import test from "node:test"
import assert from "node:assert/strict"
import {
  alternateLocale,
  dictionaries,
  formatNumber,
  getDictionary,
  isLocale,
  localeFromPathname,
  localePath,
  locales,
  stripLocale,
} from "../lib/i18n.ts"

const leafPaths = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? leafPaths(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )

test("Arabic is unprefixed and English is prefixed", () => {
  assert.equal(localePath("ar", "/"), "/")
  assert.equal(localePath("ar", "/products"), "/products")
  assert.equal(localePath("en", "/"), "/en")
  assert.equal(localePath("en", "/products"), "/en/products")
  assert.equal(localePath("en", "products"), "/en/products")
})

test("locale prefixes round-trip and alternate", () => {
  assert.equal(stripLocale("/en/products"), "/products")
  assert.equal(stripLocale("/en"), "/")
  assert.equal(stripLocale("/ar"), "/")
  assert.equal(stripLocale("/ar/products/tea"), "/products/tea")
  assert.equal(stripLocale("/products"), "/products")
  assert.equal(alternateLocale("ar"), "en")
  assert.equal(alternateLocale("en"), "ar")
  assert.equal(localeFromPathname("/en/products"), "en")
  assert.equal(localeFromPathname("/products"), "ar")
})

test("unsupported locales are rejected rather than silently defaulted", () => {
  assert.equal(isLocale("ar"), true)
  assert.equal(isLocale("en"), true)
  assert.equal(isLocale("fr"), false)
  assert.equal(isLocale(undefined), false)
})

test("both dictionaries define exactly the same UI keys", () => {
  assert.deepEqual([...locales], ["ar", "en"])
  assert.deepEqual(leafPaths(dictionaries.ar).sort(), leafPaths(dictionaries.en).sort())
})

test("every translated string is non-empty", () => {
  for (const locale of locales) {
    const walk = (value, path) => {
      for (const [key, child] of Object.entries(value)) {
        const label = `${path}${key}`
        if (typeof child === "string") assert.ok(child.trim().length > 0, `${locale}.${label}`)
        else if (typeof child === "object" && child !== null) walk(child, `${label}.`)
      }
    }
    walk(getDictionary(locale), "")
  }
})

test("numbers follow the reader's numeral system", () => {
  assert.equal(formatNumber(12, "en"), "12")
  assert.notEqual(formatNumber(12, "ar"), "12")
})
