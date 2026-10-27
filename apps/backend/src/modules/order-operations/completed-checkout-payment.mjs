import { Modules } from "@medusajs/framework/utils"
import { createHash } from "node:crypto"
import { initializePaymentBranch } from "./payment-branch.mjs"

const sameIds = (left, right) => Array.isArray(left) && left.every((v) => typeof v === "string") &&
  new Set(left).size === left.length && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())

/**
 * Trusted internal post-completion finalizer. The composition root supplies
 * only the repository's native snapshot and exact-money functions. It never
 * accepts a caller-supplied completed flag or an unverified monetary amount.
 */
export async function finalizeCompletedCheckoutPayment(db, container, authority, { snapshotInTransaction, normalizeEgpTotal }) {
  const { orderId, cartId, attemptId, epoch, ownerId, idempotencyKey, claimCodeHash,
    expectedVersion, expectedTotalMinor, expectedMethod } = authority
  if (![orderId,cartId,attemptId,ownerId,idempotencyKey].every((v) => typeof v === "string" && v) ||
      !Number.isSafeInteger(epoch) || epoch < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      typeof expectedTotalMinor !== "string" || expectedTotalMinor.length > 12 || !/^[1-9]\d*$/.test(expectedTotalMinor) ||
      !["cod", "electronic"].includes(expectedMethod) || !/^[a-f0-9]{64}$/.test(claimCodeHash || "") ||
      typeof snapshotInTransaction !== "function" || typeof normalizeEgpTotal !== "function") {
    throw new Error("PAYMENT_COMPLETION_AUTHORITY_INVALID")
  }
  const locking = container.resolve(Modules.LOCKING)
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId)
  const verifyRedis = async () => {
    if (await provider.redisClient.get(provider.keyNamePrefix + "cart:" + cartId) !== ownerId)
      throw new Error("PAYMENT_CART_LOCK_NOT_OWNED")
  }
  await verifyRedis()
  // Exact expected values are rechecked under the root by the trusted snapshot.
  const minor = BigInt(expectedTotalMinor)
  const amount = `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`
  const verifyWithinTransaction = async (tx) => {
    const adapter = { async raw(sql, values = []) {
      let index = 0
      return tx.query(sql.replace(/\?/g, () => "$" + (++index)), values)
    } }
    const native = await snapshotInTransaction(container, adapter, {
      cartId, orderId, expectedVersion, expectedTotalMinor,
    })
    const order = await container.resolve(Modules.ORDER).retrieveOrder(orderId, {
      relations: ["items", "items.detail", "items.adjustments"],
    })
    if (Number(order.version) !== native.orderVersion || !Array.isArray(order.items)) throw new Error("PAYMENT_NATIVE_ORDER_CHANGED")
    const paidUnitByLine = new Map()
    const exactMinor = (raw, fallback) => {
      if (raw && typeof raw.value === "string") return BigInt(normalizeEgpTotal(raw, true).minor)
      if (typeof fallback === "string") return BigInt(normalizeEgpTotal({ value: fallback }, true).minor)
      if (typeof fallback === "number" && Number.isSafeInteger(fallback))
        return BigInt(normalizeEgpTotal({ value: String(fallback) }, true).minor)
      throw new Error("PAYMENT_NATIVE_PRICE_NOT_EXACT")
    }
    for (const line of order.items) {
      const identity = native.lines.find((entry) => entry.lineId === line.id)
      if (!identity) throw new Error("PAYMENT_NATIVE_ORDER_CHANGED")
      const count = BigInt(identity.quantity)
      const unit = exactMinor(line.raw_unit_price, line.unit_price)
      const discounts = (line.adjustments || []).reduce((sum, adjustment) =>
        sum + exactMinor(adjustment.raw_amount, adjustment.amount), 0n)
      const net = unit * count - discounts
      if (net < 0n) throw new Error("PAYMENT_NATIVE_PRICE_NOT_EXACT")
      const paid = (net + count / 2n) / count
      paidUnitByLine.set(line.id, `${paid / 100n}.${String(paid % 100n).padStart(2, "0")}`)
    }
    const trigger = await tx.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='idempotency_key'::regclass
      AND tgname='trg_completed_checkout_identity' AND tgenabled IN ('O','A') AND NOT tgisinternal`)
    if (trigger.rowCount !== 1) throw new Error("PAYMENT_COMPLETION_IMMUTABILITY_REQUIRED")
    const session = (await tx.query(`SELECT current_attempt_id::text AS current_attempt_id,epoch,status
      FROM cart_checkout_session WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE`, [cartId])).rows[0]
    const attempt = (await tx.query(`SELECT checkout_attempt_id::text AS id,cart_id,epoch,lease_owner_id,idempotency_key,
      order_id,order_correlation_status,attempt_status,payment_method FROM cart_checkout_attempt
      WHERE checkout_attempt_id=$1::uuid FOR UPDATE`, [attemptId])).rows[0]
    if (!session || !attempt || session.current_attempt_id !== attemptId || Number(session.epoch) !== epoch ||
        attempt.cart_id !== cartId || Number(attempt.epoch) !== epoch || attempt.lease_owner_id !== ownerId ||
        attempt.idempotency_key !== idempotencyKey) throw new Error("PAYMENT_STALE_CHECKOUT_AUTHORITY")
    if (session.status !== "completed" || attempt.attempt_status !== "allocated" ||
        attempt.order_correlation_status !== "correlated" || attempt.order_id !== orderId)
      throw new Error("PAYMENT_COMPLETION_NOT_ALLOCATED")
    if (attempt.payment_method !== expectedMethod) throw new Error("PAYMENT_METHOD_IMMUTABLE")
    const key = (await tx.query(`SELECT status,order_id,response_code,response_body,lease_owner_id,request_path
      FROM idempotency_key WHERE key=$1 AND deleted_at IS NULL FOR SHARE`, [idempotencyKey])).rows[0]
    const body = key?.response_body
    if (!key || key.status !== "completed" || key.lease_owner_id !== ownerId || key.order_id !== orderId ||
        key.request_path !== "/store/carts/" + cartId + "/complete" ||
        key.response_code !== 200 || !body || body.orderId !== orderId || body.conversionStatus !== "allocated" ||
        Number(body.orderVersion) !== native.orderVersion || body.currency !== "egp" ||
        body.totalMinor !== native.totalMinor) throw new Error("PAYMENT_COMPLETION_RESPONSE_INVALID")

    const batchIds = (await tx.query(`SELECT DISTINCT batch_id FROM cart_batch_reservation
      WHERE checkout_attempt_id=$1 ORDER BY batch_id`, [attemptId])).rows.map((r) => r.batch_id)
    if (!batchIds.length) throw new Error("PAYMENT_COMPLETION_RESERVATIONS_INVALID")
    const batches = await tx.query("SELECT id FROM inventory_batch WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", [batchIds])
    if (batches.rowCount !== batchIds.length) throw new Error("PAYMENT_COMPLETION_RESERVATIONS_INVALID")
    const reservations = (await tx.query(`SELECT id,cart_id,checkout_epoch,checkout_line_key,variant_id,batch_id,quantity,status
      FROM cart_batch_reservation WHERE checkout_attempt_id=$1 ORDER BY id FOR UPDATE`, [attemptId])).rows
    const allocations = (await tx.query(`SELECT id,order_version,line_item_id,checkout_line_key,batch_id,quantity_allocated,allocation_status,
      paid_unit_amount_after_discounts_snapshot
      FROM order_batch_allocation WHERE order_id=$1 ORDER BY id FOR UPDATE`, [orderId])).rows
    const movements = (await tx.query(`SELECT id,batch_id,variant_id,deduplication_key,actor_id,reason,
      quantity_on_hand_delta,quantity_reserved_delta,quantity_quarantined_delta,
      quantity_on_hand_before,quantity_on_hand_after,quantity_reserved_before,quantity_reserved_after,
      quantity_quarantined_before,quantity_quarantined_after FROM inventory_movement
      WHERE reference_type='order_allocation' AND reference_id=$1 AND movement_type='allocation_conversion' ORDER BY id`, [orderId])).rows
    const releases = await tx.query(`SELECT id FROM inventory_movement WHERE movement_type='reservation_release'
      AND reference_id=ANY($1::text[])`, [reservations.map((r) => r.id)])
    const matches = reservations.length === allocations.length && reservations.length === movements.length &&
      new Set(reservations.map((r) => r.checkout_line_key + ":" + r.batch_id)).size === reservations.length &&
      reservations.every((r) => r.cart_id === cartId && Number(r.checkout_epoch) === epoch && r.status === "converted" &&
        native.lines.some((line) => line.checkoutLineKey === r.checkout_line_key && line.variantId === r.variant_id) &&
        allocations.some((a) => a.checkout_line_key === r.checkout_line_key && a.batch_id === r.batch_id &&
          Number(a.quantity_allocated) === Number(r.quantity) && Number(a.order_version) === expectedVersion &&
          a.allocation_status === "allocated" && String(a.paid_unit_amount_after_discounts_snapshot) === paidUnitByLine.get(a.line_item_id) &&
          native.lines.some((line) => line.lineId === a.line_item_id &&
            line.checkoutLineKey === r.checkout_line_key)) &&
        movements.some((m) => {
          const digest = createHash("sha256").update(JSON.stringify(["inv-v1","allocation_conversion",r.batch_id,
            "order_allocation",orderId,r.checkout_line_key]), "utf8").digest("hex")
          return m.deduplication_key === "inv:v1:allocation_conversion:" + digest &&
            m.batch_id === r.batch_id && m.variant_id === r.variant_id && m.actor_id === "SYSTEM" && m.reason === null &&
            m.quantity_on_hand_delta === 0 && m.quantity_reserved_delta === 0 && m.quantity_quarantined_delta === 0 &&
            m.quantity_on_hand_before === m.quantity_on_hand_after && m.quantity_reserved_before === m.quantity_reserved_after &&
            m.quantity_quarantined_before === m.quantity_quarantined_after && Number(m.quantity_reserved_before) >= Number(r.quantity)
        }))
    const linesMatch = native.lines.every((line) => reservations.filter((r) => r.checkout_line_key === line.checkoutLineKey)
      .reduce((sum, r) => sum + Number(r.quantity), 0) === line.quantity)
    if (!matches || !linesMatch || releases.rowCount !== 0 || !sameIds(body.allocationIds, allocations.map((a) => a.id)) ||
        !sameIds(body.movementIds, movements.map((m) => m.id))) throw new Error("PAYMENT_COMPLETION_ALLOCATION_DIVERGENCE")

    const payment = await tx.query(`SELECT pc.id,pc.currency_code,pc.raw_amount,ps.id AS session_id,
      ps.currency_code AS session_currency,ps.raw_amount AS session_amount,ps.status
      FROM cart_payment_collection cpc JOIN payment_collection pc ON pc.id=cpc.payment_collection_id
      JOIN payment_session ps ON ps.payment_collection_id=pc.id AND ps.deleted_at IS NULL
      WHERE cpc.cart_id=$1 AND pc.deleted_at IS NULL FOR SHARE OF cpc,pc,ps`, [cartId])
    if (payment.rowCount !== 1 || String(payment.rows[0].currency_code).toLowerCase() !== "egp" ||
        String(payment.rows[0].session_currency).toLowerCase() !== "egp" ||
        !["authorized", "captured", "pending_authorization"].includes(payment.rows[0].status) ||
        normalizeEgpTotal(payment.rows[0].raw_amount).minor !== native.totalMinor ||
        normalizeEgpTotal(payment.rows[0].session_amount).minor !== native.totalMinor)
      throw new Error("PAYMENT_NATIVE_COLLECTION_MISMATCH")
    const orderPaymentLinks = await tx.query(`SELECT order_id,payment_collection_id FROM order_payment_collection
      WHERE order_id=$1 OR payment_collection_id=$2 FOR SHARE`, [orderId, payment.rows[0].id])
    if (orderPaymentLinks.rowCount !== 1 || orderPaymentLinks.rows[0].order_id !== orderId ||
        orderPaymentLinks.rows[0].payment_collection_id !== payment.rows[0].id)
      throw new Error("PAYMENT_NATIVE_COLLECTION_LINK_DIVERGENCE")
    await verifyRedis()
  }
  return initializePaymentBranch(db, { method: expectedMethod, orderId, cartId,
    checkoutAttemptId: attemptId, amount, claimCodeHash, idempotencyKey }, { verifyWithinTransaction })
}

/**
 * Trusted composition entry point. The payment order ID and monetary identity
 * come from the immutable completion response, never from the request.
 */
export async function completeAndFinalizeSameOrder(db, container, authority, dependencies, hooks = {}) {
  const { cartId, attemptId, epoch, ownerId, expectedMethod, claimCodeHash } = authority
  if (typeof dependencies.completePayableReservedCart !== "function") throw new Error("PAYABLE_CHECKOUT_GUARD_REQUIRED")
  const read = async () => (await db.query(`SELECT a.checkout_attempt_id::text AS id,a.cart_id,a.epoch,a.lease_owner_id,
    a.order_id,a.attempt_status,a.payment_method,a.idempotency_key,s.current_attempt_id::text AS current_attempt_id,
    s.epoch AS session_epoch,s.status AS session_status,k.status AS key_status,k.response_body
    FROM cart_checkout_attempt a JOIN cart_checkout_session s ON s.cart_id=a.cart_id AND s.deleted_at IS NULL
    JOIN idempotency_key k ON k.key=a.idempotency_key AND k.deleted_at IS NULL
    WHERE a.checkout_attempt_id=$1::uuid AND a.cart_id=$2`, [attemptId, cartId])).rows[0]
  let state = await read()
  if (!state || state.id !== attemptId || state.current_attempt_id !== attemptId || Number(state.epoch) !== epoch ||
      Number(state.session_epoch) !== epoch || state.lease_owner_id !== ownerId)
    throw new Error("PAYMENT_STALE_CHECKOUT_AUTHORITY")
  if (state.payment_method !== expectedMethod) throw new Error("PAYMENT_METHOD_IMMUTABLE")
  if (!(state.session_status === "completed" && state.attempt_status === "allocated" && state.key_status === "completed")) {
    let checkout
    if (state.session_status === "completed" && state.attempt_status === "allocated" && state.key_status === "pending") {
      if (typeof dependencies.completeReservedCartWithInventory !== "function") throw new Error("PAYABLE_REPLAY_COORDINATOR_REQUIRED")
      checkout = await dependencies.completeReservedCartWithInventory(container, { cartId, attemptId, epoch, ownerId },
        { reconciliationOnly: true })
    } else {
      const completed = await dependencies.completePayableReservedCart(container, { cartId, attemptId, epoch, ownerId })
      checkout = completed.checkout
    }
    if (checkout.conversionStatus !== "allocated") return { status: "pending_reconciliation" }
    await hooks.afterCheckoutCommitted?.()
    state = await read()
  }
  const body = state?.response_body
  if (!state || state.session_status !== "completed" || state.attempt_status !== "allocated" ||
      state.key_status !== "completed" || !body || body.orderId !== state.order_id || body.currency !== "egp" ||
      typeof body.totalMinor !== "string" || !/^[1-9]\d*$/.test(body.totalMinor) ||
      !Number.isSafeInteger(body.orderVersion) || body.orderVersion < 1)
    throw new Error("PAYMENT_COMPLETION_RESPONSE_INVALID")
  const payment = await finalizeCompletedCheckoutPayment(db, container, {
    cartId, attemptId, epoch, ownerId, expectedMethod, claimCodeHash,
    orderId: state.order_id, idempotencyKey: state.idempotency_key,
    expectedVersion: body.orderVersion, expectedTotalMinor: body.totalMinor,
  }, dependencies)
  return { status: "completed", orderId: state.order_id, totalMinor: body.totalMinor,
    orderVersion: body.orderVersion, payment }
}
