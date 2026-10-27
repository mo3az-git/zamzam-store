import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const rootRequire = createRequire(path.join(root, "package.json"))
rootRequire("ts-node").register({
  project: path.join(root, "apps/backend/tsconfig.json"),
  transpileOnly: true,
})
const {
  EGYPTIAN_GOVERNORATES,
  EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION,
  getGovernorateShippingBlockers,
  evaluateGovernorateShippingConfiguration,
  resolveEgyptianGovernorateId,
  resolveEgyptianMedusaProvinceCode,
  validateApprovedFlatRate,
} = rootRequire("./apps/backend/src/modules/batch-inventory/egypt-shipping-configuration.ts")

let passed = 0
function check(name, condition) {
  assert.ok(condition, name)
  passed++
  console.log("PASS " + name)
}

check("exactly_27_governorates", EGYPTIAN_GOVERNORATES.length === 27)
check("stable_ids_are_unique", new Set(EGYPTIAN_GOVERNORATES.map((entry) => entry.id)).size === 27)
check("ISO_codes_are_unique", new Set(EGYPTIAN_GOVERNORATES.map((entry) => entry.iso3166_2)).size === 27)
check("Medusa_lowercase_province_codes_are_unique", new Set(EGYPTIAN_GOVERNORATES.map((entry) => entry.medusaProvinceCode)).size === 27)
check("all_entries_have_Arabic_and_English_names", EGYPTIAN_GOVERNORATES.every((entry) => entry.nameAr && entry.nameEn))
check("frontend_ids_remain_exact", ["cairo","giza","alexandria","qalyubia","sharqia","dakahlia","gharbia","menofia","beheira","kafr_el_sheikh","damietta","port_said","ismailia","suez","north_sinai","south_sinai","beni_suef","fayoum","minya","asyut","sohag","qena","luxor","aswan","red_sea","new_valley","matrouh"].every((id) => resolveEgyptianGovernorateId(id)?.id === id))
check("IDs_are_case_sensitive_and_unknown_values_fail_closed", resolveEgyptianGovernorateId("Cairo") === null && resolveEgyptianGovernorateId("cairo-city") === null && resolveEgyptianGovernorateId("unknown") === null)
check("display_names_are_never_accepted_as_aliases", resolveEgyptianGovernorateId("القاهرة") === null && resolveEgyptianGovernorateId("Cairo") === null)
check("province_code_reverse_lookup_is_exact", resolveEgyptianMedusaProvinceCode("eg-c")?.id === "cairo" && resolveEgyptianMedusaProvinceCode("EG-C") === null && resolveEgyptianMedusaProvinceCode("eg-xx") === null)
check("configuration_has_one_unconfigured_rate_per_governorate", EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION.length === 27 && EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION.every((entry) => entry.coverage === "unconfigured" && entry.rate.status === "unconfigured" && entry.fulfillmentProvider.status === "undecided"))
check("no_placeholder_numeric_rates_exist", EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION.every((entry) => !("amount" in entry.rate)))
check("unknown_governorate_has_only_unknown_blocker", JSON.stringify(getGovernorateShippingBlockers("Cairo")) === JSON.stringify(["SHIPPING_GOVERNORATE_UNKNOWN"]))
check("known_governorate_separates_coverage_rate_provider_blockers", JSON.stringify(getGovernorateShippingBlockers("cairo")) === JSON.stringify(["SHIPPING_COVERAGE_UNCONFIGURED","SHIPPING_RATE_UNCONFIGURED","SHIPPING_PROVIDER_UNDECIDED"]))
check("approved_rate_requires_nonzero_EGP_decimal_string_and_audit_reference", validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"egp",amount:"125.50",approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"}) && !validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"egp",amount:"0",approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"}) && !validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"usd",amount:"125.50",approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"}))
check("numeric_amount_is_rejected_without_money_coercion", !validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"egp",amount:125,approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"}))
check("missing_malformed_zero_and_unsupported_currency_rates_fail_closed", [
  undefined,
  "",
  "0",
  "0.00",
  "-1",
  "12,50",
  "NaN",
  "Infinity",
].every((amount) => !validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"egp",amount,approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"})) &&
  !validateApprovedFlatRate({status:"approved",kind:"flat",currencyCode:"usd",amount:"12.50",approvalReference:"owner-decision-123",approvedAt:"2026-10-27T00:00:00.000Z"}))
const approvedFutureConfig = {
  governorateId: "cairo",
  coverage: "configured",
  rate: { status: "approved", kind: "flat", currencyCode: "egp", amount: "125.50", approvalReference: "owner-decision-123", approvedAt: "2026-10-27T00:00:00.000Z" },
  fulfillmentProvider: { status: "selected", providerId: "future-approved-provider", approvalReference: "owner-decision-123" },
}
check("future_approved_configuration_requires_an_installed_provider_registry_match", evaluateGovernorateShippingConfiguration("cairo", approvedFutureConfig, ["future-approved-provider"]).length === 0 &&
  evaluateGovernorateShippingConfiguration("cairo", approvedFutureConfig).includes("SHIPPING_PROVIDER_UNDECIDED"))
check("malformed_future_rate_and_unsupported_provider_never_clear_readiness_blockers", [
  { ...approvedFutureConfig, rate: { ...approvedFutureConfig.rate, amount: "NaN" } },
  { ...approvedFutureConfig, rate: { ...approvedFutureConfig.rate, currencyCode: "usd" } },
  { ...approvedFutureConfig, fulfillmentProvider: { status: "selected", providerId: " ", approvalReference: "owner-decision-123" } },
  { ...approvedFutureConfig, fulfillmentProvider: { status: "undecided" } },
].every((configuration) => evaluateGovernorateShippingConfiguration("cairo", configuration, ["future-approved-provider"]).length > 0) &&
  evaluateGovernorateShippingConfiguration("cairo", {
    ...approvedFutureConfig,
    fulfillmentProvider: { status: "selected", providerId: "unsupported-provider", approvalReference: "owner-decision-123" },
  }, ["future-approved-provider"]).includes("SHIPPING_PROVIDER_UNDECIDED"))
check("configuration_cannot_be_replayed_for_another_governorate", evaluateGovernorateShippingConfiguration("giza", approvedFutureConfig).includes("SHIPPING_COVERAGE_UNCONFIGURED"))
check("missing_coverage_rate_and_installed_provider_remain_distinct", JSON.stringify(evaluateGovernorateShippingConfiguration("cairo", { ...approvedFutureConfig, coverage: "unconfigured", rate: { status: "unconfigured" } })) === JSON.stringify(["SHIPPING_COVERAGE_UNCONFIGURED","SHIPPING_RATE_UNCONFIGURED","SHIPPING_PROVIDER_UNDECIDED"]))
console.log("Egypt governorate shipping foundation: " + passed + " checks passed.")
