# Phase 2 MVP-first — Slice 02: bilingual catalog, collections and product detail

**State:** Implemented on a draft branch only; not merged, deployed or formally accepted.
**Base branch:** `phase-2/mvp-variant-selection-slice` (PR #21), which stacks on `phase-1/arabic-luxury-preview` (PR #5).
**Policy reference:** draft MVP-first amendment PR #20. **Plan reference:** draft PR #18 (P2-01/P2-02/P2-03, P2-05/P2-06, P2-08/P2-09/P2-11).
**Evidence rule:** every result below was produced in this environment; nothing is claimed for a live Medusa instance.

## Reused rather than rebuilt

- The Arabic Luxury visual system, header/footer chrome, typography tokens and responsive rules from PR #5.
- The product-card, variant-selector and Store API adapter introduced in PR #21.
- The Arabic editorial copy, preserved verbatim inside the new translation layer.
- The existing Node `--experimental-strip-types` test convention.

## Implemented

### 1. Authoritative EGP pricing (defect fixed, P2-01)

Medusa 2.22.1 only builds a pricing context from `region_id` (`setPricingContext` in
`@medusajs/medusa`): without it `variants.calculated_price` is resolved against an arbitrary
region, and a store with no region rejects the request outright. The adapter now:

- resolves the EGP region through `GET /store/regions?currency_code=egp` (cached 5 min), with
  `MEDUSA_REGION_ID` as an override;
- sends `region_id` and only then requests `+variants.calculated_price`;
- skips the price field entirely when no EGP region exists, so the catalog still loads and every
  product renders "price unavailable" instead of an error;
- continues to reject negative, non-finite, sub-piastre and non-EGP amounts.

### 2. Localization and language routing (P2-02/P2-03)

- Arabic remains the unprefixed default (`/`, `/products`); English lives under `/en`.
- `middleware.ts` rewrites unprefixed paths into the `[locale]` segment, redirects `/ar/...` to its
  canonical form, and forwards the original path/search so links and 404 copy stay locale-correct.
- `lib/i18n.ts` holds typed Arabic/English dictionaries; a test asserts both expose identical keys.
- `<html lang dir>` is correct per locale; English reuses the same layout with a Latin display face.
- The language switch preserves path and query string.
- **Translation fallback:** catalog text is shown exactly as stored in Medusa. No product name,
  description or claim is machine-translated or invented.

### 3. Real collections (P2-04)

- `GET /store/product-categories` drives the home collections section and catalog filters.
- Catalog filters by `category_id` while keeping `q` and page state in the URL.
- Unknown collection handles 404 rather than silently showing everything.
- Empty/unavailable categories render an explicit "not published yet" state.

### 4. Catalog and product detail (P2-05/P2-06/P2-08)

- Search (`q`, trimmed to 100 chars) plus count-derived pagination; filters survive paging.
- Variant selection keeps per-variant SKU and EGP price, with an explicit unavailable message.
- Images are filtered to `http(s)` or same-origin paths and deduplicated before rendering.
- Missing image, price or stock never produces a fabricated value; stock status is deliberately
  **not** shown because generic Medusa quantity is not batch/FEFO authority.
- Product JSON-LD emits `offers` only when a verified EGP amount exists; no `availability` claim.
- Metadata dedupe: `generateMetadata` and the page share one Store API call per request.

### 5. Responsive, accessibility, SEO (P2-09/P2-11)

- Mobile layout for collection tiles, filter chips, pagination and gallery; no horizontal overflow
  introduced (inherits the existing breakpoints).
- Skip link, labelled navigation/search/filters/gallery, `aria-current` on the active filter and
  page, `aria-live` price updates, visible focus rings, `bdi` isolation for SKUs.
- Canonical + `hreflang` (`ar`, `en`) alternates, per-locale titles/descriptions, Open Graph, and
  `metadataBase` from `NEXT_PUBLIC_SITE_URL`.

## Verification executed

| Check | Command | Result |
|---|---|---|
| Unit tests (pricing, query building, media safety, locale routing, dictionary parity) | `node --experimental-strip-types --test apps/storefront/tests/*.test.mjs` | 16 passed, 0 failed |
| Lint | `npm run lint --workspace @zamzam/storefront` | pass |
| Production build | `npm run build:storefront` | pass (routes `/[locale]`, `/[locale]/products`, `/[locale]/products/[handle]`, middleware) |
| Runtime, Arabic + English | `next start` against a local stub of the Store API contract | `/`, `/products`, `/products/[handle]`, `/en*` all 200; `/ar/products` → 308 `/products`; localized 404 |
| Pricing context | same | requests carry `region_id`; one Store call per product request |
| Degradation | stub returning no EGP region | catalog 200, prices "unavailable", no price fields requested |
| Safe rendering | stub products without price / with USD price / without image | unavailable price text, no invented media, no JSON-LD `offers` |

**Not executed:** any live or disposable Medusa instance, the canonical TP suite, **TP-01** (still
unauthorized), checkout, payment, inventory or concurrency paths. No TP entry was added, renamed,
ticked or removed.

## Deferred

- Verified live Store API sample capture (P2-01) against a real catalog and publishable key.
- Owner decisions on English product translations and licensed media.
- Batch/FEFO availability read contract and its presentation.
- Sitemap generation (needs a stable product set) and performance budget measurement.

## Shortest safe path to the existing inventory and checkout backend

1. **Availability read contract.** The storefront must not derive stock from Medusa's generic
   quantity. The backend already owns `batch-inventory`; it needs one store-facing read endpoint
   that reports purchasable quantity per variant. Until it exists, no stock claim is rendered.
2. **Cart creation with the same region.** Reuse `resolveEgpRegionId()` for `POST /store/carts`
   (`region_id`) so cart totals match the displayed EGP prices, then add line items by variant id.
3. **Mutations behind the existing guards.** The backend's cart middleware, checkout lock and
   reservation routes in `apps/backend/src/api/store/carts/**` are the authority; the storefront
   should call them through server actions/route handlers and never compute payable totals client-side.
4. **Then, and only then, the Add to Cart UI.** Replace the display-only notice with an action that
   surfaces inventory/lock rejections verbatim; keep payment disabled until separately authorized.

This ordering reuses the Phase 1 checkout work instead of duplicating pricing or cart logic in the
storefront, and keeps TP-01 and the payment gates untouched.

## Guardrails observed

- No branch merged; PR #5, #18, #20 and #21 untouched.
- No payments enabled, no production-readiness claim, no invented product data.
- Canonical TP registry unchanged; formal TP acceptance remains deferred to pre-release.
