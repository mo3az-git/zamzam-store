# Phase 2 — Catalog & Arabic Storefront: Implementation Backlog (Planning Only)

**Status:** PROPOSED / NOT AUTHORIZED FOR IMPLEMENTATION.  
**Scope:** Phase 2 catalog and storefront presentation only; a design/readiness artifact, not executable TP evidence.  
**Source of truth:** `docs/PROJECT_BRIEF.md` §§4.1, 5, 6, 13, 14; `docs/implementation-plan.md` §1 & §3/Acceptance Gate; `docs/architecture.md`; `docs/data-model.md`; `docs/risk-and-assumptions.md`.

> This backlog does not override the Phase 1 gate or authorize feature code. The canonical 59-row TP registry and every acceptance checkbox stay unchanged. TP-01 remains **explicitly unauthorized**; do not execute, assume, rename, or backfill it.

## 1. Entry gate and delivery contract

Phase 2 implementation must not begin until an explicitly authorized phase-transition decision is recorded and the required Phase 1 acceptance evidence has been independently reviewed. The existing `implementation-plan.md` still specifies all 59 TP rows; TP-01 remains prohibited and **cannot** be marked passed or worked around by a renamed test. Report this policy conflict to the owner as a release-gate blocker for a separate, explicit decision; no implicit waiver or scope change.

The storefront must consume Medusa APIs/approved server interfaces, never direct database access or privileged internal inventory modules. It must not mistake a successful prototype or CI build for deployed customer behavior.

**Release sequencing:** P2 catalog/UI → P3 batch integration → P4 guest checkout/payment → P5 admin/reporting → P6 hardening/release. During Phase 2, cart/checkout pages may be planned and have nonoperational shell designs, but no production checkout workflow may be exposed or claimed ready until its later-phase gates.

## 2. Ordered implementation backlog

| ID | Priority | Deliverable / implementation contract | Acceptance checks (when implementation is authorized) | Dependencies |
|---|---|---|---|---|
| P2-01 | P0 | Medusa product/category/variant read contract: active products, category/slug, images, EGP price, variant IDs/SKUs and pagination. Use supported Medusa Store APIs with explicit field allowlists. | Draft/archived records not publicly listed; no direct SQL in storefront; stable IDs, empty states, bad-slug 404; documented request/response examples. | Phase 1 acceptance, verified Medusa Store API, publishable key |
| P2-02 | P0 | Catalog content mapping for Arabic and English product fields: name, description, SEO title/description, package size, unit, origin/ingredients/storage only if independently verified. | Arabic is always available; unavailable English translations use a documented, truthful fallback; no fabricated sourcing/certification information. | Product content owner; content evidence gate |
| P2-03 | P0 | Arabic-first localization: default Arabic `/`, proposed English `/en`, translation dictionaries, locale-preserving language switch, `lang` and `dir` per locale. | RTL on Arabic and LTR on English; translated navigation, forms/errors/statuses; no strings hardcoded in components; URL switches preserve equivalent page when possible. | Routing decision and translation source |
| P2-04 | P0 | Mobile-first storefront layout: header/navigation, responsive grids, product cards, breadcrumbs, loading/empty/error states, footer. | Keyboard navigation, visible focus, semantically structured elements; RTL icons, menus, breadcrumbs/forms/dialogs; checked on narrow mobile screens and desktop. | UX/content spec, accessible component conventions |
| P2-05 | P0 | Listing/category pages with bounded pagination and server-rendered catalog where appropriate. Categories initially packaged Zamzam water and packaged dates, but no hardcoded category assumptions. | Active category/product only, correct localized slugs/content, pagination boundaries, no N+1 requests, no fake availability counters. | P2-01..04 |
| P2-06 | P0 | Product detail pages: verified primary/gallery imagery, appropriate alt text in both languages, variant selection, SKU/package size, authoritative EGP price, availability messaging. | Variant choice updates displayed fields correctly; inaccessible variant cannot be sold; inaccessible or missing image uses clearly marked internal placeholder, never a false product photo. | P2-01..05 and media permissions |
| P2-07 | P0 | Batch stock *presentation contract*, not final stock behavior: in-stock/out-of-stock availability from an authoritative backend endpoint, with cache/invalidation policy suitable for P3. | No absolute availability promise based on stale cache; no exposure of internal lot, unit cost, quarantine, supplier or exact sensitive stock numbers; real reservation remains P3/P4. | P3 owner for API/invalidation and FEFO |
| P2-08 | P1 | Approved media delivery: Cloudinary or S3-compatible source choice, structured image metadata, sizes/responsive loading and bilingual alt text. | Files have rights/consent records; optimized image variants; placeholders identified in nonproduction only; no invented authenticity badges. | Storage/provider choice; owner-supplied photos |
| P2-09 | P1 | SEO foundation: localized titles/descriptions, canonical/hreflang where warranted, sitemap, robots rules, semantic markup, accurate product structured data. | No inaccurate price/availability/ratings/claims in metadata or structured data; canonical and locale checks in build tests. | P2-02, P2-03, P2-05, P2-06 |
| P2-10 | P1 | Informational/legal-page shells: About, Contact, Shipping, Returns, Privacy, Terms. Maintain a publishing gate around legal/owner-approved text. | Draft policy placeholder is never misrepresented as approved legal advice or live promises; release requires appropriate owner/legal review. | Owner-approved contacts, customer policy and Gate 4 |
| P2-11 | P1 | Site quality checks: accessibility, mobile behavior, localization, performance, SEO smoke tests, image loading and missing-data safety. | Reproducible build plus RTL/LTR screenshots, keyboard and screen-reader checks, paginated behavior, usable fallbacks, no invented product claims. | P2-01..10 |
| P2-12 | P1 | Interfaces to later phases: cart CTA contract, guest checkout/order-status route placeholders, locale-preserving navigation and integration handoff. | No production cart/checkout marked working prematurely; backend authority and lock/lease logic untouched; request boundaries documented for P3/P4. | Phase 1 prototype contracts; P3/P4 planning |

P0/P1 are **planning priorities**, not a mandate to ship new features now. No estimated dates or false complete flags are assigned.

## 3. Data and UI contract

- **Product/variant:** stable product ID, localized name/description, URL slug, category, image reference/alt text, selling EGP price, status, package/net quantity, unit of measure, SKU per variant, availability, and metadata. Structured fields are preferred to a monolithic description.
- **Variant integrity:** different package sizes must retain distinct SKU, price (if relevant), inventory relationship and appropriate images. No implicit equivalence or substitution across packages.
- **Media:** actual licensed product images only on public pages. Supplier-provided origin, ingredients, composition and sourcing claims are displayed only when verified under Launch Gate 1.
- **Arabic UX:** default Arabic and `dir=rtl`; English secondary `dir=ltr`; logical CSS properties, appropriate mixed bidi treatment for SKU/EGP/numbers, coherent breadcrumbs/navigation; images have meaningful alt text; error/loading/empty states translated.
- **Pricing:** EGP major-unit monetary interpretation, authoritative Medusa prices, no monetary calculations from untrusted client input; Phase 2 display must not become an independent billing source.
- **Stock:** `batch_inventory` remains authoritative for managed batch/FEFO inventory. Avoid Medusa aggregate inventory replacing it; no presentation of lot-level or quarantined quantities.
- **Page boundaries:** Phase 2 owns browse/search-discovery shell/product detail/SEO/localization; full guest checkout/payment/fulfillment/returns are later phase responsibilities.

## 4. Acceptance plan (future execution, not present evidence)

| Check | Evidence required |
|---|---|
| Catalog API integrity | Published/archived product and variant fixtures; Store API contract snapshots; search/listing errors; pagination test logs |
| Localization | Arabic/English navigation screenshot pair, document `lang/dir` inspection, text-overflow/mobile viewport evidence, translation completeness report |
| Product media honesty | File rights provenance, bilingual alt-text audit, placeholder-publication control |
| Price/variant integrity | Variant price/SKU changes reflected accurately; EGP format major-unit test; no client-supplied stock or price override |
| Accessibility | Keyboard-only traversal, focus visibility, semantic headings/landmarks, accessible form validation |
| Performance & SEO | Server-side render/build evidence, image optimization, canonical/meta/hreflang/sitemap/robots checks and bounded query/list limits |
| Security and compliance | No privileged secrets/database access in browser bundle; origin/product claim proof; owner/legal sign-off for public policies |
| Phase transition | Full Phase 1 approved gate + explicit permission for P2 implementation; P2 evidence attached to exact commit SHA, not inferred from this document |

## 5. Explicit non-goals / owner decisions

- **Post-MVP:** Coupon codes and advanced promotion engines; values, types, counts, redemption limits and schedule remain undecided. This respects the owner's latest confirmation and §14 of the brief. The basic data model may retain paid-after-discount amounts without implementing coupons in Phase 2.
- **Not Phase 2:** Payment gateway work, COD settlement, inventory reservation/FEFO mechanics, fulfillment courier integration, returns/refunds engine, admin reporting, customer account registration, reviews/ratings, loyalty, multiple warehouse/multi-currency support.
- **Owner inputs needed before publication:** verified product imagery, product names and translations, brand/provenance evidence, actual package/SKU/price catalog, business contact and policy content, media host decision, English content fallback policy, approved legal pages.
- **Specification conflict requiring clarification:** Older PROJECT_BRIEF §14 says online payment gateways/webhooks are out of MVP, but its Revision 19 header and `implementation-plan.md` now explicitly include electronic payments plus COD for MVP. Follow the superseding Revision 19 payment decision; do not copy the obsolete exclusion into Phase 2 scope.
- **Not determined:** exact search/filter facets, category taxonomy beyond initial classes, full legal text, inventory-availability endpoint, image provider, acceptance benchmarks and timings. These must be decided, not invented.
