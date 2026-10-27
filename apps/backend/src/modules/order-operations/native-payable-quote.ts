import type { MedusaContainer } from "@medusajs/framework/types"
import { readNativePayableOrderSnapshot } from "../batch-inventory/native-payable-order-snapshot"
import { makeInternalPayableQuote, type InternalPayableQuote } from "./payment-quote-validation"

/**
 * Trusted server-side *read only* payment handoff for later checkout work.
 * Caller owns cart/attempt lock authority; no browser-visible route and
 * no payment record, gateway operation, or COD collection is performed here.
 * Results are snapshots, NOT authorization to write or capture payment.
 */
export async function readInternalPayableQuote(
  container: MedusaContainer,
  expected: { cartId: string; orderId: string; expectedVersion?: number; expectedTotalMinor?: string }
): Promise<InternalPayableQuote> {
  if (!expected?.cartId || !expected?.orderId) {
    throw new Error("INVALID_INTERNAL_PAYMENT_QUOTE_REQUEST")
  }
  const snapshot = await readNativePayableOrderSnapshot(container, expected)
  return makeInternalPayableQuote(snapshot, expected)
}
