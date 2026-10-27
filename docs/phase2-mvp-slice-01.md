# Phase 2 MVP-first — Slice 01: variant pricing and selection

**State:** Implemented in draft branch only; not merged, deployed, or formally accepted.
**Starting point:** `phase-1/arabic-luxury-preview` (PR #5), retaining the chosen Arabic Luxury identity.
**Policy reference:** Draft MVP-first amendment PR #20. **Plan reference:** P2-01/P2-06 in draft PR #18.

## Changes
- Request variant SKU alongside Medusa calculated price; do not fabricate SKUs, images, stock, or selling prices.
- Select an individual product variant on the Arabic product detail page, then show that exact variant's authoritative calculated EGP price and SKU, or a clear unavailable message.
- Refuse non-EGP, negative, non-finite and sub-piastre display prices. Never derive payable totals in the browser.
- Preserve read-only product discovery; **no Add to Cart, checkout, batch stock claim or payment workflow**.

## Verification instructions
- `node --experimental-strip-types --test apps/storefront/tests/catalog-prices.test.mjs` (Node 24 target; local/runtime execution must be reported separately).
- `npm run lint --workspace @zamzam/storefront` and `npm run build:storefront` with installed dependencies.
- Manually inspect multi-variant selection, SKU, EGP display, absent price, mobile layout, RTL and keyboard selection against a disposable Medusa dataset.

## Deferred
- P2-01 verified live Store API field contract and sample responses; P2-02 localized metadata/translation;
  P2-03 English routing; category taxonomy; approved assets; P2-07 batch-aware availability.
- Formal TP suite (59 rows) remains deferred; **TP-01 remains unauthorized**, and no TP checkbox is changed.
- Do not merge this PR, PR #5, PR #18, or PR #20 without owner authorization.
