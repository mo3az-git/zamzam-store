import { createHash } from "node:crypto"
import { initializePaymentBranch } from "./payment-branch.mjs"

/**
 * Internal-only TP-05 -> native order bridge. This is not a Store API endpoint
 * and does not authorize payment, capture funds, or expose COD to clients.
 *
 * The supplied readNativeOrder function must be a server-owned trusted Medusa
 * order module reader; it must never accept client-provided monetary figures.
 * We verify native order-cart and current checkout attempt again INSIDE the
 * same transaction that persists payment records.
 */
export async function recordPaymentForCorrelatedOrder(db, authority, readNativeOrder) {
  const { orderId, cartId, attemptId, epoch, ownerId, idempotencyKey, claimCodeHash } = authority
  if (![orderId,cartId,attemptId,ownerId,idempotencyKey,claimCodeHash].every(x=>typeof x==="string"&&x.length>0) ||
      !Number.isSafeInteger(epoch) || epoch<1) throw new Error("PAYMENT_INVALID_AUTHORITY")
  if (typeof readNativeOrder !== "function") throw new Error("PAYMENT_NATIVE_ORDER_READER_REQUIRED")

  // Fetch monetary data from the trusted Medusa order API, not from the
  // request or front end. Reread immutable identity inside the transaction.
  const native = await readNativeOrder(orderId)
  if (!native || native.id!==orderId || typeof native.currency_code!=="string" ||
      native.currency_code.toLowerCase()!=="egp")
    throw new Error("PAYMENT_NATIVE_ORDER_NOT_VERIFIED")
  const amount = native.total
  // Medusa monetary values can be represented as Number, BigNumber or string.
  // Avoid floating point arithmetic; require the reader to normalize to a
  // canonical two-decimal MAJOR-unit string before persistence.
  if (typeof amount!=="string" || !/^(?:0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(amount) || amount==="0.00")
    throw new Error("PAYMENT_UNSUPPORTED_ORDER_TOTAL")
  if (!/^[a-f0-9]{64}$/.test(claimCodeHash)) throw new Error("PAYMENT_INVALID_CLAIM_HASH")
  const expectedIntentDigest = createHash("sha256").update(
    JSON.stringify({orderId,cartId,attemptId,epoch,amount,currency:"egp"})
  ).digest("hex")

  let method
  const verifyWithinTransaction = async (tx)=>{
    const order = await tx.query(`
      SELECT o.id,oc.cart_id
      FROM "order" AS o JOIN order_cart AS oc ON oc.order_id=o.id
      WHERE o.id=$1 AND oc.cart_id=$2 AND o.deleted_at IS NULL
      FOR SHARE OF o,oc`,[orderId,cartId])
    if (order.rows.length!==1) throw new Error("PAYMENT_NATIVE_ORDER_CART_LINK_MISSING")
    const session = await tx.query(`
      SELECT current_attempt_id,epoch,status
      FROM cart_checkout_session WHERE cart_id=$1 AND deleted_at IS NULL FOR UPDATE`,[cartId])
    const attempt = await tx.query(`
      SELECT checkout_attempt_id::text AS id,cart_id,epoch,lease_owner_id,
             order_id,order_correlation_status,attempt_status,payment_method
      FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid FOR UPDATE`,[attemptId])
    const s=session.rows[0],a=attempt.rows[0]
    if (!s || !a || s.current_attempt_id!==attemptId || Number(s.epoch)!==epoch ||
        a.cart_id!==cartId || Number(a.epoch)!==epoch || a.lease_owner_id!==ownerId)
      throw new Error("PAYMENT_STALE_CHECKOUT_AUTHORITY")
    // The checkout idempotency lease belongs to the same server-derived
    // owner and remains fresh while payment-branch records are committed.
    // Guard inside this transaction rather than trusting a prior preflight.
    const lease=await tx.query(`
      SELECT key,status FROM idempotency_key
      WHERE key=$1 AND lease_owner_id=$2 AND deleted_at IS NULL
        AND status='pending' AND last_heartbeat_at>NOW()-INTERVAL '120 seconds'
      FOR SHARE`,[idempotencyKey,ownerId])
    if (lease.rows.length!==1) throw new Error("PAYMENT_CHECKOUT_LEASE_NOT_OWNED")
    const attemptLease=await tx.query(
      "SELECT idempotency_key FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid",
      [attemptId])
    if (attemptLease.rows[0]?.idempotency_key!==idempotencyKey)
      throw new Error("PAYMENT_IDEMPOTENCY_KEY_MISMATCH")
    if (a.order_id!==orderId || a.order_correlation_status!=="correlated" ||
        a.attempt_status!=="allocated" || s.status!=="completed")
      throw new Error("PAYMENT_ORDER_NOT_ALLOCATED")
    if (!["cod","electronic"].includes(a.payment_method))
      throw new Error("PAYMENT_METHOD_NOT_SELECTED")
    if (a.payment_method!==method) throw new Error("PAYMENT_METHOD_CHANGED")
  }
  // The expected payment method must itself be obtained from a trusted source,
  // not injected by an HTTP request. Query a short preflight snapshot; the
  // transactional verifier rechecks its identity/immutability under locks.
  const preflight=await db.query(
    "SELECT payment_method FROM cart_checkout_attempt WHERE checkout_attempt_id=$1::uuid",
    [attemptId])
  method=preflight.rows[0]?.payment_method
  if (!["cod","electronic"].includes(method)) throw new Error("PAYMENT_METHOD_NOT_SELECTED")

  const result=await initializePaymentBranch(db,{
    method,orderId,cartId,checkoutAttemptId:attemptId,amount,claimCodeHash,idempotencyKey
  },{verifyWithinTransaction})
  return {...result,amountCurrency:"EGP",intentDigest:expectedIntentDigest}
}
