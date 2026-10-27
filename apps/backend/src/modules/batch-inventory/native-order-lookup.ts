/**
 * The native Medusa order/cart association is stored by its Order-Cart link.
 * Lookup is read-only and returns every candidate, including ambiguity.
 * Never infer "no native order" from absence of an order ID in a workflow result.
 */
export type NativeOrderCandidate = { id: string; cart_id: string }
type PgReader = {
  raw(sql: string, parameters?: unknown[]): Promise<{
    rows: Record<string, unknown>[]
  }>
}

/**
 * Use the Medusa native order_cart link rather than trusting request metadata.
 * If schema/permission is unavailable, propagate the error and keep the
 * checkout attempt fenced for reconciliation; never return [] on failure.
 */
export async function findNativeOrdersByCart(db: PgReader, cartId: string):
  Promise<NativeOrderCandidate[]> {
  if (!/^cart_[A-Za-z0-9_-]{3,250}$/.test(cartId)) {
    throw new Error("INVALID_NATIVE_CART_ID")
  }
  const result = await db.raw(`
    SELECT DISTINCT o.id, oc.cart_id
    FROM order_cart AS oc
    INNER JOIN "order" AS o ON o.id = oc.order_id
    WHERE oc.cart_id = ? AND o.deleted_at IS NULL
    ORDER BY o.id ASC`, [cartId])
  return result.rows as NativeOrderCandidate[]
}
