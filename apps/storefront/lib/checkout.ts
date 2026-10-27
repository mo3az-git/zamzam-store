/**
 * Guest Checkout Types, Validation & Utilities (Phase 4.3 MVP)
 *
 * Client & Server safe:
 * - Pure data models and validation functions.
 * - Egyptian phone normalization and format validation.
 * - Standard list of Egyptian governorates.
 * - In-memory form caching for preview/language-switch navigation (RAM only;
 *   never stored in localStorage, cookies, or URL query strings).
 */

import type { Dictionary } from "./i18n.ts"

export interface GuestCheckoutInput {
  fullName: string
  phone: string
  governorate: string
  city: string
  address: string
  notes?: string
}

export type GuestCheckoutFieldErrors = Partial<Record<keyof GuestCheckoutInput, string>>

export interface GovernorateOption {
  code: string
  nameAr: string
  nameEn: string
}

/** Standard Egyptian Governorates (27 Governorates) */
export const EGYPTIAN_GOVERNORATES: readonly GovernorateOption[] = [
  { code: "cairo", nameAr: "القاهرة", nameEn: "Cairo" },
  { code: "giza", nameAr: "الجيزة", nameEn: "Giza" },
  { code: "alexandria", nameAr: "الإسكندرية", nameEn: "Alexandria" },
  { code: "qalyubia", nameAr: "القليوبية", nameEn: "Qalyubia" },
  { code: "sharqia", nameAr: "الشرقية", nameEn: "Sharqia" },
  { code: "dakahlia", nameAr: "الدقهلية", nameEn: "Dakahlia" },
  { code: "gharbia", nameAr: "الغربية", nameEn: "Gharbia" },
  { code: "menofia", nameAr: "المنوفية", nameEn: "Menofia" },
  { code: "beheira", nameAr: "البحيرة", nameEn: "Beheira" },
  { code: "kafr_el_sheikh", nameAr: "كفر الشيخ", nameEn: "Kafr El Sheikh" },
  { code: "damietta", nameAr: "دمياط", nameEn: "Damietta" },
  { code: "port_said", nameAr: "بورسعيد", nameEn: "Port Said" },
  { code: "ismailia", nameAr: "الإسماعيلية", nameEn: "Ismailia" },
  { code: "suez", nameAr: "السويس", nameEn: "Suez" },
  { code: "north_sinai", nameAr: "شمال سيناء", nameEn: "North Sinai" },
  { code: "south_sinai", nameAr: "جنوب سيناء", nameEn: "South Sinai" },
  { code: "beni_suef", nameAr: "بني سويف", nameEn: "Beni Suef" },
  { code: "fayoum", nameAr: "الفيوم", nameEn: "Fayoum" },
  { code: "minya", nameAr: "المنيا", nameEn: "Minya" },
  { code: "asyut", nameAr: "أسيوط", nameEn: "Asyut" },
  { code: "sohag", nameAr: "سوهاج", nameEn: "Sohag" },
  { code: "qena", nameAr: "قنا", nameEn: "Qena" },
  { code: "luxor", nameAr: "الأقصر", nameEn: "Luxor" },
  { code: "aswan", nameAr: "أسوان", nameEn: "Aswan" },
  { code: "red_sea", nameAr: "البحر الأحمر", nameEn: "Red Sea" },
  { code: "new_valley", nameAr: "الوادي الجديد", nameEn: "New Valley" },
  { code: "matrouh", nameAr: "مطروح", nameEn: "Matrouh" },
] as const

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
 * Does not fabricate shipping coverage rules or promise unsupported delivery.
 */
export function validateGuestCheckout(
  data: Partial<GuestCheckoutInput>,
  dict: Dictionary
): CheckoutValidationResult {
  const errors: GuestCheckoutFieldErrors = {}

  const fullName = typeof data.fullName === "string" ? data.fullName.trim() : ""
  if (!fullName || fullName.length < 3) {
    errors.fullName = dict.checkout.nameRequired
  }

  const phone = typeof data.phone === "string" ? data.phone.trim() : ""
  if (!phone || !isValidEgyptianPhone(phone)) {
    errors.phone = dict.checkout.phoneRequired
  }

  const governorate = typeof data.governorate === "string" ? data.governorate.trim() : ""
  const isGovValid = EGYPTIAN_GOVERNORATES.some((g) => g.code === governorate)
  if (!governorate || !isGovValid) {
    errors.governorate = dict.checkout.governorateRequired
  }

  const city = typeof data.city === "string" ? data.city.trim() : ""
  if (!city || city.length < 2) {
    errors.city = dict.checkout.cityRequired
  }

  const address = typeof data.address === "string" ? data.address.trim() : ""
  if (!address || address.length < 5) {
    errors.address = dict.checkout.addressRequired
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * In-memory RAM cache for guest form fields during preview/language-switch navigation.
 * Never persisted to localStorage, cookies, or URL query strings.
 */
let inMemoryCheckoutState: GuestCheckoutInput = {
  fullName: "",
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
