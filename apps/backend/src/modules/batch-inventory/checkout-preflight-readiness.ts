import type { AvailabilityResponse } from "./availability"
import type { CheckoutShippingQuoteReadiness } from "./shipping-quote-readiness"
import type { PaymentReadinessSnapshot, PaymentBranchReadiness } from "../order-operations/payment-provider-contract"

/**
 * Internal, read-only checkout preflight result. "ready_for_review" is not
 * authorization to create an order, payment session, charge, or reservation.
 */
export type CheckoutPreflightBlocker =
  | "GUEST_CART_NOT_OWNED"
  | "CART_VERSION_STALE"
  | "CART_CURRENCY_NOT_EGP"
  | "CART_TOTAL_INVALID"
  | "CHECKOUT_ATTEMPT_STALE"
  | "CHECKOUT_IN_PROGRESS"
  | "CHECKOUT_ALREADY_COMPLETED"
  | "PAYMENT_OUTCOME_UNCERTAIN"
  | "PREFLIGHT_REPLAY_CONFLICT"
  | "PREFLIGHT_STATE_UNAVAILABLE"
  | "INVENTORY_UNKNOWN"
  | "INVENTORY_UNAVAILABLE"
  | "INVENTORY_RESPONSE_INVALID"
  | "SHIPPING_READINESS_UNAVAILABLE"
  | "SHIPPING_GOVERNORATE_MISMATCH"
  | "SHIPPING_OPTION_UNSELECTED"
  | "SHIPPING_OPTION_MISMATCH"
  | "SHIPPING_CURRENCY_MISMATCH"
  | "SHIPPING_PAYABLE_TOTAL_MISMATCH"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "PAYMENT_READINESS_INVALID"

export type CheckoutPreflightMoney = Readonly<{ currencyCode: "egp"; amount: string }>
export type CheckoutPreflightLine = Readonly<{
  variantId: string
  quantity: number
  minShelfLifeDays: number | null
}>
export type CheckoutPreflightCart = Readonly<{
  cartId: string
  version: string
  currencyCode: string
  governorateId: string | null
  selectedShippingOptionId: string | null
  subtotal: CheckoutPreflightMoney
  payableTotal: CheckoutPreflightMoney
  lines: readonly CheckoutPreflightLine[]
}>
export type CheckoutAttemptReadiness =
  | Readonly<{ status: "none" }>
  | Readonly<{ status: "active"; cartVersion: string; paymentMethod: "cod" | "electronic" }>
  | Readonly<{ status: "stale"; cartVersion: string; paymentMethod: "cod" | "electronic" }>
  | Readonly<{ status: "completed" }>
  | Readonly<{ status: "outcome_unknown" }>

export type CheckoutPreflightInput = Readonly<{
  /** Exact server-resolved proof object returned by the Cart BFF ownership resolver. */
  ownershipProof: unknown
  expectedVersion: string
  selectedMethod: "cod" | "electronic"
  replay: "new" | "exact" | "conflict" | "unavailable"
  cart: CheckoutPreflightCart
  attempt: CheckoutAttemptReadiness
  inventory: AvailabilityResponse
  shipping: CheckoutShippingQuoteReadiness
  payments: PaymentReadinessSnapshot
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
  orderCompletionAllowed: false
  paymentExecutionAllowed: false
  replayed: boolean
}>

export type CheckoutPreflightDependencies = Readonly<{
  /** Must be the Cart BFF's isVerifiedGuestCartOwnership function, never a client flag. */
  isVerifiedGuestCartOwnership(proof: unknown, cartId: string): boolean
}>

const messageKey = (code: CheckoutPreflightBlocker) => "checkout.readiness.blockers." + code.toLowerCase()
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** Parse decimal EGP strings as exact minor units; reject float-like or >2dp values. */
function minorUnits(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ""] = value.split(".")
  try { return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) } catch { return null }
}

function methodResult(readiness: PaymentBranchReadiness | undefined): CheckoutPaymentBranchReadiness {
  if (!readiness || !["cod", "electronic"].includes(readiness.method) ||
      readiness.publicMethodEnabled !== false || readiness.settlementEnabled !== false ||
      !Array.isArray(readiness.blockers) || typeof readiness.internallyAvailable !== "boolean") {
    return { status: "blocked", blockers: ["PAYMENT_READINESS_INVALID"],
      publicMethodEnabled: false, transactionAllowed: false }
  }
  const blockers = readiness.internallyAvailable && readiness.blockers.length === 0
    ? [] : ["PAYMENT_METHOD_UNAVAILABLE" as const]
  return { status: blockers.length ? "blocked" : "ready_for_review", blockers,
    publicMethodEnabled: false, transactionAllowed: false }
}

function appendShippingBlockers(
  input: CheckoutPreflightInput,
  add: (code: CheckoutPreflightBlocker) => void
): void {
  const quote = input.shipping
  if (!quote || !isRecord(quote) || (quote.status !== "ready" && quote.status !== "blocked")) {
    add("SHIPPING_READINESS_UNAVAILABLE")
    return
  }
  if (quote.status === "blocked") {
    for (const blocker of quote.blockers) {
      if (blocker === "SHIPPING_GOVERNORATE_UNKNOWN" || blocker === "SHIPPING_COVERAGE_UNCONFIGURED" ||
          blocker === "SHIPPING_RATE_UNCONFIGURED" || blocker === "SHIPPING_PROVIDER_UNDECIDED" ||
          blocker === "SHIPPING_RATE_INVALID" || blocker === "SHIPPING_OPTION_UNSUPPORTED" ||
          blocker === "SHIPPING_RATE_UNAVAILABLE" || blocker === "SHIPPING_CURRENCY_MISMATCH" ||
          blocker === "CART_CURRENCY_NOT_EGP") add(blocker === "CART_CURRENCY_NOT_EGP" ? "CART_CURRENCY_NOT_EGP" as never : "SHIPPING_READINESS_UNAVAILABLE")
    }
    if (!quote.blockers.length) add("SHIPPING_READINESS_UNAVAILABLE")
    return
  }
  if (quote.currencyCode !== "egp" || quote.cartCurrencyCode !== "egp") add("SHIPPING_CURRENCY_MISMATCH")
  if (!input.cart.governorateId || quote.governorateId !== input.cart.governorateId) add("SHIPPING_GOVERNORATE_MISMATCH")
  if (!input.cart.selectedShippingOptionId) add("SHIPPING_OPTION_UNSELECTED")
  else if (quote.shippingOptionId !== input.cart.selectedShippingOptionId) add("SHIPPING_OPTION_MISMATCH")
  const cartTotal = minorUnits(input.cart.payableTotal.amount)
  const quoteTotal = minorUnits(quote.payableTotal)
  if (input.cart.payableTotal.currencyCode !== "egp" || cartTotal === null || cartTotal <= 0n ||
      quoteTotal === null || cartTotal !== quoteTotal) add("SHIPPING_PAYABLE_TOTAL_MISMATCH")
}

export function evaluateCheckoutPreflight(
  input: CheckoutPreflightInput,
  dependencies: CheckoutPreflightDependencies
): CheckoutPreflightResult {
  const blockers = new Set<CheckoutPreflightBlocker>()
  const cart = input?.cart
  if (!input || !dependencies || typeof dependencies.isVerifiedGuestCartOwnership !== "function" ||
      !cart || typeof cart.cartId !== "string" || !cart.cartId ||
      !dependencies.isVerifiedGuestCartOwnership(input.ownershipProof, cart.cartId)) {
    blockers.add("GUEST_CART_NOT_OWNED")
  }
  if (!input || !cart) {
    blockers.add("PREFLIGHT_STATE_UNAVAILABLE")
  } else {
    if (input.replay === "conflict") blockers.add("PREFLIGHT_REPLAY_CONFLICT")
    if (input.replay === "unavailable") blockers.add("PREFLIGHT_STATE_UNAVAILABLE")
    if (input.expectedVersion !== cart.version) blockers.add("CART_VERSION_STALE")
    if (input.attempt?.status === "stale" ||
        (input.attempt?.status === "active" &&
         (input.attempt.cartVersion !== cart.version || input.attempt.paymentMethod !== input.selectedMethod))) {
      blockers.add("CHECKOUT_ATTEMPT_STALE")
    } else if (input.attempt?.status === "active") blockers.add("CHECKOUT_IN_PROGRESS")
    else if (input.attempt?.status === "completed") blockers.add("CHECKOUT_ALREADY_COMPLETED")
    else if (input.attempt?.status === "outcome_unknown") blockers.add("PAYMENT_OUTCOME_UNCERTAIN")

    if (cart.currencyCode.toLowerCase() !== "egp" || cart.payableTotal.currencyCode !== "egp") {
      blockers.add("CART_CURRENCY_NOT_EGP")
    }
    const subtotal = minorUnits(cart.subtotal.amount)
    const total = minorUnits(cart.payableTotal.amount)
    if (subtotal === null || total === null || total <= 0n || subtotal > total) blockers.add("CART_TOTAL_INVALID")

    if (!input.inventory || input.inventory.authority !== "batch_inventory" || !Array.isArray(input.inventory.items)) {
      blockers.add("INVENTORY_RESPONSE_INVALID")
    } else {
      const statuses = new Map<string, string>()
      let invalid = false
      for (const item of input.inventory.items) {
        if (!item || typeof item.variantId !== "string" || statuses.has(item.variantId) ||
            !["available", "unavailable", "unknown"].includes(item.status)) invalid = true
        else statuses.set(item.variantId, item.status)
      }
      if (invalid || statuses.size !== cart.lines.length ||
          cart.lines.some((line) => !statuses.has(line.variantId))) blockers.add("INVENTORY_RESPONSE_INVALID")
      for (const line of cart.lines) {
        const status = statuses.get(line.variantId)
        if (status === "unknown") blockers.add("INVENTORY_UNKNOWN")
        else if (status === "unavailable") blockers.add("INVENTORY_UNAVAILABLE")
        if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) blockers.add("INVENTORY_RESPONSE_INVALID")
      }
    }
    appendShippingBlockers(input, (code) => blockers.add(code))
  }

  const cod = methodResult(input?.payments?.cod)
  const electronic = methodResult(input?.payments?.electronic)
  const selectedPayment = input?.selectedMethod === "cod" ? cod : electronic
  selectedPayment.blockers.forEach((code) => blockers.add(code))
  if (input && input.selectedMethod !== "cod" && input.selectedMethod !== "electronic") {
    blockers.add("PAYMENT_READINESS_INVALID")
  }

  const ordered = [...blockers]
  const details = ordered.map((code) => ({ code, presentationKey: messageKey(code) }))
  return {
    status: details.length ? "blocked" : "ready_for_review",
    selectedMethod: input?.selectedMethod === "cod" ? "cod" : "electronic",
    blockers: details,
    payment: { cod, electronic },
    cartVersion: cart?.version ?? null,
    currencyCode: "egp",
    payableTotal: cart?.payableTotal?.amount ?? null,
    orderCompletionAllowed: false,
    paymentExecutionAllowed: false,
    replayed: input?.replay === "exact",
  }
}
