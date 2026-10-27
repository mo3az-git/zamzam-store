# Storefront Purchase Journey Review

Review date: 2026-10-27

Scope: Arabic and English catalog through checkout preflight. This review does
not activate cart mutations, order creation, shipping charges, or payment.

## Integration matrix

| Journey step | Current behavior | Result | Evidence / boundary |
| --- | --- | --- | --- |
| Arabic and English catalog | Locale routes, translated labels, RTL/LTR layout, category and search navigation | Verified | `apps/storefront/lib/i18n.ts`; catalog route and navigation tests |
| Product detail and variants | Product/variant data comes from Medusa; selected variant is URL-validated; displayed amount must be explicit EGP calculated price | Verified with live-data limitation | `apps/storefront/lib/medusa.ts`; `catalog-prices.test.mjs`; no live Medusa response was available in this review |
| Cart creation and add | Server adapter resolves EGP region, sends variant and quantity only, and defaults disabled; no customer UI is wired to it | Safe but not integrated | `apps/storefront/lib/cart.ts`; `cart-adapter.test.mjs` |
| Cart quantity update and removal | No storefront adapter or UI actions exist | Missing | Current adapter only exports create, add-line-item, and retrieve operations |
| Batch availability | UI accepts authoritative statuses but no backend availability response is wired to product pages; status defaults to unknown | Safe but not integrated | `availability.ts`, `availability-display.tsx`, `variant-selector.tsx`, `availability.test.mjs` |
| Cart ownership and price authority | Browser cart IDs are not treated as ownership; BFF transport is unmounted; cart adapter sends no client price | Safe but blocked | `bff-client.ts`, `session.ts`, `cart.ts`; BFF foundation tests |
| Guest checkout and address | Bilingual form validates guest details, Egyptian phone, and exact governorate IDs; address submission only simulates QA mapping | UI verified; backend preflight missing | `checkout.ts`, `checkout-view.tsx`, `checkout-ui.test.mjs` |
| Governorates and shipping states | 27 localized options map to backend province codes; unknown geography is rejected; unconfigured/pending states show no fabricated price | Verified | `governorate-contract.test.mjs`, `checkout-ui.test.mjs`, `egypt-shipping-configuration.ts` |
| Shipping quote | Checkout passes no quote to the adapter; runtime coverage, rate, and provider are unconfigured | Blocked safely | `checkout-view.tsx`, `shipping.ts`, `phase4-8-egypt-shipping-foundation.md` |
| COD and electronic payment selection | No selection UI or payment-method capability contract is present; no gateway or order action is enabled | Missing and safely inactive | `checkout-view.tsx`; `checkout-ui.test.mjs` |
| Cart/checkout navigation and mobile | Locale-aware links and back-to-cart/catalog navigation exist; mobile overflow smoke coverage currently targets product detail only | Partially verified | `cart-view.tsx`, `checkout-view.tsx`, `storefront-smoke.spec.mjs` |

## Confirmed defects and focused fixes

1. **Payable total could appear ready from subtotal alone.** The non-QA checkout
   readiness state treated a nonzero cart subtotal as a payable total even while
   shipping was unquoted. The UI now keeps payable total pending until a trusted
   backend readiness response exists.
2. **Incomplete “ready” shipping quotes could display an amount.** The quote
   adapter accepted a missing currency and missing governorate binding. A ready
   quote now requires an explicit EGP currency, matching selected governorate,
   and finite non-negative amount. Focused regressions cover these cases.

No inventory, price, shipping fee, or payment state was fabricated. No real order
or payment was attempted. No TP state was changed.

## Backend contracts still needed

- Authorized server-side session issuance and ownership resolution, with an
  HttpOnly guest-session cookie and no browser-supplied cart ID as proof.
- Ownership-bound authoritative cart retrieval and line-item create, quantity
  update, and removal operations, preserving server-computed prices.
- Guest address preflight and a stable readiness response covering ownership,
  cart region/currency, address, shipping method, shipping quote, and payable
  total.
- Read-only variant-keyed batch-availability response for catalog presentation.
- Shipping quote/method contract bound to cart and selected governorate, with
  explicit EGP currency, authoritative amount, status, and stable blockers.
- Payment-method capability contract for COD and electronic methods, separately
  from any payment-session, order, or collection action. Storefront selection
  must remain display-only until separately authorized.

## Verification limits

The repository contains unit and browser-smoke coverage, but this review did not
have a live Medusa catalog or authorized BFF transport to verify current product
records, variant IDs, or live EGP amounts. “Authoritative” here describes the
data boundary enforced by the implementation and tests; it is not a claim that
production catalog values were fetched during this review.
