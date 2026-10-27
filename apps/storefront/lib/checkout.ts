/**
 * Guest Checkout Types, Validation & Data Mapping (Phase 4.4 MVP)
 *
 * Client & Server safe:
 * - Pure data models, validation functions, and backend contract mapping.
 * - Aligned with `apps/backend/src/modules/batch-inventory/guest-checkout-preflight.ts`.
 * - Egyptian phone normalization and format validation.
 * - Validated email and first/last name separation without ambiguous guessing.
 * - Delivery notes strictly kept separate from Medusa CartAddress payload.
 * - In-memory RAM caching for preview/language-switch navigation (RAM only;
 *   never stored in localStorage, cookies, or URL query strings).
 */

import type { Dictionary } from "./i18n.ts"

export interface GuestCheckoutInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  governorate: string
  city: string
  address: string
  notes?: string
  fullName?: string
}

export type GuestCheckoutFieldErrors = Partial<Record<keyof GuestCheckoutInput, string>>

export interface GovernorateOption {
  code: string
  nameAr: string
  nameEn: string
  /** Canonical native Medusa GeoZone province_code (lowercase ISO 3166-2). */
  provinceCode: string
}

/** Standard Egyptian Governorates (27 Governorates) */
export const EGYPTIAN_GOVERNORATES: readonly GovernorateOption[] = [
  { code: "cairo", nameAr: "القاهرة", nameEn: "Cairo" , provinceCode: "eg-c" },
  { code: "giza", nameAr: "الجيزة", nameEn: "Giza" , provinceCode: "eg-gz" },
  { code: "alexandria", nameAr: "الإسكندرية", nameEn: "Alexandria" , provinceCode: "eg-alx" },
  { code: "qalyubia", nameAr: "القليوبية", nameEn: "Qalyubia" , provinceCode: "eg-kb" },
  { code: "sharqia", nameAr: "الشرقية", nameEn: "Sharqia" , provinceCode: "eg-shr" },
  { code: "dakahlia", nameAr: "الدقهلية", nameEn: "Dakahlia" , provinceCode: "eg-dk" },
  { code: "gharbia", nameAr: "الغربية", nameEn: "Gharbia" , provinceCode: "eg-gh" },
  { code: "menofia", nameAr: "المنوفية", nameEn: "Menofia" , provinceCode: "eg-mnf" },
  { code: "beheira", nameAr: "البحيرة", nameEn: "Beheira" , provinceCode: "eg-bh" },
  { code: "kafr_el_sheikh", nameAr: "كفر الشيخ", nameEn: "Kafr El Sheikh" , provinceCode: "eg-kfs" },
  { code: "damietta", nameAr: "دمياط", nameEn: "Damietta" , provinceCode: "eg-dt" },
  { code: "port_said", nameAr: "بورسعيد", nameEn: "Port Said" , provinceCode: "eg-pts" },
  { code: "ismailia", nameAr: "الإسماعيلية", nameEn: "Ismailia" , provinceCode: "eg-is" },
  { code: "suez", nameAr: "السويس", nameEn: "Suez" , provinceCode: "eg-suz" },
  { code: "north_sinai", nameAr: "شمال سيناء", nameEn: "North Sinai" , provinceCode: "eg-sin" },
  { code: "south_sinai", nameAr: "جنوب سيناء", nameEn: "South Sinai" , provinceCode: "eg-js" },
  { code: "beni_suef", nameAr: "بني سويف", nameEn: "Beni Suef" , provinceCode: "eg-bns" },
  { code: "fayoum", nameAr: "الفيوم", nameEn: "Fayoum" , provinceCode: "eg-fym" },
  { code: "minya", nameAr: "المنيا", nameEn: "Minya" , provinceCode: "eg-mn" },
  { code: "asyut", nameAr: "أسيوط", nameEn: "Asyut" , provinceCode: "eg-ast" },
  { code: "sohag", nameAr: "سوهاج", nameEn: "Sohag" , provinceCode: "eg-shg" },
  { code: "qena", nameAr: "قنا", nameEn: "Qena" , provinceCode: "eg-kn" },
  { code: "luxor", nameAr: "الأقصر", nameEn: "Luxor" , provinceCode: "eg-lx" },
  { code: "aswan", nameAr: "أسوان", nameEn: "Aswan" , provinceCode: "eg-asn" },
  { code: "red_sea", nameAr: "البحر الأحمر", nameEn: "Red Sea" , provinceCode: "eg-ba" },
  { code: "new_valley", nameAr: "الوادي الجديد", nameEn: "New Valley" , provinceCode: "eg-wad" },
  { code: "matrouh", nameAr: "مطروح", nameEn: "Matrouh" , provinceCode: "eg-mt" },
] as const

/** Stable governorate identifiers are exact, case-sensitive allowlisted slugs. */
export function isValidGovernorate(govCode: unknown): govCode is string {
  return typeof govCode === "string" && EGYPTIAN_GOVERNORATES.some((g) => g.code === govCode)
}

/** Map UI governorate slug to Medusa province_code, never to a display label. */
export function resolveGovernorateProvince(govCode: string): string | null {
  const gov = EGYPTIAN_GOVERNORATES.find((g) => g.code === govCode)
  return gov ? gov.provinceCode : null
}

/**
 * Validates whether an email string matches the backend preflight email specification.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false
  const trimmed = email.trim()
  if (trimmed.length === 0 || trimmed.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Normalizes an Egyptian mobile phone number.
 * Strips whitespace, hyphens, and standard Egyptian country codes (+20, 0020).
 */
export function normalizeEgyptianPhone(phone: string): string {
  if (typeof phone !== "string") return ""
  return phone.replace(/[\s\-()]/g, "").replace(/^(?:\+20|0020)/, "0")
}

/**
 * Validates whether a phone number matches standard Egyptian mobile format.
 * Must be 11 digits starting with 010, 011, 012, or 015.
 */
export function isValidEgyptianPhone(phone: string): boolean {
  const normalized = normalizeEgyptianPhone(phone)
  return /^01[0125]\d{8}$/.test(normalized)
}

export interface CheckoutValidationResult {
  isValid: boolean
  errors: GuestCheckoutFieldErrors
}

/**
 * Validates guest checkout delivery form input fields.
 * Ensures first/last name and email satisfy the preflight contract without silent guessing.
 */
export function validateGuestCheckout(
  data: Partial<GuestCheckoutInput>,
  dict: Dictionary
): CheckoutValidationResult {
  const errors: GuestCheckoutFieldErrors = {}

  // Name handling: Accept explicit firstName and lastName, or split unambiguous fullName (>= 2 tokens)
  const firstName = typeof data.firstName === "string" ? data.firstName.trim() : ""
  const lastName = typeof data.lastName === "string" ? data.lastName.trim() : ""
  const fullName = typeof data.fullName === "string" ? data.fullName.trim() : ""

  if (firstName || lastName) {
    if (!firstName || firstName.length > 100) {
      errors.firstName = dict.checkout.firstNameRequired
    }
    if (!lastName || lastName.length > 100) {
      errors.lastName = dict.checkout.lastNameRequired
    }
  } else if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length < 2 || fullName.length < 3) {
      errors.fullName = dict.checkout.nameRequired
    }
  } else {
    // Neither explicit first/last nor full name provided
    errors.fullName = dict.checkout.nameRequired
    errors.firstName = dict.checkout.firstNameRequired
    errors.lastName = dict.checkout.lastNameRequired
  }

  // Email validation
  const email = typeof data.email === "string" ? data.email.trim() : ""
  if (!email || !isValidEmail(email)) {
    errors.email = dict.checkout.emailRequired
  }

  // Phone validation
  const phone = typeof data.phone === "string" ? data.phone.trim() : ""
  if (!phone || !isValidEgyptianPhone(phone)) {
    errors.phone = dict.checkout.phoneRequired
  }

  // Governorate validation
  const governorate = typeof data.governorate === "string" ? data.governorate.trim() : ""
  const isGovValid = EGYPTIAN_GOVERNORATES.some((g) => g.code === governorate)
  if (!governorate || !isGovValid) {
    errors.governorate = dict.checkout.governorateRequired
  }

  // City validation
  const city = typeof data.city === "string" ? data.city.trim() : ""
  if (!city || city.length < 2 || city.length > 100) {
    errors.city = dict.checkout.cityRequired
  }

  // Address validation
  const address = typeof data.address === "string" ? data.address.trim() : ""
  if (!address || address.length < 5 || address.length > 255) {
    errors.address = dict.checkout.addressRequired
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Backend Medusa-compatible Guest Delivery Payload (PR #19 preflight contract).
 */
export interface BackendGuestDeliveryPayload {
  email: string
  first_name: string
  last_name: string
  phone: string
  address_1: string
  address_2?: string
  city: string
  province?: string
  postal_code?: string
  country_code: "eg"
}

export type GuestDeliveryMappingResult =
  | { success: true; payload: BackendGuestDeliveryPayload; deliveryNotes?: string }
  | { success: false; errors: GuestCheckoutFieldErrors }

/**
 * Pure frontend-to-backend data-mapping helper.
 * - Extracts first_name and last_name safely without ambiguous guessing.
 * - Normalizes Egyptian phone number.
 * - Normalizes email to lowercase.
 * - Maps governorate to province representation.
 * - Enforces country_code = "eg".
 * - Keeps optional delivery notes strictly separate from the Medusa CartAddress payload.
 * - Prevents invalid fields from returning a supposedly valid backend payload.
 */
export function mapGuestCheckoutToBackend(
  input: Partial<GuestCheckoutInput>,
  dict: Dictionary
): GuestDeliveryMappingResult {
  const validation = validateGuestCheckout(input, dict)
  if (!validation.isValid) {
    return { success: false, errors: validation.errors }
  }

  let firstName = typeof input.firstName === "string" ? input.firstName.trim() : ""
  let lastName = typeof input.lastName === "string" ? input.lastName.trim() : ""
  if (!firstName || !lastName) {
    const fullName = typeof input.fullName === "string" ? input.fullName.trim() : ""
    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      firstName = parts[0]
      lastName = parts.slice(1).join(" ")
    }
  }

  const email = (input.email ?? "").trim().toLowerCase()
  const phone = normalizeEgyptianPhone(input.phone ?? "")
  const address1 = (input.address ?? "").trim()
  const city = (input.city ?? "").trim()
  const province = resolveGovernorateProvince(input.governorate ?? "")
  if (!province) {
    return {
      success: false,
      errors: { ...validation.errors, governorate: dict.checkout.governorateRequired },
    }
  }

  const payload: BackendGuestDeliveryPayload = {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    address_1: address1,
    city,
    province,
    country_code: "eg",
  }

  const deliveryNotes =
    typeof input.notes === "string" && input.notes.trim().length > 0
      ? input.notes.trim()
      : undefined

  return {
    success: true,
    payload,
    deliveryNotes,
  }
}

/**
 * Backend Preflight Blocker Codes.
 * Directly aligned with `guest-checkout-preflight.ts`.
 */
export type PreflightBlocker =
  | "CHECKOUT_OWNERSHIP_UNAVAILABLE"
  | "GUEST_DELIVERY_INVALID"
  | "MISSING_SHIPPING_ADDRESS"
  | "MISSING_SHIPPING_METHOD"
  | "SHIPPING_PRICE_UNAVAILABLE"
  | "PAYABLE_TOTAL_UNAVAILABLE"
  | "CHECKOUT_IN_PROGRESS"
  | "CHECKOUT_ALREADY_COMPLETED"
  | "CART_UNAVAILABLE"
  | "CART_REGION_UNAVAILABLE"
  | "CART_REGION_NOT_EGYPT_EGP"
  | "CART_CURRENCY_NOT_EGP"
  | "CHECKOUT_SESSION_UNAVAILABLE"

export interface CheckoutReadinessState {
  status: "blocked" | "ready_for_review"
  blockers: PreflightBlocker[]
  readiness: {
    deliveryAddress: boolean
    shippingMethod: boolean
    shippingPrice: boolean
    payableTotal: boolean
  }
}

/**
 * Synthetic QA Readiness Fixture.
 * Strictly used inside verified QA preview mode to demonstrate backend blocker mapping.
 */
export const SYNTHETIC_QA_READINESS_FIXTURE: CheckoutReadinessState = {
  status: "blocked",
  blockers: [
    "CHECKOUT_OWNERSHIP_UNAVAILABLE",
    "MISSING_SHIPPING_METHOD",
    "SHIPPING_PRICE_UNAVAILABLE",
  ],
  readiness: {
    deliveryAddress: false,
    shippingMethod: false,
    shippingPrice: false,
    payableTotal: true,
  },
}

/**
 * In-memory RAM cache for guest form fields during preview/language-switch navigation.
 * Never persisted to localStorage, cookies, or URL query strings.
 */
let inMemoryCheckoutState: GuestCheckoutInput = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  governorate: "",
  city: "",
  address: "",
  notes: "",
}

export function getInMemoryCheckoutState(): GuestCheckoutInput {
  return { ...inMemoryCheckoutState }
}

export function setInMemoryCheckoutState(data: Partial<GuestCheckoutInput>): void {
  inMemoryCheckoutState = { ...inMemoryCheckoutState, ...data }
}
