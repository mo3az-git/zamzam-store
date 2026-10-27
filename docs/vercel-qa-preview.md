# Vercel read-only QA Preview — handoff to Argon

Goal: give the independent browser QA agent an **accessible, nonproduction Preview** for the integrated Next.js storefront. This is **not** a production release, does not enable carts, payments, stock claims, or any formal TP acceptance.

## Exact app to deploy

- Git repository: \`mo3az-git/zamzam-store\`.
- Framework: Next.js (v15).
- Monorepo Vercel project **Root Directory**: \`apps/storefront\`.
- Branch: \`integration/mvp-consolidated-20261027\` from PR #26, **Preview environment only** (not Production).
- Required Preview-only environment variable: \`ZAMZAM_SYNTHETIC_PREVIEW=true\`.
- Require Vercel system \`VERCEL_ENV=preview\` (set by Vercel, never manually forged in Production).
- Keep \`FEATURE_ENABLE_MEDUSA_CART\` unset or \`false\`; do not set backend URLs or any real Medusa key. Do not supply real customer/payment/admin secrets.
- Enable Vercel Deployment Protection / project access restrictions appropriate for the Argon test browser, rather than publicly launching the website.
- Confirm the **exact deployment commit SHA and Preview URL**, and grant Argon browser access to that origin.

## How it works

Only when \`VERCEL_ENV=preview\` **and** \`ZAMZAM_SYNTHETIC_PREVIEW=true\` are both true, read-only catalog queries use \`apps/storefront/lib/synthetic-preview.ts\` directly. This avoids requiring a running Medusa backend outside GitHub Actions. The preview has 14 synthetic QA products, two categories, two variants on the first product, EGP sample prices and a two-image gallery. Other products show image placeholders. A permanent warning banner distinguishes this synthetic test catalog from commercial product content; metadata robots are \`noindex,nofollow\`.

The cart adapter refuses mutations in this mode even if the cart feature flag is accidentally set. No Store API HTTP endpoint for QA fixtures is exposed. With either QA flag missing, the normal storefront behaves exactly as before and requires a real Medusa backend.

## What this DOES NOT verify

No actual publishable-key/sales-channel visibility, real Medusa Store API availability, FEFO balances, fulfillment, orders, payment integration or production checkout. Those retain separate backend and release gates. Never mark TP-01 or any formal TP case complete.

## Quick independent browser acceptance

Argon should load \`/\`, \`/en\`, \`/products\`, \`/en/products\`, \`/en/products/qa-fixture-1\` and the Arabic equivalent; confirm SPA locale-switch after filtering, selected-variant preservation across locale changes, EGP sample prices and the absence of purchase UI, plus 390px mobile usability. Report only confirmed P0/P1 issues and the exact deployed commit.

**Operational blocker:** A Vercel deployment must be created by an authorized connected Vercel project/tool or by the owner via its dashboard. The presence of this file and a successful GitHub CI is not evidence that the preview was actually deployed.
