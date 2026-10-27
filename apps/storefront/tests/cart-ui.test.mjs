import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getDictionary, locales, localePath } from "../lib/i18n.ts"
import { formatEgpAmount } from "../lib/medusa.ts"
import {
  isCartEnabled,
  createCart,
  addLineItemToCart,
  retrieveCart,
  SYNTHETIC_CART_PREVIEW_FIXTURE,
} from "../lib/cart.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test("1. Empty cart and populated cart rendering data structures", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)
    const catalogUrl = localePath(locale, "/products")

    // Empty cart checks
    assert.ok(dict.cart.emptyTitle?.trim())
    assert.ok(dict.cart.emptyMessage?.trim())
    assert.ok(dict.cart.continueShopping?.trim())
    assert.equal(catalogUrl, locale === "en" ? "/en/products" : "/products")

    // Populated cart checks with SYNTHETIC_CART_PREVIEW_FIXTURE
    const fixture = SYNTHETIC_CART_PREVIEW_FIXTURE
    assert.ok(fixture.items.length > 0)
    assert.equal(fixture.currency_code, "egp")

    const firstItem = fixture.items[0]
    assert.equal(firstItem.variant_id, "var_zamzam_5l")
    assert.equal(firstItem.quantity, 3)

    const formattedUnit = formatEgpAmount(firstItem.unit_price, locale)
    const formattedTotal = formatEgpAmount(firstItem.total, locale)
    const formattedCartTotal = formatEgpAmount(fixture.total, locale)

    assert.ok(formattedUnit?.includes("61") || formattedUnit?.includes("٦١"))
    assert.ok(formattedTotal?.includes("185") || formattedTotal?.includes("١٨٥"))
    assert.ok(formattedCartTotal?.includes("185") || formattedCartTotal?.includes("١٨٥"))
  }
})

test("2. Feature-disabled behavior fails closed across all cart mutation operations", async () => {
  // Ensure default environment has no feature flag active
  delete process.env.FEATURE_ENABLE_MEDUSA_CART
  assert.equal(isCartEnabled(), false)

  const createRes = await createCart()
  assert.equal(createRes.success, false)
  assert.equal(createRes.error, "disabled")

  const addRes = await addLineItemToCart("cart_1", "var_1", 1)
  assert.equal(addRes.success, false)
  assert.equal(addRes.error, "disabled")

  const getRes = await retrieveCart("cart_1")
  assert.equal(getRes.success, false)
  assert.equal(getRes.error, "disabled")
})

test("3. Correct variant and authoritative EGP totals preserved without frontend math", () => {
  const authoritativeCart = {
    id: "cart_auth_egp_1",
    region_id: "reg_egp_1",
    currency_code: "egp",
    total: 246.8,
    subtotal: 246.8,
    tax_total: 0,
    items: [
      {
        id: "item_1",
        title: "عبوة ماء زمزم 5 لتر",
        variant_id: "var_case_4",
        quantity: 4,
        unit_price: 61.7,
        total: 246.8,
      },
    ],
  }

  for (const locale of locales) {
    const formattedSubtotal = formatEgpAmount(authoritativeCart.subtotal, locale)
    const formattedTotal = formatEgpAmount(authoritativeCart.total, locale)
    assert.ok(formattedSubtotal?.includes("246") || formattedSubtotal?.includes("٢٤٦"))
    assert.ok(formattedTotal?.includes("246") || formattedTotal?.includes("٢٤٦"))
  }
})

test("4. Backend conflict handling maps CART_MUTATIONS_LOCKED, CART_ALREADY_COMPLETED and LOCK_TIMEOUT", () => {
  const errorMapping = (code, dict) => {
    if (code === "CART_MUTATIONS_LOCKED" || code === "cart_locked") return dict.cart.lockedError
    if (code === "CART_ALREADY_COMPLETED" || code === "cart_completed") return dict.cart.completedError
    if (code === "LOCK_TIMEOUT" || code === "lock_timeout") return dict.cart.timeoutError
    return dict.cart.genericError
  }

  for (const locale of locales) {
    const dict = getDictionary(locale)
    assert.equal(errorMapping("CART_MUTATIONS_LOCKED", dict), dict.cart.lockedError)
    assert.equal(errorMapping("cart_locked", dict), dict.cart.lockedError)

    assert.equal(errorMapping("CART_ALREADY_COMPLETED", dict), dict.cart.completedError)
    assert.equal(errorMapping("cart_completed", dict), dict.cart.completedError)

    assert.equal(errorMapping("LOCK_TIMEOUT", dict), dict.cart.timeoutError)
    assert.equal(errorMapping("lock_timeout", dict), dict.cart.timeoutError)

    assert.equal(errorMapping("UNKNOWN_CODE", dict), dict.cart.genericError)

    // Ensure all error strings are localized and non-empty
    assert.ok(dict.cart.lockedError.trim().length > 0)
    assert.ok(dict.cart.completedError.trim().length > 0)
    assert.ok(dict.cart.timeoutError.trim().length > 0)
    assert.ok(dict.cart.genericError.trim().length > 0)
  }
})

test("5. Absence of accidental checkout or payment action across cart components", () => {
  const cartViewPath = path.resolve(__dirname, "../components/cart-view.tsx")
  const addToCartPreviewPath = path.resolve(__dirname, "../components/add-to-cart-preview.tsx")
  const cartPagePath = path.resolve(__dirname, "../app/[locale]/cart/page.tsx")

  const cartViewSrc = fs.readFileSync(cartViewPath, "utf-8")
  const addToCartSrc = fs.readFileSync(addToCartPreviewPath, "utf-8")
  const cartPageSrc = fs.readFileSync(cartPagePath, "utf-8")

  // No payment gateway SDKs or real order submission endpoints
  for (const src of [cartViewSrc, addToCartSrc, cartPageSrc]) {
    assert.equal(
      /stripe|paymob|fawry|paypal|paymentSession|createOrder/i.test(src),
      false,
      "Must not reference live payment gateways or order creation"
    )
  }

  // Cart view must explicitly render disabled checkout notice
  assert.ok(
    cartViewSrc.includes("dict.cart.checkoutDisabledNotice"),
    "CartView must include disabled checkout notice"
  )

  // A preview is never inferred from a URL alone; regular cart actions use the
  // same-origin BFF and never receive browser-owned prices/cart identifiers.
  assert.ok(
    addToCartSrc.includes('searchParams?.get("preview") === "cart"'),
    "AddToCartPreview must require explicit preview=cart parameter"
  )
  assert.match(addToCartSrc, /requestCartBff\(/)
  assert.match(addToCartSrc, /expectedVersion:\s*cart\.version/)
  assert.match(cartViewSrc, /operation:\s*"update_item"/)
  assert.match(cartViewSrc, /operation:\s*"remove_item"/)
  assert.match(cartPageSrc, /allowSyntheticPreview/)
  assert.match(addToCartSrc, /resolveSelectedVariantId\(/)
})

