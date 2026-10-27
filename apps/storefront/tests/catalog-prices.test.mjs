import test from "node:test"
import assert from "node:assert/strict"
import { displayPrice, formatVariantPrice } from "../lib/medusa.ts"
import { getDictionary, getEquivalentPath } from "../lib/i18n.ts"
import { queryVariantAvailability } from "../lib/backend-contracts.ts"

const variant = (amount, currency = "egp", id = "variant_1") => ({
  id, title: "عبوة", sku: "SKU-001",
  calculated_price: { calculated_amount: amount, currency_code: currency },
})

test("displays EGP price for the selected Medusa variant in Arabic (default)", () => {
  const formatted = formatVariantPrice(variant(61.7))
  assert.ok(formatted?.includes("٦١") || formatted?.includes("61"))
})

test("displays EGP price for the selected Medusa variant in English", () => {
  const formatted = formatVariantPrice(variant(61.7), "en")
  assert.ok(formatted?.includes("61.70"))
  assert.ok(formatted?.includes("EGP"))
})

test("unpriced, negative, other-currency, and sub-piastre variants are not priced", () => {
  for (const item of [
    { id: "v" }, variant(-1), variant(2, "usd"), variant(1.001), variant(Number.NaN),
  ]) {
    assert.equal(formatVariantPrice(item), null)
    assert.equal(formatVariantPrice(item, "en"), null)
  }
})

test("product-level price selects the lowest valid EGP variant", () => {
  const cheap = variant(35.5, "egp", "cheap")
  const expensive = variant(100, "egp", "expensive")
  assert.equal(
    displayPrice({ id: "prod", handle: "p", title: "P", variants: [expensive, cheap] }),
    formatVariantPrice(cheap)
  )
  assert.equal(
    displayPrice({ id: "prod", handle: "p", title: "P", variants: [expensive, cheap] }, "en"),
    formatVariantPrice(cheap, "en")
  )
})

test("mixed currencies cannot be silently displayed as one EGP price", () => {
  assert.equal(
    displayPrice({ id: "prod", handle: "p", title: "P", variants: [variant(10), variant(5, "usd")] }),
    null
  )
})

test("dictionary returns correct locale and direction", () => {
  const arDict = getDictionary("ar")
  const enDict = getDictionary("en")
  assert.equal(arDict.locale, "ar")
  assert.equal(arDict.dir, "rtl")
  assert.equal(enDict.locale, "en")
  assert.equal(enDict.dir, "ltr")
})

test("language switcher preserves equivalent path between Arabic and English", () => {
  assert.equal(getEquivalentPath("/", "en"), "/en")
  assert.equal(getEquivalentPath("/products", "en"), "/en/products")
  assert.equal(getEquivalentPath("/products/zamzam-water", "en"), "/en/products/zamzam-water")
  assert.equal(getEquivalentPath("/products?q=dates", "en"), "/en/products?q=dates")

  assert.equal(getEquivalentPath("/en", "ar"), "/")
  assert.equal(getEquivalentPath("/en/products", "ar"), "/products")
  assert.equal(getEquivalentPath("/en/products/zamzam-water", "ar"), "/products/zamzam-water")
  assert.equal(getEquivalentPath("/en/products?q=dates", "ar"), "/products?q=dates")
})

test("backend stock availability contract returns read-only catalog status without database mutation", async () => {
  const availability = await queryVariantAvailability("var_123")
  assert.equal(availability.variant_id, "var_123")
  assert.equal(availability.status, "unavailable")
  assert.ok(availability.localized_message?.ar)
  assert.ok(availability.localized_message?.en)
})
