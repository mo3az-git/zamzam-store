import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCategoryQuery,
  buildProductQuery,
  displayPrice,
  formatVariantPrice,
  productImageUrls,
  productPriceAmount,
} from "../lib/medusa.ts"

const variant = (amount, currency = "egp", id = "variant_1") => ({
  id,
  title: "عبوة",
  sku: "SKU-001",
  calculated_price: { calculated_amount: amount, currency_code: currency },
})

test("calculated price is only requested with an explicit pricing region", () => {
  const withoutRegion = buildProductQuery({ limit: 12 })
  assert.equal(withoutRegion.get("region_id"), null)
  assert.equal(withoutRegion.get("fields").includes("calculated_price"), false)

  const withRegion = buildProductQuery({ limit: 12, regionId: "reg_egp" })
  assert.equal(withRegion.get("region_id"), "reg_egp")
  assert.equal(withRegion.get("fields").includes("+variants.calculated_price"), true)
})

test("product queries clamp paging, trim search and pass the category filter", () => {
  const params = buildProductQuery({
    limit: 500,
    offset: -4,
    q: `  ${"ا".repeat(120)}  `,
    handle: "zamzam-water-5l",
    categoryId: "cat_water",
    regionId: "reg_egp",
  })
  assert.equal(params.get("limit"), "100")
  assert.equal(params.get("offset"), "0")
  assert.equal(params.get("q").length, 100)
  assert.equal(params.get("handle"), "zamzam-water-5l")
  assert.equal(params.get("category_id"), "cat_water")
})

test("category queries request the store fields and optional handle", () => {
  const params = buildCategoryQuery({ handle: "dates", limit: 1000 })
  assert.equal(params.get("limit"), "100")
  assert.equal(params.get("handle"), "dates")
  assert.match(params.get("fields"), /parent_category_id/)
  assert.equal(params.get("parent_category_id"), null)
})

test("a product price is only published for whole EGP amounts", () => {
  assert.equal(productPriceAmount({ id: "p", handle: "p", title: "P", variants: [variant(61.7)] }), 61.7)
  assert.equal(productPriceAmount({ id: "p", handle: "p", title: "P", variants: [] }), null)
  assert.equal(
    productPriceAmount({ id: "p", handle: "p", title: "P", variants: [variant(10, "usd")] }),
    null
  )
  assert.equal(
    productPriceAmount({ id: "p", handle: "p", title: "P", variants: [variant(1.001)] }),
    null
  )
})

test("prices are formatted per locale and never borrowed from another currency", () => {
  const arabic = formatVariantPrice(variant(61.7), "ar")
  const english = formatVariantPrice(variant(61.7), "en")
  assert.ok(arabic)
  assert.ok(english)
  assert.notEqual(arabic, english)
  assert.match(english, /61\.70/)
  assert.equal(formatVariantPrice(variant(61.7, "usd"), "en"), null)
  assert.equal(displayPrice({ id: "p", handle: "p", title: "P", variants: [variant(5)] }, "en"), english.replace("61.70", "5.00"))
})

test("gallery urls are unique, ordered and safe to render", () => {
  const urls = productImageUrls({
    id: "p",
    handle: "p",
    title: "P",
    thumbnail: "https://cdn.example.test/main.jpg",
    images: [
      { id: "1", url: "https://cdn.example.test/main.jpg" },
      { id: "2", url: "/local/second.jpg" },
      { id: "3", url: "javascript:alert(1)" },
      { id: "4", url: "data:image/png;base64,AAAA" },
    ],
  })
  assert.deepEqual(urls, ["https://cdn.example.test/main.jpg", "/local/second.jpg"])
  assert.deepEqual(productImageUrls({ id: "p", handle: "p", title: "P" }), [])
})
