import { createHash, randomUUID } from "node:crypto"
import { fork } from "node:child_process"
import { createRegionsWorkflow, createPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow } from "@medusajs/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { finalizeCompletedCheckoutPayment, completeAndFinalizeSameOrder } from "../src/modules/order-operations/completed-checkout-payment.mjs"
import { recordPaymentForCorrelatedOrder } from "../src/modules/order-operations/verified-payment-bridge.mjs"

export async function runSameOrderPaymentScenarios(ctx) {
  const { runtime, adminPg, batch, makeCart, saveSnapshot, check, expectCode, events, InventoryLedger,
    findNativeOrdersByCart, knex, rootRequire, completeReservedCartWithInventory } = ctx
  const container = runtime.container
  const { completePayableReservedCart, assertPayableCheckoutReady } = rootRequire("./apps/backend/src/modules/batch-inventory/payable-checkout-guard.ts")
  const { readNativePayableOrderSnapshot, readNativePayableOrderSnapshotInTransaction, normalizeEgpTotal } =
    rootRequire("./apps/backend/src/modules/batch-inventory/native-payable-order-snapshot.ts")
  const deps = { snapshotInTransaction: readNativePayableOrderSnapshotInTransaction, normalizeEgpTotal,
    completePayableReservedCart, completeReservedCartWithInventory }
  const regions = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Disposable Egypt same-order", currency_code: "egp", countries: ["eg"], payment_providers: ["pp_system_default"],
  }] } })
  const regionId = regions.result[0].id
  const fixture = async (method, label) => {
    const item = await makeCart([{ quantity: 2 }, { quantity: 3 }], label, "12.34", regionId, method)
    await new InventoryLedger(container).reserveCart(item.authority)
    const collection = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: item.cart.id } })
    await createPaymentSessionsWorkflow(container).run({ input: {
      payment_collection_id: collection.result.id, provider_id: "pp_system_default", data: {},
    } })
    return item
  }
  const branchState = async (orderId) => ({
    operational: (await adminPg.query("SELECT id,order_id,payment_method FROM order_operational_state WHERE order_id=$1 AND deleted_at IS NULL", [orderId])).rows,
    cod: (await adminPg.query("SELECT id,order_id,expected_amount,collection_status FROM cod_collection_record WHERE order_id=$1 AND deleted_at IS NULL", [orderId])).rows,
    electronic: (await adminPg.query("SELECT id,order_id,cart_id,amount,currency_code,status,provider_key FROM electronic_payment_attempt WHERE order_id=$1 AND deleted_at IS NULL", [orderId])).rows,
  })
  const authorityFor = async (item, orderId, method) => {
    const attempt = (await adminPg.query("SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid", [item.authority.attemptId])).rows[0]
    return { ...item.authority, orderId, idempotencyKey: attempt.idempotency_key, expectedMethod: method,
      expectedVersion: 1, expectedTotalMinor: "6170", claimCodeHash: createHash("sha256").update("test-only-" + item.authority.attemptId).digest("hex") }
  }
  const startWorker = (authority) => {
    const child = fork(new URL("./test-same-order-payment-worker.mjs", import.meta.url), [], {
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
      if (ended) return reject(new Error("payment worker exited: " + stderr))
      const timeout = setTimeout(() => reject(new Error("payment worker IPC deadline")), 60000)
      waiters.push({ resolve: (value) => { clearTimeout(timeout); resolve(value) },
        reject: (error) => { clearTimeout(timeout); reject(error) } })
    })
    child.send({ authority })
    return { child, next, exit }
  }
  for (const method of ["cod", "electronic"]) {
    const item = await fixture(method, "same-native-order-" + method)
    const initial = await assertPayableCheckoutReady(container, item.authority)
    const orchestration = { ...item.authority, expectedMethod: method,
      claimCodeHash: createHash("sha256").update("test-only-" + item.authority.attemptId).digest("hex") }
    await expectCode("after_checkout_failure_" + method, "TEST_AFTER_CHECKOUT",
      () => completeAndFinalizeSameOrder(adminPg, container, orchestration, deps, {
        afterCheckoutCommitted() { throw new Error("TEST_AFTER_CHECKOUT") },
      }))
    const links = await findNativeOrdersByCart(knex, item.cart.id)
    const orderId = links[0]?.id
    const order = await readNativePayableOrderSnapshot(container, { cartId: item.cart.id, orderId,
      expectedVersion: 1, expectedTotalMinor: initial.totalMinor })
    const authority = await authorityFor(item, orderId, method)
    const before = await branchState(orderId)
    check("native_completion_before_payment_" + method, true, { cartId: item.cart.id, order, before },
      initial.totalMinor === "6170" && links.length === 1 &&
      links[0].id === orderId && links[0].cart_id === item.cart.id && before.operational.length === 0)

    // A failure after committed checkout but before payment persistence leaves
    // no branch record; recovery uses only the immutable completion identity.
    const interrupted = await branchState(orderId)
    check("post_checkout_interruption_has_no_payment_" + method, true, interrupted,
      interrupted.cod.length === 0 && interrupted.electronic.length === 0)
    if (method === "cod") {
      const allocation = (await adminPg.query("SELECT id FROM order_batch_allocation WHERE order_id=$1 ORDER BY id LIMIT 1", [orderId])).rows[0]
      await adminPg.query("UPDATE order_batch_allocation SET paid_unit_amount_after_discounts_snapshot=12.35 WHERE id=$1", [allocation.id])
      try {
        await expectCode("divergent_allocation_blocks_payment", "PAYMENT_COMPLETION_ALLOCATION_DIVERGENCE",
          () => finalizeCompletedCheckoutPayment(adminPg, container, authority, deps))
        const divergentBranch = await branchState(orderId)
        check("divergent_allocation_creates_no_payment", true, divergentBranch, divergentBranch.operational.length === 0)
      } finally {
        await adminPg.query("UPDATE order_batch_allocation SET paid_unit_amount_after_discounts_snapshot=12.34 WHERE id=$1", [allocation.id])
      }
      const anotherCart = await fixture("cod", "different-real-cart")
      await expectCode("another_real_cart_cannot_claim_order", "ORDER_CART_ASSOCIATION_MISMATCH",
        () => finalizeCompletedCheckoutPayment(adminPg, container,
          { ...authority, cartId: anotherCart.cart.id, ownerId: anotherCart.ownerId }, deps))
    }
    let first
    if (method === "electronic") {
      const left = startWorker(authority), right = startWorker(authority)
      const ready = await Promise.all([left.next(), right.next()])
      if (ready.some((r) => r.type !== "ready")) throw new Error("payment worker failed to start: " + JSON.stringify(ready))
      left.child.send({ go: true }); right.child.send({ go: true })
      const results = await Promise.all([left.next(), right.next()])
      const exits = await Promise.all([left.exit, right.exit])
      first = results[0].result
      check("concurrent_electronic_workers_serialize", true, { ready, results, exits },
        ready[0].pid !== ready[1].pid && ready[0].dbPid !== ready[1].dbPid &&
        exits.every((e) => e.code === 0) && results.every((r) =>
          r.type === "result" && r.result.orderId === orderId && r.result.method === method))
    } else first = await completeAndFinalizeSameOrder(adminPg, container, orchestration, deps)
    const branch = await branchState(orderId)
    const beforeReplay = await saveSnapshot([batch.id])
    const replay = await finalizeCompletedCheckoutPayment(adminPg, container, authority, deps)
    const afterReplay = await saveSnapshot([batch.id])
    const replayBranch = await branchState(orderId)
    check("same_order_payment_branch_exactly_once_" + method, true, { order, first, branch, replay },
      branch.operational.length === 1 && branch.operational[0].payment_method === method &&
      branch.cod.length === Number(method === "cod") && branch.electronic.length === Number(method === "electronic") &&
      (method === "cod" ? branch.cod[0]?.expected_amount === "61.70" && branch.cod[0]?.collection_status === "unpaid" :
        branch.electronic[0]?.amount === "61.70" && branch.electronic[0]?.status === "initiated" &&
        branch.electronic[0]?.provider_key === "phase1-simulator") &&
      JSON.stringify(branch) === JSON.stringify(replayBranch) && JSON.stringify(beforeReplay) === JSON.stringify(afterReplay) &&
      afterReplay.allocations.filter((a) => a.order_id === orderId).length === 2 &&
      afterReplay.movements.filter((m) => m.reference_id === orderId && m.movement_type === "allocation_conversion").length === 2 &&
      !afterReplay.movements.some((m) => m.movement_type === "reservation_release" &&
        afterReplay.reservations.some((r) => r.checkout_attempt_id === item.authority.attemptId && r.id === m.reference_id)))
    events.push({ method, cartId: item.cart.id, order, checkoutResponse: (await adminPg.query(
      "SELECT response_body FROM idempotency_key WHERE key=$1", [authority.idempotencyKey])).rows[0], branch, replay })

    await expectCode("other_method_rejected_" + method, "PAYMENT_METHOD_IMMUTABLE",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, expectedMethod: method === "cod" ? "electronic" : "cod" }, deps))
    await expectCode("wrong_epoch_rejected_" + method, "PAYMENT_STALE_CHECKOUT_AUTHORITY",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, epoch: 2 }, deps))
    await expectCode("stale_attempt_rejected_" + method, "PAYMENT_STALE_CHECKOUT_AUTHORITY",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, attemptId: randomUUID() }, deps))
    await expectCode("wrong_owner_rejected_" + method, "PAYMENT_CART_LOCK_NOT_OWNED",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, ownerId: "wrong-owner" }, deps))
    await expectCode("wrong_cart_rejected_" + method, "PAYMENT_CART_LOCK_NOT_OWNED",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, cartId: "cart_wrong" }, deps))
    await expectCode("wrong_order_rejected_" + method, "ORDER_CART_ASSOCIATION_MISMATCH",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, orderId: "order_wrong" }, deps))
    await expectCode("changed_total_rejected_" + method, "NATIVE_ORDER_TOTAL_CONFLICT",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, expectedTotalMinor: "6171" }, deps))
    await expectCode("changed_version_rejected_" + method, "NATIVE_ORDER_VERSION_CONFLICT",
      () => finalizeCompletedCheckoutPayment(adminPg, container, { ...authority, expectedVersion: 2 }, deps))
    await expectCode("completed_checkout_identity_cannot_be_rewritten_" + method, "COMPLETED_CHECKOUT_IDENTITY_IMMUTABLE",
      () => adminPg.query("UPDATE idempotency_key SET response_body='{}'::jsonb WHERE key=$1", [authority.idempotencyKey]))
    const finalBranch = await branchState(orderId)
    check("negative_checks_leave_branch_unchanged_" + method, true, finalBranch,
      JSON.stringify(finalBranch) === JSON.stringify(branch))
  }

  const orderService = container.resolve(Modules.ORDER)
  const interruptedAllocation = await fixture("cod", "after-allocation-before-response")
  await expectCode("allocated_before_response_fault", "ALLOCATED_FAULT",
    () => completePayableReservedCart(container, interruptedAllocation.authority, {
      afterConversionCommit() { throw new Error("ALLOCATED_FAULT") },
    }))
  const interruptedLinks = await findNativeOrdersByCart(knex, interruptedAllocation.cart.id)
  const interruptedAttempt = await authorityFor(interruptedAllocation, interruptedLinks[0].id, "cod")
  const interruptedResult = await completeAndFinalizeSameOrder(adminPg, container, interruptedAttempt, deps)
  const interruptedState = await saveSnapshot([batch.id])
  const interruptedBranch = await branchState(interruptedLinks[0].id)
  check("allocated_before_response_recovers_same_order_and_payment", true,
    { interruptedLinks, interruptedResult, interruptedBranch },
    interruptedResult.orderId === interruptedLinks[0].id && interruptedBranch.cod.length === 1 &&
    interruptedState.allocations.filter((a) => a.order_id === interruptedLinks[0].id).length === 2 &&
    interruptedState.movements.filter((m) => m.reference_id === interruptedLinks[0].id && m.movement_type === "allocation_conversion").length === 2)

  const changedAmount = await fixture("cod", "native-total-changed")
  const amountCheckout = await completePayableReservedCart(container, changedAmount.authority)
  const amountOrderId = amountCheckout.checkout.orderId
  const amountAuthority = await authorityFor(changedAmount, amountOrderId, "cod")
  const amountOrder = await orderService.retrieveOrder(amountOrderId, { relations: ["items", "items.detail"] })
  await orderService.updateOrderItem(amountOrder.items[0].detail.id, { unit_price: "13.34" })
  const changedSnapshot = await readNativePayableOrderSnapshot(container, { cartId: changedAmount.cart.id, orderId: amountOrderId })
  await expectCode("modified_native_total_blocks_payment", "NATIVE_ORDER_TOTAL_CONFLICT",
    () => finalizeCompletedCheckoutPayment(adminPg, container, amountAuthority, deps))
  const changedBranch = await branchState(amountOrderId)
  check("modified_native_total_creates_no_payment", true, { changedSnapshot, changedBranch },
    changedSnapshot.totalMinor !== "6170" && changedBranch.operational.length === 0)

  const changedVersion = await fixture("electronic", "native-version-changed")
  const versionCheckout = await completePayableReservedCart(container, changedVersion.authority)
  const versionOrderId = versionCheckout.checkout.orderId
  const versionAuthority = await authorityFor(changedVersion, versionOrderId, "electronic")
  await orderService.updateOrders(versionOrderId, { version: 2 })
  await expectCode("modified_native_version_blocks_payment", "NATIVE_ORDER_VERSION_CONFLICT",
    () => finalizeCompletedCheckoutPayment(adminPg, container, versionAuthority, deps))
  const versionBranch = await branchState(versionOrderId)
  check("modified_native_version_creates_no_payment", true, versionBranch, versionBranch.operational.length === 0)

  const changedCurrency = await fixture("cod", "native-currency-changed")
  const currencyCheckout = await completePayableReservedCart(container, changedCurrency.authority)
  const currencyOrderId = currencyCheckout.checkout.orderId
  const currencyAuthority = await authorityFor(changedCurrency, currencyOrderId, "cod")
  await orderService.updateOrders(currencyOrderId, { currency_code: "usd" })
  await expectCode("modified_native_currency_blocks_payment", "NATIVE_ORDER_CURRENCY_MISMATCH",
    () => finalizeCompletedCheckoutPayment(adminPg, container, currencyAuthority, deps))
  const currencyBranch = await branchState(currencyOrderId)
  check("modified_native_currency_creates_no_payment", true, currencyBranch, currencyBranch.operational.length === 0)

  const pending = await fixture("cod", "expired-pending")
  await expectCode("pending_order_fault_boundary", "PENDING_FAULT",
    () => completePayableReservedCart(container, pending.authority, {
      afterCorrelationPersisted() { throw Object.assign(new Error("PENDING_FAULT"), { code: "PENDING_FAULT" }) },
    }))
  const pendingOrders = await findNativeOrdersByCart(knex, pending.cart.id)
  const pendingAuthority = await authorityFor(pending, pendingOrders[0].id, "cod")
  await adminPg.query("UPDATE idempotency_key SET last_heartbeat_at=NOW()-INTERVAL '10 minutes' WHERE key=$1", [pendingAuthority.idempotencyKey])
  await expectCode("expired_pending_lease_still_rejected", "PAYMENT_CHECKOUT_LEASE_NOT_OWNED",
    () => recordPaymentForCorrelatedOrder(adminPg, pendingAuthority, async (id) => {
      const snap = await readNativePayableOrderSnapshot(container, { cartId: pending.cart.id, orderId: id })
      return { id, currency_code: snap.currency, total: snap.totalMajor }
    }))
  await expectCode("pending_never_authorizes_post_completion", "PAYMENT_COMPLETION_NOT_ALLOCATED",
    () => finalizeCompletedCheckoutPayment(adminPg, container, pendingAuthority, deps))
  const pendingState = await branchState(pendingOrders[0].id)
  const pendingStock = await saveSnapshot([batch.id])
  check("expired_pending_keeps_stock_and_has_no_payment", true, pendingState,
    pendingState.operational.length === 0 &&
    pendingStock.reservations.filter((r) => r.checkout_attempt_id === pending.authority.attemptId).length === 2 &&
    pendingStock.reservations.filter((r) => r.checkout_attempt_id === pending.authority.attemptId).every((r) => r.status === "active"))

  const mismatch = await fixture("cod", "payment-collection-mismatch")
  const cartService = container.resolve(Modules.CART)
  await cartService.updateLineItems(mismatch.lines[0].id, { unit_price: "14.00" })
  await expectCode("cart_payment_amount_mismatch_blocks_native_completion", "PAYABLE_PAYMENT_AMOUNT_MISMATCH",
    () => completePayableReservedCart(container, mismatch.authority))
  const mismatchLinks = await findNativeOrdersByCart(knex, mismatch.cart.id)
  const mismatchStock = await saveSnapshot([batch.id])
  check("mismatch_creates_no_order_and_keeps_reservations", true, { mismatchLinks },
    mismatchLinks.length === 0 && mismatchStock.reservations.filter((r) => r.checkout_attempt_id === mismatch.authority.attemptId)
      .every((r) => r.status === "active"))
}
