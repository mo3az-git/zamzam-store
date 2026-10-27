import { createHash, randomUUID } from "node:crypto"
import { fork } from "node:child_process"

// Runs only inside the inventory harness's verified disposable database.
export async function runNativeRecoveryScenarios(ctx) {
  const { runtime, knex, adminPg, batch, makeCart, makeNativeOrder, reservationsFor,
    convert, saveSnapshot, check, expectCode, events, InventoryLedger,
    completeReservedCartWithInventory: complete, findNativeOrdersByCart, isolatedUrl, createPgClient } = ctx
  const scope = () => runtime.container.createScope()
  const reserve = (fixture) => new InventoryLedger(scope()).reserveCart(fixture.authority)
  const readState = async (fixture) => {
    const snapshot = await saveSnapshot([batch.id])
    const attempt = snapshot.attempts.find((row) => row.checkout_attempt_id === fixture.authority.attemptId)
    const session = snapshot.sessions.find((row) => row.cart_id === fixture.cart.id)
    const reservations = snapshot.reservations.filter((row) => row.checkout_attempt_id === fixture.authority.attemptId)
    const orders = await findNativeOrdersByCart(knex, fixture.cart.id)
    const allocations = snapshot.allocations.filter((row) => orders.some((order) => order.id === row.order_id))
    const movements = snapshot.movements.filter((row) => orders.some((order) => order.id === row.reference_id) ||
      reservations.some((reservation) => reservation.id === row.reference_id))
    return { cartId: fixture.cart.id, attempt, session, reservations, orders, allocations, movements,
      batch: snapshot.batches.find((row) => row.id === batch.id) }
  }
  const unchangedStock = (state) => state.reservations.every((row) => row.status === "active") &&
    !state.movements.some((row) => row.movement_type === "reservation_release")
  const definitions = [
    ["after_fence", "afterFenceCommit", false, false],
    ["after_native", "afterNativeReturn", true, false],
    ["after_correlation", "afterCorrelationPersisted", true, false],
    ["during_conversion", "afterConversionAllocation", true, false],
    ["after_conversion_commit", "afterConversionCommit", true, true],
  ]
  for (const [name, point, hasOrder, committed] of definitions) {
    const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], "recovery-" + name)
    await reserve(fixture)
    let injections = 0, nativeCalls = 0
    await expectCode(name + "_injected", "RECOVERY_FAULT", () => complete(scope(), fixture.authority, {
      beforeNativeCompletion() { nativeCalls++ },
      [point]() { injections++; throw Object.assign(new Error("RECOVERY_FAULT"), { code: "RECOVERY_FAULT" }) },
    }))
    const interrupted = await readState(fixture)
    events.push({ boundary: name, phase: "interrupted", state: interrupted })
    check(name + "_persisted_state", true, { injections, nativeCalls, state: interrupted },
      injections === 1 && nativeCalls === (name === "after_fence" ? 0 : 1) &&
      interrupted.orders.length === (hasOrder ? 1 : 0) &&
      interrupted.allocations.length === (committed ? 2 : 0) &&
      interrupted.movements.filter((row) => row.movement_type === "allocation_conversion").length === (committed ? 2 : 0) &&
      (committed ? interrupted.reservations.every((row) => row.status === "converted") : unchangedStock(interrupted)))
    let retryCalls = 0
    const recovered = await complete(scope(), fixture.authority, { beforeNativeCompletion() { retryCalls++ } })
    const recoveredState = await readState(fixture)
    events.push({ boundary: name, phase: "recovered", result: recovered, state: recoveredState })
    if (!hasOrder) {
      check(name + "_recovery_stays_fenced", true, { recovered, retryCalls, state: recoveredState },
        recovered.conversionStatus === "pending_reconciliation" && retryCalls === 0 &&
        recoveredState.orders.length === 0 && unchangedStock(recoveredState))
      continue
    }
    check(name + "_recovery_preserves_order_and_single_allocation_set", true,
      { recovered, retryCalls, state: recoveredState },
      retryCalls === 0 && recovered.orderId === interrupted.orders[0].id &&
      recoveredState.orders.length === 1 && recoveredState.allocations.length === 2 &&
      recoveredState.movements.filter((row) => row.movement_type === "allocation_conversion").length === 2 &&
      recoveredState.reservations.every((row) => row.status === "converted") &&
      !recoveredState.movements.some((row) => row.movement_type === "reservation_release"))
    const replay = await complete(scope(), fixture.authority)
    const replayState = await readState(fixture)
    check(name + "_exact_replay", true, { replay, allocationIds: replayState.allocations.map((row) => row.id),
      movementIds: replayState.movements.map((row) => row.id) },
      replay.replayed && replay.orderId === recovered.orderId &&
      JSON.stringify(replayState.allocations) === JSON.stringify(recoveredState.allocations) &&
      JSON.stringify(replayState.movements) === JSON.stringify(recoveredState.movements) &&
      JSON.stringify(replayState.batch) === JSON.stringify(recoveredState.batch))
  }

  // A second Medusa runtime runs in a different process against the isolated database.
  const fixture = await makeCart([{ quantity: 2 }], "worker-authority")
  const staleAuthority = { ...fixture.authority }
  const nextAttempt = randomUUID(), nextKey = randomUUID()
  await adminPg.query(`INSERT INTO idempotency_key(key,request_path,request_hash,status,lease_owner_id,expires_at,locked_at,last_heartbeat_at)
    VALUES($1,$2,$3,'pending',$4,NOW()+INTERVAL '14 days',NOW(),NOW())`,
  [nextKey, "/store/carts/" + fixture.cart.id + "/complete", createHash("sha256").update(nextKey).digest("hex"), fixture.ownerId])
  await adminPg.query(`INSERT INTO cart_checkout_attempt(checkout_attempt_id,cart_id,epoch,idempotency_key,payment_method,lease_owner_id)
    VALUES($1::uuid,$2,2,$3,'cod',$4)`, [nextAttempt, fixture.cart.id, nextKey, fixture.ownerId])
  await adminPg.query("UPDATE cart_checkout_session SET epoch=2,current_attempt_id=$2::uuid WHERE cart_id=$1", [fixture.cart.id, nextAttempt])
  fixture.authority = { ...fixture.authority, epoch: 2, attemptId: nextAttempt }
  await reserve(fixture)
  let releaseFence, enteredFence
  const gate = new Promise((resolve) => { releaseFence = resolve })
  const entered = new Promise((resolve) => { enteredFence = resolve })
  let calls = 0
  const first = complete(scope(), fixture.authority, {
    async afterFenceCommit() { enteredFence(); await gate },
    beforeNativeCompletion() { calls++ },
  })
  await entered
  const waitingState = await readState(fixture)
  const worker = fork(new URL("./test-native-recovery-worker.mjs", import.meta.url), [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [],
  })
  let workerStderr = ""
  worker.stderr.on("data", (chunk) => { workerStderr += chunk.toString() })
  const workerExit = new Promise((resolve) => worker.once("exit", resolve))
  const workerReply = new Promise((resolve, reject) => {
    worker.once("error", reject)
    worker.once("message", resolve)
    worker.once("exit", (code) => { if (code !== 0) reject(new Error("Recovery worker exited " + code + ": " + workerStderr)) })
  })
  worker.send({ authority: fixture.authority })
  const workerResult = await workerReply
  const workerExitCode = await workerExit
  if (workerResult.error) throw new Error(workerResult.error)
  if (workerExitCode !== 0) throw new Error("Recovery worker failed: " + workerStderr)
  const second = workerResult.result
  await expectCode("different_owner_cannot_enter", "CART_LOCK_OWNER_MISMATCH",
    () => complete(scope(), { ...fixture.authority, ownerId: "other-worker" }))
  await expectCode("stale_epoch_cannot_enter", "STALE_OR_UNAUTHORIZED_ATTEMPT",
    () => complete(scope(), staleAuthority))
  const afterRejected = await readState(fixture)
  check("competing_workers_leave_fenced_stock_unchanged", true, { waitingState, workerResult, afterRejected },
    workerResult.workerPid !== process.pid && Number(workerResult.pid) > 0 &&
    second.conversionStatus === "pending_reconciliation" && unchangedStock(afterRejected) &&
    afterRejected.orders.length === 0 && afterRejected.allocations.length === 0 &&
    afterRejected.batch.quantity_reserved === waitingState.batch.quantity_reserved)
  releaseFence()
  const firstResult = await first
  const finalState = await readState(fixture)
  check("two_worker_scopes_create_one_native_order", true, { firstResult, calls, finalState },
    calls === 1 && finalState.orders.length === 1 && finalState.allocations.length === 1 &&
    finalState.movements.filter((row) => row.movement_type === "allocation_conversion").length === 1)

  const expired = await makeCart([{ quantity: 1 }], "expired-correlated-lease")
  await reserve(expired)
  await expectCode("correlated_lease_setup", "RECOVERY_FAULT", () => complete(scope(), expired.authority, {
    afterCorrelationPersisted() { throw Object.assign(new Error("RECOVERY_FAULT"), { code: "RECOVERY_FAULT" }) },
  }))
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()-INTERVAL '10 minutes'
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [expired.authority.attemptId])
  const expiredBefore = await readState(expired)
  await expectCode("expired_lease_rejects_correlated_recovery", "CHECKOUT_LEASE_NOT_OWNED", () => complete(scope(), expired.authority))
  const expiredAfter = await readState(expired)
  check("expired_lease_keeps_order_and_stock", true, { before: expiredBefore, after: expiredAfter },
    expiredBefore.orders.length === 1 && expiredAfter.orders[0]?.id === expiredBefore.orders[0].id &&
    unchangedStock(expiredAfter) && expiredAfter.allocations.length === 0)
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [expired.authority.attemptId])
  const renewed = await complete(scope(), expired.authority)
  check("renewed_lease_recovers_existing_order", true, renewed,
    renewed.orderId === expiredBefore.orders[0].id && renewed.conversionStatus === "allocated")

  const expiresDuringNative = await makeCart([{ quantity: 1 }], "lease-expires-during-native")
  await reserve(expiresDuringNative)
  await expectCode("expired_lease_blocks_native_correlation", "CHECKOUT_LEASE_NOT_OWNED",
    () => complete(scope(), expiresDuringNative.authority, {
      async afterNativeReturn() {
        await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()-INTERVAL '10 minutes'
          WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`,
        [expiresDuringNative.authority.attemptId])
      },
    }))
  const unbound = await readState(expiresDuringNative)
  check("lease_expired_during_native_preserves_order_and_fence", true, unbound,
    unbound.orders.length === 1 && unbound.attempt.order_id === null &&
    unbound.attempt.attempt_status === "order_creation_started" && unchangedStock(unbound) && unbound.allocations.length === 0)
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [expiresDuringNative.authority.attemptId])
  let expiredRetryCalls = 0
  const resumed = await complete(scope(), expiresDuringNative.authority, { beforeNativeCompletion() { expiredRetryCalls++ } })
  check("lease_renewal_correlates_existing_native_order", true, { resumed, expiredRetryCalls },
    resumed.orderId === unbound.orders[0].id && expiredRetryCalls === 0 && resumed.conversionStatus === "allocated")

  const concurrentCleanup = await makeCart([{ quantity: 1 }], "native-cleanup-conversion")
  await reserve(concurrentCleanup)
  await expectCode("native_cleanup_setup", "RECOVERY_FAULT", () => complete(scope(), concurrentCleanup.authority, {
    afterCorrelationPersisted() { throw Object.assign(new Error("RECOVERY_FAULT"), { code: "RECOVERY_FAULT" }) },
  }))
  let releaseConversion, conversionReady, cleanupStarted
  const conversionGate = new Promise((resolve) => { releaseConversion = resolve })
  const conversionEntered = new Promise((resolve) => { conversionReady = resolve })
  const cleanupEntered = new Promise((resolve) => { cleanupStarted = resolve })
  const converting = complete(scope(), concurrentCleanup.authority, {
    async event(name, data) {
      events.push({ boundary: "native-cleanup", name, ...data })
      if (name === "conversion_reservations_locked") { conversionReady(); await conversionGate }
    },
  })
  await conversionEntered
  const cleaning = new InventoryLedger(scope(), { event(name, data) {
    events.push({ boundary: "native-cleanup", name, ...data })
    if (name === "transaction_started") cleanupStarted()
  } }).cleanupExpired(concurrentCleanup.authority).then((value) => ({ value }), (error) => ({ error: error.message }))
  await cleanupEntered
  releaseConversion()
  const conversionResult = await converting
  const cleanupResult = await cleaning
  const cleanupState = await readState(concurrentCleanup)
  check("native_cleanup_and_conversion_keep_stock_and_single_order", true,
    { conversionResult, cleanupResult, cleanupState },
    cleanupState.orders.length === 1 && cleanupState.allocations.length === 1 &&
    cleanupState.movements.filter((row) => row.movement_type === "allocation_conversion").length === 1 &&
    !cleanupState.movements.some((row) => row.movement_type === "reservation_release") &&
    cleanupState.reservations.every((row) => row.status === "converted"))

  const responseRace = await makeCart([{ quantity: 1 }], "response-race")
  await reserve(responseRace)
  let releaseResponse, responseReady
  const responseGate = new Promise((resolve) => { releaseResponse = resolve })
  const responseEntered = new Promise((resolve) => { responseReady = resolve })
  const delayedResponse = complete(scope(), responseRace.authority, {
    async afterConversionCommit() { responseReady(); await responseGate },
  })
  await responseEntered
  const otherResponse = await complete(scope(), responseRace.authority)
  releaseResponse()
  const originalResponse = await delayedResponse
  const responseState = await readState(responseRace)
  check("concurrent_response_completion_preserves_original_result", true,
    { originalResponse, otherResponse, responseState },
    originalResponse.orderId === otherResponse.orderId &&
    JSON.stringify([...originalResponse.allocationIds].sort()) === JSON.stringify([...otherResponse.allocationIds].sort()) &&
    JSON.stringify([...originalResponse.movementIds].sort()) === JSON.stringify([...otherResponse.movementIds].sort()) &&
    responseState.orders.length === 1 && responseState.allocations.length === 1 &&
    responseState.movements.filter((row) => row.movement_type === "allocation_conversion").length === 1)

  const ambiguous = await makeCart([{ quantity: 1 }], "multiple-native-orders")
  await reserve(ambiguous)
  await expectCode("ambiguous_setup", "RECOVERY_FAULT", () => complete(scope(), ambiguous.authority, {
    afterFenceCommit() { throw Object.assign(new Error("RECOVERY_FAULT"), { code: "RECOVERY_FAULT" }) },
  }))
  await makeNativeOrder(ambiguous, { bindAttempt: false })
  await makeNativeOrder(ambiguous, { bindAttempt: false })
  let ambiguousCalls = 0
  const ambiguousResult = await complete(scope(), ambiguous.authority, { beforeNativeCompletion() { ambiguousCalls++ } })
  const ambiguousState = await readState(ambiguous)
  check("multiple_native_orders_remain_unresolved", true, { ambiguousResult, ambiguousCalls, ambiguousState },
    ambiguousCalls === 0 && ambiguousState.orders.length === 2 && ambiguousState.attempt.order_id === null &&
    ambiguousResult.conversionStatus === "pending_reconciliation" && unchangedStock(ambiguousState) &&
    ambiguousState.allocations.length === 0)

  const negative = [
    ["missing_key", { omitKey: [0] }, "UNMAPPED_OR_AMBIGUOUS_LINE_ITEM"],
    ["duplicate_key", { duplicate: true }, "AMBIGUOUS_LINE_MAPPING"],
    ["changed_quantity", { lineQuantities: [9, 1] }, "ORDER_LINE_QUANTITY_MISMATCH"],
    ["changed_variant", { lineVariant: "variant_wrong_" + Date.now() }, "ORDER_LINE_VARIANT_MISMATCH"],
    ["partial_reservations", {}, "INCOMPLETE_VALIDATED_RESERVATION_SET"],
  ]
  for (const [name, options, expected] of negative) {
    const item = await makeCart([{ quantity: 1 }, { quantity: 1 }], "negative-" + name)
    await reserve(item)
    const reservationRows = await reservationsFor(item.authority.attemptId)
    const order = await makeNativeOrder(item, options.duplicate
      ? { duplicateKey: item.lines[0].metadata.checkout_line_key } : options)
    const ids = name === "partial_reservations" ? [reservationRows[0].id] : reservationRows.map((row) => row.id)
    const before = await readState(item)
    await expectCode(name + "_rejected", expected, () => convert(item, order, ids))
    const after = await readState(item)
    check(name + "_database_unchanged", true, { before, after },
      JSON.stringify(before) === JSON.stringify(after) && unchangedStock(after) && after.allocations.length === 0)
  }
  const wrongCart = await makeCart([{ quantity: 1 }], "wrong-cart")
  await reserve(wrongCart)
  const wrongOrder = await makeNativeOrder(wrongCart)
  const another = await makeCart([{ quantity: 1 }], "other-cart")
  await reserve(another)
  const beforeWrong = await readState(another)
  await expectCode("wrong_cart_order_rejected", "ORDER_CART_CORRELATION_NOT_AUTHORITATIVE",
    () => convert(another, wrongOrder, beforeWrong.reservations.map((row) => row.id)))
  const afterWrong = await readState(another)
  check("wrong_cart_order_preserves_database", true, { beforeWrong, afterWrong },
    JSON.stringify(beforeWrong) === JSON.stringify(afterWrong) && unchangedStock(afterWrong))

  const holder = createPgClient(isolatedUrl), contender = createPgClient(isolatedUrl)
  await holder.connect(); await contender.connect()
  try {
    const original = (await adminPg.query("SELECT quantity_reserved FROM inventory_batch WHERE id=$1", [batch.id])).rows[0]
    await holder.query("BEGIN")
    await holder.query("SELECT id FROM inventory_batch WHERE id=$1 FOR UPDATE", [batch.id])
    await contender.query("BEGIN")
    await contender.query("SET LOCAL lock_timeout='100ms'")
    let timeout
    try { await contender.query("UPDATE inventory_batch SET quantity_reserved=quantity_reserved+1 WHERE id=$1", [batch.id]) }
    catch (error) { timeout = error }
    await contender.query("ROLLBACK")
    await holder.query("ROLLBACK")
    const remaining = (await adminPg.query("SELECT quantity_reserved FROM inventory_batch WHERE id=$1", [batch.id])).rows[0]
    check("lock_timeout_rolls_back_without_stock_write", "55P03", { code: timeout?.code, remaining, original },
      timeout?.code === "55P03" && Number(remaining.quantity_reserved) === Number(original.quantity_reserved))
  } finally { await holder.end(); await contender.end() }
}
