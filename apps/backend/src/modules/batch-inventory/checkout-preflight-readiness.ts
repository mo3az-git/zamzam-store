import type { AvailabilityResponse } from "./availability"
import type { CartOrchestrationSnapshot, GuestCartAuthority } from "./cart-bff-orchestrator"
import type { CheckoutShippingQuoteReadiness, CheckoutShippingBlocker } from "./shipping-quote-readiness"
import type { PaymentReadinessSnapshot, PaymentBranchReadiness } from "../order-operations/payment-provider-contract"

export type CheckoutPreflightBlocker =
  | "GUEST_CART_NOT_OWNED" | "CART_VERSION_STALE" | "CART_REGION_NOT_EGYPT_EGP" | "CART_CURRENCY_NOT_EGP"
  | "CART_TOTAL_INVALID" | "CART_TOTAL_MISMATCH" | "CHECKOUT_ATTEMPT_STALE" | "CHECKOUT_IN_PROGRESS"
  | "CHECKOUT_ALREADY_COMPLETED" | "PAYMENT_OUTCOME_UNCERTAIN" | "PREFLIGHT_REPLAY_CONFLICT"
  | "PREFLIGHT_STATE_UNAVAILABLE" | "INVENTORY_UNKNOWN" | "INVENTORY_UNAVAILABLE"
  | "INVENTORY_RESPONSE_INVALID" | "SHIPPING_READINESS_UNAVAILABLE" | "SHIPPING_GOVERNORATE_MISMATCH"
  | "SHIPPING_OPTION_UNSELECTED" | "SHIPPING_OPTION_MISMATCH" | "SHIPPING_CURRENCY_MISMATCH"
  | "SHIPPING_PAYABLE_TOTAL_MISMATCH" | "PAYMENT_METHOD_UNAVAILABLE" | "PAYMENT_READINESS_INVALID"
  | "COD_COLLECTION_AUTHORITY_REQUIRED" | "GATEWAY_NOT_SELECTED"
  | "AUTHENTICATED_ADAPTER_NOT_CONFIGURED" | "NATIVE_MEDUSA_PAYMENT_SYNC_REQUIRED"
  | CheckoutShippingBlocker

export type CheckoutAttemptReadiness =
  | Readonly<{ status: "none" }>
  | Readonly<{ status: "active"; cartVersion: string; paymentMethod: "cod" | "electronic" }>
  | Readonly<{ status: "stale"; cartVersion: string; paymentMethod: "cod" | "electronic" }>
  | Readonly<{ status: "completed" }>
  | Readonly<{ status: "outcome_unknown" }>

export type NativeCheckoutReadinessFacts = Readonly<{
  cartId: string
  cartVersion: string
  countryCode: string
  currencyCode: string
  governorateId: string | null
  selectedShippingOptionId: string | null
  subtotal: string
  payableTotal: string
}>

export type CheckoutPaymentBranchReadiness = Readonly<{
  status: "blocked" | "ready_for_review"
  blockers: readonly CheckoutPreflightBlocker[]
  publicMethodEnabled: false
  transactionAllowed: false
}>

export type CheckoutPreflightResult = Readonly<{
  status: "blocked" | "ready_for_review"
  selectedMethod: "cod" | "electronic"
  blockers: readonly Readonly<{ code: CheckoutPreflightBlocker; presentationKey: string }>[]
  payment: Readonly<{ cod: CheckoutPaymentBranchReadiness; electronic: CheckoutPaymentBranchReadiness }>
  cartVersion: string | null
  currencyCode: "egp"
  payableTotal: string | null
  inventoryReservationRequired: true
  orderCompletionAllowed: false
  paymentExecutionAllowed: false
  replayed: boolean
}>

export type CheckoutPreflightInput = Readonly<{
  ownership: GuestCartAuthority
  expectedVersion: string
  selectedMethod: "cod" | "electronic"
  replay: "new" | "exact" | "conflict" | "unavailable"
  cart: CartOrchestrationSnapshot
  native: NativeCheckoutReadinessFacts
  attempt: CheckoutAttemptReadiness
  inventory: AvailabilityResponse
  shipping: CheckoutShippingQuoteReadiness
  payments: PaymentReadinessSnapshot
}>

export type CheckoutPreflightDependencies = Readonly<{
  /** Wire directly to Cart BFF isVerifiedGuestCartOwnership; never derive from request JSON. */
  isVerifiedGuestCartOwnership(proof: unknown, cartId: string): boolean
}>

const keyFor = (code: CheckoutPreflightBlocker) => "checkout.readiness.blockers." + code.toLowerCase()
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const minor = (raw: unknown): bigint | null => {
  if (typeof raw !== "string" || !/^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/.test(raw)) return null
  const [whole, fraction = ""] = raw.split(".")
  try { return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) } catch { return null }
}

function paymentBranch(
  value: PaymentBranchReadiness | undefined,
  expectedMethod: "cod" | "electronic"
): CheckoutPaymentBranchReadiness {
  if (!value || value.method !== expectedMethod || typeof value.internallyAvailable !== "boolean" ||
      value.publicMethodEnabled !== false || value.settlementEnabled !== false || !Array.isArray(value.blockers)) {
    return { status: "blocked", blockers: ["PAYMENT_READINESS_INVALID"],
      publicMethodEnabled: false, transactionAllowed: false }
  }
  const blockers: CheckoutPreflightBlocker[] = value.blockers.length
    ? [...value.blockers]
    : value.internallyAvailable ? [] : ["PAYMENT_METHOD_UNAVAILABLE"]
  return { status: blockers.length ? "blocked" : "ready_for_review", blockers,
    publicMethodEnabled: false, transactionAllowed: false }
}

/**
 * Read-only composition of the Cart BFF proof/snapshot, FEFO projection,
 * PR #36 server-owned shipping quote and PR #19 internal payment readiness.
 * The supplied ownership verifier must be Cart BFF's exact proof validator.
 */
export function evaluateCheckoutPreflight(
  input: CheckoutPreflightInput,
  dependencies: CheckoutPreflightDependencies
): CheckoutPreflightResult {
  const blockers = new Set<CheckoutPreflightBlocker>()
  const cart = input?.cart
  const native = input?.native
  const ownership = input?.ownership
  if (!input || !dependencies || typeof dependencies.isVerifiedGuestCartOwnership !== "function" ||
      ownership?.status !== "owned" || !ownership.cartId || !ownership.proof || !cart ||
      !dependencies.isVerifiedGuestCartOwnership(ownership.proof, ownership.cartId)) {
    blockers.add("GUEST_CART_NOT_OWNED")
  }
  if (!input || !cart || !native || !input.attempt || !input.inventory || !input.shipping || !input.payments) {
    blockers.add("PREFLIGHT_STATE_UNAVAILABLE")
  } else {
    if (native.cartId !== ownership?.cartId || native.cartVersion !== cart.version) blockers.add("PREFLIGHT_STATE_UNAVAILABLE")
    if (input.replay === "conflict") blockers.add("PREFLIGHT_REPLAY_CONFLICT")
    if (input.replay === "unavailable") blockers.add("PREFLIGHT_STATE_UNAVAILABLE")
    if (input.expectedVersion !== cart.version) blockers.add("CART_VERSION_STALE")
    if (native.countryCode.toLowerCase() !== "eg") blockers.add("CART_REGION_NOT_EGYPT_EGP")
    if (native.currencyCode.toLowerCase() !== "egp" || cart.public.currency !== "egp") blockers.add("CART_CURRENCY_NOT_EGP")

    const subtotal = minor(native.subtotal)
    const payable = minor(native.payableTotal)
    const publicPayable = minor(cart.public.total.amount)
    if (subtotal === null || payable === null || payable <= 0n || subtotal > payable) blockers.add("CART_TOTAL_INVALID")
    if (payable === null || publicPayable === null || payable !== publicPayable ||
        cart.public.total.currency !== "egp") blockers.add("CART_TOTAL_MISMATCH")

    if (input.attempt.status === "stale" ||
        (input.attempt.status === "active" &&
         (input.attempt.cartVersion !== cart.version || input.attempt.paymentMethod !== input.selectedMethod))) {
      blockers.add("CHECKOUT_ATTEMPT_STALE")
    } else if (input.attempt.status === "active") blockers.add("CHECKOUT_IN_PROGRESS")
    else if (input.attempt.status === "completed") blockers.add("CHECKOUT_ALREADY_COMPLETED")
    else if (input.attempt.status === "outcome_unknown") blockers.add("PAYMENT_OUTCOME_UNCERTAIN")

    if (input.inventory.authority !== "batch_inventory" || !Array.isArray(input.inventory.items)) {
      blockers.add("INVENTORY_RESPONSE_INVALID")
    } else {
      const expectedVariants = new Set(cart.lines.map((line) => line.variantId))
      const statuses = new Map<string, string>()
      let invalid = false
      for (const item of input.inventory.items) {
        if (!item || typeof item.variantId !== "string" || statuses.has(item.variantId) ||
            !["available", "unavailable", "unknown"].includes(item.status)) invalid = true
        else statuses.set(item.variantId, item.status)
      }
      if (invalid || statuses.size !== expectedVariants.size ||
          [...expectedVariants].some((id) => !statuses.has(id))) blockers.add("INVENTORY_RESPONSE_INVALID")
      for (const status of statuses.values()) {
        if (status === "unknown") blockers.add("INVENTORY_UNKNOWN")
        else if (status === "unavailable") blockers.add("INVENTORY_UNAVAILABLE")
      }
      if (cart.lines.some((line) => !Number.isSafeInteger(line.minShelfLifeDays) &&
          line.minShelfLifeDays !== null)) blockers.add("INVENTORY_UNKNOWN")
    }

    const quote = input.shipping
    if (!isRecord(quote) || (quote.status !== "ready" && quote.status !== "blocked")) {
      blockers.add("SHIPPING_READINESS_UNAVAILABLE")
    } else if (quote.status === "blocked") {
      if (!quote.blockers.length) blockers.add("SHIPPING_READINESS_UNAVAILABLE")
      else quote.blockers.forEach((code) => blockers.add(code))
    } else {
      if (!native.governorateId || quote.governorateId !== native.governorateId ||
          native.governorateId !== cart.governorateId) blockers.add("SHIPPING_GOVERNORATE_MISMATCH")
      if (!native.selectedShippingOptionId) blockers.add("SHIPPING_OPTION_UNSELECTED")
      else if (quote.shippingOptionId !== native.selectedShippingOptionId) blockers.add("SHIPPING_OPTION_MISMATCH")
      const quoteTotal = minor(quote.payableTotal)
      if (quote.currencyCode !== "egp" || quote.cartCurrencyCode !== "egp") blockers.add("SHIPPING_CURRENCY_MISMATCH")
      if (quoteTotal === null || payable === null || quoteTotal !== payable) blockers.add("SHIPPING_PAYABLE_TOTAL_MISMATCH")
    }
  }

  const cod = paymentBranch(input?.payments?.cod, "cod")
  const electronic = paymentBranch(input?.payments?.electronic, "electronic")
  const selected = input?.selectedMethod === "cod" ? cod : electronic
  selected.blockers.forEach((code) => blockers.add(code))
  if (input && input.selectedMethod !== "cod" && input.selectedMethod !== "electronic") blockers.add("PAYMENT_READINESS_INVALID")

  const details = [...blockers].map((code) => ({ code, presentationKey: keyFor(code) }))
  return {
    status: details.length ? "blocked" : "ready_for_review",
    selectedMethod: input?.selectedMethod === "cod" ? "cod" : "electronic",
    blockers: details,
    payment: { cod, electronic },
    cartVersion: cart?.version ?? null,
    currencyCode: "egp",
    payableTotal: native?.payableTotal ?? null,
    inventoryReservationRequired: true,
    orderCompletionAllowed: false,
    paymentExecutionAllowed: false,
    replayed: input?.replay === "exact",
  }
}
