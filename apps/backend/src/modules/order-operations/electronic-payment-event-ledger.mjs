import { randomUUID } from "node:crypto"

const statuses = new Set([
  "authorized", "paid", "failed", "abandoned", "outcome_unknown",
  "void_pending", "voided", "partially_refunded", "refunded",
])
const digestPattern = /^[0-9a-f]{64}$/
const idPattern = /^[A-Za-z0-9_:-]{1,255}$/
const minorPattern = /^[1-9][0-9]{0,13}$/

export class ElectronicPaymentEventError extends Error {
  constructor(code) {
    super(code)
    this.name = "ElectronicPaymentEventError"
    this.code = code
  }
}

function required(value, code) {
  if (typeof value !== "string" || !value.trim() || value.length > 255) {
    throw new ElectronicPaymentEventError(code)
  }
  return value
}

function validateEvent(event) {
  if (!event || typeof event !== "object") throw new ElectronicPaymentEventError("PAYMENT_EVENT_INVALID")
  const providerKey = required(event.providerKey, "PAYMENT_EVENT_PROVIDER_INVALID")
  const providerEventId = required(event.providerEventId, "PAYMENT_EVENT_ID_INVALID")
  const checkoutAttemptId = required(event.checkoutAttemptId, "PAYMENT_EVENT_ATTEMPT_INVALID")
  const providerPaymentId = required(event.providerPaymentId, "PAYMENT_EVENT_PAYMENT_INVALID")
  const amountMinor = typeof event.amountMinor === "string" ? event.amountMinor : ""
  if (!minorPattern.test(amountMinor)) throw new ElectronicPaymentEventError("PAYMENT_EVENT_AMOUNT_INVALID")
  if (event.currencyCode !== "EGP") throw new ElectronicPaymentEventError("PAYMENT_EVENT_CURRENCY_INVALID")
  if (!statuses.has(event.status)) throw new ElectronicPaymentEventError("PAYMENT_EVENT_STATUS_INVALID")
  if (typeof event.eventDigest !== "string" || !digestPattern.test(event.eventDigest)) {
    throw new ElectronicPaymentEventError("PAYMENT_EVENT_DIGEST_INVALID")
  }
  const occurredAt = new Date(event.occurredAt)
  if (!Number.isFinite(occurredAt.getTime())) throw new ElectronicPaymentEventError("PAYMENT_EVENT_TIME_INVALID")
  let providerRevision = null
  if (event.providerRevision !== undefined && event.providerRevision !== null) {
    if (typeof event.providerRevision !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(event.providerRevision) ||
        event.providerRevision.length > 100) {
      throw new ElectronicPaymentEventError("PAYMENT_EVENT_REVISION_INVALID")
    }
    providerRevision = event.providerRevision
  }
  for (const [value, code] of [
    [providerKey, "PAYMENT_EVENT_PROVIDER_INVALID"],
    [providerEventId, "PAYMENT_EVENT_ID_INVALID"],
    [checkoutAttemptId, "PAYMENT_EVENT_ATTEMPT_INVALID"],
    [providerPaymentId, "PAYMENT_EVENT_PAYMENT_INVALID"],
  ]) {
    if (!idPattern.test(value)) throw new ElectronicPaymentEventError(code)
  }
  return { providerKey, providerEventId, checkoutAttemptId, providerPaymentId,
    amountMinor, currencyCode: "EGP", status: event.status,
    occurredAt: occurredAt.toISOString(), providerRevision, eventDigest: event.eventDigest }
}

function majorToMinor(value) {
  const match = String(value).match(/^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,2}))?$/)
  if (!match) throw new ElectronicPaymentEventError("PAYMENT_ATTEMPT_AMOUNT_INVALID")
  return (BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"))).toString()
}

const transitions = {
  initiated: new Set(["authorized", "paid", "failed", "abandoned", "outcome_unknown", "void_pending"]),
  authorized: new Set(["paid", "failed", "outcome_unknown", "void_pending"]),
  outcome_unknown: new Set(["authorized", "paid", "failed", "void_pending"]),
  failed: new Set(["paid"]),
  abandoned: new Set(["paid"]),
  void_pending: new Set(["voided", "paid"]),
  paid: new Set(["partially_refunded", "refunded"]),
  partially_refunded: new Set(["refunded"]),
  refunded: new Set(),
  voided: new Set(["paid"]),
}

async function compareExistingEvent(db, event) {
  const result = await db.query(`SELECT provider_key,provider_event_id,electronic_payment_attempt_id,
    checkout_attempt_id,order_id,provider_payment_id,status,amount_minor::text,currency_code,
    occurred_at,provider_revision,event_digest,disposition
    FROM electronic_payment_event WHERE provider_key=$1 AND provider_event_id=$2 FOR UPDATE`,
  [event.providerKey, event.providerEventId])
  const row = result.rows[0]
  if (!row) return null
  const same = row.checkout_attempt_id === event.checkoutAttemptId &&
    row.provider_payment_id === event.providerPaymentId &&
    row.status === event.status && String(row.amount_minor) === event.amountMinor &&
    String(row.currency_code).trim() === event.currencyCode &&
    new Date(row.occurred_at).toISOString() === event.occurredAt &&
    row.provider_revision === event.providerRevision && row.event_digest.trim() === event.eventDigest
  if (!same) throw new ElectronicPaymentEventError("PAYMENT_EVENT_IDENTITY_CONFLICT")
  return row
}

async function eventOrdering(db, attemptId, event) {
  const prior = await db.query(`SELECT provider_revision,occurred_at FROM electronic_payment_event
    WHERE electronic_payment_attempt_id=$1 ORDER BY created_at`, [attemptId])
  if (!prior.rowCount) return "current"
  const anyRevision = prior.rows.some((row) => row.provider_revision !== null)
  if (event.providerRevision !== null || anyRevision) {
    if (event.providerRevision === null || prior.rows.some((row) => row.provider_revision === null)) {
      return "ambiguous"
    }
    const latest = prior.rows.reduce((max, row) => {
      const revision = BigInt(row.provider_revision)
      return revision > max ? revision : max
    }, -1n)
    const incoming = BigInt(event.providerRevision)
    return incoming < latest ? "stale" : incoming === latest ? "ambiguous" : "current"
  }
  const latestTime = prior.rows.reduce((max, row) => {
    const time = new Date(row.occurred_at).getTime()
    return time > max ? time : max
  }, -1)
  return new Date(event.occurredAt).getTime() < latestTime ? "stale" : "current"
}

/**
 * Apply normalized data returned by a trusted adapter after authenticity
 * verification. Internal only; request-body data must never call this directly.
 */
export async function applyVerifiedElectronicPaymentEvent(db, rawEvent) {
  const event = validateEvent(rawEvent)
  await db.query("BEGIN")
  try {
    const attemptResult = await db.query(`SELECT id,checkout_attempt_id,order_id,cart_id,provider_key,
      provider_payment_id,amount::text AS amount_major,currency_code,status,last_provider_event_at
      FROM electronic_payment_attempt
      WHERE checkout_attempt_id=$1 AND deleted_at IS NULL FOR UPDATE`, [event.checkoutAttemptId])
    const attempt = attemptResult.rows[0]
    if (!attempt || attempt.checkout_attempt_id !== event.checkoutAttemptId || !attempt.order_id) {
      throw new ElectronicPaymentEventError("PAYMENT_EVENT_ATTEMPT_UNAVAILABLE")
    }
    if (attempt.provider_key !== event.providerKey) throw new ElectronicPaymentEventError("PAYMENT_EVENT_PROVIDER_MISMATCH")
    if (String(attempt.currency_code).toUpperCase() !== event.currencyCode ||
        majorToMinor(attempt.amount_major) !== event.amountMinor) {
      throw new ElectronicPaymentEventError("PAYMENT_EVENT_AMOUNT_MISMATCH")
    }
    if (attempt.provider_payment_id && attempt.provider_payment_id !== event.providerPaymentId) {
      throw new ElectronicPaymentEventError("PAYMENT_EVENT_PAYMENT_MISMATCH")
    }

    const replay = await compareExistingEvent(db, event)
    if (replay) {
      await db.query("COMMIT")
      return { status: attempt.status, replayed: true, disposition: replay.disposition }
    }

    const ordering = await eventOrdering(db, attempt.id, event)
    const currentStatus = attempt.status
    let disposition = "applied"
    let nextStatus = currentStatus
    if (ordering === "stale") disposition = "stale"
    else if (ordering === "ambiguous") disposition = "needs_reconciliation"
    else if (event.status === "partially_refunded" || event.status === "refunded") {
      // Refund state alone is insufficient: no refund amount/identity ledger exists yet.
      disposition = "needs_reconciliation"
    } else if (currentStatus === event.status) disposition = "applied"
    else if (transitions[currentStatus]?.has(event.status)) nextStatus = event.status
    else disposition = "needs_reconciliation"

    await db.query(`INSERT INTO electronic_payment_event
      (id,provider_key,provider_event_id,electronic_payment_attempt_id,checkout_attempt_id,order_id,
       provider_payment_id,status,amount_minor,currency_code,occurred_at,provider_revision,event_digest,disposition)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::timestamptz,$12,$13,$14)`,
    ["epe_" + randomUUID(), event.providerKey, event.providerEventId, attempt.id,
      event.checkoutAttemptId, attempt.order_id, event.providerPaymentId, event.status,
      event.amountMinor, event.currencyCode, event.occurredAt, event.providerRevision,
      event.eventDigest, disposition])

    if (disposition === "applied" && nextStatus !== currentStatus) {
      const updated = await db.query(`UPDATE electronic_payment_attempt SET status=$1,
        provider_payment_id=COALESCE(provider_payment_id,$2),
        last_provider_event_at=$3::timestamptz,
        paid_at=CASE WHEN $1='paid' THEN COALESCE(paid_at,$3::timestamptz) ELSE paid_at END,
        updated_at=NOW()
        WHERE id=$4 AND status=$5 AND deleted_at IS NULL`,
      [nextStatus, event.providerPaymentId, event.occurredAt, attempt.id, currentStatus])
      if (updated.rowCount !== 1) throw new ElectronicPaymentEventError("PAYMENT_EVENT_ATTEMPT_CHANGED")
    } else if (disposition === "applied" && nextStatus === currentStatus) {
      await db.query(`UPDATE electronic_payment_attempt SET
        provider_payment_id=COALESCE(provider_payment_id,$1),
        last_provider_event_at=GREATEST(COALESCE(last_provider_event_at,$2::timestamptz),$2::timestamptz),
        paid_at=CASE WHEN status='paid' THEN COALESCE(paid_at,$2::timestamptz) ELSE paid_at END,
        updated_at=NOW() WHERE id=$3 AND deleted_at IS NULL`,
      [event.providerPaymentId, event.occurredAt, attempt.id])
    }

    await db.query("COMMIT")
    return { status: nextStatus, replayed: false, disposition }
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}
