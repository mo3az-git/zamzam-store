import { fork } from "node:child_process"

export async function runReconciliationOperationsScenarios(ctx) {
  const { runtime, knex, adminPg, batch, makeCart, makeNativeOrder, saveSnapshot, check, expectCode,
    events, InventoryLedger, findNativeOrdersByCart, rootRequire, createPgClient, isolatedUrl,
    completeReservedCartWithInventory } = ctx
  const { CheckoutReconciliationOperations } = rootRequire("./apps/backend/src/modules/batch-inventory/checkout-reconciliation-operations.ts")
  const { markOrderCreationStarted } = rootRequire("./apps/backend/src/modules/batch-inventory/order-correlation.ts")
  const service = new CheckoutReconciliationOperations(runtime.container, async () => true)
  const fixtureFor = async (label) => {
    const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], label)
    await new InventoryLedger(runtime.container).reserveCart(fixture.authority)
    return fixture
  }
  const state = async (fixture) => {
    const snapshot = await saveSnapshot([batch.id])
    const orders = await findNativeOrdersByCart(knex, fixture.cart.id)
    const reservations = snapshot.reservations.filter((r) => r.checkout_attempt_id === fixture.authority.attemptId)
    return { cartId: fixture.cart.id, attempt: snapshot.attempts.find((a) => a.checkout_attempt_id === fixture.authority.attemptId),
      session: snapshot.sessions.find((s) => s.cart_id === fixture.cart.id), orders, reservations,
      allocations: snapshot.allocations.filter((a) => orders.some((o) => o.id === a.order_id)),
      movements: snapshot.movements.filter((m) => orders.some((o) => o.id === m.reference_id) || reservations.some((r) => r.id === m.reference_id)),
      batch: snapshot.batches.find((b) => b.id === batch.id) }
  }
  const worker = (mode, authority, boundary) => {
    const child = fork(new URL("./test-reconciliation-worker.mjs", import.meta.url), [], {
      stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [],
    })
    let stderr = "", exited = null
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    const queue = [], waiters = []
    const exit = new Promise((resolve) => child.once("exit", (code, signal) => {
      exited = { code, signal }; resolve(exited)
      while (waiters.length) waiters.shift().reject(new Error("worker exited before message: " + stderr))
    }))
    child.on("message", (message) => {
      if (waiters.length) waiters.shift().resolve(message)
      else queue.push(message)
    })
    child.on("error", (error) => { while (waiters.length) waiters.shift().reject(error) })
    const next = () => {
      if (queue.length) return Promise.resolve(queue.shift())
      if (exited) return Promise.reject(new Error("worker already exited: " + stderr))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worker IPC deadline exceeded")), 60000)
        waiters.push({ resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) } })
      })
    }
    child.send({ mode, authority, boundary })
    return { child, next, exit }
  }
  const prepare = async (mode, fixture, boundary) => {
    const w = worker(mode, fixture.authority, boundary)
    const ready = await w.next()
    if (ready.type !== "ready") throw new Error("worker failed to initialize: " + JSON.stringify(ready))
    return { ...w, ready }
  }
  const crashAt = async (fixture, boundary) => {
    const w = await prepare("crash", fixture, boundary)
    w.child.send({ go: true })
    const barrier = await w.next()
    if (barrier.type !== "barrier" || barrier.boundary !== boundary) throw new Error("missing crash barrier: " + JSON.stringify(barrier))
    const beforeKill = await state(fixture)
    const killed = w.child.kill("SIGKILL")
    const termination = await w.exit
    const afterKill = await state(fixture)
    events.push({ boundary, crash: { pid: barrier.pid, dbPid: w.ready.dbPid, killed, termination }, beforeKill, afterKill })
    check(boundary + "_process_really_terminated_and_state_persisted", true,
      { pid: barrier.pid, killed, termination, afterKill },
      killed && (termination.signal === "SIGKILL" || (termination.code !== null && termination.code !== 0)) &&
      JSON.stringify(beforeKill) === JSON.stringify(afterKill))
    return afterKill
  }
  const recoverInWorker = async (fixture) => {
    const w = await prepare("recover", fixture)
    w.child.send({ go: true })
    const message = await w.next()
    const termination = await w.exit
    if (message.type !== "result" || termination.code !== 0) throw new Error("recovery worker failed: " + JSON.stringify({ message, termination }))
    return message
  }
  const boundaries = ["afterFenceCommit", "afterNativeReturn", "afterCorrelationPersisted", "afterConversionCommit"]
  let unresolvedFixture
  const unfenced = await fixtureFor("unfenced-attempt")
  const unfencedBefore = await state(unfenced)
  const unfencedResult = await service.recover(unfenced.authority)
  await expectCode("transaction_guard_rejects_unfenced_attempt", "RECONCILIATION_FENCE_REQUIRED",
    () => completeReservedCartWithInventory(runtime.container, unfenced.authority, { reconciliationOnly: true }))
  const unfencedAfter = await state(unfenced)
  check("unfenced_attempt_never_starts_native_checkout", true, unfencedResult,
    unfencedResult.reason === "RECONCILIATION_FENCE_REQUIRED" && JSON.stringify(unfencedBefore) === JSON.stringify(unfencedAfter))
  for (const boundary of boundaries) {
    const fixture = await fixtureFor("process-kill-" + boundary)
    const before = await crashAt(fixture, boundary)
    const inspection = await service.inspect({ cartId: fixture.cart.id, attemptId: fixture.authority.attemptId })
    check(boundary + "_inspection_hides_owner_token", true, { decision: inspection.decision, reason: inspection.reason },
      !JSON.stringify(inspection).includes(fixture.authority.ownerId))
    const recovery = await recoverInWorker(fixture)
    const after = await state(fixture)
    events.push({ boundary, recovery, after })
    if (boundary === "afterFenceCommit") {
      unresolvedFixture = fixture
      check("no_order_after_process_death_stays_unresolved", true, { before, recovery, after },
        before.orders.length === 0 && after.orders.length === 0 && recovery.result.reason === "NO_NATIVE_ORDER_AFTER_FENCE" &&
        after.allocations.length === 0 && after.reservations.every((r) => r.status === "active") &&
        !after.movements.some((m) => m.movement_type === "reservation_release"))
    } else {
      const replay = await service.recover(fixture.authority)
      const afterReplay = await state(fixture)
      check(boundary + "_new_process_recovers_original_order_once", true, { before, recovery, replay, after },
        before.orders.length === 1 && after.orders.length === 1 && after.orders[0].id === before.orders[0].id &&
        recovery.result.result?.orderId === before.orders[0].id && after.allocations.length === 2 &&
        after.movements.filter((m) => m.movement_type === "allocation_conversion").length === 2 &&
        !after.movements.some((m) => m.movement_type === "reservation_release") &&
        replay.reason === "EXACT_REPLAY" && JSON.stringify(after) === JSON.stringify(afterReplay))
    }
  }

  await makeNativeOrder(unresolvedFixture, { bindAttempt: false })
  await makeNativeOrder(unresolvedFixture, { bindAttempt: false })
  const ambiguousBefore = await state(unresolvedFixture)
  const ambiguousInspection = await service.inspect({ cartId: unresolvedFixture.cart.id, attemptId: unresolvedFixture.authority.attemptId })
  const ambiguousResult = await service.recover(unresolvedFixture.authority)
  const ambiguousAfter = await state(unresolvedFixture)
  check("multiple_real_links_are_reported_without_mutation", true, { ambiguousInspection, ambiguousResult },
    ambiguousInspection.reason === "MULTIPLE_NATIVE_ORDERS" && ambiguousResult.decision === "ambiguous" &&
    ambiguousBefore.orders.length === 2 && JSON.stringify(ambiguousBefore) === JSON.stringify(ambiguousAfter))

  const denied = new CheckoutReconciliationOperations(runtime.container, async () => false)
  await expectCode("unauthorized_operator_cannot_inspect", "OPERATOR_NOT_AUTHORIZED",
    () => denied.inspect({ cartId: unresolvedFixture.cart.id, attemptId: unresolvedFixture.authority.attemptId }))
  await expectCode("unauthorized_operator_cannot_recover", "OPERATOR_NOT_AUTHORIZED", () => denied.recover(unresolvedFixture.authority))

  const corrupt = await fixtureFor("bad-order-quantity")
  await markOrderCreationStarted(knex, corrupt.authority)
  await makeNativeOrder(corrupt, { lineQuantities: [9, 3], bindAttempt: false })
  const corruptBefore = await state(corrupt)
  const corruptInspection = await service.inspect({ cartId: corrupt.cart.id, attemptId: corrupt.authority.attemptId })
  const corruptResult = await service.recover(corrupt.authority)
  const corruptAfter = await state(corrupt)
  check("divergent_order_quantity_fails_closed", true, { corruptInspection, corruptResult },
    corruptInspection.reason === "ORDER_LINE_QUANTITY_MISMATCH" && corruptResult.decision === "blocked" &&
    JSON.stringify(corruptBefore) === JSON.stringify(corruptAfter))

  const concurrent = await fixtureFor("concurrent-operators")
  const concurrentBefore = await crashAt(concurrent, "afterCorrelationPersisted")
  await adminPg.query(`UPDATE idempotency_key SET lease_owner_id='replacement-owner'
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [concurrent.authority.attemptId])
  const stolen = await service.recover(concurrent.authority)
  const stolenState = await state(concurrent)
  check("stolen_durable_lease_blocks_recovery", true, { stolen, stolenState },
    stolen.reason === "LEASE_OWNER_MISMATCH" && stolenState.allocations.length === 0 &&
    stolenState.orders[0]?.id === concurrentBefore.orders[0].id)
  await adminPg.query(`UPDATE idempotency_key SET lease_owner_id=$2
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [concurrent.authority.attemptId, concurrent.authority.ownerId])
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()-INTERVAL '10 minutes'
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [concurrent.authority.attemptId])
  const expired = await service.recover(concurrent.authority)
  const wrongOwner = await service.recover({ ...concurrent.authority, ownerId: "stale-owner" })
  const expiredState = await state(concurrent)
  check("expired_or_stolen_authority_never_mutates", true, { expired, wrongOwner, expiredState },
    expired.reason === "LEASE_EXPIRED_OR_INVALID" && wrongOwner.decision === "blocked" &&
    expiredState.allocations.length === 0 && expiredState.orders[0]?.id === concurrentBefore.orders[0].id)
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [concurrent.authority.attemptId])
  const staleOwner = await service.recover({ ...concurrent.authority, ownerId: "stale-owner" })
  const staleEpoch = await service.recover({ ...concurrent.authority, epoch: concurrent.authority.epoch + 1 })
  check("stale_owner_and_epoch_cannot_take_over", true, { staleOwner, staleEpoch },
    staleOwner.reason === "STALE_CHECKOUT_AUTHORITY" && staleEpoch.reason === "STALE_CHECKOUT_AUTHORITY")
  const [a,b] = await Promise.all([prepare("recover", concurrent), prepare("recover", concurrent)])
  const holder = createPgClient(isolatedUrl)
  await holder.connect()
  let blockedWorkers = 0
  try {
    await holder.query("BEGIN")
    const holderPid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["phase0:order:" + concurrentBefore.orders[0].id])
    a.child.send({ go: true }); b.child.send({ go: true })
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      blockedWorkers = (await adminPg.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`, [holderPid])).rows[0].n
      if (blockedWorkers >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (blockedWorkers < 2) throw new Error("Both operator workers did not reach the order lock")
    await holder.query("COMMIT")
  } finally {
    await holder.query("ROLLBACK").catch(() => {})
    await holder.end()
  }
  const [left,right] = await Promise.all([a.next(), b.next()])
  const exits = await Promise.all([a.exit,b.exit])
  const final = await state(concurrent)
  const lockEvents = []
  const observingService = new CheckoutReconciliationOperations(runtime.container, async () => true,
    (name, data) => { lockEvents.push({ name, ...data }) })
  const retry = await observingService.recover(concurrent.authority)
  events.push({ boundary: "concurrent-operators", workers: [left,right], blockedWorkers, exits, final, retry })
  check("independent_operators_recover_one_order_and_replay", true, { left, right, exits, final, retry },
    left.type === "result" && right.type === "result" && left.pid !== right.pid && blockedWorkers >= 2 &&
    exits.every((e) => e.code === 0) && [left.result,right.result].some((r) => r.reason === "ORDER_RECOVERED") &&
    [left.result,right.result].some((r) => r.reason === "EXACT_REPLAY") && retry.reason === "EXACT_REPLAY" &&
    final.orders.length === 1 && final.orders[0].id === concurrentBefore.orders[0].id &&
    final.allocations.length === 2 && final.movements.filter((m) => m.movement_type === "allocation_conversion").length === 2 &&
    !final.movements.some((m) => m.movement_type === "reservation_release"))
  const order = lockEvents.filter((e) => ["order_advisory_lock_acquired", "conversion_session_locked",
    "conversion_attempt_locked", "conversion_batches_locked_ascending", "conversion_reservations_locked"].includes(e.name)).map((e) => e.name)
  check("reconciliation_replay_uses_revision18_lock_order", true, order,
    JSON.stringify(order) === JSON.stringify(["order_advisory_lock_acquired", "conversion_session_locked",
      "conversion_attempt_locked", "conversion_batches_locked_ascending", "conversion_reservations_locked"]))
  await adminPg.query("UPDATE inventory_batch SET quantity_reserved=quantity_reserved+1 WHERE id=$1", [batch.id])
  try {
    const corruptLedger = await service.inspect({ cartId: concurrent.cart.id, attemptId: concurrent.authority.attemptId })
    const corruptRecovery = await service.recover(concurrent.authority)
    check("ledger_divergence_is_reported_without_recovery", true, { corruptLedger, corruptRecovery },
      corruptLedger.reason === "INVENTORY_LEDGER_DIVERGENCE" && corruptRecovery.reason === "INVENTORY_LEDGER_DIVERGENCE")
  } finally {
    await adminPg.query("UPDATE inventory_batch SET quantity_reserved=quantity_reserved-1 WHERE id=$1", [batch.id])
  }
}
