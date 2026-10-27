/**
 * Storefront <-> Backend Contract Boundaries
 *
 * Prepares clean, strongly-typed interfaces for future cart, batch stock availability,
 * and checkout integration (Phases 3 and 4) without duplicating or modifying
 * backend payment/inventory internals.
 *
 * Canonical Rules:
 * 1. Storefront is read-only catalog presentation in Phase 2.
 * 2. Storefront NEVER executes direct database queries or calls privileged backend modules.
 * 3. Batch stock availability is an authoritative backend presentation contract,
 *    not browser-calculated inventory.
 * 4. Production checkout, cart mutations, and payment capture require explicit coordination
 *    with backend agents (PR #19, PR #23).
 */

export type BatchStockStatus = "in_stock" | "low_stock" | "out_of_stock" | "unavailable"

export interface BatchStockAvailabilityResponse {
  variant_id: string
  status: BatchStockStatus
  /** Customer-facing message in Arabic/English; never exposes lot numbers or quarantine quantities */
  localized_message?: {
    ar: string
    en: string
  }
  updated_at: string
}

export interface StoreCartItemContract {
  variant_id: string
  quantity: number
  unit_price: number
  title: string
  sku?: string | null
}

export interface StoreCartSessionContract {
  id: string
  currency_code: "egp"
  items: StoreCartItemContract[]
  subtotal: number
  shipping_total?: number | null
  total: number
  status: "active" | "locked_for_checkout" | "completed"
}

export interface CheckoutContractHandoff {
  cart_id: string
  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string
  }
  shipping_address: {
    governorate: string
    city: string
    street_address: string
    building_details?: string
    notes?: string
  }
  payment_method: "cash_on_delivery" | "electronic_payment"
}

/**
 * Read-only stub adapter for stock availability.
 * In Phase 2, displays informative catalog-only availability notices.
 * When Phase 3 batch availability endpoint is ready, this function maps directly to it.
 */
export async function queryVariantAvailability(variantId: string): Promise<BatchStockAvailabilityResponse> {
  return {
    variant_id: variantId,
    status: "unavailable",
    localized_message: {
      ar: "حالة التوفر تعتمد على فحص المخزون الفعلي عند فتح الطلبات.",
      en: "Availability status will be verified against inventory when ordering opens.",
    },
    updated_at: new Date().toISOString(),
  }
}
