import { randomUUID } from "node:crypto"

/**
 * Internal-only provider-neutral branch prototype.
 *
 * Precondition: caller has already established authoritative order/cart/amount,
 * checkout_attempt_id and a claim-code hash. Not an HTTP route. Not a gateway.
 * The caller must provide a dedicated PostgreSQL client (supports BEGIN/COMMIT).
 *
 * The advisory lock serializes competing branch selections for the same order,
 * making the chosen payment method immutable and suppressing cross-branch writes.
 */
export async function initializePaymentBranch(db, input, { verifyWithinTransaction } = {}) {
  const { method, orderId, cartId, checkoutAttemptId, amount, claimCodeHash, idempotencyKey } = input
  if (method !== "electronic" && method !== "cod") throw new Error("INVALID_PAYMENT_METHOD")
  for (const [key, val] of Object.entries({orderId, cartId, checkoutAttemptId, idempotencyKey})) {
    if (typeof val !== "string" || !/^[a-zA-Z0-9_:-]{3,255}$/.test(val)) throw new Error("INVALID_" + key)
  }
  if (!/^[a-f0-9]{64}$/.test(claimCodeHash || "")) throw new Error("INVALID_CLAIM_CODE_HASH")
  if (typeof amount !== "string" || !/^(?:0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(amount) || amount === "0.00") {
    throw new Error("INVALID_AMOUNT_MAJOR_UNITS")
  }

  await db.query("BEGIN")
  try {
    // Revision 18: root lock precedes any order-scoped child locks.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["phase0:order:" + orderId])
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["tp05:order:" + orderId])
    // Production-facing callers must validate native order/cart/attempt
    // association within this transaction, before any payment write.
    if (verifyWithinTransaction) await verifyWithinTransaction(db)
    const existing = await db.query(
      "SELECT id, payment_method, claim_code_hash FROM order_operational_state WHERE order_id = $1 AND deleted_at IS NULL FOR UPDATE",
      [orderId]
    )
    if (existing.rows[0] && existing.rows[0].payment_method !== method) {
      throw new Error("PAYMENT_METHOD_IMMUTABLE")
    }
    if (existing.rows[0] && existing.rows[0].claim_code_hash !== claimCodeHash) {
      throw new Error("CLAIM_CODE_IDENTITY_CONFLICT")
    }

    if (existing.rows.length === 0) {
      await db.query(`
        INSERT INTO order_operational_state (id, order_id, payment_method, claim_code_hash)
        VALUES ($1, $2, $3, $4)`,
      ["oop_" + randomUUID(), orderId, method, claimCodeHash])
    }

    if (method === "cod") {
      const current = await db.query("SELECT id, expected_amount, collection_status FROM cod_collection_record WHERE order_id=$1 AND deleted_at IS NULL FOR UPDATE", [orderId])
      if (current.rows[0]) {
        if (current.rows[0].expected_amount !== amount) throw new Error("PAYMENT_AMOUNT_CONFLICT")
      } else {
        await db.query(`
          INSERT INTO cod_collection_record (id,order_id,expected_amount)
          VALUES ($1,$2,$3::numeric)`,
          ["cod_" + randomUUID(),orderId,amount])
      }
    } else {
      const current = await db.query(
        "SELECT id, order_id, cart_id, amount, provider_key, idempotency_key FROM electronic_payment_attempt WHERE checkout_attempt_id=$1 AND deleted_at IS NULL FOR UPDATE",
        [checkoutAttemptId]
      )
      if (current.rows[0]) {
        const row=current.rows[0]
        if (row.order_id !== orderId || row.cart_id !== cartId ||
            row.amount !== amount || row.provider_key !== "phase1-simulator" ||
            row.idempotency_key !== idempotencyKey) throw new Error("PAYMENT_INTENT_CONFLICT")
      } else {
        await db.query(`
          INSERT INTO electronic_payment_attempt
          (id,order_id,cart_id,checkout_attempt_id,provider_key,amount,currency_code,status,idempotency_key)
          VALUES ($1,$2,$3,$4,'phase1-simulator',$5::numeric,'EGP','initiated',$6)`,
          ["epa_" + randomUUID(),orderId,cartId,checkoutAttemptId,amount,idempotencyKey])
      }
      // If an order already has a different attempt, this prototype refuses
      // an additional attempt rather than inventing payment retry semantics.
      const all = await db.query("SELECT id FROM electronic_payment_attempt WHERE order_id=$1 AND deleted_at IS NULL", [orderId])
      if (all.rows.length !== 1) throw new Error("MULTIPLE_ELECTRONIC_ATTEMPTS_UNSUPPORTED")
    }

    // The DB commit must never leave both mutually exclusive branches present.
    const counts = await db.query(`
      SELECT
        (SELECT count(*)::int FROM cod_collection_record WHERE order_id=$1 AND deleted_at IS NULL) AS cod,
        (SELECT count(*)::int FROM electronic_payment_attempt WHERE order_id=$1 AND deleted_at IS NULL) AS electronic`, [orderId])
    if (counts.rows[0].cod !== Number(method === "cod") || counts.rows[0].electronic !== Number(method === "electronic")) {
      throw new Error("PAYMENT_BRANCH_DIVERGENCE")
    }
    await db.query("COMMIT")
    return { method, orderId, provider: method === "electronic" ? "phase1-simulator" : null, persisted: true }
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}
