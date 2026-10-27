# MVP Integration QA Environment

## Safe execution

- GitHub Actions provides an ephemeral PostgreSQL 16 and Redis 7 service for the scoped backend integrations, and a separate Chromium job runs against a local synthetic Medusa fixture. Neither job uses production data, live payments, live fulfillment, or public shipping rates.
- For local Medusa/PostgreSQL/Redis integration checks on Windows, run `./scripts/run-disposable-integration.ps1` from the repository. It creates a unique Compose project, uses tmpfs for PostgreSQL and Redis, pins the same service images as the main Compose file, requires healthy services before migrating, and tears down only its own project in `finally`.
- The local runner uses `zamzam_spike` and the existing explicit local disposable-service opt-in. It requires Docker Compose v2, Node 24.22.x, installed workspace dependencies, and free loopback ports 5432 and 6379. It does not create a shipping option or rate.
- Browser QA installs Playwright only in the GitHub runner and starts synthetic mock Medusa plus the Next preview on loopback. The preview gate is enabled only in that job; no order or payment request is simulated.

## Coverage matrix

| Area | Automated coverage in this candidate | Current boundary / blocker |
|---|---|---|
| Catalog discovery, filtering, EGP prices, locale, mobile and keyboard access | Existing synthetic Chromium catalog suite plus storefront unit tests | Synthetic read-only catalog, not live products or stock |
| Cart creation and guarded updates | Existing storefront adapter tests and backend cart guard/ownership integration checks | Storefront customer cart lifecycle is feature-gated; local adapter failures are recorded below |
| Batch availability | Unit projection/visibility checks and CI PostgreSQL FEFO + Medusa Query checks | Advisory projection only; no customer availability endpoint or reservation journey |
| Guest form and governorates | New Arabic invalid-form + English valid-form synthetic browser tests; existing 27-governorate contracts | Form validation is simulated; no authorized address write |
| Shipping readiness | Existing missing-rate/native readiness and 27-governorate Medusa geography checks | No provider, tariff, shipping option, or customer quote; synthetic rates are not activated |
| Server-authoritative totals and payment selection | Read-only EGP quote validation tests and UI blocker checks | No authorized checkout total refresh, COD/electronic selection, or order path |
| COD and electronic payment | Existing internal component/unit boundaries only | No end-to-end order, gateway, callbacks, reconciliation, or live payment behavior |
| FEFO reservation, concurrency, rollback and retry | Existing scoped component suites; selected real PostgreSQL FEFO and reservation integrations in CI | No full customer checkout/reservation conversion journey |
| Accessibility and localized errors | Existing localization/unit tests and new browser form assertions | Browser coverage is Chromium-only; human exploratory accessibility review remains separate |

This matrix describes tests and implementation boundaries. It does not accept or change any canonical TP status. TP-01 remains excluded and no canonical TP is accepted by this work.

## Exact local execution record

Recorded on 2026-10-27 in the shared Windows checkout, Node v24.22.1 / npm 11.19.1. Docker was unavailable, so disposable PostgreSQL/Redis integrations and Playwright browser execution were not run locally.

| Command group | Passed | Failed | Blocked | Skipped |
|---|---:|---:|---:|---:|
| Storefront unit suite (`node --experimental-strip-types --test apps/storefront/tests/*.test.mjs`) | 58 | 4 | 0 | 0 |
| Read-only payable quote | 6 | 0 | 0 | 0 |
| Governorate contract | 2 | 0 | 0 | 0 |
| Batch availability unit | 6 | 0 | 0 | 0 |
| Store visibility unit | 8 | 0 | 0 | 0 |
| Cart boundary, guest preflight, shipping-policy unit runners | 0 | 0 | 3 suites | 0 |
| Disposable PostgreSQL/Redis and Chromium suites | 0 | 0 | 2 suites | 0 |
| **Executed Node test cases** | **80** | **4** | **5 suites** | **0** |

The three script runners blocked before executing their assertions because the installed `@swc/core` Windows native binding is absent and the configured SWC cache locations are not writable. The two integration suites are blocked locally by missing Docker/Compose and the absence of an installed Playwright package/browser. These are environment blockers, not passing tests.

## Defect reproduction evidence

The full storefront run exited 1 with four failing cases in `apps/storefront/tests/cart-adapter.test.mjs`:

1. Successful EGP cart creation returned `success: false` instead of `true` (assertion at line 216).
2. Native Add Line Item request test returned `success: false` instead of `true` (line 354).
3. Locked-cart error mapped to `upstream_error` instead of `cart_locked` (line 436).
4. Ambiguous mutation test observed zero requests instead of one (line 498).

These failures reproduce with the checked-in Node command. Root cause is not established yet; the isolated passing results and environment-specific failures must not be used to dismiss them. The full suite reported 62 tests: 58 passed, 4 failed, 0 skipped.

## CI evidence and remaining blockers

On PR #31 head `f1e670f2c0403affac0d7d9854c88bb81f8f2a98`, both GitHub Actions workflows completed successfully:

- [Browser QA run 40573243305](https://github.com/mo3az-git/zamzam-store/actions/runs/40573243305): catalog Chromium **7/7 passed**; synthetic checkout Chromium **2/2 passed**; 0 failed, 0 skipped.
- [Consolidated MVP run 40573243338](https://github.com/mo3az-git/zamzam-store/actions/runs/40573243338): Node test cases **89/89 passed** (storefront 62, payment quote 6, governorate 2, availability 6, visibility 8, PostgreSQL FEFO 5); proposed API contract **5/5 passed**; named cart guard, shipping policy, guest ownership, native shipping readiness, and governorate integration assertions **73/73 passed**. Lint, migrations, builds, and the overall job succeeded; 0 failed, 0 skipped.

The two browser jobs use synthetic-only preview data. The disposable backend run created no order, payment, payment session, invoice, inventory reservation, or allocation. It persisted 27 Medusa service zones/GeoZones in the disposable database while keeping all 27 rates unconfigured and returning no shipping option. No gateway or fulfillment provider was selected. CI success does not mean canonical TP acceptance, owner acceptance, or production readiness.

Remaining product blockers include an authorized guest-cart/session bridge, public scoped batch availability, customer checkout/address/shipping writes, approved governorate tariffs and fulfillment provider, server-authoritative positive payable quote, COD operations, electronic provider and callback policy, duplicate/replay-safe callback path, order/reconciliation operator controls, and an end-to-end retry-safe inventory reservation path.
