/**
 * Server-owned cart BFF wire contract.
 *
 * Requests deliberately contain no cart ID, owner, price, currency, provider,
 * stock quantity, or completion operation. This module is pure and unmounted;
 * an HTTP adapter must first supply the verified guest ownership context.
 */
export type CartBffOperation =
  | { operation: "create"; requestId: string }
  | { operation: "read"; requestId: string }
  | { operation: "add_item"; requestId: string; expectedVersion: string; variantId: string; quantity: number }
  | { operation: "update_item"; requestId: string; expectedVersion: string; lineItemId: string; quantity: number }
  | { operation: "remove_item"; requestId: string; expectedVersion: string; lineItemId: string }
  | { operation: "set_delivery"; requestId: string; expectedVersion: string; delivery: CartBffDelivery }
  | { operation: "checkout_preflight"; requestId: string; expectedVersion: string; paymentMethod: "cod" | "electronic" }

export type CartBffDelivery = Readonly<{
  email: string
  firstName: string
  lastName: string
  phone: string
  governorateId: string
  city: string
  address1: string
  address2?: string
  postalCode?: string
  notes?: string
}>

export type CartBffMoney = Readonly<{ currency: "egp"; amount: string }>
export type CartBffLine = Readonly<{
  lineItemId: string
  variantId: string
  title: string | null
  quantity: number
  unitPrice: CartBffMoney
  total: CartBffMoney
  availability: "available" | "unavailable" | "unknown"
}>

export type CartBffBlocker =
  | "CART_UNAVAILABLE" | "CART_VERSION_CONFLICT" | "CART_MUTATION_LOCKED"
  | "CART_COMPLETED" | "CART_IDEMPOTENCY_CONFLICT" | "CART_IDEMPOTENCY_UNAVAILABLE"
  | "CART_REGION_NOT_EGYPT_EGP" | "GUEST_DELIVERY_INVALID" | "INVENTORY_UNKNOWN"
  | "INVENTORY_UNAVAILABLE" | "SHIPPING_COVERAGE_UNCONFIGURED" | "SHIPPING_RATE_UNCONFIGURED"
  | "SHIPPING_PROVIDER_UNDECIDED" | "SHIPPING_QUOTE_UNAVAILABLE"
  | "PAYMENT_METHOD_UNAVAILABLE" | "CHECKOUT_IN_PROGRESS" | "CHECKOUT_ALREADY_COMPLETED"
  | "ORDER_COMPLETION_DISABLED" | "UPSTREAM_UNAVAILABLE"
  | "GUEST_CART_NOT_OWNED" | "CART_VERSION_STALE" | "CART_REGION_NOT_EGYPT_EGP" | "CART_CURRENCY_NOT_EGP"
  | "CART_TOTAL_INVALID" | "CART_TOTAL_MISMATCH" | "CHECKOUT_ATTEMPT_STALE" | "PAYMENT_OUTCOME_UNCERTAIN"
  | "PREFLIGHT_REPLAY_CONFLICT" | "PREFLIGHT_STATE_UNAVAILABLE" | "INVENTORY_RESPONSE_INVALID"
  | "SHIPPING_READINESS_UNAVAILABLE" | "SHIPPING_GOVERNORATE_MISMATCH" | "SHIPPING_OPTION_UNSELECTED"
  | "SHIPPING_OPTION_MISMATCH" | "SHIPPING_CURRENCY_MISMATCH" | "SHIPPING_PAYABLE_TOTAL_MISMATCH"
  | "PAYMENT_READINESS_INVALID" | "COD_COLLECTION_AUTHORITY_REQUIRED" | "GATEWAY_NOT_SELECTED"
  | "AUTHENTICATED_ADAPTER_NOT_CONFIGURED" | "NATIVE_MEDUSA_PAYMENT_SYNC_REQUIRED"
  | "SHIPPING_GOVERNORATE_UNKNOWN" | "SHIPPING_COVERAGE_UNCONFIGURED" | "SHIPPING_RATE_UNCONFIGURED"
  | "SHIPPING_PROVIDER_UNDECIDED" | "SHIPPING_RATE_INVALID" | "SHIPPING_OPTION_UNSUPPORTED" | "SHIPPING_RATE_UNAVAILABLE"

export type CartBffSnapshot = Readonly<{
  version: string
  currency: "egp"
  items: readonly CartBffLine[]
  subtotal: CartBffMoney
  shipping: CartBffMoney | null
  total: CartBffMoney
  delivery: CartBffDelivery | null
}>

export type CartBffResponse = Readonly<{
  ok: boolean
  operation: CartBffOperation["operation"]
  cart: CartBffSnapshot | null
  blockers: readonly CartBffBlocker[]
  checkout: Readonly<{
    status: "blocked" | "ready_for_review"
    paymentMethod: "cod" | "electronic" | null
    blockers: readonly Readonly<{ code: CartBffBlocker; presentationKey: string }>[]
  }> | null
}>

export type ContractValidation<T> = { valid: true; value: T } | { valid: false; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const cleanText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max &&
  !Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
const requestIdPattern = /^[A-Za-z0-9_-]{16,128}$/
const resourceIdPattern = /^[A-Za-z0-9_-]{1,255}$/
const versionPattern = /^[A-Za-z0-9_.:-]{1,128}$/
const allowedKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key))

export function validateCartBffDelivery(value: unknown): ContractValidation<CartBffDelivery> {
  if (!isRecord(value) || !allowedKeys(value, ["email", "firstName", "lastName", "phone", "governorateId", "city", "address1", "address2", "postalCode", "notes"])) {
    return { valid: false, reason: "invalid_delivery_shape" }
  }
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : ""
  const phone = typeof value.phone === "string" ? value.phone.trim() : ""
  if (!cleanText(email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !cleanText(value.firstName, 100) || !cleanText(value.lastName, 100) ||
      !cleanText(phone, 40) || !/^[+\d() .-]+$/.test(phone) || phone.replace(/\D/g, "").length < 8 ||
      !cleanText(value.governorateId, 64) || !cleanText(value.city, 100) || !cleanText(value.address1, 255)) {
    return { valid: false, reason: "invalid_delivery_fields" }
  }
  for (const field of ["address2", "postalCode", "notes"] as const) {
    const max = field === "notes" ? 500 : field === "postalCode" ? 32 : 255
    if (value[field] !== undefined && value[field] !== "" && !cleanText(value[field], max)) {
      return { valid: false, reason: "invalid_delivery_fields" }
    }
  }
  return { valid: true, value: {
    email, firstName: value.firstName.trim(), lastName: value.lastName.trim(), phone,
    governorateId: value.governorateId, city: value.city.trim(), address1: value.address1.trim(),
    ...(cleanText(value.address2, 255) ? { address2: value.address2.trim() } : {}),
    ...(cleanText(value.postalCode, 32) ? { postalCode: value.postalCode.trim() } : {}),
    ...(cleanText(value.notes, 500) ? { notes: value.notes.trim() } : {}),
  } }
}

/** Strict allowlist validation rejects caller authority fields and unknown operations. */
export function validateCartBffRequest(value: unknown): ContractValidation<CartBffOperation> {
  if (!isRecord(value) || !cleanText(value.requestId, 128) || !requestIdPattern.test(value.requestId)) {
    return { valid: false, reason: "invalid_request_id_or_shape" }
  }
  const operation = value.operation
  const base = ["operation", "requestId"]
  if (operation === "create" || operation === "read") {
    if (!allowedKeys(value, base)) return { valid: false, reason: "unexpected_request_field" }
    return { valid: true, value: { operation, requestId: value.requestId } }
  }
  if (!["add_item", "update_item", "remove_item", "set_delivery", "checkout_preflight"].includes(String(operation))) {
    return { valid: false, reason: "unsupported_operation" }
  }
  if (!cleanText(value.expectedVersion, 128) || !versionPattern.test(value.expectedVersion)) {
    return { valid: false, reason: "invalid_expected_version" }
  }
  if (operation === "add_item") {
    if (!allowedKeys(value, [...base, "expectedVersion", "variantId", "quantity"]) ||
        !cleanText(value.variantId, 255) || !resourceIdPattern.test(value.variantId) ||
        !Number.isSafeInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 100) {
      return { valid: false, reason: "invalid_add_item" }
    }
    return { valid: true, value: { operation, requestId: value.requestId, expectedVersion: value.expectedVersion,
      variantId: value.variantId, quantity: Number(value.quantity) } }
  }
  if (operation === "update_item" || operation === "remove_item") {
    const keys = operation === "update_item" ? [...base, "expectedVersion", "lineItemId", "quantity"] : [...base, "expectedVersion", "lineItemId"]
    if (!allowedKeys(value, keys) || !cleanText(value.lineItemId, 255) || !resourceIdPattern.test(value.lineItemId) ||
        (operation === "update_item" && (!Number.isSafeInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 100))) {
      return { valid: false, reason: "invalid_line_item_mutation" }
    }
    return { valid: true, value: operation === "update_item"
      ? { operation, requestId: value.requestId, expectedVersion: value.expectedVersion, lineItemId: value.lineItemId, quantity: Number(value.quantity) }
      : { operation, requestId: value.requestId, expectedVersion: value.expectedVersion, lineItemId: value.lineItemId } }
  }
  if (operation === "set_delivery") {
    if (!allowedKeys(value, [...base, "expectedVersion", "delivery"])) return { valid: false, reason: "unexpected_request_field" }
    const delivery = validateCartBffDelivery(value.delivery)
    return delivery.valid ? { valid: true, value: { operation, requestId: value.requestId, expectedVersion: value.expectedVersion, delivery: delivery.value } }
      : { valid: false, reason: delivery.reason }
  }
  if (!allowedKeys(value, [...base, "expectedVersion", "paymentMethod"]) ||
      (value.paymentMethod !== "cod" && value.paymentMethod !== "electronic")) {
    return { valid: false, reason: "invalid_checkout_preflight" }
  }
  return { valid: true, value: { operation: "checkout_preflight", requestId: value.requestId,
    expectedVersion: value.expectedVersion, paymentMethod: value.paymentMethod } }
}

const validMoney = (value: unknown): value is CartBffMoney => isRecord(value) && value.currency === "egp" &&
  typeof value.amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.amount)

/** Validate an allowlisted response before serializing it across the BFF boundary. */
export function validateCartBffResponse(value: unknown): ContractValidation<CartBffResponse> {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.operation !== "string" ||
      !Array.isArray(value.blockers) || !Array.isArray(value.blockers) ||
      !allowedKeys(value, ["ok", "operation", "cart", "blockers", "checkout"]) ||
      value.blockers.some((item) => !["CART_UNAVAILABLE", "CART_VERSION_CONFLICT", "CART_MUTATION_LOCKED", "CART_COMPLETED",
        "CART_IDEMPOTENCY_CONFLICT", "CART_IDEMPOTENCY_UNAVAILABLE", "CART_REGION_NOT_EGYPT_EGP", "GUEST_DELIVERY_INVALID",
        "INVENTORY_UNKNOWN", "INVENTORY_UNAVAILABLE", "SHIPPING_COVERAGE_UNCONFIGURED", "SHIPPING_RATE_UNCONFIGURED",
        "SHIPPING_PROVIDER_UNDECIDED", "SHIPPING_QUOTE_UNAVAILABLE", "PAYMENT_METHOD_UNAVAILABLE", "CHECKOUT_IN_PROGRESS",
        "CHECKOUT_ALREADY_COMPLETED", "ORDER_COMPLETION_DISABLED", "UPSTREAM_UNAVAILABLE",
        "GUEST_CART_NOT_OWNED", "CART_VERSION_STALE", "CART_REGION_NOT_EGYPT_EGP", "CART_CURRENCY_NOT_EGP",
        "CART_TOTAL_INVALID", "CART_TOTAL_MISMATCH", "CHECKOUT_ATTEMPT_STALE", "PAYMENT_OUTCOME_UNCERTAIN",
        "PREFLIGHT_REPLAY_CONFLICT", "PREFLIGHT_STATE_UNAVAILABLE", "INVENTORY_RESPONSE_INVALID",
        "SHIPPING_READINESS_UNAVAILABLE", "SHIPPING_GOVERNORATE_MISMATCH", "SHIPPING_OPTION_UNSELECTED",
        "SHIPPING_OPTION_MISMATCH", "SHIPPING_CURRENCY_MISMATCH", "SHIPPING_PAYABLE_TOTAL_MISMATCH",
        "PAYMENT_READINESS_INVALID", "COD_COLLECTION_AUTHORITY_REQUIRED", "GATEWAY_NOT_SELECTED",
        "AUTHENTICATED_ADAPTER_NOT_CONFIGURED", "NATIVE_MEDUSA_PAYMENT_SYNC_REQUIRED",
        "SHIPPING_GOVERNORATE_UNKNOWN", "SHIPPING_COVERAGE_UNCONFIGURED", "SHIPPING_RATE_UNCONFIGURED",
        "SHIPPING_PROVIDER_UNDECIDED", "SHIPPING_RATE_INVALID", "SHIPPING_OPTION_UNSUPPORTED",
        "SHIPPING_RATE_UNAVAILABLE"].includes(String(item))) ||
      !["create", "read", "add_item", "update_item", "remove_item", "set_delivery", "checkout_preflight"].includes(value.operation)) {
    return { valid: false, reason: "invalid_response_shape" }
  }
  if (value.cart !== null) {
    if (!isRecord(value.cart) || !allowedKeys(value.cart, ["version", "currency", "items", "subtotal", "shipping", "total", "delivery"]) ||
        !cleanText(value.cart.version, 128) || value.cart.currency !== "egp" ||
        !Array.isArray(value.cart.items) || !validMoney(value.cart.subtotal) || !validMoney(value.cart.total) ||
        !(value.cart.shipping === null || validMoney(value.cart.shipping)) ||
        !(value.cart.delivery === null || validateCartBffDelivery(value.cart.delivery).valid)) {
      return { valid: false, reason: "invalid_cart_snapshot" }
    }
    for (const line of value.cart.items) {
      if (!isRecord(line) || !allowedKeys(line, ["lineItemId", "variantId", "title", "quantity", "unitPrice", "total", "availability"]) ||
          !cleanText(line.lineItemId, 255) || !cleanText(line.variantId, 255) ||
          !(line.title === null || typeof line.title === "string") || !Number.isSafeInteger(line.quantity) ||
          Number(line.quantity) < 1 || !validMoney(line.unitPrice) || !validMoney(line.total) ||
          !["available", "unavailable", "unknown"].includes(String(line.availability))) {
        return { valid: false, reason: "invalid_cart_line" }
      }
    }
  }
  if (value.checkout !== null && (!isRecord(value.checkout) || !allowedKeys(value.checkout, ["status", "paymentMethod", "blockers"]) ||
      !["blocked", "ready_for_review"].includes(String(value.checkout.status)) ||
      !(value.checkout.paymentMethod === "cod" || value.checkout.paymentMethod === "electronic" || value.checkout.paymentMethod === null) ||
      !Array.isArray(value.checkout.blockers) || value.checkout.blockers.some((item) => !isRecord(item) ||
        !allowedKeys(item, ["code", "presentationKey"]) || typeof item.code !== "string" ||
        !(value.blockers as unknown[]).includes(item.code) || typeof item.presentationKey !== "string" ||
        !/^checkout\.readiness\.blockers\.[a-z_]+$/.test(item.presentationKey)))) {
    return { valid: false, reason: "invalid_checkout_status" }
  }
  return { valid: true, value: value as unknown as CartBffResponse }
}

