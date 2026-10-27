/**
 * Read-only, internal boundary for a verified Medusa native order snapshot.
 *
 * This is NOT permission to create a payment intent or authorize checkout.
 * The native snapshot is authenticated separately by the backend reader.
 * A future writer MUST recheck cart→order, version/amount, checkout lease,
 * payment method, and owner authority under the correct transactional locks.
 */
export type VerifiedNativeOrderSnapshot = {
  cartId: string
  orderId: string
  currency: string
  orderVersion: number
  totalMajor: string
  totalMinor: string
  lines: Array<{ lineId: string; checkoutLineKey: string }>
}
export type InternalPayableQuote = Readonly<{
  cartId: string
  orderId: string
  orderVersion: number
  currency: "EGP"
  amountMajor: string
  amountMinor: string
}>

const invalid = (): never => { throw new Error("UNVERIFIED_PAYABLE_ORDER_SNAPSHOT") }

export function makeInternalPayableQuote(
  snapshot: VerifiedNativeOrderSnapshot,
  expected: { cartId: string; orderId: string }
): InternalPayableQuote {
  if (!expected || typeof expected.cartId !== "string" || !expected.cartId ||
    typeof expected.orderId !== "string" || !expected.orderId ||
    !snapshot || snapshot.cartId !== expected.cartId || snapshot.orderId !== expected.orderId ||
    snapshot.currency !== "egp" || !Number.isSafeInteger(snapshot.orderVersion) ||
    snapshot.orderVersion < 1 || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0) invalid()

  // Exact integer arithmetic, never JS Number × 100 or cosmetic rounding.
  const major = snapshot.totalMajor
  if (typeof major !== "string" || !/^(?:0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(major) ||
    typeof snapshot.totalMinor !== "string" || !/^[1-9][0-9]*$/.test(snapshot.totalMinor)) invalid()
  const [whole, fraction] = major.split(".")
  const computedMinor = (BigInt(whole) * 100n + BigInt(fraction)).toString()
  if (computedMinor !== snapshot.totalMinor) invalid()
  return Object.freeze({
    cartId: expected.cartId,
    orderId: expected.orderId,
    orderVersion: snapshot.orderVersion,
    currency: "EGP" as const,
    amountMajor: major,
    amountMinor: computedMinor,
  })
}
