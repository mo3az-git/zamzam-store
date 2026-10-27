import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dictionaries, locales } from "../lib/i18n.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

test("localized gallery status copy is present for Arabic and English", () => {
  for (const locale of locales) {
    assert.match(dictionaries[locale].product.imagePosition(2, 4), /2|٢/)
    assert.ok(dictionaries[locale].product.imagePosition(2, 4).trim())
  }
})

test("product gallery uses labelled button controls and announces the selected image", () => {
  const gallery = read("components", "product-gallery.tsx")
  assert.match(gallery, /role="group" aria-label=\{galleryLabel\}/)
  assert.match(gallery, /aria-pressed=\{isSelected\}/)
  assert.match(gallery, /aria-live="polite" aria-atomic="true"/)
  assert.doesNotMatch(gallery, /role="tab(list)?"|aria-selected=/)
})

test("product route supplies localized gallery labels and truthful missing-image copy", () => {
  const detail = read("app", "[locale]", "products", "[handle]", "page.tsx")
  assert.match(detail, /galleryLabel=\{dict\.product\.galleryLabel\}/)
  assert.match(detail, /imagePosition=\{dict\.product\.imagePosition\}/)
  assert.match(detail, /noImageText=\{dict\.product\.noImage\}/)
})

test("catalog results, empty states, search and errors retain screen-reader status semantics", () => {
  const catalog = read("app", "[locale]", "products", "page.tsx")
  assert.match(catalog, /role="search"/)
  assert.match(catalog, /role="status"/)
  assert.match(catalog, /aria-current="page"/)
})

test("locale metadata continues to provide canonical and hreflang alternates", () => {
  const site = read("lib", "site.ts")
  assert.match(site, /canonical: localePath\(locale, path\)/)
  assert.match(site, /languages:\s*\{\s*ar: localePath\("ar", path\),\s*en: localePath\("en", path\)/)
})


