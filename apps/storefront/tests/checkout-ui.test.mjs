import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  getDictionary,
  locales,
  localePath,
  buildLanguageSwitchHref,
} from "../lib/i18n.ts"
import { formatEgpAmount } from "../lib/medusa.ts"
import { SYNTHETIC_CART_PREVIEW_FIXTURE } from "../lib/cart-types.ts"
import {
  EGYPTIAN_GOVERNORATES,
  normalizeEgyptianPhone,
  isValidEgyptianPhone,
  validateGuestCheckout,
  getInMemoryCheckoutState,
  setInMemoryCheckoutState,
} from "../lib/checkout.ts"
import { isServerQaPreview } from "../lib/qa-preview.ts"
import { localeAlternates } from "../lib/site.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test("1. Required guest fields and safe Egyptian validation", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)

    // 1.1 Empty fields validation fails with localized error messages
    const emptyResult = validateGuestCheckout({}, dict)
    assert.equal(emptyResult.isValid, false)
    assert.equal(emptyResult.errors.fullName, dict.checkout.nameRequired)
    assert.equal(emptyResult.errors.phone, dict.checkout.phoneRequired)
    assert.equal(emptyResult.errors.governorate, dict.checkout.governorateRequired)
    assert.equal(emptyResult.errors.city, dict.checkout.cityRequired)
    assert.equal(emptyResult.errors.address, dict.checkout.addressRequired)

    // 1.2 Phone validation: Egyptian formats (010, 011, 012, 015)
    assert.equal(isValidEgyptianPhone("01012345678"), true)
    assert.equal(isValidEgyptianPhone("01112345678"), true)
    assert.equal(isValidEgyptianPhone("01212345678"), true)
    assert.equal(isValidEgyptianPhone("01512345678"), true)
    assert.equal(isValidEgyptianPhone("+201012345678"), true)
    assert.equal(isValidEgyptianPhone("00201112345678"), true)
    assert.equal(isValidEgyptianPhone("010-1234-5678"), true)
    assert.equal(isValidEgyptianPhone("010 1234 5678"), true)

    // Rejection of invalid phone formats
    assert.equal(isValidEgyptianPhone("01312345678"), false) // Invalid operator prefix
    assert.equal(isValidEgyptianPhone("0101234567"), false) // 10 digits (too short)
    assert.equal(isValidEgyptianPhone("010123456789"), false) // 12 digits (too long)
    assert.equal(isValidEgyptianPhone("0221234567"), false) // Landline
    assert.equal(isValidEgyptianPhone("abcdefghijk"), false)

    // 1.3 Governorate validation against official Egyptian list
    assert.ok(EGYPTIAN_GOVERNORATES.length >= 27)
    assert.ok(EGYPTIAN_GOVERNORATES.some((g) => g.code === "cairo"))
    assert.ok(EGYPTIAN_GOVERNORATES.some((g) => g.code === "giza"))
    assert.ok(EGYPTIAN_GOVERNORATES.some((g) => g.code === "alexandria"))

    // 1.4 Valid submission passes with optional notes
    const validData = {
      fullName: "محمد أحمد علي",
      phone: "01098765432",
      governorate: "cairo",
      city: "مدينة نصر",
      address: "شارع مصطفى النحاس، عمارة 14، الدور الرابع",
      notes: "يرجى الاتصال قبل الوصول",
    }
    const validResult = validateGuestCheckout(validData, dict)
    assert.equal(validResult.isValid, true)
    assert.deepEqual(validResult.errors, {})
  }
})

test("2. Arabic/English routing and RTL/LTR metadata and navigation", () => {
  // Path routing
  assert.equal(localePath("ar", "/checkout"), "/checkout")
  assert.equal(localePath("en", "/checkout"), "/en/checkout")

  // Alternates
  const alternatesAr = localeAlternates("/checkout", "ar")
  assert.equal(alternatesAr.canonical, "/checkout")
  assert.equal(alternatesAr.languages.ar, "/checkout")
  assert.equal(alternatesAr.languages.en, "/en/checkout")

  const alternatesEn = localeAlternates("/checkout", "en")
  assert.equal(alternatesEn.canonical, "/en/checkout")
  assert.equal(alternatesEn.languages.ar, "/checkout")
  assert.equal(alternatesEn.languages.en, "/en/checkout")

  // Language switch preservation
  assert.equal(buildLanguageSwitchHref("ar", "/checkout"), "/en/checkout")
  assert.equal(buildLanguageSwitchHref("en", "/en/checkout"), "/checkout")

  // RAM-only in-memory state preservation across simulated client navigation
  setInMemoryCheckoutState({
    fullName: "Ahmad Test",
    phone: "01122334455",
    governorate: "giza",
    city: "Dokki",
    address: "Tahrir St.",
  })
  const cached = getInMemoryCheckoutState()
  assert.equal(cached.fullName, "Ahmad Test")
  assert.equal(cached.phone, "01122334455")
  assert.equal(cached.governorate, "giza")
  assert.equal(cached.city, "Dokki")
  assert.equal(cached.address, "Tahrir St.")
})

test("3. Display of authoritative cart amounts and missing shipping quotes", () => {
  const fixture = SYNTHETIC_CART_PREVIEW_FIXTURE
  assert.ok(fixture.subtotal)

  for (const locale of locales) {
    const dict = getDictionary(locale)
    const formattedSubtotal = formatEgpAmount(fixture.subtotal, locale)

    // Subtotal must be formatted accurately via Medusa helper
    assert.ok(formattedSubtotal?.includes("185") || formattedSubtotal?.includes("١٨٥"))

    // Shipping fee must explicitly indicate pending/store confirmation
    assert.ok(dict.checkout.shippingPending.trim().length > 0)
    assert.ok(dict.checkout.shippingNotice.trim().length > 0)
    assert.ok(dict.checkout.payableTotalNotice.trim().length > 0)

    // Authoritative notice must declare that browser does not compute amounts
    assert.ok(dict.cart.authoritativeNotice.trim().length > 0)
  }
})

test("4. No real order or payment action and no persistent storage of customer address", () => {
  const checkoutViewPath = path.resolve(__dirname, "../components/checkout-view.tsx")
  const checkoutPagePath = path.resolve(__dirname, "../app/[locale]/checkout/page.tsx")
  const checkoutLibPath = path.resolve(__dirname, "../lib/checkout.ts")

  const checkoutViewSrc = fs.readFileSync(checkoutViewPath, "utf-8")
  const checkoutPageSrc = fs.readFileSync(checkoutPagePath, "utf-8")
  const checkoutLibSrc = fs.readFileSync(checkoutLibPath, "utf-8")

  for (const [name, src] of [
    ["CheckoutView", checkoutViewSrc],
    ["CheckoutPage", checkoutPageSrc],
    ["CheckoutLib", checkoutLibSrc],
  ]) {
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")

    // 4.1 No payment gateway SDKs or live order submission endpoints
    assert.equal(
      /stripe|paymob|fawry|paypal|paymentSession|orderWorkflow|createOrder/i.test(codeOnly),
      false,
      `${name} must not reference live payment gateways or order workflows`
    )

    // 4.2 No storing customer addresses in localStorage or query strings
    assert.equal(
      /localStorage|sessionStorage/i.test(codeOnly),
      false,
      `${name} must not call localStorage or sessionStorage`
    )
  }

  // 4.3 Form actions must disable checkout when isQaMode is false
  assert.ok(
    checkoutViewSrc.includes("dict.checkout.disabledNotice"),
    "CheckoutView must render disabled notice in non-QA mode"
  )
  assert.ok(
    checkoutViewSrc.includes("dict.checkout.disabledSubmitButton"),
    "CheckoutView must render disabled button in non-QA mode"
  )
})

test("5. Production/customer mode cannot activate simulated checkout through a URL parameter", () => {
  const prevVercelEnv = process.env.VERCEL_ENV
  const prevSynthetic = process.env.ZAMZAM_SYNTHETIC_PREVIEW

  try {
    // 5.1 Default / production environment: isServerQaPreview must be false
    process.env.VERCEL_ENV = "production"
    delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
    assert.equal(isServerQaPreview(), false)

    // Even if ZAMZAM_SYNTHETIC_PREVIEW is set, if VERCEL_ENV is production, it fails
    process.env.ZAMZAM_SYNTHETIC_PREVIEW = "true"
    assert.equal(isServerQaPreview(), false)

    // If VERCEL_ENV is preview but ZAMZAM_SYNTHETIC_PREVIEW is not 'true', it fails
    process.env.VERCEL_ENV = "preview"
    process.env.ZAMZAM_SYNTHETIC_PREVIEW = "false"
    assert.equal(isServerQaPreview(), false)

    delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
    assert.equal(isServerQaPreview(), false)

    // 5.2 Only when BOTH VERCEL_ENV=preview AND ZAMZAM_SYNTHETIC_PREVIEW=true does QA mode activate
    process.env.VERCEL_ENV = "preview"
    process.env.ZAMZAM_SYNTHETIC_PREVIEW = "true"
    assert.equal(isServerQaPreview(), true)

    // 5.3 CheckoutView component props check: isQaMode is derived from server environment, not client URL
    const checkoutPageSrc = fs.readFileSync(
      path.resolve(__dirname, "../app/[locale]/checkout/page.tsx"),
      "utf-8"
    )
    assert.ok(
      checkoutPageSrc.includes("isServerQaPreview()"),
      "CheckoutPage must gate isQaMode using isServerQaPreview()"
    )
    assert.equal(
      /searchParams\s*\??\.\s*get\s*\(\s*["']preview["']\s*\)\s*===/i.test(checkoutPageSrc),
      false,
      "CheckoutPage must not use URL searchParams to authorize QA mode"
    )
  } finally {
    if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv
    else delete process.env.VERCEL_ENV
    if (prevSynthetic !== undefined) process.env.ZAMZAM_SYNTHETIC_PREVIEW = prevSynthetic
    else delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
  }
})
