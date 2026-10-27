import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { createPgClient, verifyDisposableTargetServices } from "./shared/tp-harness.mjs"
import { applyVerifiedElectronicPaymentEvent } from "../src/modules/order-operations/electronic-payment-event-ledger.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
createRequire(path.join(root, "package.json"))
const check = (name, condition, detail = "") => {
  if (!condition) throw new Error("FAIL " + name + (detail ? ": " + detail : ""))
  console.log("PASS " + name)
}
const expectCode = async (name, code, callback) => {
  try {
    await callback()
    throw new Error("Expected " + code)
  } catch (error) {
    if (error.message === "Expected " + code) throw error
    check(name, error.code === code || error.message === code, error.code || error.message)
  }
}
const digestEvent = (event) => createHash("sha256").update(JSON.stringify([
  event.providerKey, event.providerEventId, event.checkoutAttemptId, event.providerPaymentId,
  event.status, event.amountMinor, event.currencyCode, event.occurredAt, event.providerRevision ?? null,
])).digest("hex")
const makeEvent = (attempt, overrides = {}) => {
  const event = {
    providerKey: "test_simulator",
    providerEventId: "evt_" + randomUUID(),
    checkoutAttemptId: attempt.checkoutAttemptId,
    providerPaymentId: attempt.providerPaymentId,
    status: "paid",
    amountMinor: "6170",
    currencyCode: "EGP",
    occurredAt: new Date().toISOString(),
    providerRevision: "1",
    ...overrides,
  }
  event.eventDigest = digestEvent(event)
  return event
}
const target = verifyDisposableTargetServices(process.env.DATABASE_URL,
  process.env.LOCKING_REDIS_URL || process.env.REDIS_URL)
check("approved_disposable_postgres_redis_target", target.verified && target.executionProfile === "ci_ephemeral_service")
const first = createPgClient(process.env.DATABASE_URL)
const second = createPgClient(process.env.DATABASE_URL)
const fixtureAttempts = []
let connected = false
async function newAttempt(label, status = "initiated") {
  const id = "epa_" + randomUUID()
  const checkoutAttemptId = randomUUID()
  const providerPaymentId = "pay_" + randomUUID()
  const idempotencyKey = "event-fixture:" + label + ":" + randomUUID()
  await first.query(`INSERT INTO electronic_payment_attempt
    (id,order_id,cart_id,checkout_attempt_id,provider_key,provider_payment_id,amount,currency_code,status,idempotency_key)
    VALUES($1,$2,$3,$4,'test_simulator',$5,61.70,'EGP',$6,$7)`,
  [id, "ord_event_fixture_" + label, "cart_event_fixture_" + label, checkoutAttemptId,
    providerPaymentId, status, idempotencyKey])
  const attempt = { id, checkoutAttemptId, providerPaymentId }
  fixtureAttempts.push(attempt)
  return attempt
}
try {
  await first.connect()
  await second.connect()
  connected = true
  const relation = await first.query("SELECT to_regclass('electronic_payment_event') AS relation")
  check("event_inbox_migration_applied", Boolean(relation.rows[0]?.relation))

  const paidAttempt = await newAttempt("duplicate")
  const paidEvent = makeEvent(paidAttempt)
  const applied = await applyVerifiedElectronicPaymentEvent(first, paidEvent)
  check("verified_simulated_paid_event_applies", applied.status === "paid" &&
    applied.disposition === "applied" && !applied.replayed)
  const replay = await applyVerifiedElectronicPaymentEvent(first, paidEvent)
  check("duplicate_provider_event_is_idempotent", replay.replayed &&
    replay.status === "paid" && replay.disposition === "applied")
  const eventCount = await first.query(`SELECT count(*)::int AS n FROM electronic_payment_event
    WHERE checkout_attempt_id=$1`, [paidAttempt.checkoutAttemptId])
  check("duplicate_event_persists_one_inbox_row", eventCount.rows[0].n === 1)

  const conflictEvent = makeEvent(paidAttempt, { ...paidEvent, status: "failed", providerRevision: "2" })
  await expectCode("reused_event_id_with_changed_content_rejected", "PAYMENT_EVENT_IDENTITY_CONFLICT",
    () => applyVerifiedElectronicPaymentEvent(first, conflictEvent))
  const afterConflict = await first.query("SELECT status FROM electronic_payment_attempt WHERE id=$1", [paidAttempt.id])
  check("event_identity_conflict_does_not_change_attempt", afterConflict.rows[0].status === "paid")

  const wrongAmount = makeEvent(paidAttempt, {
    providerEventId: "evt_wrong_amount_" + randomUUID(),
    amountMinor: "6171",
    providerRevision: "3",
  })
  await expectCode("event_amount_must_match_native_attempt", "PAYMENT_EVENT_AMOUNT_MISMATCH",
    () => applyVerifiedElectronicPaymentEvent(first, wrongAmount))
  const badAmountRows = await first.query("SELECT count(*)::int AS n FROM electronic_payment_event WHERE provider_event_id=$1",
    [wrongAmount.providerEventId])
  check("amount_mismatch_is_not_applied_or_journaled", badAmountRows.rows[0].n === 0)

  const unknownAttempt = await newAttempt("unknown")
  const unknownEvent = makeEvent(unknownAttempt, {
    providerEventId: "evt_unknown_" + randomUUID(),
    status: "outcome_unknown",
    providerRevision: "1",
  })
  const unknownResult = await applyVerifiedElectronicPaymentEvent(first, unknownEvent)
  check("uncertain_provider_outcome_stays_unknown", unknownResult.status === "outcome_unknown")
  const resolvedEvent = makeEvent(unknownAttempt, {
    providerEventId: "evt_resolved_" + randomUUID(),
    status: "paid",
    providerRevision: "2",
  })
  const resolved = await applyVerifiedElectronicPaymentEvent(first, resolvedEvent)
  check("higher_revision_resolves_unknown_to_paid", resolved.status === "paid" &&
    resolved.disposition === "applied")

  const refundAttempt = await newAttempt("refund_boundary", "paid")
  const refundEvent = makeEvent(refundAttempt, {
    providerEventId: "evt_refund_" + randomUUID(),
    status: "refunded",
    providerRevision: "1",
  })
  const refundResult = await applyVerifiedElectronicPaymentEvent(first, refundEvent)
  check("refund_without_amount_ledger_requires_reconciliation",
    refundResult.status === "paid" && refundResult.disposition === "needs_reconciliation")
  const refundStored = await first.query(`SELECT disposition FROM electronic_payment_event
    WHERE provider_key=$1 AND provider_event_id=$2`,
  [refundEvent.providerKey, refundEvent.providerEventId])
  check("unaccounted_refund_event_is_retained_not_applied",
    refundStored.rows[0].disposition === "needs_reconciliation")

  const orderedAttempt = await newAttempt("ordering")
  const orderedPaid = makeEvent(orderedAttempt, {
    providerEventId: "evt_ordered_paid_" + randomUUID(),
    status: "paid",
    providerRevision: "8",
  })
  await applyVerifiedElectronicPaymentEvent(first, orderedPaid)
  const staleAuthorized = makeEvent(orderedAttempt, {
    providerEventId: "evt_stale_auth_" + randomUUID(),
    status: "authorized",
    providerRevision: "7",
    occurredAt: new Date(Date.now() - 60000).toISOString(),
  })
  const stale = await applyVerifiedElectronicPaymentEvent(first, staleAuthorized)
  check("stale_provider_revision_cannot_regress_paid", stale.status === "paid" &&
    stale.disposition === "stale")
  const staleStored = await first.query(`SELECT disposition FROM electronic_payment_event
    WHERE provider_key=$1 AND provider_event_id=$2`,
  [staleAuthorized.providerKey, staleAuthorized.providerEventId])
  check("stale_event_is_retained_for_audit", staleStored.rows[0].disposition === "stale")

  const concurrentAttempt = await newAttempt("concurrent")
  const concurrentEvent = makeEvent(concurrentAttempt, {
    providerEventId: "evt_concurrent_" + randomUUID(),
    status: "authorized",
    providerRevision: "1",
  })
  const concurrent = await Promise.all([
    applyVerifiedElectronicPaymentEvent(first, concurrentEvent),
    applyVerifiedElectronicPaymentEvent(second, concurrentEvent),
  ])
  check("concurrent_duplicate_deliveries_have_one_apply",
    concurrent.filter((item) => !item.replayed && item.disposition === "applied").length === 1 &&
    concurrent.filter((item) => item.replayed).length === 1)
  const concurrentCount = await first.query(`SELECT count(*)::int AS n FROM electronic_payment_event
    WHERE checkout_attempt_id=$1`, [concurrentAttempt.checkoutAttemptId])
  check("concurrent_duplicate_creates_one_event_row", concurrentCount.rows[0].n === 1)
  const finalAttempt = await first.query("SELECT status FROM electronic_payment_attempt WHERE id=$1",
    [concurrentAttempt.id])
  check("concurrent_event_attempt_state_is_authorized", finalAttempt.rows[0].status === "authorized")

  const wrongProvider = makeEvent(concurrentAttempt, {
    providerEventId: "evt_wrong_provider_" + randomUUID(),
    providerKey: "unselected_provider",
    providerRevision: "2",
  })
  await expectCode("unconfigured_provider_cannot_mutate_attempt", "PAYMENT_EVENT_PROVIDER_MISMATCH",
    () => applyVerifiedElectronicPaymentEvent(first, wrongProvider))

  console.log("Electronic payment event inbox: 19/19 assertions passed.")
} finally {
  if (connected) {
    const attemptIds = fixtureAttempts.map((item) => item.checkoutAttemptId)
    if (attemptIds.length) {
      await first.query("DELETE FROM electronic_payment_event WHERE checkout_attempt_id=ANY($1::text[])", [attemptIds])
      await first.query("DELETE FROM electronic_payment_attempt WHERE checkout_attempt_id=ANY($1::text[])", [attemptIds])
    }
    await second.end()
    await first.end()
  }
}
