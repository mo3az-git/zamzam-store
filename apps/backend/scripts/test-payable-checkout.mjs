import { createRegionsWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fork } from "node:child_process"

export async function runPayableCheckoutScenarios(ctx) {
  const { runtime, knex, adminPg, batch, makeCart, check, expectCode, events, InventoryLedger,
    completeReservedCartWithInventory, findNativeOrdersByCart, saveSnapshot, rootRequire } = ctx
  const { readNativePayableOrderSnapshot, normalizeEgpTotal } = rootRequire("./apps/backend/src/modules/batch-inventory/native-payable-order-snapshot.ts")
  const { markOrderCreationStarted } = rootRequire("./apps/backend/src/modules/batch-inventory/order-correlation.ts")
  const { completeNativeCartForTp08Workflow } = rootRequire("./apps/backend/src/workflows/tp08-native-complete-cart.ts")
  const container = runtime.container
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // Disposable region and the built-in local system provider: it contacts no gateway.
  const regions = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable Egypt", currency_code: "egp", countries: ["eg"],
    payment_providers: ["pp_system_default"],
  }] } })
  const regionId = regions.result[0].id
  const setup = async (label, price = "12.34", quantity = [{ quantity: 2 }, { quantity: 3 }]) => {
    const item = await makeCart(quantity, label, price, regionId)
    await new InventoryLedger(container).reserveCart(item.authority)
    const collection = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: item.cart.id } })
    const paymentSession = await createPaymentSessionsWorkflow(container).run({ input: {
      payment_collection_id: collection.result.id, provider_id: "pp_system_default", data: {},
    } })
    return { item, collection: collection.result, session: paymentSession.result }
  }
  const fixture = await makeCart([{ quantity: 2 }, { quantity: 3 }], "payable-digital-fixture", "12.34", regionId)
  await new InventoryLedger(container).reserveCart(fixture.authority)
  const paymentCollection = await createPaymentCollectionForCartWorkflow(container).run({
    input: { cart_id: fixture.cart.id },
  })
  const session = await createPaymentSessionsWorkflow(container).run({ input: {
    payment_collection_id: paymentCollection.result.id, provider_id: "pp_system_default", data: {},
  } })
  const cartGraph = await query.graph({ entity: "cart", fields: ["id", "currency_code", "total", "raw_total",
    "payment_collection.id", "payment_collection.amount", "payment_collection.raw_amount",
    "payment_collection.payment_sessions.id", "payment_collection.payment_sessions.status",
    "payment_collection.payment_sessions.provider_id", "payment_collection.payment_sessions.amount"],
    filters: { id: fixture.cart.id } })
  const completed = await completeReservedCartWithInventory(container, fixture.authority)
  const authorizedCart = await query.graph({ entity: "cart", fields: ["id",
    "payment_collection.payment_sessions.status", "payment_collection.payment_sessions.provider_id",
    "payment_collection.payment_sessions.raw_amount"], filters: { id: fixture.cart.id } })
  const links = await findNativeOrdersByCart(knex, fixture.cart.id)
  const orderGraph = await query.graph({ entity: "order", fields: ["id", "currency_code", "version", "total", "raw_total",
    "items.id", "items.variant_id", "items.metadata", "items.raw_unit_price", "items.detail.quantity"],
    filters: { id: completed.orderId } })
  const snapshot = await saveSnapshot([batch.id])
  const allocations = snapshot.allocations.filter((row) => row.order_id === completed.orderId)
  const movements = snapshot.movements.filter((row) => row.reference_id === completed.orderId && row.movement_type === "allocation_conversion")
  events.push({ boundary: "payable-native-completion", cart: cartGraph.data, order: orderGraph.data, links, completed, allocations, movements })
  check("native_payment_workflows_create_test_session", true, { regionId, paymentCollection: paymentCollection.result.id,
    session: session.result, cart: cartGraph.data[0] }, Boolean(session.result?.id) && Boolean(paymentCollection.result?.id) &&
    session.result.provider_id === "pp_system_default" && normalizeEgpTotal(session.result.raw_amount).minor === "6170" &&
    normalizeEgpTotal(cartGraph.data[0].raw_total).minor === "6170")
  check("actual_payable_native_order_created_and_allocated", true, { completed, links, order: orderGraph.data[0], allocations, movements },
    completed.conversionStatus === "allocated" && links.length === 1 && links[0].id === completed.orderId &&
    links[0].cart_id === fixture.cart.id && allocations.length === 2 && movements.length === 2 &&
    authorizedCart.data[0].payment_collection.payment_sessions.some((p) => p.status === "authorized" &&
      p.provider_id === "pp_system_default" && normalizeEgpTotal(p.raw_amount).minor === "6170"))
  const authoritative = await readNativePayableOrderSnapshot(container, {
    cartId: fixture.cart.id, orderId: completed.orderId, expectedVersion: 1, expectedTotalMinor: "6170",
  })
  const response = (await adminPg.query(`SELECT k.status,k.response_body FROM idempotency_key k
    JOIN cart_checkout_attempt a ON a.idempotency_key=k.key WHERE a.checkout_attempt_id=$1::uuid`, [fixture.authority.attemptId])).rows[0]
  const nativeOrder = orderGraph.data[0]
  check("exact_payable_order_snapshot_uses_egp_major_units", true, { authoritative, rawTotal: nativeOrder.raw_total },
    authoritative.currency === "egp" && authoritative.totalMajor === "61.70" && authoritative.totalMinor === "6170" &&
    authoritative.lines.length === 2 && authoritative.lines.every((line) => line.rawUnitPriceMajor === "12.34") &&
    authoritative.lines.every((line) => allocations.some((a) => a.line_item_id === line.lineId &&
      a.checkout_line_key === line.checkoutLineKey && Number(a.quantity_allocated) === line.quantity &&
      a.paid_unit_amount_after_discounts_snapshot === "12.34")) &&
    authoritative.lines.reduce((sum, line) => sum + 1234n * BigInt(line.quantity), 0n) === 6170n &&
    response.status === "completed" && response.response_body.orderId === completed.orderId)
  events.push({ boundary: "authoritative-payable-snapshot", authoritative, response })
  const replayBefore = await saveSnapshot([batch.id])
  const replay = await completeReservedCartWithInventory(container, fixture.authority)
  const replayAfter = await saveSnapshot([batch.id])
  check("exact_payable_checkout_replay_is_read_only", true, { replay },
    replay.replayed && replay.orderId === completed.orderId &&
    JSON.stringify(replayBefore) === JSON.stringify(replayAfter))
  await expectCode("conflicting_native_order_total_rejected", "NATIVE_ORDER_TOTAL_CONFLICT",
    () => readNativePayableOrderSnapshot(container, { cartId: fixture.cart.id, orderId: completed.orderId, expectedTotalMinor: "6171" }))
  await expectCode("conflicting_native_order_version_rejected", "NATIVE_ORDER_VERSION_CONFLICT",
    () => readNativePayableOrderSnapshot(container, { cartId: fixture.cart.id, orderId: completed.orderId, expectedVersion: 2 }))
  await expectCode("native_order_linked_to_different_cart_rejected", "ORDER_CART_ASSOCIATION_MISMATCH",
    () => readNativePayableOrderSnapshot(container, { cartId: "cart_not_the_order", orderId: completed.orderId }))
  await expectCode("zero_payable_total_rejected", "NATIVE_TOTAL_NOT_POSITIVE", () => normalizeEgpTotal({ value: "0.00" }))
  await expectCode("fractional_minor_unit_total_rejected", "NATIVE_TOTAL_FRACTIONAL_MINOR_UNIT",
    () => normalizeEgpTotal({ value: "12.345" }))
  check("exact_high_precision_total_converts_without_number_rounding", "123456789012345678901234",
    normalizeEgpTotal({ value: "1234567890123456789012.3400" }).minor,
    normalizeEgpTotal({ value: "1234567890123456789012.3400" }).minor === "123456789012345678901234")

  const zero = await makeCart([{ quantity: 1 }], "zero-total-negative", "0", regionId)
  await new InventoryLedger(container).reserveCart(zero.authority)
  const zeroOrder = await completeReservedCartWithInventory(container, zero.authority)
  await expectCode("real_other_cart_cannot_claim_native_order", "ORDER_CART_ASSOCIATION_MISMATCH",
    () => readNativePayableOrderSnapshot(container, { cartId: zero.cart.id, orderId: completed.orderId }))
  await expectCode("real_zero_native_order_rejected_as_payable", "NATIVE_TOTAL_NOT_POSITIVE",
    () => readNativePayableOrderSnapshot(container, { cartId: zero.cart.id, orderId: zeroOrder.orderId }))

  const fractional = await setup("fractional-total-negative", "1.001", [{ quantity: 1 }])
  await markOrderCreationStarted(knex, fractional.item.authority)
  const fractionalNative = await completeNativeCartForTp08Workflow(container).run({
    input: { cartId: fractional.item.cart.id },
  })
  const fractionalLinks = await findNativeOrdersByCart(knex, fractional.item.cart.id)
  await expectCode("real_fractional_native_order_rejected_as_payable", "NATIVE_TOTAL_FRACTIONAL_MINOR_UNIT",
    () => readNativePayableOrderSnapshot(container, { cartId: fractional.item.cart.id, orderId: fractionalNative.result.id }))
  await expectCode("fractional_total_blocks_inventory_conversion", "NATIVE_TOTAL_FRACTIONAL_MINOR_UNIT",
    () => completeReservedCartWithInventory(container, fractional.item.authority))
  const fractionalState = await saveSnapshot([batch.id])
  const fractionalReservations = fractionalState.reservations.filter((r) => r.checkout_attempt_id === fractional.item.authority.attemptId)
  check("fractional_native_total_preserves_unconverted_stock", true, { fractionalLinks, fractionalReservations },
    fractionalLinks.length === 1 && fractionalReservations.length === 1 && fractionalReservations[0].status === "active" &&
    !fractionalState.allocations.some((a) => a.order_id === fractionalNative.result.id) &&
    !fractionalState.movements.some((m) => m.reference_id === fractionalNative.result.id && m.movement_type === "allocation_conversion"))
  const fractionalUnit = await setup("fractional-unit-negative", "1.005", [{ quantity: 2 }])
  await markOrderCreationStarted(knex, fractionalUnit.item.authority)
  const fractionalUnitNative = await completeNativeCartForTp08Workflow(container).run({
    input: { cartId: fractionalUnit.item.cart.id },
  })
  const exactTotal = await readNativePayableOrderSnapshot(container, {
    cartId: fractionalUnit.item.cart.id, orderId: fractionalUnitNative.result.id, expectedTotalMinor: "201",
  })
  await expectCode("fractional_unit_price_blocks_inventory_conversion", "ORDER_PRICE_FRACTIONAL_MINOR_UNIT",
    () => completeReservedCartWithInventory(container, fractionalUnit.item.authority))
  const fractionalUnitState = await saveSnapshot([batch.id])
  const fractionalUnitReservations = fractionalUnitState.reservations.filter((r) => r.checkout_attempt_id === fractionalUnit.item.authority.attemptId)
  check("fractional_unit_preserves_stock_despite_exact_order_total", true, { exactTotal, fractionalUnitReservations },
    exactTotal.totalMinor === "201" && fractionalUnitReservations.length === 1 && fractionalUnitReservations[0].status === "active" &&
    !fractionalUnitState.allocations.some((a) => a.order_id === fractionalUnitNative.result.id))

  const missing = await makeCart([{ quantity: 1 }], "positive-without-payment", "12.34", regionId)
  await new InventoryLedger(container).reserveCart(missing.authority)
  await markOrderCreationStarted(knex, missing.authority)
  let missingError
  try { await completeNativeCartForTp08Workflow(container).run({ input: { cartId: missing.cart.id } }) }
  catch (error) { missingError = error }
  const missingLinks = await findNativeOrdersByCart(knex, missing.cart.id)
  let missingRetryNativeCalls = 0
  const missingRetry = await completeReservedCartWithInventory(container, missing.authority, {
    beforeNativeCompletion() { missingRetryNativeCalls++ },
  })
  const missingRows = (await adminPg.query("SELECT status FROM cart_batch_reservation WHERE checkout_attempt_id=$1", [missing.authority.attemptId])).rows
  check("nonzero_native_workflow_requires_payment_collection", true,
    { error: missingError?.message, missingLinks, missingRetry, missingRetryNativeCalls, reservations: missingRows },
    Boolean(missingError?.message?.includes("Payment collection has not been initiated")) &&
    missingLinks.length === 0 && missingRetry.conversionStatus === "pending_reconciliation" && missingRetryNativeCalls === 0 &&
    missingRows.length === 1 && missingRows[0].status === "active")

  const startWorker = (mode, authority, boundary) => {
    const child = fork(new URL("./test-reconciliation-worker.mjs", import.meta.url), [], {
      stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [],
    })
    let stderr = "", ended = false
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    const queue = [], waiters = []
    const exit = new Promise((resolve) => child.once("exit", (code, signal) => {
      ended = true; resolve({ code, signal })
      while (waiters.length) waiters.shift().reject(new Error("worker exited before IPC: " + stderr))
    }))
    child.on("message", (message) => { if (waiters.length) waiters.shift().resolve(message); else queue.push(message) })
    const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
      if (ended) return reject(new Error("worker exited: " + stderr))
      const timeout = setTimeout(() => reject(new Error("worker IPC timeout")), 60000)
      waiters.push({ resolve: (value) => { clearTimeout(timeout); resolve(value) },
        reject: (error) => { clearTimeout(timeout); reject(error) } })
    })
    child.send({ mode, authority, boundary })
    return { child, next, exit }
  }
  const prepareWorker = async (mode, item, boundary) => {
    const worker = startWorker(mode, item.authority, boundary)
    const ready = await worker.next()
    if (ready.type !== "ready") throw new Error("worker not ready: " + JSON.stringify(ready))
    return { ...worker, ready }
  }
  for (const boundary of ["afterNativeReturn", "afterConversionCommit"]) {
    const { item } = await setup("payable-kill-" + boundary)
    const crashing = await prepareWorker("crash", item, boundary)
    crashing.child.send({ go: true })
    const reached = await crashing.next()
    if (reached.type !== "barrier") throw new Error("missing payable crash boundary: " + JSON.stringify(reached))
    const beforeLinks = await findNativeOrdersByCart(knex, item.cart.id)
    const before = await saveSnapshot([batch.id])
    const killed = crashing.child.kill("SIGKILL")
    const terminated = await crashing.exit
    const recovering = await prepareWorker("recover", item)
    recovering.child.send({ go: true })
    const recovered = await recovering.next()
    const recoveredExit = await recovering.exit
    const after = await saveSnapshot([batch.id])
    const afterLinks = await findNativeOrdersByCart(knex, item.cart.id)
    const afterAllocations = after.allocations.filter((a) => a.order_id === beforeLinks[0]?.id)
    const afterMovements = after.movements.filter((m) => m.reference_id === beforeLinks[0]?.id && m.movement_type === "allocation_conversion")
    const reservations = after.reservations.filter((r) => r.checkout_attempt_id === item.authority.attemptId)
    const snapshot = await readNativePayableOrderSnapshot(container, { cartId: item.cart.id, orderId: beforeLinks[0]?.id,
      expectedVersion: 1, expectedTotalMinor: "6170" })
    events.push({ boundary, workerPid: reached.pid, terminated, beforeLinks, before, recovered, afterLinks, after, snapshot })
    check(boundary + "_payable_process_crash_recovers_once", true,
      { workerPid: reached.pid, killed, terminated, recovered, recoveredExit, beforeLinks, afterLinks, allocations: afterAllocations, movements: afterMovements },
      killed && terminated.signal === "SIGKILL" && recoveredExit.code === 0 && beforeLinks.length === 1 &&
      afterLinks.length === 1 && beforeLinks[0].id === afterLinks[0].id && recovered.result?.result?.orderId === beforeLinks[0].id &&
      afterAllocations.length === 2 && afterMovements.length === 2 && reservations.every((r) => r.status === "converted") &&
      !after.movements.some((m) => reservations.some((r) => r.id === m.reference_id) && m.movement_type === "reservation_release") &&
      snapshot.totalMinor === "6170")
  }

  const lease = await setup("payable-expired-lease")
  await expectCode("payable_correlated_lease_setup", "PAYABLE_INJECTED_CRASH",
    () => completeReservedCartWithInventory(container, lease.item.authority, {
      afterCorrelationPersisted() { throw Object.assign(new Error("PAYABLE_INJECTED_CRASH"), { code: "PAYABLE_INJECTED_CRASH" }) },
    }))
  const leaseLinks = await findNativeOrdersByCart(knex, lease.item.cart.id)
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()-INTERVAL '10 minutes'
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [lease.item.authority.attemptId])
  await expectCode("expired_payable_lease_blocks_conversion", "CHECKOUT_LEASE_NOT_OWNED",
    () => completeReservedCartWithInventory(container, lease.item.authority))
  const expiredState = await saveSnapshot([batch.id])
  const expiredReservations = expiredState.reservations.filter((r) => r.checkout_attempt_id === lease.item.authority.attemptId)
  check("expired_payable_lease_preserves_reserved_stock", true,
    { order: leaseLinks[0]?.id, reservations: expiredReservations },
    leaseLinks.length === 1 && expiredReservations.length === 2 && expiredReservations.every((r) => r.status === "active") &&
    !expiredState.allocations.some((a) => a.order_id === leaseLinks[0].id) &&
    !expiredState.movements.some((m) => expiredReservations.some((r) => r.id === m.reference_id) && m.movement_type === "reservation_release"))
  await adminPg.query(`UPDATE idempotency_key SET last_heartbeat_at=NOW()
    WHERE key=(SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid)`, [lease.item.authority.attemptId])
  await expectCode("changed_payable_owner_is_rejected", "CART_LOCK_OWNER_MISMATCH",
    () => completeReservedCartWithInventory(container, { ...lease.item.authority, ownerId: "stale-owner" }))
  await expectCode("changed_payable_epoch_is_rejected", "STALE_OR_UNAUTHORIZED_ATTEMPT",
    () => completeReservedCartWithInventory(container, { ...lease.item.authority, epoch: 2 }))
  const leaseRecovery = await completeReservedCartWithInventory(container, lease.item.authority)
  check("renewed_payable_lease_reuses_existing_order", true, { leaseLinks, leaseRecovery },
    leaseLinks.length === 1 && leaseRecovery.orderId === leaseLinks[0].id && leaseRecovery.conversionStatus === "allocated")

  const concurrent = await setup("payable-parallel-workers")
  let release, entered
  const gate = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  let nativeCalls = 0
  const first = completeReservedCartWithInventory(container, concurrent.item.authority, {
    afterFenceCommit: async () => { entered(); await gate },
    beforeNativeCompletion() { nativeCalls++ },
  })
  await started
  const second = await prepareWorker("recover", concurrent.item)
  second.child.send({ go: true })
  const secondResult = await second.next()
  const secondExit = await second.exit
  release()
  const firstResult = await first
  const concurrentLinks = await findNativeOrdersByCart(knex, concurrent.item.cart.id)
  const concurrentState = await saveSnapshot([batch.id])
  check("payable_two_processes_never_create_duplicate_order", true,
    { firstResult, secondResult, secondExit, nativeCalls, concurrentLinks },
    secondResult.result?.reason === "NO_NATIVE_ORDER_AFTER_FENCE" && secondExit.code === 0 && nativeCalls === 1 &&
    concurrentLinks.length === 1 && firstResult.orderId === concurrentLinks[0].id &&
    concurrentState.allocations.filter((a) => a.order_id === firstResult.orderId).length === 2 &&
    concurrentState.movements.filter((m) => m.reference_id === firstResult.orderId && m.movement_type === "allocation_conversion").length === 2)
}
