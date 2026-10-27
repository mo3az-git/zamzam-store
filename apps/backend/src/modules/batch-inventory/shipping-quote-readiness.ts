import {
  evaluateGovernorateShippingConfiguration,
  type GovernorateShippingConfiguration,
  type ShippingConfigurationBlocker,
} from "./egypt-shipping-configuration"

/** Stable backend-to-Checkout result. Only a native server cart snapshot can produce `ready`. */
export type CheckoutShippingQuoteReadiness =
  | Readonly<{
      status: "blocked"
      governorateId: string | null
      currencyCode: "egp"
      blockers: readonly CheckoutShippingBlocker[]
    }>
  | Readonly<{
      status: "ready"
      governorateId: string
      shippingOptionId: string
      currencyCode: "egp"
      amount: string
      cartCurrencyCode: "egp"
      payableTotal: string
    }>

export type CheckoutShippingBlocker = ShippingConfigurationBlocker |
  "SHIPPING_OPTION_UNSUPPORTED" |
  "SHIPPING_RATE_UNAVAILABLE" |
  "SHIPPING_CURRENCY_MISMATCH" |
  "CART_CURRENCY_NOT_EGP"

/** Values read by trusted backend code from Medusa; never pass browser-supplied totals here. */
export type NativeShippingQuoteSnapshot = Readonly<{
  shippingOptionId?: unknown
  supportedOption?: unknown
  amount?: unknown
  currencyCode?: unknown
  cartCurrencyCode?: unknown
  payableTotal?: unknown
}>

/**
 * Builds the checkout handoff contract without quoting, converting currency, or falling back
 * to zero. `nativeQuote` must be read from the server-owned Medusa cart after option selection.
 */
export function resolveCheckoutShippingQuoteReadiness(input: Readonly<{
  governorateId: unknown
  configuration?: GovernorateShippingConfiguration | null
  availableProviderIds?: readonly string[]
  nativeQuote?: NativeShippingQuoteSnapshot | null
}>): CheckoutShippingQuoteReadiness {
  const governorateId = typeof input.governorateId === "string" ? input.governorateId : null
  const blockers: CheckoutShippingBlocker[] = [...evaluateGovernorateShippingConfiguration(
    input.governorateId,
    input.configuration,
    input.availableProviderIds,
  )]
  if (blockers.length) return blocked(governorateId, blockers)

  const quote = input.nativeQuote
  if (!quote) return blocked(governorateId, ["SHIPPING_RATE_UNAVAILABLE"])
  if (quote.supportedOption !== true || typeof quote.shippingOptionId !== "string" || !quote.shippingOptionId.trim()) {
    return blocked(governorateId, ["SHIPPING_OPTION_UNSUPPORTED"])
  }
  if (typeof quote.currencyCode !== "string" || quote.currencyCode.toLowerCase() !== "egp") {
    return blocked(governorateId, ["SHIPPING_CURRENCY_MISMATCH"])
  }
  if (typeof quote.cartCurrencyCode !== "string" || quote.cartCurrencyCode.toLowerCase() !== "egp") {
    return blocked(governorateId, ["CART_CURRENCY_NOT_EGP"])
  }
  if (!isPositiveDecimal(quote.amount) || !isNonNegativeDecimal(quote.payableTotal)) {
    return blocked(governorateId, ["SHIPPING_RATE_UNAVAILABLE"])
  }

  return {
    status: "ready",
    governorateId: input.governorateId as string,
    shippingOptionId: quote.shippingOptionId,
    currencyCode: "egp",
    amount: quote.amount,
    cartCurrencyCode: "egp",
    payableTotal: quote.payableTotal,
  }
}

function blocked(governorateId: string | null, blockers: readonly CheckoutShippingBlocker[]): CheckoutShippingQuoteReadiness {
  return { status: "blocked", governorateId, currencyCode: "egp", blockers }
}

function isNonNegativeDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
}

function isPositiveDecimal(value: unknown): value is string {
  return isNonNegativeDecimal(value) && /[1-9]/.test(value)
}

