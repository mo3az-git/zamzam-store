# Independent QA Handoff — 2026-10-27

## Reviewed changes

- [QA PR #31](https://github.com/mo3az-git/zamzam-store/pull/31), head `47f75ab8df51be64b48082bdfc1c96441b22543e`, Draft/open.
- [Operational readiness PR #30](https://github.com/mo3az-git/zamzam-store/pull/30), head `9fc07be2c8b0367c732c6d7538a9b6c00e4e9a7d`, Draft/open.

No merges, production changes, TP-01 runs, or canonical TP status changes were made.

## Follow-up PR #40 CI handoff

- [Draft PR #40](https://github.com/mo3az-git/zamzam-store/pull/40), final tested head `045d797324c2825b3fbe689689471c8d5b6b48bf`.
- [Consolidated run 40577755199](https://github.com/mo3az-git/zamzam-store/actions/runs/40577755199): passed. Image digest parity passed; all focused storefront/cart/checkout/governorate/shipping/batch/visibility suites, lint, disposable migrations, three PostgreSQL integration groups (20 + 13 + 10 checks), backend/storefront builds, and 5 API schema tests passed. The run uploaded `mvp-integration-run-40577755199-1` (796 bytes; retained through 2026-11-10) with runner and step outcomes.
- [Chromium run 40577755374](https://github.com/mo3az-git/zamzam-store/actions/runs/40577755374): catalog/locale/mobile 7/7 and synthetic guest checkout 2/2 passed, 0 failed and 0 skipped. Both browser artifacts uploaded and retained through 2026-11-10.
- GitHub diagnostics report all three required checks passed on the tested head. Vercel reports a separate deployment rate limit (retry in 24 hours); no deployment was required for QA and this does not change the workflow results.

## CI evidence on PR #31

- [Consolidated MVP run 40573837150](https://github.com/mo3az-git/zamzam-store/actions/runs/40573837150): **89/89 Node test cases passed**, **73/73 named integration and guard assertions passed**, **5/5 proposed API schema tests passed**. Lint, disposable migrations, backend/storefront builds and the overall workflow succeeded. The job covers guest ownership, cart guards, PostgreSQL FEFO, Medusa visibility, governorate mapping and shipping-readiness blockers.
- [Chromium run 40573837179](https://github.com/mo3az-git/zamzam-store/actions/runs/40573837179): catalog/locale/mobile **7/7 passed**, synthetic guest-checkout **2/2 passed**; **0 failed, 0 skipped**.
- GitHub check diagnostics confirm these workflow/job conclusions against PR #31 head `47f75ab`. Vercel deployment also completed successfully.

The browser run retained two artifacts: `argon-prep-browser-qa` (1,338,902 bytes) and `synthetic-checkout-browser-qa` (196,014 bytes). The consolidated integration run had no uploaded artifact; its output was available only in step logs. This follow-up adds a non-secret JSON run manifest with SHA, runner/runtime, pinned service image refs, and named step outcomes, uploaded for 14 days. Existing browser evidence retention is extended from 7 to 14 days.

## Local Windows reconciliation

The PR #31 note recorded **58/62 storefront tests passing, 4 failing** on Windows and **62/62 passing** on Linux CI. In this review, the current shared Windows working tree contains seven additional uncommitted accessibility/SEO cases: the full local command reports **65/69 passing, 4 failing, 0 skipped**. All four failures remain the cart adapter cases: cart creation, line-item request, locked-cart mapping and ambiguous POST request count.

A loopback-only Node HTTP probe in this execution environment bound a temporary server on `127.0.0.1`, then failed its local `fetch` with `EACCES`. The cart-adapter tests use the same loopback pattern. This explains the observed failures in this restricted Windows execution environment; it does not establish a general Windows or Node defect. Re-run the same suite on an ordinary Windows runner that permits local loopback before classifying the adapter behavior itself. Linux CI passed the same 62-test baseline. Do not count the four local failures as passes.

Local validation also confirmed Node `v24.22.1`, npm `11.19.1`, no Docker command, and `npm run ops:readiness` passed. Docker-backed PostgreSQL/Redis and browser execution were therefore not run locally. The PowerShell disposable runner’s fixed loopback ports `5432` and `6379` must be available; the runner scopes teardown to its generated Compose project and stores database/Redis data in tmpfs.

## Confirmed infrastructure gap and fix

PR #30’s `ops:readiness` script checks immutable PostgreSQL/Redis references in Compose, but it does not inspect the consolidated workflow’s service images. PR #31’s workflow used floating `postgres:16` and `redis:7.2` tags while local QA uses digest-pinned images. Therefore a green preflight did not guarantee CI/local service-image identity.

This follow-up pins the GitHub Actions services to the same digests used by `compose.qa.yaml` and adds a static check that fails on image drift or a missing digest. It does not change service behavior or product code.

## Coverage status for integration handoff

| Capability | QA result | Boundary |
|---|---|---|
| Guest ownership and cart mutation guards | **Passed in CI** | Internal/guard-level integration coverage; customer storefront cart lifecycle remains disabled/unwired |
| Batch availability / FEFO | **Passed in CI** | Projection and PostgreSQL FEFO coverage; no public batch-availability endpoint or full reservation-to-order journey |
| Shipping/geography | **Passed in CI** | 27 canonical geographies and missing-rate blockers; no approved tariff/provider or customer quote |
| Invalid price and payable quote guards | **Passed as read-only quote/unit checks** | No order or payment path |
| Stale cart and conflict behavior | **Guard tests passed in CI** | No end-to-end customer cart mutation lifecycle |
| Payment selection, callback replay, settlement, COD collection | **Blocked** | No authorized storefront payment selection/transaction path; unit/internal evidence is not end-to-end settlement proof |
| Full customer purchase journey | **Blocked** | BFF ownership bridge, customer cart lifecycle, live shipping quote, approved payment capability and order completion are not integrated |

CI green status applies only to the named scoped checks. It is not formal TP acceptance or production readiness.

## Reproduction

On a configured Windows machine with Docker Compose v2, Node 24.22.x, dependencies installed, and loopback ports 5432/6379 free:

```powershell
./scripts/run-disposable-integration.ps1
```

The runner migrates its generated disposable PostgreSQL project, runs guest-ownership, shipping-readiness and governorate-geography checks, then removes only that project. It does not create shipping rates, orders, payments or inventory reservations.

The Linux GitHub Actions workflows remain the reproducible source for Chromium and PostgreSQL/Redis results when those prerequisites are unavailable locally. The new service-image preflight and manifest make the runner identity and each workflow step outcome available as an artifact for Integration Coordinator review.
