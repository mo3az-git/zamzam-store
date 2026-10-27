import { isVerifiedGuestCartOwnership, type GuestCartOwnershipResult } from "./guest-cart-ownership"

/**
 * Internal, read-only guest checkout readiness contract (Gemini 3.8 Flash adapter).
 * Request: pass a CartDTO already resolved by trusted server-side Medusa code,
 * the exact ownership proof returned by resolveGuestCartOwnership, and guest fields.
 * Never pass a client cart id, ownership claim, price, payment data, or provider.
 * Result: only readiness booleans and stable blocker codes; native Medusa totals
 * are observed, never recalculated. A clear result is not checkout authorization.
 * This module stays unmounted until a secure cookie/session adapter is integrated.
 */

type UnknownRecord = Record<string, unknown>
export type GuestDeliveryInput = {
  email?: unknown
  first_name?: unknown
  last_name?: unknown
  phone?: unknown
  address_1?: unknown
  address_2?: unknown
  city?: unknown
  province?: unknown
  postal_code?: unknown
  country_code?: unknown
}
type NativeMoney = number | string | { value?: unknown } | null | undefined
export type NativeShippingMethodSnapshot = {
  shipping_option_id?: unknown
  amount?: NativeMoney
  raw_amount?: NativeMoney
}
export type NativeCartSnapshot = {
  id?: unknown
  currency_code?: unknown
  region_id?: unknown
  region?: { id?: unknown; currency_code?: unknown; countries?: Array<{ iso_2?: unknown }> } | null
  shipping_address?: UnknownRecord | null
  shipping_methods?: NativeShippingMethodSnapshot[] | null
  shipping_total?: NativeMoney
  raw_shipping_total?: NativeMoney
  total?: NativeMoney
  raw_total?: NativeMoney
}
export type CheckoutSessionStatus = "in_progress" | "completed" | "aborted" | "failed" | "missing" | "unavailable"
export type PreflightBlocker =
  | "CART_UNAVAILABLE" | "CHECKOUT_OWNERSHIP_UNAVAILABLE" | "GUEST_DELIVERY_INVALID"
  | "CART_REGION_UNAVAILABLE" | "CART_REGION_NOT_EGYPT_EGP" | "CART_CURRENCY_NOT_EGP"
  | "MISSING_SHIPPING_ADDRESS" | "MISSING_SHIPPING_METHOD" | "SHIPPING_PRICE_UNAVAILABLE"
  | "PAYABLE_TOTAL_UNAVAILABLE" | "CHECKOUT_IN_PROGRESS" | "CHECKOUT_ALREADY_COMPLETED"
  | "CHECKOUT_SESSION_UNAVAILABLE"

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 &&
  value.trim().length <= max && !Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  }) ? value.trim() : null
const moneyValue = (value: NativeMoney): string | number | null => {
  const raw = value && typeof value === "object" ? value.value : value
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null
  if (typeof raw === "string") return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) ? raw : null
  return null
}

/** Allowlist and sanitize Medusa-compatible CartAddress/cart email fields. */
export function validateGuestDeliveryInput(input: GuestDeliveryInput | null | undefined): { valid: boolean; address: Record<string, string> | null; email: string | null } {
  input = input && typeof input === "object" ? input : {}
  const email = text(input.email, 254)?.toLowerCase() ?? null
  const firstName = text(input.first_name, 100)
  const lastName = text(input.last_name, 100)
  const phone = text(input.phone, 40)
  const address1 = text(input.address_1, 255)
  const address2 = input.address_2 === undefined || input.address_2 === null || input.address_2 === "" ? "" : text(input.address_2, 255)
  const city = text(input.city, 100)
  const province = input.province === undefined || input.province === null || input.province === "" ? "" : text(input.province, 100)
  const postal = input.postal_code === undefined || input.postal_code === null || input.postal_code === "" ? "" : text(input.postal_code, 32)
  const countryCode = text(input.country_code, 2)?.toLowerCase() ?? null
  const phoneDigits = phone?.replace(/\D/g, "") ?? ""
  const valid = Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && firstName && lastName &&
    phone && /^[+\d() .-]+$/.test(phone) && phoneDigits.length >= 8 && phoneDigits.length <= 15 &&
    address1 && city && countryCode === "eg" && address2 !== null && province !== null && postal !== null)
  if (!valid) return { valid: false, address: null, email: null }
  const address: Record<string, string> = { first_name: firstName!, last_name: lastName!, phone: phone!,
    address_1: address1!, city: city!, country_code: "eg" }
  if (address2) address.address_2 = address2
  if (province) address.province = province
  if (postal) address.postal_code = postal
  return { valid: true, address, email }
}

/** Readiness only. `cart` must come from a trusted server-side Medusa query, never request identity. */
export function evaluateGuestCheckoutPreflight(input: {
  cart: NativeCartSnapshot | null
  guest: GuestDeliveryInput | null | undefined
  ownership: GuestCartOwnershipResult | null | undefined
}): {
  status: "blocked" | "ready_for_review"
  blockers: PreflightBlocker[]
  readiness: { deliveryAddress: boolean; shippingMethod: boolean; shippingPrice: boolean; payableTotal: boolean }
  currency: "egp" | null
} {
  const blockers = new Set<PreflightBlocker>()
  const cart = input.cart
  const guest = validateGuestDeliveryInput(input.guest)
  if (!cart) blockers.add("CART_UNAVAILABLE")
  const ownershipVerified = isVerifiedGuestCartOwnership(input.ownership, cart?.id)
  if (!ownershipVerified) {
    blockers.add("CHECKOUT_OWNERSHIP_UNAVAILABLE")
    if (input.ownership?.status === "not_owned" && input.ownership.blocker === "CHECKOUT_ALREADY_COMPLETED") {
      blockers.add("CHECKOUT_ALREADY_COMPLETED")
    }
  }
  if (!guest.valid) blockers.add("GUEST_DELIVERY_INVALID")
  const cartCurrency = typeof cart?.currency_code === "string" ? cart.currency_code.toLowerCase() : ""
  if (cart && (!cart.region_id || !cart.region || !cart.region.id)) blockers.add("CART_REGION_UNAVAILABLE")
  if (cartCurrency && cartCurrency !== "egp") blockers.add("CART_CURRENCY_NOT_EGP")
  const regionCurrency = typeof cart?.region?.currency_code === "string" ? cart.region.currency_code.toLowerCase() : ""
  const hasEgypt = cart?.region?.countries?.some((country) => String(country.iso_2 ?? "").toLowerCase() === "eg") ?? false
  if (cart && cart.region && (regionCurrency !== "egp" || !hasEgypt)) blockers.add("CART_REGION_NOT_EGYPT_EGP")
  const address = cart?.shipping_address
  const persistedAddress = Boolean(address && String(address.address_1 ?? "").trim() &&
    String(address.city ?? "").trim() && String(address.country_code ?? "").toLowerCase() === "eg")
  const deliveryAddress = guest.valid && persistedAddress
  if (!deliveryAddress) blockers.add("MISSING_SHIPPING_ADDRESS")
  const method = cart?.shipping_methods?.find((entry) => typeof entry.shipping_option_id === "string" && entry.shipping_option_id.length > 0)
  const shippingMethod = Boolean(method)
  if (!shippingMethod) blockers.add("MISSING_SHIPPING_METHOD")
  const shippingPrice = Boolean(method && moneyValue(method.raw_amount ?? method.amount) !== null &&
    moneyValue(cart?.raw_shipping_total ?? cart?.shipping_total) !== null)
  if (shippingMethod && !shippingPrice) blockers.add("SHIPPING_PRICE_UNAVAILABLE")
  const payableTotal = moneyValue(cart?.raw_total ?? cart?.total) !== null &&
    Number(moneyValue(cart?.raw_total ?? cart?.total)) > 0
  if (!payableTotal) blockers.add("PAYABLE_TOTAL_UNAVAILABLE")
  const sessionStatus: CheckoutSessionStatus = ownershipVerified
    ? (input.ownership as Extract<GuestCartOwnershipResult, { status: "owned" }>).sessionStatus
    : "unavailable"
  if (sessionStatus === "in_progress") blockers.add("CHECKOUT_IN_PROGRESS")
  else if (sessionStatus === "completed") blockers.add("CHECKOUT_ALREADY_COMPLETED")
  else if (sessionStatus === "unavailable") blockers.add("CHECKOUT_SESSION_UNAVAILABLE")
  // Aborted/failed sessions also require a trusted recovery flow; this module cannot clear them.
  else if (sessionStatus === "aborted" || sessionStatus === "failed") blockers.add("CHECKOUT_SESSION_UNAVAILABLE")
  return { status: blockers.size ? "blocked" : "ready_for_review", blockers: [...blockers],
    readiness: { deliveryAddress, shippingMethod, shippingPrice, payableTotal },
    currency: cartCurrency === "egp" && regionCurrency === "egp" ? "egp" : null }
}
