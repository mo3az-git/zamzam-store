import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const rootRequire = createRequire(path.join(root, "package.json"))
rootRequire("ts-node").register({
  project: path.join(root, "apps/backend/tsconfig.json"),
  transpileOnly: true,
  swc: false,
})
const { EGYPTIAN_GOVERNORATES } = rootRequire("./apps/backend/src/modules/batch-inventory/egypt-shipping-configuration.ts")
const { resolveCheckoutShippingQuoteReadiness } = rootRequire("./apps/backend/src/modules/batch-inventory/shipping-quote-readiness.ts")

let passed = 0
function check(name, condition) {
  assert.ok(condition, name)
  passed++
  console.log("PASS " + name)
}

const approvedConfig = {
  governorateId: "cairo",
  coverage: "configured",
  rate: { status: "approved", kind: "flat", currencyCode: "egp", amount: "125.50", approvalReference: "synthetic-test-only", approvedAt: "2026-10-27T00:00:00.000Z" },
  fulfillmentProvider: { status: "selected", providerId: "fixture-provider", approvalReference: "synthetic-test-only" },
}
const nativeQuote = {
  shippingOptionId: "so_fixture_cairo",
  supportedOption: true,
  amount: "125.50",
  currencyCode: "egp",
  cartCurrencyCode: "egp",
  payableTotal: "625.50",
}
const readiness = (overrides = {}) => resolveCheckoutShippingQuoteReadiness({
  governorateId: "cairo",
  configuration: approvedConfig,
  availableProviderIds: ["fixture-provider"],
  nativeQuote,
  ...overrides,
})

check("ready_contract_requires_server_native_positive_EGP_cart_snapshot", readiness().status === "ready" &&
  readiness().amount === "125.50" && readiness().payableTotal === "625.50" && readiness().currencyCode === "egp")
check("invalid_governorate_fails_closed", readiness({ governorateId: "Cairo" }).status === "blocked" &&
  readiness({ governorateId: "Cairo" }).blockers.includes("SHIPPING_GOVERNORATE_UNKNOWN"))
check("absent_or_unregistered_provider_fails_closed", readiness({ availableProviderIds: [] }).status === "blocked" &&
  readiness({ availableProviderIds: [] }).blockers.includes("SHIPPING_PROVIDER_UNDECIDED"))
check("unsupported_native_option_fails_closed", readiness({ nativeQuote: { ...nativeQuote, supportedOption: false } }).blockers.includes("SHIPPING_OPTION_UNSUPPORTED"))
check("unavailable_rate_never_becomes_zero_or_free", readiness({ nativeQuote: null }).blockers.includes("SHIPPING_RATE_UNAVAILABLE") &&
  readiness({ nativeQuote: { ...nativeQuote, amount: "0" } }).blockers.includes("SHIPPING_RATE_UNAVAILABLE"))
check("shipping_currency_mismatch_fails_closed", readiness({ nativeQuote: { ...nativeQuote, currencyCode: "usd" } }).blockers.includes("SHIPPING_CURRENCY_MISMATCH"))
check("cart_currency_mismatch_fails_closed", readiness({ nativeQuote: { ...nativeQuote, cartCurrencyCode: "usd" } }).blockers.includes("CART_CURRENCY_NOT_EGP"))
check("currency_case_normalization_does_not_change_EGP_authority", readiness({ nativeQuote: { ...nativeQuote, currencyCode: "EGP", cartCurrencyCode: "EGP" } }).status === "ready")
check("malformed_amount_and_payable_totals_fail_closed", [
  { ...nativeQuote, amount: 125.5 },
  { ...nativeQuote, amount: "NaN" },
  { ...nativeQuote, payableTotal: "-1" },
  { ...nativeQuote, payableTotal: "120.00" },
].every((quote) => readiness({ nativeQuote: quote }).status === "blocked"))
check("all_27_governorates_preserve_unknown_unapproved_blocked_state", EGYPTIAN_GOVERNORATES.length === 27 &&
  EGYPTIAN_GOVERNORATES.every((governorate) => {
    const result = resolveCheckoutShippingQuoteReadiness({ governorateId: governorate.id })
    return result.status === "blocked" && result.blockers.includes("SHIPPING_RATE_UNCONFIGURED") && result.blockers.includes("SHIPPING_PROVIDER_UNDECIDED")
  }))

console.log("Shipping quote readiness contract: " + passed + " checks passed.")

