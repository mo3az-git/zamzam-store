/**
 * Pure Types & Synthetic Fixtures for the Storefront Cart (Phase 4 MVP).
 *
 * Safe to import in both Server and Client Components.
 * Does not contain server-only secrets, backend URLs, or network mutation adapters.
 */

export interface SanitizedLineItem {
  id: string
  title: string | null
  variant_id: string
  quantity: number
  unit_price: number | null
  total: number | null
}

export interface SanitizedCart {
  id: string
  region_id: string
  currency_code: string
  total: number | null
  subtotal: number | null
  tax_total?: number | null
  items: SanitizedLineItem[]
}

/**
 * Isolated synthetic fixture for nonproduction Cart UI preview.
 * Strictly used for design and layout preview without executing real mutations or unauthorized TP-01 checkout.
 */
export const SYNTHETIC_CART_PREVIEW_FIXTURE: SanitizedCart = {
  id: "cart_preview_synthetic_1",
  region_id: "reg_egp_preview",
  currency_code: "egp",
  total: 185.1,
  subtotal: 185.1,
  tax_total: 0,
  items: [
    {
      id: "item_preview_1",
      title: "ماء زمزم 5 لتر",
      variant_id: "var_zamzam_5l",
      quantity: 3,
      unit_price: 61.7,
      total: 185.1,
    },
  ],
}
