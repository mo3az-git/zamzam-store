/**
 * Canonical, provider-neutral governorate shipping configuration.
 *
 * This module describes coverage and approval state only. It creates no Medusa
 * zones/options and contains no rates. Runtime activation requires an explicit
 * separately reviewed configuration change.
 */
export type EgyptianGovernorate = Readonly<{
  id: string
  nameEn: string
  nameAr: string
  iso3166_2: string
  medusaProvinceCode: string
}>

const GOVERNORATES: readonly EgyptianGovernorate[] = [
  { id: "cairo", nameEn: "Cairo", nameAr: "القاهرة", iso3166_2: "EG-C", medusaProvinceCode: "eg-c" },
  { id: "giza", nameEn: "Giza", nameAr: "الجيزة", iso3166_2: "EG-GZ", medusaProvinceCode: "eg-gz" },
  { id: "alexandria", nameEn: "Alexandria", nameAr: "الإسكندرية", iso3166_2: "EG-ALX", medusaProvinceCode: "eg-alx" },
  { id: "qalyubia", nameEn: "Qalyubia", nameAr: "القليوبية", iso3166_2: "EG-KB", medusaProvinceCode: "eg-kb" },
  { id: "sharqia", nameEn: "Sharqia", nameAr: "الشرقية", iso3166_2: "EG-SHR", medusaProvinceCode: "eg-shr" },
  { id: "dakahlia", nameEn: "Dakahlia", nameAr: "الدقهلية", iso3166_2: "EG-DK", medusaProvinceCode: "eg-dk" },
  { id: "gharbia", nameEn: "Gharbia", nameAr: "الغربية", iso3166_2: "EG-GH", medusaProvinceCode: "eg-gh" },
  { id: "menofia", nameEn: "Monufia", nameAr: "المنوفية", iso3166_2: "EG-MNF", medusaProvinceCode: "eg-mnf" },
  { id: "beheira", nameEn: "Beheira", nameAr: "البحيرة", iso3166_2: "EG-BH", medusaProvinceCode: "eg-bh" },
  { id: "kafr_el_sheikh", nameEn: "Kafr El Sheikh", nameAr: "كفر الشيخ", iso3166_2: "EG-KFS", medusaProvinceCode: "eg-kfs" },
  { id: "damietta", nameEn: "Damietta", nameAr: "دمياط", iso3166_2: "EG-DT", medusaProvinceCode: "eg-dt" },
  { id: "port_said", nameEn: "Port Said", nameAr: "بورسعيد", iso3166_2: "EG-PTS", medusaProvinceCode: "eg-pts" },
  { id: "ismailia", nameEn: "Ismailia", nameAr: "الإسماعيلية", iso3166_2: "EG-IS", medusaProvinceCode: "eg-is" },
  { id: "suez", nameEn: "Suez", nameAr: "السويس", iso3166_2: "EG-SUZ", medusaProvinceCode: "eg-suz" },
  { id: "north_sinai", nameEn: "North Sinai", nameAr: "شمال سيناء", iso3166_2: "EG-SIN", medusaProvinceCode: "eg-sin" },
  { id: "south_sinai", nameEn: "South Sinai", nameAr: "جنوب سيناء", iso3166_2: "EG-JS", medusaProvinceCode: "eg-js" },
  { id: "beni_suef", nameEn: "Beni Suef", nameAr: "بني سويف", iso3166_2: "EG-BNS", medusaProvinceCode: "eg-bns" },
  { id: "fayoum", nameEn: "Faiyum", nameAr: "الفيوم", iso3166_2: "EG-FYM", medusaProvinceCode: "eg-fym" },
  { id: "minya", nameEn: "Minya", nameAr: "المنيا", iso3166_2: "EG-MN", medusaProvinceCode: "eg-mn" },
  { id: "asyut", nameEn: "Asyut", nameAr: "أسيوط", iso3166_2: "EG-AST", medusaProvinceCode: "eg-ast" },
  { id: "sohag", nameEn: "Sohag", nameAr: "سوهاج", iso3166_2: "EG-SHG", medusaProvinceCode: "eg-shg" },
  { id: "qena", nameEn: "Qena", nameAr: "قنا", iso3166_2: "EG-KN", medusaProvinceCode: "eg-kn" },
  { id: "luxor", nameEn: "Luxor", nameAr: "الأقصر", iso3166_2: "EG-LX", medusaProvinceCode: "eg-lx" },
  { id: "aswan", nameEn: "Aswan", nameAr: "أسوان", iso3166_2: "EG-ASN", medusaProvinceCode: "eg-asn" },
  { id: "red_sea", nameEn: "Red Sea", nameAr: "البحر الأحمر", iso3166_2: "EG-BA", medusaProvinceCode: "eg-ba" },
  { id: "new_valley", nameEn: "New Valley", nameAr: "الوادي الجديد", iso3166_2: "EG-WAD", medusaProvinceCode: "eg-wad" },
  { id: "matrouh", nameEn: "Matrouh", nameAr: "مطروح", iso3166_2: "EG-MT", medusaProvinceCode: "eg-mt" },
] as const

export const EGYPTIAN_GOVERNORATES: readonly EgyptianGovernorate[] = Object.freeze(
  GOVERNORATES.map((entry) => Object.freeze(entry))
)

export type ShippingRateApproval =
  | Readonly<{ status: "unconfigured" }>
  | Readonly<{
      status: "approved"
      kind: "flat"
      currencyCode: "egp"
      amount: string
      approvalReference: string
      approvedAt: string
    }>

export type FulfillmentProviderSelection =
  | Readonly<{ status: "undecided" }>
  | Readonly<{ status: "selected"; providerId: string; approvalReference: string }>

export type GovernorateShippingConfiguration = Readonly<{
  governorateId: string
  coverage: "unconfigured" | "configured"
  rate: ShippingRateApproval
  fulfillmentProvider: FulfillmentProviderSelection
}>

export const EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION: readonly GovernorateShippingConfiguration[] =
  Object.freeze(EGYPTIAN_GOVERNORATES.map((governorate) => Object.freeze({
    governorateId: governorate.id,
    coverage: "unconfigured" as const,
    rate: Object.freeze({ status: "unconfigured" as const }),
    fulfillmentProvider: Object.freeze({ status: "undecided" as const }),
  })))

export type ShippingConfigurationBlocker =
  | "SHIPPING_GOVERNORATE_UNKNOWN"
  | "SHIPPING_COVERAGE_UNCONFIGURED"
  | "SHIPPING_RATE_UNCONFIGURED"
  | "SHIPPING_PROVIDER_UNDECIDED"
  | "SHIPPING_RATE_INVALID"

const byId = new Map(EGYPTIAN_GOVERNORATES.map((entry) => [entry.id, entry]))
const byProvince = new Map(EGYPTIAN_GOVERNORATES.map((entry) => [entry.medusaProvinceCode, entry]))

/** Accept only the stable storefront ID; display names and aliases are not identifiers. */
export function resolveEgyptianGovernorateId(value: unknown): EgyptianGovernorate | null {
  return typeof value === "string" ? byId.get(value) ?? null : null
}

/** Medusa's province_code is lower-case ISO 3166-2. Unknown/case-changed codes fail closed. */
export function resolveEgyptianMedusaProvinceCode(value: unknown): EgyptianGovernorate | null {
  return typeof value === "string" ? byProvince.get(value) ?? null : null
}

export function getGovernorateShippingConfiguration(value: unknown): GovernorateShippingConfiguration | null {
  const governorate = resolveEgyptianGovernorateId(value)
  if (!governorate) return null
  return EGYPT_GOVERNORATE_SHIPPING_CONFIGURATION.find((entry) => entry.governorateId === governorate.id) ?? null
}

/** A provider-native quote is impossible until coverage, rate, and provider are all approved. */
export function getGovernorateShippingBlockers(value: unknown): ShippingConfigurationBlocker[] {
  const configuration = getGovernorateShippingConfiguration(value)
  return evaluateGovernorateShippingConfiguration(value, configuration)
}

/** Evaluate a future server-owned persisted configuration; caller data is never authoritative. */
export function evaluateGovernorateShippingConfiguration(
  governorateId: unknown,
  configuration: GovernorateShippingConfiguration | null | undefined
): ShippingConfigurationBlocker[] {
  const governorate = resolveEgyptianGovernorateId(governorateId)
  if (!governorate) return ["SHIPPING_GOVERNORATE_UNKNOWN"]
  if (!configuration || configuration.governorateId !== governorate.id) {
    return ["SHIPPING_COVERAGE_UNCONFIGURED", "SHIPPING_RATE_UNCONFIGURED", "SHIPPING_PROVIDER_UNDECIDED"]
  }
  const blockers: ShippingConfigurationBlocker[] = []
  if (configuration.coverage !== "configured") blockers.push("SHIPPING_COVERAGE_UNCONFIGURED")
  if (configuration.rate.status !== "approved") blockers.push("SHIPPING_RATE_UNCONFIGURED")
  else if (!isApprovedRate(configuration.rate)) blockers.push("SHIPPING_RATE_INVALID")
  const provider = configuration.fulfillmentProvider
  if (provider.status !== "selected" || typeof provider.providerId !== "string" || !provider.providerId.trim() ||
      typeof provider.approvalReference !== "string" || !provider.approvalReference.trim()) {
    blockers.push("SHIPPING_PROVIDER_UNDECIDED")
  }
  return blockers
}

function isApprovedRate(rate: Extract<ShippingRateApproval, { status: "approved" }>): boolean {
  return rate.currencyCode === "egp" &&
    typeof rate.amount === "string" &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate.amount) &&
    /[1-9]/.test(rate.amount) &&
    typeof rate.approvalReference === "string" && rate.approvalReference.trim().length > 0 &&
    typeof rate.approvedAt === "string" && !Number.isNaN(Date.parse(rate.approvedAt))
}

/** Exact shape validator for future server-owned configuration; never converts money to Number. */
export function validateApprovedFlatRate(value: unknown): value is Extract<ShippingRateApproval, { status: "approved" }> {
  if (!value || typeof value !== "object") return false
  const rate = value as Record<string, unknown>
  return rate.status === "approved" && rate.kind === "flat" && rate.currencyCode === "egp" &&
    typeof rate.amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate.amount) &&
    /[1-9]/.test(rate.amount) &&
    typeof rate.approvalReference === "string" && rate.approvalReference.trim().length > 0 &&
    typeof rate.approvedAt === "string" && !Number.isNaN(Date.parse(rate.approvedAt))
}
