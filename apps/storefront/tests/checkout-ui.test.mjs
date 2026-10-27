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
  isValidGovernorate,
  normalizeEgyptianPhone,
  isValidEgyptianPhone,
  isValidEmail,
  validateGuestCheckout,
  mapGuestCheckoutToBackend,
  resolveGovernorateProvince,
  getInMemoryCheckoutState,
  setInMemoryCheckoutState,
  SYNTHETIC_QA_READINESS_FIXTURE,
} from "../lib/checkout.ts"
import { adaptShippingQuoteToUi } from "../lib/shipping.ts"
import { isServerQaPreview } from "../lib/qa-preview.ts"
import { localeAlternates } from "../lib/site.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test("1. Required guest fields, email validation and safe Egyptian contract mapping", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)

    // 1.1 Empty fields validation fails with localized error messages
    const emptyResult = validateGuestCheckout({}, dict)
    assert.equal(emptyResult.isValid, false)
    assert.equal(emptyResult.errors.email, dict.checkout.emailRequired)
    assert.equal(emptyResult.errors.phone, dict.checkout.phoneRequired)
    assert.equal(emptyResult.errors.governorate, dict.checkout.governorateRequired)
    assert.equal(emptyResult.errors.city, dict.checkout.cityRequired)
    assert.equal(emptyResult.errors.address, dict.checkout.addressRequired)

    // 1.2 Email validation
    assert.equal(isValidEmail("guest@example.com"), true)
    assert.equal(isValidEmail("user.name+tag@domain.co.uk"), true)
    assert.equal(isValidEmail(""), false)
    assert.equal(isValidEmail("invalid-email"), false)
    assert.equal(isValidEmail("user@domain"), false)

    // 1.3 Phone validation: Egyptian formats (010, 011, 012, 015)
    assert.equal(isValidEgyptianPhone("01012345678"), true)
    assert.equal(isValidEgyptianPhone("01112345678"), true)
    assert.equal(isValidEgyptianPhone("01212345678"), true)
    assert.equal(isValidEgyptianPhone("01512345678"), true)
    assert.equal(isValidEgyptianPhone("+201012345678"), true)
    assert.equal(isValidEgyptianPhone("00201112345678"), true)
    assert.equal(isValidEgyptianPhone("010-1234-5678"), true)
    assert.equal(isValidEgyptianPhone("010 1234 5678"), true)

    assert.equal(isValidEgyptianPhone("01312345678"), false)
    assert.equal(isValidEgyptianPhone("0101234567"), false)
    assert.equal(isValidEgyptianPhone("010123456789"), false)
    assert.equal(isValidEgyptianPhone("0221234567"), false)

    // 1.4 Ambiguous full name handling: Ambiguous single-word name is rejected without guessing
    const ambiguousData = {
      fullName: "محمد",
      email: "mohamed@example.com",
      phone: "01012345678",
      governorate: "cairo",
      city: "Cairo",
      address: "123 Nile Street",
    }
    const ambiguousMapping = mapGuestCheckoutToBackend(ambiguousData, dict)
    assert.equal(ambiguousMapping.success, false)
    assert.ok(ambiguousMapping.errors.fullName)

    // 1.5 Unambiguous first/last name mapping to backend preflight contract
    const validData = {
      firstName: "محمد",
      lastName: "أحمد علي",
      email: "  Guest@Example.COM  ",
      phone: "+20 100 123 4567",
      governorate: "cairo",
      city: "القاهرة",
      address: "شارع النيل 14",
      notes: "يرجى ترك الشحنة لدى الاستقبال",
    }
    const mappingResult = mapGuestCheckoutToBackend(validData, dict)
    assert.equal(mappingResult.success, true)
    if (mappingResult.success) {
      const payload = mappingResult.payload
      assert.equal(payload.first_name, "محمد")
      assert.equal(payload.last_name, "أحمد علي")
      assert.equal(payload.email, "guest@example.com") // Lowercased
      assert.equal(payload.phone, "01001234567") // Normalized Egyptian phone
      assert.equal(payload.address_1, "شارع النيل 14")
      assert.equal(payload.city, "القاهرة")
      assert.equal(payload.province, "eg-c") // Native Medusa province_code, not display name
      assert.equal(payload.country_code, "eg") // Hardcoded Egypt country code

      // Delivery notes kept separate from Medusa address allowlist
      assert.equal("notes" in payload, false)
      assert.equal("delivery_notes" in payload, false)
      assert.equal(mappingResult.deliveryNotes, "يرجى ترك الشحنة لدى الاستقبال")
    }
  }
})

test("2. Priority 1: Strict QA fixture gate — URL parameters cannot activate synthetic cart", () => {
  const checkoutViewSrc = fs.readFileSync(
    path.resolve(__dirname, "../components/checkout-view.tsx"),
    "utf-8"
  )

  // Verify that activeCart only selects SYNTHETIC_CART_PREVIEW_FIXTURE when isQaMode is true
  assert.equal(
    /initialCart\s*\?\?\s*\(\s*isQaMode\s*\|\|\s*isSamplePreview/i.test(checkoutViewSrc),
    false,
    "CheckoutView must not allow isSamplePreview to bypass isQaMode"
  )
  assert.ok(
    /initialCart\s*\?\?\s*\(\s*isQaMode\s*\?\s*SYNTHETIC_CART_PREVIEW_FIXTURE\s*:\s*null\s*\)/i.test(
      checkoutViewSrc
    ),
    "CheckoutView must strictly gate SYNTHETIC_CART_PREVIEW_FIXTURE by isQaMode"
  )

  // Confirm that ?preview=sample or ?preview=checkout does not authorize fixtures in checkout-view
  assert.equal(
    /searchParams\s*\??\.\s*get\s*\(\s*["']preview["']\s*\)\s*===/i.test(checkoutViewSrc),
    false,
    "CheckoutView must not check URL preview parameters to activate cart fixtures"
  )
})

test("3. Priority 3: Read-only checkout readiness presentation and blocker localization", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)
    const blockers = dict.checkout.blockers

    // Check all required stable blocker codes exist and have non-empty strings
    const requiredBlockers = [
      "CHECKOUT_OWNERSHIP_UNAVAILABLE",
      "GUEST_DELIVERY_INVALID",
      "MISSING_SHIPPING_ADDRESS",
      "MISSING_SHIPPING_METHOD",
      "SHIPPING_PRICE_UNAVAILABLE",
      "PAYABLE_TOTAL_UNAVAILABLE",
      "CHECKOUT_IN_PROGRESS",
      "CHECKOUT_ALREADY_COMPLETED",
      "CART_UNAVAILABLE",
      "CART_REGION_UNAVAILABLE",
      "CART_REGION_NOT_EGYPT_EGP",
      "CART_CURRENCY_NOT_EGP",
      "CHECKOUT_SESSION_UNAVAILABLE",
    ]

    for (const code of requiredBlockers) {
      assert.ok(blockers[code], `Missing localized message for blocker: ${code}`)
      assert.ok(blockers[code].trim().length > 0, `Empty localized message for blocker: ${code}`)
    }

    // Readiness fixture verification
    assert.equal(SYNTHETIC_QA_READINESS_FIXTURE.status, "blocked")
    assert.ok(
      SYNTHETIC_QA_READINESS_FIXTURE.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"),
      "Readiness fixture must include CHECKOUT_OWNERSHIP_UNAVAILABLE"
    )
    assert.equal(SYNTHETIC_QA_READINESS_FIXTURE.readiness.shippingMethod, false)
    assert.equal(SYNTHETIC_QA_READINESS_FIXTURE.readiness.shippingPrice, false)
  }

  // Cart subtotal alone cannot make the payable total ready without a trusted
  // shipping quote and backend preflight response.
  const checkoutViewSrc = fs.readFileSync(
    path.resolve(__dirname, "../components/checkout-view.tsx"),
    "utf-8"
  )
  assert.match(checkoutViewSrc, /payableTotal:\s*false/)
  assert.doesNotMatch(checkoutViewSrc, /payableTotal:\s*Boolean\(activeCart\?\.subtotal\)/)
  assert.match(checkoutViewSrc, /value="cod" disabled/)
  assert.match(checkoutViewSrc, /value="electronic" disabled/)
  assert.match(checkoutViewSrc, /paymentUnavailable/)
})

test("4. Arabic/English routing, RTL/LTR metadata and RAM-only in-memory caching", () => {
  // Path routing
  assert.equal(localePath("ar", "/checkout"), "/checkout")
  assert.equal(localePath("en", "/checkout"), "/en/checkout")

  // Alternates
  const alternatesAr = localeAlternates("/checkout", "ar")
  assert.equal(alternatesAr.canonical, "/checkout")
  assert.equal(alternatesAr.languages.ar, "/checkout")
  assert.equal(alternatesAr.languages.en, "/en/checkout")

  // Language switch preservation
  assert.equal(buildLanguageSwitchHref("ar", "/checkout"), "/en/checkout")
  assert.equal(buildLanguageSwitchHref("en", "/en/checkout"), "/checkout")

  // In-memory state preservation without localStorage
  setInMemoryCheckoutState({
    firstName: "سارة",
    lastName: "محمود",
    email: "sara@example.com",
    phone: "01099887766",
    governorate: "alexandria",
    city: "Alexandria",
    address: "Corniche Road",
  })
  const cached = getInMemoryCheckoutState()
  assert.equal(cached.firstName, "سارة")
  assert.equal(cached.lastName, "محمود")
  assert.equal(cached.email, "sara@example.com")
  assert.equal(cached.phone, "01099887766")
  assert.equal(cached.governorate, "alexandria")
})

test("5. Absence of live payment or order actions and server-gated QA preview", () => {
  const checkoutViewPath = path.resolve(__dirname, "../components/checkout-view.tsx")
  const checkoutPagePath = path.resolve(__dirname, "../app/[locale]/checkout/page.tsx")
  const checkoutLibPath = path.resolve(__dirname, "../lib/checkout.ts")

  for (const filePath of [checkoutViewPath, checkoutPagePath, checkoutLibPath]) {
    const src = fs.readFileSync(filePath, "utf-8")
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")

    assert.equal(
      /stripe|paymob|fawry|paypal|paymentSession|orderWorkflow|createOrder/i.test(codeOnly),
      false,
      "Must not reference live payment gateways or order workflows"
    )
    assert.equal(
      /localStorage|sessionStorage/i.test(codeOnly),
      false,
      "Must not call localStorage or sessionStorage"
    )
  }

  // Server QA preview environment variable check
  const prevVercelEnv = process.env.VERCEL_ENV
  const prevSynthetic = process.env.ZAMZAM_SYNTHETIC_PREVIEW

  try {
    process.env.VERCEL_ENV = "production"
    delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
    assert.equal(isServerQaPreview(), false)

    process.env.VERCEL_ENV = "preview"
    process.env.ZAMZAM_SYNTHETIC_PREVIEW = "true"
    assert.equal(isServerQaPreview(), true)
  } finally {
    if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv
    else delete process.env.VERCEL_ENV
    if (prevSynthetic !== undefined) process.env.ZAMZAM_SYNTHETIC_PREVIEW = prevSynthetic
    else delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
  }
})

test("6. Phase 4.8 Task A: Governorate UX validation, 27 unique IDs, names, and language-switch preservation", () => {
  // 6.1 Exactly 27 governorates
  assert.equal(EGYPTIAN_GOVERNORATES.length, 27, "Must contain exactly 27 Egyptian governorates")

  // 6.2 Stable, unique identifiers
  const codes = EGYPTIAN_GOVERNORATES.map((g) => g.code)
  const uniqueCodes = new Set(codes)
  assert.equal(uniqueCodes.size, 27, "All 27 governorate codes must be unique")

  // 6.3 Valid Arabic and English names
  for (const gov of EGYPTIAN_GOVERNORATES) {
    assert.ok(gov.code && gov.code.trim().length > 0, "Governorate code must be non-empty")
    assert.ok(gov.nameAr && gov.nameAr.trim().length > 0, `Governorate ${gov.code} must have Arabic name`)
    assert.ok(gov.nameEn && gov.nameEn.trim().length > 0, `Governorate ${gov.code} must have English name`)
  }

  // 6.4 Valid and invalid governorate checks
  assert.equal(isValidGovernorate("cairo"), true)
  assert.equal(isValidGovernorate("alexandria"), true)
  assert.equal(isValidGovernorate("Aswan"), false) // Stable IDs are exact and case-sensitive
  assert.equal(isValidGovernorate("matrouh"), true)

  assert.equal(isValidGovernorate(""), false)
  assert.equal(isValidGovernorate("atlantis"), false)
  assert.equal(isValidGovernorate(null), false)
  assert.equal(isValidGovernorate(undefined), false)

  // 6.5 Province resolution: Does NOT silently map unknown governorates
  assert.equal(resolveGovernorateProvince("cairo"), "eg-c")
  assert.equal(resolveGovernorateProvince("alexandria"), "eg-alx")
  assert.equal(resolveGovernorateProvince("unknown_gov"), null)
  assert.equal(resolveGovernorateProvince(""), null)

  // 6.6 Language-switch preservation: State remains consistent in-memory
  setInMemoryCheckoutState({ governorate: "luxor" })
  const preserved = getInMemoryCheckoutState()
  assert.equal(preserved.governorate, "luxor")

  // Both Arabic and English views resolve the same stable identifier
  const govObj = EGYPTIAN_GOVERNORATES.find((g) => g.code === preserved.governorate)
  assert.ok(govObj)
  assert.equal(govObj.nameAr, "الأقصر")
  assert.equal(govObj.nameEn, "Luxor")
})

test("7. Phase 4.8 Task B, C & D: Delivery pricing UI boundary, presentation states, and QA safety", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)

    // 7.1 Missing / no governorate selected -> shipping_quote_pending
    const pendingNoGov = adaptShippingQuoteToUi(null, "", dict, locale)
    assert.equal(pendingNoGov.status, "shipping_quote_pending")
    assert.equal(pendingNoGov.formattedAmount, null, "Pending quote must not format an amount")
    assert.equal(pendingNoGov.isReady, false)
    assert.equal(pendingNoGov.isBlocked, true)
    assert.equal(pendingNoGov.statusLabel, dict.checkout.shippingStates.shipping_quote_pending)

    // 7.2 Selected governorate with unconfigured rate (no backend quote) -> shipping_rate_unconfigured
    const unconfiguredGov = adaptShippingQuoteToUi(null, "cairo", dict, locale)
    assert.equal(unconfiguredGov.status, "shipping_rate_unconfigured")
    assert.equal(unconfiguredGov.formattedAmount, null, "Unconfigured quote must NOT display EGP 0 or free")
    assert.notEqual(unconfiguredGov.statusLabel, "0 EGP")
    assert.notEqual(unconfiguredGov.statusLabel, "مجاني")
    assert.notEqual(unconfiguredGov.statusLabel, "Free")
    assert.equal(unconfiguredGov.isReady, false)
    assert.equal(unconfiguredGov.isBlocked, true)
    assert.equal(unconfiguredGov.statusLabel, dict.checkout.shippingStates.shipping_rate_unconfigured)

    // 7.3 Unknown backend status fails closed to shipping_quote_unavailable
    const unknownStatusQuote = adaptShippingQuoteToUi(
      { status: "unexpected_status", governorate: "cairo", currency: "EGP" },
      "cairo",
      dict,
      locale
    )
    assert.equal(unknownStatusQuote.status, "shipping_quote_unavailable")
    assert.equal(unknownStatusQuote.formattedAmount, null)
    assert.equal(unknownStatusQuote.isReady, false)
    assert.equal(unknownStatusQuote.isBlocked, true)

    // 7.4 Non-EGP currency fails closed to shipping_quote_unavailable
    const foreignCurrencyQuote = adaptShippingQuoteToUi(
      { status: "ready", amount: 50, currency: "USD", governorate: "cairo" },
      "cairo",
      dict,
      locale
    )
    assert.equal(foreignCurrencyQuote.status, "shipping_quote_unavailable")
    assert.equal(foreignCurrencyQuote.formattedAmount, null)
    assert.equal(foreignCurrencyQuote.blockerCode, "CART_CURRENCY_NOT_EGP")

    // 7.5 Conflicting governorate response fails closed
    const conflictingGovQuote = adaptShippingQuoteToUi(
      { status: "ready", amount: 50, currency: "EGP", governorate: "alexandria" },
      "cairo",
      dict,
      locale
    )
    assert.equal(conflictingGovQuote.status, "shipping_quote_unavailable")
    assert.equal(conflictingGovQuote.formattedAmount, null)
    assert.equal(conflictingGovQuote.isReady, false)

    // 7.6 Malformed amount (null, NaN, negative) fails closed
    const malformedAmountQuote = adaptShippingQuoteToUi(
      { status: "ready", amount: -10, currency: "EGP", governorate: "cairo" },
      "cairo",
      dict,
      locale
    )
    assert.equal(malformedAmountQuote.status, "shipping_quote_unavailable")
    assert.equal(malformedAmountQuote.formattedAmount, null)

    // 7.7 Trusted future native quote (valid EGP amount)
    const validQuote = adaptShippingQuoteToUi(
      { status: "ready", amount: 65, currency: "EGP", governorate: "giza" },
      "giza",
      dict,
      locale
    )
    assert.equal(validQuote.status, "shipping_ready")
    assert.ok(validQuote.formattedAmount !== null)
    assert.equal(validQuote.rawAmount, 65)
    assert.equal(validQuote.isReady, true)
    assert.equal(validQuote.isBlocked, false)
    assert.equal(validQuote.statusLabel, dict.checkout.shippingStates.shipping_ready)

    // A ready status without explicit quote currency or governorate binding is
    // not authoritative and must never surface an amount.
    for (const incompleteQuote of [
      { status: "ready", amount: 65, governorate: "giza" },
      { status: "ready", amount: 65, currency: "EGP" },
    ]) {
      const rejected = adaptShippingQuoteToUi(incompleteQuote, "giza", dict, locale)
      assert.equal(rejected.status, "shipping_quote_unavailable")
      assert.equal(rejected.formattedAmount, null)
      assert.equal(rejected.isReady, false)
    }

    // 7.8 Representation without client-side recalculation:
    // Total line does NOT add shipping client-side; order placement remains disabled
    const checkoutViewSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/checkout-view.tsx"),
      "utf-8"
    )
    assert.equal(
      /activeCart\?\.subtotal\s*\+\s*shipping/i.test(checkoutViewSrc),
      false,
      "CheckoutView must not add shipping to subtotal on the client"
    )
    assert.equal(
      /formatEgpAmount\s*\(\s*\(?\s*activeCart\?\.subtotal\s*\+\s*/i.test(checkoutViewSrc),
      false,
      "CheckoutView must not perform arithmetic on subtotal"
    )

    // 7.9 QA fixture safety: QA fixture does not have fake shipping rates
    assert.equal(SYNTHETIC_QA_READINESS_FIXTURE.readiness.shippingPrice, false)
    assert.ok(SYNTHETIC_QA_READINESS_FIXTURE.blockers.includes("SHIPPING_PRICE_UNAVAILABLE"))
  }
})

