import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  AVAILABILITY_STATUSES,
  isValidAvailabilityStatus,
  normalizeAvailabilityStatus,
} from "../lib/availability.ts"
import { getDictionary, locales } from "../lib/i18n.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test("supports exactly the three authoritative availability statuses", () => {
  assert.deepEqual([...AVAILABILITY_STATUSES], ["available", "unavailable", "unknown"])
  assert.equal(isValidAvailabilityStatus("available"), true)
  assert.equal(isValidAvailabilityStatus("unavailable"), true)
  assert.equal(isValidAvailabilityStatus("unknown"), true)
  assert.equal(isValidAvailabilityStatus("in_stock"), false)
  assert.equal(isValidAvailabilityStatus("out_of_stock"), false)
  assert.equal(isValidAvailabilityStatus(""), false)
  assert.equal(isValidAvailabilityStatus(null), false)
  assert.equal(isValidAvailabilityStatus(undefined), false)
})

test("normalizes valid statuses with trimming and case-insensitivity", () => {
  assert.equal(normalizeAvailabilityStatus("available"), "available")
  assert.equal(normalizeAvailabilityStatus("AVAILABLE"), "available")
  assert.equal(normalizeAvailabilityStatus("  available  "), "available")
  assert.equal(normalizeAvailabilityStatus("unavailable"), "unavailable")
  assert.equal(normalizeAvailabilityStatus("UNAVAILABLE"), "unavailable")
  assert.equal(normalizeAvailabilityStatus("unknown"), "unknown")
  assert.equal(normalizeAvailabilityStatus("UNKNOWN"), "unknown")
})

test("missing, null, or invalid status strictly fails safe to unknown", () => {
  assert.equal(normalizeAvailabilityStatus(null), "unknown")
  assert.equal(normalizeAvailabilityStatus(undefined), "unknown")
  assert.equal(normalizeAvailabilityStatus(""), "unknown")
  assert.equal(normalizeAvailabilityStatus("   "), "unknown")
  assert.equal(normalizeAvailabilityStatus("in_stock"), "unknown")
  assert.equal(normalizeAvailabilityStatus("out_of_stock"), "unknown")
  assert.equal(normalizeAvailabilityStatus(123), "unknown")
  assert.equal(normalizeAvailabilityStatus(false), "unknown")
  assert.equal(normalizeAvailabilityStatus({}), "unknown")
  assert.equal(normalizeAvailabilityStatus(["available"]), "unknown")
})

test("Arabic and English dictionaries provide non-empty labels and descriptions for all statuses", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)
    assert.ok(dict.availability.heading?.trim())
    assert.ok(dict.availability.disclaimer?.trim())

    for (const status of AVAILABILITY_STATUSES) {
      const entry = dict.availability[status]
      assert.ok(entry, `Missing entry for status ${status} in ${locale}`)
      assert.ok(entry.label?.trim(), `Missing label for status ${status} in ${locale}`)
      assert.ok(entry.description?.trim(), `Missing description for status ${status} in ${locale}`)
    }
  }
})

test("translations avoid misleading claims of guaranteed stock or quantities", () => {
  for (const locale of locales) {
    const dict = getDictionary(locale)
    const disclaimer = dict.availability.disclaimer.toLowerCase()
    // Should clearly mention that verification occurs via store records / no advance guarantees
    assert.ok(
      disclaimer.includes("store") || disclaimer.includes("المتجر"),
      `Disclaimer in ${locale} should reference store system verification`
    )
    for (const status of AVAILABILITY_STATUSES) {
      const label = dict.availability[status].label
      const desc = dict.availability[status].description
      // No specific numbers or countdowns
      assert.equal(/\d+/.test(label), false, `Label for ${status} in ${locale} must not contain numbers`)
      assert.equal(/\d+/.test(desc), false, `Description for ${status} in ${locale} must not contain numbers`)
    }
  }
})

test("AvailabilityDisplay component enforces accessible status role and ARIA live region", () => {
  const compPath = path.resolve(__dirname, "../components/availability-display.tsx")
  const source = fs.readFileSync(compPath, "utf-8")

  assert.ok(source.includes('role="status"'), "Must define role='status'")
  assert.ok(source.includes('aria-live="polite"'), "Must define aria-live='polite'")
  assert.ok(source.includes('aria-atomic="true"'), "Must define aria-atomic='true'")
  assert.ok(source.includes("normalizeAvailabilityStatus"), "Must normalize status via lib/availability")
  assert.ok(source.includes("lux-availability"), "Must follow Arabic luxury design class hierarchy")
})

test("AvailabilityDisplay and VariantSelector contain no purchase or checkout triggers", () => {
  const displaySrc = fs.readFileSync(
    path.resolve(__dirname, "../components/availability-display.tsx"),
    "utf-8"
  )
  const selectorSrc = fs.readFileSync(
    path.resolve(__dirname, "../components/variant-selector.tsx"),
    "utf-8"
  )

  // AvailabilityDisplay must be strictly read-only presentation
  assert.equal(/<button\b/i.test(displaySrc), false, "AvailabilityDisplay must not render buttons")
  assert.equal(/<form\b/i.test(displaySrc), false, "AvailabilityDisplay must not render forms")
  assert.equal(/<input\b/i.test(displaySrc), false, "AvailabilityDisplay must not render inputs")

  // VariantSelector must render AvailabilityDisplay safely without checkout or cart buttons
  assert.ok(selectorSrc.includes("<AvailabilityDisplay"), "VariantSelector must mount AvailabilityDisplay")
  assert.equal(/<button\b/i.test(selectorSrc), false, "VariantSelector must not render buttons")
  assert.equal(/<form\b/i.test(selectorSrc), false, "VariantSelector must not render forms")
  assert.equal(/addToCart|createCart|initiatePayment/i.test(selectorSrc), false, "VariantSelector must not invoke cart mutations")
})
