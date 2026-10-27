# Zamzam Storefront Accessibility and SEO Audit

**Date:** 2026-10-27  
**Scope:** Read-only catalog and presentation across Arabic (`/`, RTL) and English (`/en`, LTR). No backend inventory, payment, shipping, cart, or checkout behavior was changed. No TP record or status was changed.

## Summary

The storefront declares the document language and direction per route, preserves the current path and query parameters when switching language, and uses localized route alternates for canonical and `hreflang` metadata. Catalog prices and media are sourced from Medusa; missing prices are labelled unavailable and absent images get an explicit placeholder. Product JSON-LD omits `Offer` while purchasing is disabled, avoiding unsupported price or availability claims.

One isolated accessibility defect was corrected: product thumbnails used tab roles without implementing the tab keyboard interaction model or a corresponding tab panel. They are now ordinary pressed-state buttons in a named group, with a localized polite announcement of the selected image. A focused regression test and browser smoke assertion cover this behavior.

## Audit findings

| Area | Finding | Status / follow-up |
| --- | --- | --- |
| Arabic RTL / English LTR | Locale layout sets `lang` and `dir`; English typography and mobile layouts have locale-specific rules. | Source verified. Runtime visual comparison remains deployment-dependent. |
| Language switching | Client-side switch follows `usePathname` and `useSearchParams`; helper tests cover product, category, search, page, and variant query preservation. | Source and unit tests verified. Browser QA includes a client-side route regression. |
| Search, filtering, pagination | Search has a visible label and search landmark; category filters expose `aria-current`; pagination preserves query/category and resets page on filter changes. Result/error/empty summaries use status semantics. | Source verified; live catalog behavior depends on a configured Medusa store. |
| Keyboard and assistive technology | Skip link, native links/forms/buttons, focus-visible styles, status regions and SKU bidi isolation are present. Thumbnail controls had invalid/incomplete tab semantics; breadcrumb landmarks reused the “Main navigation” name. | Gallery semantics and distinct localized breadcrumb names fixed; regression coverage added. Manual screen-reader testing remains recommended. |
| WCAG 2.2 AA | The source supports language/direction, keyboard use, visible focus, labels, landmarks, and text status announcements. Mobile filter controls are at least 34px high. | Static source review only; this is not a WCAG conformance certification. Contrast of every rendered color/state, zoom/reflow, target spacing, focus obstruction, and third-party browser/AT combinations need runtime testing. |
| Canonical / hreflang / metadata | Locale-independent paths receive a locale-specific canonical and both `ar` and `en` alternates. Catalog and product pages provide titles/descriptions; product Open Graph images are included only when present. | Runtime preview initially emitted `http://localhost:8000` canonical URLs. Origin resolution now prefers configured site URL, then Vercel's production domain, then deployment URL. Verify the production domain in deployment settings. |
| Robots / sitemap | Synthetic preview metadata is `noindex,nofollow`. The inspected Vercel preview also returned `x-robots-tag: noindex`. No sitemap or robots route is present in the storefront app. | Preview response was noindexed. Decide whether to publish a production sitemap and explicit robots policy before SEO launch. |
| Structured product data | Product JSON-LD uses sourced name, description, SKU and image only; no `Offer` is emitted while purchase is disabled. | Source verified; keep product claims and media approval aligned with catalog data. |
| Truthful prices and images | Missing/invalid/non-EGP prices resolve to localized “unavailable” text. Product cards use an aria-hidden placeholder when no thumbnail exists; detail pages render localized missing-image copy. | Source verified. No placeholder is represented as a product photograph. |
| Rendering performance / responsive layout | Responsive breakpoints exist down to 380px and the first product image is prioritized. Catalog images use `unoptimized`, so Next's image resizing/format optimization is bypassed. | Performance limitation; enabling optimization safely needs an approved remote-image host policy and representative media profiling. Do not add broad remote image hosts without approval. |

## Reproducible defect fixed

On a product detail page with multiple images, the thumbnail wrapper advertised a `tablist`, and thumbnail buttons advertised `tab`/`aria-selected`, but there was no `tabpanel`, roving tab stop, or arrow-key movement. Keyboard users therefore received a tab widget that did not follow the expected tab interaction pattern. The gallery now exposes a labelled button group, uses `aria-pressed`, and announces the selected image position in the active language.

## Bilingual product content and media approval

The UI dictionary is bilingual, but product title, subtitle, description, category names, and variant labels are rendered from the single Medusa catalog value in both locales. This avoids silently presenting machine translation as approved copy, but English pages may still contain Arabic catalog content and paired `hreflang` URLs may not represent genuinely localized product pages. Before advertising bilingual product pages, request owner-approved English and Arabic titles, descriptions, category names, variant labels, and SEO snippets, or explicitly mark a locale's content as unavailable and decide its indexing policy.

Product photography must be approved for commercial storefront use and each meaningful image should receive a concise, human-authored description in both locales. Decorative image placeholders are hidden from assistive technology; real product image `alt` currently falls back to the product title, which is not a substitute for approved image-specific text where the image conveys additional information.

## Verification limits

This audit changes only product gallery presentation, its localized copy, focused storefront tests, and this report. No live store credentials, production URL, approved translations, approved media, screen reader, color-contrast analyzer, or deployed responsive preview were available for this source review. No inventory/payment/shipping/checkout logic, formal test register, or canonical status was modified; TP-01 was not run and no branch was merged.

