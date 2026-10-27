import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dictionaries, locales } from "../lib/i18n.ts"
import { siteUrl } from "../lib/site.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8")

test("localized gallery status copy is present for Arabic and English", () => {
  for (const locale of locales) {
    assert.match(dictionaries[locale].product.imagePosition(2, 4), /2|٢/)
    assert.ok(dictionaries[locale].product.imagePosition(2, 4).trim())
  }
})

test("breadcrumb landmarks have distinct localized names", () => {
  assert.equal(dictionaries.ar.catalog.breadcrumbLabel, "مسار التنقل")
  assert.equal(dictionaries.en.catalog.breadcrumbLabel, "Breadcrumb")
  for (const route of [
    read("app", "[locale]", "products", "page.tsx"),
    read("app", "[locale]", "products", "[handle]", "page.tsx"),
  ]) assert.match(route, /aria-label=\{dict\.catalog\.breadcrumbLabel\}/)
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

test("canonical origin uses the Vercel production domain when the site URL is unset", () => {
  const original = {
    site: process.env.NEXT_PUBLIC_SITE_URL,
    production: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    deployment: process.env.VERCEL_URL,
  }
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "shop.example.com"
    delete process.env.VERCEL_URL
    assert.equal(siteUrl().origin, "https://shop.example.com")
  } finally {
    if (original.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = original.site
    if (original.production === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = original.production
    if (original.deployment === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = original.deployment
  }
})


