import test from "node:test"
import assert from "node:assert/strict"
import { buildLanguageSwitchHref } from "../lib/i18n.ts"
import {
  buildProductStructuredData,
  formatVariantPrice,
  resolveSelectedVariantId,
} from "../lib/medusa.ts"

test("1. Client-side navigation followed by language switching (DEF-02)", () => {
  // Unprefixed Arabic default -> prefixed English (/en)
  assert.equal(buildLanguageSwitchHref("ar", "/"), "/en")
  assert.equal(buildLanguageSwitchHref("ar", "/products"), "/en/products")
  assert.equal(
    buildLanguageSwitchHref("ar", "/products/zamzam-water-5l"),
    "/en/products/zamzam-water-5l"
  )

  // Prefixed English (/en) -> unprefixed Arabic
  assert.equal(buildLanguageSwitchHref("en", "/en"), "/")
  assert.equal(buildLanguageSwitchHref("en", "/en/products"), "/products")
  assert.equal(
    buildLanguageSwitchHref("en", "/en/products/zamzam-water-5l"),
    "/products/zamzam-water-5l"
  )

  // Prevents duplicate prefixes or redirect loops
  assert.equal(buildLanguageSwitchHref("ar", "/en/products"), "/en/products")
  assert.equal(buildLanguageSwitchHref("en", "/ar/products"), "/products")
  assert.equal(
    buildLanguageSwitchHref("ar", buildLanguageSwitchHref("en", "/en/products")),
    "/en/products"
  )
})

test("2. Search, filter, and pagination preservation across language switch (DEF-02)", () => {
  // Query string preserves q, category, page
  const arabicCatalogUrl = "/products"
  const search = "?category=cat_water&q=zamzam&page=2"
  const switchedToEn = buildLanguageSwitchHref("ar", arabicCatalogUrl, search)
  assert.equal(switchedToEn, "/en/products?category=cat_water&q=zamzam&page=2")

  // Switching back to Arabic retains exact parameters
  const switchedBackToAr = buildLanguageSwitchHref("en", "/en/products", search)
  assert.equal(switchedBackToAr, "/products?category=cat_water&q=zamzam&page=2")

  // Works with URLSearchParams instance
  const params = new URLSearchParams()
  params.set("category", "dates")
  params.set("page", "3")
  const withParamsObj = buildLanguageSwitchHref("ar", "/products", params)
  assert.equal(withParamsObj, "/en/products?category=dates&page=3")

  // Empty or missing query parameter handling
  assert.equal(buildLanguageSwitchHref("ar", "/products", ""), "/en/products")
  assert.equal(buildLanguageSwitchHref("ar", "/products", null), "/en/products")
  assert.equal(buildLanguageSwitchHref("ar", "/products", undefined), "/en/products")
})

test("3. Variant selection followed by locale switching (DEF-02 & DEF-04)", () => {
  const productPath = "/products/zamzam-water-5l"
  const variantQuery = "?variant=var_5l_case"

  // Switching to English keeps selected variant parameter
  const enUrl = buildLanguageSwitchHref("ar", productPath, variantQuery)
  assert.equal(enUrl, "/en/products/zamzam-water-5l?variant=var_5l_case")

  // Switching from English back to Arabic keeps selected variant
  const arUrl = buildLanguageSwitchHref("en", "/en/products/zamzam-water-5l", variantQuery)
  assert.equal(arUrl, "/products/zamzam-water-5l?variant=var_5l_case")

  // Preserves variant alongside other parameters (e.g. tracking or referrer)
  const complexQuery = "?ref=social&variant=var_5l_case&page=1"
  assert.equal(
    buildLanguageSwitchHref("ar", productPath, complexQuery),
    "/en/products/zamzam-water-5l?ref=social&variant=var_5l_case&page=1"
  )
})

test("4. Invalid variant URL input fallback (DEF-04)", () => {
  const variants = [
    { id: "var_single", title: "Single Bottle", sku: "SKU-01" },
    { id: "var_pack_6", title: "6-Pack Case", sku: "SKU-06" },
  ]

  // Valid variant returns exact ID
  assert.equal(resolveSelectedVariantId(variants, "var_pack_6"), "var_pack_6")
  assert.equal(resolveSelectedVariantId(variants, "var_single"), "var_single")
  assert.equal(resolveSelectedVariantId(variants, "  var_pack_6  "), "var_pack_6")

  // Nonexistent variant ID falls back to primary variant
  assert.equal(resolveSelectedVariantId(variants, "var_fake_999"), "var_single")
  assert.equal(resolveSelectedVariantId(variants, "nonexistent"), "var_single")

  // Empty, null, undefined, or malformed values fall back to primary variant
  assert.equal(resolveSelectedVariantId(variants, ""), "var_single")
  assert.equal(resolveSelectedVariantId(variants, "   "), "var_single")
  assert.equal(resolveSelectedVariantId(variants, null), "var_single")
  assert.equal(resolveSelectedVariantId(variants, undefined), "var_single")
  assert.equal(resolveSelectedVariantId(variants, 123), "var_single")
  assert.equal(resolveSelectedVariantId(variants, {}), "var_single")

  // Empty variant array falls back safely without throwing
  assert.equal(resolveSelectedVariantId([], "var_1"), "")
  assert.equal(resolveSelectedVariantId(null, "var_1"), "")
})

test("5. Price, SKU, and availability consistency with URL-selected variant (DEF-04)", () => {
  const v1 = {
    id: "var_1",
    title: "عبوة فردية",
    sku: "SKU-BOTTLE-01",
    calculated_price: { calculated_amount: 25, currency_code: "egp" },
  }
  const v2 = {
    id: "var_2",
    title: "كرتونة 6 عبوات",
    sku: "SKU-CASE-06",
    calculated_price: { calculated_amount: 140, currency_code: "egp" },
  }
  const variants = [v1, v2]
  const mockAvailability = {
    var_1: "available",
    var_2: "unavailable",
  }

  // Case A: URL specifies var_2
  const selectedIdA = resolveSelectedVariantId(variants, "var_2")
  const variantA = variants.find((v) => v.id === selectedIdA)
  assert.equal(selectedIdA, "var_2")
  assert.equal(variantA.sku, "SKU-CASE-06")
  assert.ok(formatVariantPrice(variantA, "en")?.includes("140.00"))
  assert.equal(mockAvailability[selectedIdA], "unavailable")

  // Case B: URL specifies invalid variant -> falls back to v1
  const selectedIdB = resolveSelectedVariantId(variants, "injected_variant")
  const variantB = variants.find((v) => v.id === selectedIdB)
  assert.equal(selectedIdB, "var_1")
  assert.equal(variantB.sku, "SKU-BOTTLE-01")
  assert.ok(formatVariantPrice(variantB, "en")?.includes("25.00"))
  assert.equal(mockAvailability[selectedIdB], "available")
})

test("6. Absence of misleading JSON-LD Offer when purchasing is disabled (DEF-06)", () => {
  const product = {
    id: "prod_zamzam_5l",
    handle: "zamzam-water-5l",
    title: "ماء زمزم 5 لتر",
    description: "ماء زمزم مبارك نقي من مكة المكرمة",
    thumbnail: "https://cdn.example.test/zamzam-5l.jpg",
    variants: [
      {
        id: "var_1",
        title: "عبوة 5 لتر",
        sku: "ZAM-5L",
        calculated_price: { calculated_amount: 61.7, currency_code: "egp" },
      },
    ],
  }

  // 1. In storefront mode: purchasing is disabled
  const schemaDisabled = buildProductStructuredData(product, {
    siteUrl: "https://zamzamstore.test",
    isPurchasingEnabled: false,
  })

  assert.equal(schemaDisabled["@context"], "https://schema.org")
  assert.equal(schemaDisabled["@type"], "Product")
  assert.equal(schemaDisabled.name, "ماء زمزم 5 لتر")
  assert.equal(schemaDisabled.description, "ماء زمزم مبارك نقي من مكة المكرمة")
  assert.deepEqual(schemaDisabled.image, ["https://cdn.example.test/zamzam-5l.jpg"])
  assert.equal(schemaDisabled.sku, "ZAM-5L")

  // DEF-06 Guardrail: MUST NOT contain an Offer
  assert.equal("offers" in schemaDisabled, false, "Must not emit 'offers' while purchasing is disabled")

  // 2. Controlled check: when purchasing is explicitly enabled, Offer is emitted
  const schemaEnabled = buildProductStructuredData(product, {
    siteUrl: "https://zamzamstore.test",
    isPurchasingEnabled: true,
  })
  assert.equal("offers" in schemaEnabled, true)
  assert.equal(schemaEnabled.offers?.["@type"], "Offer")
  assert.equal(schemaEnabled.offers?.price, "61.70")
  assert.equal(schemaEnabled.offers?.priceCurrency, "EGP")
})
