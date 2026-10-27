import test from "node:test"
import assert from "node:assert/strict"
import { displayPrice, formatVariantPrice } from "../lib/medusa.ts"

const variant = (amount, currency = "egp", id = "variant_1") => ({
  id, title: "عبوة", sku: "SKU-001",
  calculated_price: { calculated_amount: amount, currency_code: currency },
})

test("displays EGP price for the selected Medusa variant", () => {
  assert.ok(formatVariantPrice(variant(61.7))?.includes("٦١") || formatVariantPrice(variant(61.7))?.includes("61"))
})

test("unpriced, negative, other-currency, and sub-piastre variants are not priced", () => {
  for (const item of [
    { id: "v" }, variant(-1), variant(2, "usd"), variant(1.001), variant(Number.NaN),
  ]) assert.equal(formatVariantPrice(item), null)
})

test("product-level price selects the lowest valid EGP variant", () => {
  const cheap = variant(35.5, "egp", "cheap")
  const expensive = variant(100, "egp", "expensive")
  assert.equal(displayPrice({ id: "prod", handle: "p", title: "P", variants: [expensive, cheap] }), formatVariantPrice(cheap))
})

test("mixed currencies cannot be silently displayed as one EGP price", () => {
  assert.equal(displayPrice({ id: "prod", handle: "p", title: "P", variants: [variant(10), variant(5, "usd")] }), null)
})
