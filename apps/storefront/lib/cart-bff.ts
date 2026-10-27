/** Same-origin client for the server-owned guest-cart BFF contract.
 * The browser sends intent only. Cart ownership, prices, availability and totals
 * are always resolved by the server; session credentials are HttpOnly cookies.
 */
export type CartBffOperation =
  | { operation: "create" | "read"; requestId: string }
  | { operation: "add_item"; requestId: string; expectedVersion: string; variantId: string; quantity: number }
  | { operation: "update_item"; requestId: string; expectedVersion: string; lineItemId: string; quantity: number }
  | { operation: "remove_item"; requestId: string; expectedVersion: string; lineItemId: string }
  | { operation: "set_delivery"; requestId: string; expectedVersion: string; delivery: CartBffDelivery }
  | { operation: "checkout_preflight"; requestId: string; expectedVersion: string; paymentMethod: "cod" | "electronic" }

export type CartBffDelivery = {
  email: string; firstName: string; lastName: string; phone: string
  governorateId: string; city: string; address1: string
  address2?: string; postalCode?: string; notes?: string
}
export type CartBffMoney = { currency: "egp"; amount: string }
export type CartBffLine = {
  lineItemId: string; variantId: string; title: string | null; quantity: number
  unitPrice: CartBffMoney; total: CartBffMoney
  availability: "available" | "unavailable" | "unknown"
}
export type CartBffSnapshot = {
  version: string; currency: "egp"; items: CartBffLine[]; subtotal: CartBffMoney
  shipping: CartBffMoney | null; total: CartBffMoney; delivery: CartBffDelivery | null
}
export type CartBffBlocker =
  | "CART_UNAVAILABLE" | "CART_VERSION_CONFLICT" | "CART_MUTATION_LOCKED" | "CART_COMPLETED"
  | "CART_IDEMPOTENCY_CONFLICT" | "CART_IDEMPOTENCY_UNAVAILABLE" | "CART_REGION_NOT_EGYPT_EGP"
  | "GUEST_DELIVERY_INVALID" | "INVENTORY_UNKNOWN" | "INVENTORY_UNAVAILABLE"
  | "SHIPPING_COVERAGE_UNCONFIGURED" | "SHIPPING_RATE_UNCONFIGURED" | "SHIPPING_PROVIDER_UNDECIDED"
  | "SHIPPING_QUOTE_UNAVAILABLE" | "PAYMENT_METHOD_UNAVAILABLE" | "CHECKOUT_IN_PROGRESS"
  | "CHECKOUT_ALREADY_COMPLETED" | "ORDER_COMPLETION_DISABLED" | "UPSTREAM_UNAVAILABLE"
export type CartBffResponse = {
  ok: boolean; operation: CartBffOperation["operation"]; cart: CartBffSnapshot | null
  blockers: CartBffBlocker[]
  checkout: { status: "blocked" | "ready_for_review"; paymentMethod: "cod" | "electronic" | null } | null
}
export type CartBffResult = { success: true; data: CartBffResponse } | { success: false; error: "unavailable" | "invalid_response" }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))
const isMoney = (value: unknown): value is CartBffMoney => isRecord(value) && exactKeys(value, ["currency", "amount"]) && value.currency === "egp" &&
  typeof value.amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.amount)
const isCart = (value: unknown): value is CartBffSnapshot => {
  if (!isRecord(value) || !exactKeys(value, ["version", "currency", "items", "subtotal", "shipping", "total", "delivery"]) || typeof value.version !== "string" || !value.version || value.currency !== "egp" ||
      !Array.isArray(value.items) || !isMoney(value.subtotal) || !isMoney(value.total) ||
      !(value.shipping === null || isMoney(value.shipping)) || !(value.delivery === null || isRecord(value.delivery))) return false
  return value.items.every((line) => isRecord(line) && typeof line.lineItemId === "string" &&
    exactKeys(line, ["lineItemId", "variantId", "title", "quantity", "unitPrice", "total", "availability"]) &&
    typeof line.variantId === "string" && (line.title === null || typeof line.title === "string") &&
    Number.isSafeInteger(line.quantity) && Number(line.quantity) > 0 && isMoney(line.unitPrice) && isMoney(line.total) &&
    ["available", "unavailable", "unknown"].includes(String(line.availability)))
}
const blockers = new Set<CartBffBlocker>([
  "CART_UNAVAILABLE", "CART_VERSION_CONFLICT", "CART_MUTATION_LOCKED", "CART_COMPLETED", "CART_IDEMPOTENCY_CONFLICT",
  "CART_IDEMPOTENCY_UNAVAILABLE", "CART_REGION_NOT_EGYPT_EGP", "GUEST_DELIVERY_INVALID", "INVENTORY_UNKNOWN",
  "INVENTORY_UNAVAILABLE", "SHIPPING_COVERAGE_UNCONFIGURED", "SHIPPING_RATE_UNCONFIGURED", "SHIPPING_PROVIDER_UNDECIDED",
  "SHIPPING_QUOTE_UNAVAILABLE", "PAYMENT_METHOD_UNAVAILABLE", "CHECKOUT_IN_PROGRESS", "CHECKOUT_ALREADY_COMPLETED",
  "ORDER_COMPLETION_DISABLED", "UPSTREAM_UNAVAILABLE",
])
export function parseCartBffResponse(value: unknown, operation: CartBffOperation["operation"]): CartBffResponse | null {
  if (!isRecord(value) || !exactKeys(value, ["ok", "operation", "cart", "blockers", "checkout"]) ||
      typeof value.ok !== "boolean" || value.operation !== operation || !Array.isArray(value.blockers) ||
      !value.blockers.every((item) => blockers.has(item as CartBffBlocker)) ||
      !(value.cart === null || isCart(value.cart))) return null
  const checkout = value.checkout
  if (!(checkout === null || (isRecord(checkout) && ["blocked", "ready_for_review"].includes(String(checkout.status)) &&
      [null, "cod", "electronic"].includes(checkout.paymentMethod as string | null)))) return null
  return value as unknown as CartBffResponse
}

export function newCartRequestId(): string {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? ""
}

/** Does not retry: an ambiguous mutation is resolved by a subsequent read. */
export async function requestCartBff(operation: CartBffOperation): Promise<CartBffResult> {
  if (!operation.requestId || !/^[A-Za-z0-9_-]{16,128}$/.test(operation.requestId)) return { success: false, error: "invalid_response" }
  try {
    const response = await fetch("/api/cart", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(operation),
    })
    if (!response.ok) return { success: false, error: "unavailable" }
    const data = parseCartBffResponse(await response.json(), operation.operation)
    return data ? { success: true, data } : { success: false, error: "invalid_response" }
  } catch {
    return { success: false, error: "unavailable" }
  }
}

