# Phase 2 MVP-first — Slice 02: Arabic-first Localization, Full Catalog & Storefront Integration

**State:** Implemented in draft branch `phase-2/arabic-storefront-mvp`; not merged, deployed, or formally accepted.  
**Immediate parent:** `phase-2/mvp-variant-selection-slice` (PR #21, commit `92e877a`).  
**Visual foundation:** Arabic Luxury storefront design (PR #5).  
**Policy reference:** MVP-first amendment (PR #20). **Backlog reference:** P2-01 to P2-06, P2-12 in PR #18.

## 1. Implemented Capabilities

### A. Localization & Routing
- **Arabic-First Default (RTL):** Root routes (`/`, `/products`, `/products/[handle]`) render with `lang="ar"` and `dir="rtl"`.
- **English Secondary (LTR):** Dedicated localized routes (`/en`, `/en/products`, `/en/products/[handle]`) render with `lang="en"` and `dir="ltr"`.
- **Bilingual Dictionary (`apps/storefront/lib/i18n.ts`):** Complete structured translation dictionaries for Arabic and English covering all navigation, hero copy, collection banners, catalog filters, variant selectors, ordering notices, footer copy, and error states.
- **Language Switcher (`apps/storefront/components/language-switcher.tsx`):** Accessible language toggle in the luxury header preserving equivalent paths across language transitions (e.g. `/products/zamzam-water` ↔ `/en/products/zamzam-water`).
- **Next.js Middleware (`apps/storefront/middleware.ts`):** Automatically injects `x-locale`, `x-dir`, and `x-pathname` into request headers for server-rendered HTML.
- **Client Synchronization (`apps/storefront/components/dir-sync.tsx`):** Ensures `document.documentElement.lang` and `dir` update immediately on client transitions.

### B. Product Catalog & Categories
- **Medusa Product Categories (`apps/storefront/lib/medusa.ts`):** `listStoreCategories()` fetches active categories from Medusa Store API with graceful fallback when unconfigured.
- **Category Filtering & Search (`apps/storefront/components/catalog-content.tsx`):** Category filter pills, keyword search input (`q`), active pill indicator, and "All Products" reset.
- **Bounded Pagination:** Bounded navigation (`page`, previous, next) preserving active search query and category filters.
- **Interactive Product Gallery (`apps/storefront/components/product-gallery.tsx`):** Image thumbnail picker with accessible keyboard controls, active image preview, and elegant fallback for unphotographed items.
- **Authoritative EGP Pricing & Variant Selection (`apps/storefront/components/variant-selector.tsx`):** Selected variant dynamically updates the displayed price and SKU; rejects sub-piastre, negative, non-finite, and foreign currency amounts.
- **Catalog-Only Notices:** Clear customer-facing notices explaining that product information is for display only and that purchasing begins upon inventory reservation and checkout activation.

### C. Backend Integration Contracts
- **Clean Contracts Boundary (`apps/storefront/lib/backend-contracts.ts`):** Stubs for future batch stock presentation (`BatchStockAvailabilityResponse`), cart sessions (`StoreCartSessionContract`), and checkout handoff (`CheckoutContractHandoff`).
- **Zero Infiltration:** Does not execute database mutations, payment captures, or lot-level reservation logic.

## 2. Verification Evidence

- **Unit tests:**
  `node --experimental-strip-types --test apps/storefront/tests/catalog-prices.test.mjs`
  Result: 8 passing tests (Arabic/English EGP price formatting, currency rejection, lowest-price selection, mixed currency rejection, dictionary locale/dir, language switcher path preservation, backend contract safety).
- **Storefront Lint:**
  `npm run lint --workspace @zamzam/storefront`
  Result: 0 errors, 0 warnings.
- **Storefront Production Build:**
  `npm run build:storefront`
  Result: Next.js 15.5.28 optimized production build succeeded. Generated all 6 dynamic routes (`/`, `/products`, `/products/[handle]`, `/en`, `/en/products`, `/en/products/[handle]`) and middleware.

## 3. Mandatory Safety Restrictions Preserved

1. **TP-01 remains explicitly unauthorized.** Not executed, renamed, simulated, or marked passed.
2. Canonical 59 TP test statuses and registry unchanged.
3. No production payments or real customer transactions enabled.
4. No direct database access from storefront.
5. Preserved PR #19, PR #23, and backend modules owned by other agents.
