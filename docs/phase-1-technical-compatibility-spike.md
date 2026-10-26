# Phase 1 — Technical Compatibility Spike

**Current status (audit at HEAD `c518745d942415ef006c06691d46088c9c7c8bc1`):** Baseline compatibility checks passed in the latest push and PR CI runs (#40295594332 and #40295602184) on Medusa 2.22.1. TP-02a and TP-03 behavioral runners both exited successfully in those runs against the real Medusa container and disposable PostgreSQL/Redis; TP-03 is workflow-level only, not an HTTP route test. Their uploaded evidence awaits independent review. TP-01 has not been executed and execution remains explicitly unauthorized. The committed `package-lock.json` is enforced via `npm ci --strict-peer-deps` in CI. All 59 canonical TP rows in `docs/implementation-plan.md` remain unchecked `[ ]`; only 2 TP behavioral runs have been executed, and no case is formally accepted.
**Starting commit:** 404bf23275d67cc6274ed567779081c25f676100 (Phase 0 design accepted; runtime unverified).  
**Scope boundary:** initial monorepo scaffold, package/peer metadata, strict dependency resolution, lint/build, and baseline Medusa migrations against a disposable database; then the documented TP cases. No production feature work is included.

## 1. Repository baseline

At the starting commit, Git contained the ten Phase 0 Markdown documents and no application source, package manifests, lockfile, or CI workflow. This branch proposes only a minimal Medusa configuration shell, a Next.js placeholder page, disposable local services, and repeatable validation scripts.

## 2. Candidate package versions

The version pins below are candidates from the project design and public package listings consulted on 2026-10-25. Publishing of an individual version is not proof that the cohort works together.

- Node.js 24.22.1 LTS, published 2026-10-21: https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
- Next.js 15.5.28: https://www.npmjs.com/package/next?activeTab=versions
- React 18.3.1 and React DOM 18.3.1 across both workspaces. Attempt 5 exposed a duplicate React runtime during App Router prerender; the unified pin removed that specific duplicate-version setup, but production-build compatibility still requires a clean CI pass: https://www.npmjs.com/package/react?activeTab=versions and https://www.npmjs.com/package/react-dom?activeTab=versions
- Medusa framework/server/CLI, admin SDK, draft-order plugin, test-utils and JS SDK version 2.22.1 (candidate pending full CI rerun): https://www.npmjs.com/package/%40medusajs/framework, https://www.npmjs.com/package/%40medusajs/medusa, https://www.npmjs.com/package/%40medusajs/cli, https://www.npmjs.com/package/%40medusajs/admin-sdk, https://www.npmjs.com/package/%40medusajs/draft-order, https://www.npmjs.com/package/%40medusajs/test-utils, https://www.npmjs.com/package/%40medusajs/js-sdk
- PostgreSQL 16.15 image digest: https://hub.docker.com/layers/library/postgres/16.15/images/sha256-b0c06b134b08ce49214ebb783d292c7cd9527136f30691408e98d2d40d9a5070?tab=layers
- Redis 7.2.16 image digest: https://hub.docker.com/layers/library/redis/7.2.16/images/sha256-da115d3817f5c0a2c080ea685836bde82bf550bbecdebb12074577ee43926cde

The CI workflow captures exact direct-package metadata (version, peerDependencies, engines), installs with strict peer checks, records the resolved tree, runs lint/build, and applies baseline migrations to disposable PostgreSQL. Package compatibility is not accepted until those steps pass and their logs are inspected.

React and React DOM 18.3.1 are pinned in both workspaces. Next.js 15.5.28 accepts this version in its declared peer range, and the Medusa default/admin module cohort also expects React 18. This avoids a hoisted Next.js runtime resolving a different React copy from the storefront JSX runtime. The metadata guard rejects conflicting exact pins across all workspaces.

## 3. CI attempts and corrective actions

### Attempt 1 — Initial scaffold

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40226199160  
Commit: ca24542b2302fd8509e04aa8bc0d18bc7a726025.

The exact package metadata check, TP-registry markup guard, dependency installation with strict peer checks, npm ls --all, and workspace lint all passed. The baseline migration failed because the Medusa CLI could not load ts-node/config correctly; backend and storefront builds were consequently skipped. This is a genuine failure, not a passing migration.

### Attempt 2 — TypeScript config loader

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40226538549  
Commit under test: ad8dcbc17577d6f149e6ff96d85a2df68f2d870f.

Metadata, registry integrity, install, npm ls --all, and lint passed again. The migration step reported that tsconfig-paths received an undefined base path and that the Medusa CLI could not resolve @medusajs/draft-order from the app root. The baseline migrations failed and both builds were skipped.

### Attempt 3 — Metadata checker stopped early

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40227226731  
Commit under test: f80c52c93b9f2153860ca920b4d5d55cdf457b50.

The updated metadata script checked all new direct version pins and identified an npm CLI output-shape edge case: for @medusajs/admin-sdk@2.21.2, npm view returned the version as a JSON string because optional metadata fields were absent. The script incorrectly expected an object with a version property and stopped before registry, install, migration or build steps. This was a validator bug, not evidence that the package version was absent.

### Attempt 4 — Strict peer check finds a React Router mismatch

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40227402378  
Commit under test: d9005073e004e03926978125b816560a87cac251.

The metadata and TP-registry checks passed. Strict installation correctly rejected the requested React Router versions: the backend manifest pinned react-router-dom 7.0.0, while Medusa Dashboard 2.21.2 resolves react-router-dom 7.18.2, which requires react-router 7.18.2. The install failed before lint, migration or build. The pin is aligned to 7.18.2 in this revision; strict peer checks remain enabled.

### Attempt 5 — Base runtime checks pass; Next.js React renderer mismatch

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40227622445  
Commit under test: b1208c7a585e8e42326bee66a2d519a2e0c00347.

The metadata and registry checks, strict dependency install, npm ls --all, workspace lint, PostgreSQL migrations, and Medusa backend build all passed. The Next.js production build failed during prerender of the default /404 page with a React element/renderer mismatch. The uploaded package-lock showed Next.js hoisted at repository root (where React 18.3.1 was installed) while the storefront workspace had React 19.3.1 installed separately. We are aligning both workspaces on React/React DOM 18.3.1, within Next.js 15's declared peer range and the Medusa UI peer requirements, so the hoisted Next.js runtime and JSX runtime resolve to the same React copy.

Medusa build also emitted a tsconfig-paths warning that the base path was undefined even though the backend workspace tsconfig specified it; the current revision adds a minimal root tsconfig with baseUrl set so the CLI can resolve it from either working directory. This warning did not fail the backend build but should be removed or documented before accepting a clean setup.



### Attempt 6 — App Router status-page prerender failure; environment override removed

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40228084444  
Commit under test: 4a5334c271193ed5731ab29913ae245306f80ee2.

Metadata checks, TP registry integrity, strict install, dependency-tree capture, lint, disposable PostgreSQL baseline migrations, and the Medusa backend build passed. The Next.js build still failed while prerendering `/404` with `<Html> should not be imported outside of pages/_document`. The current storefront source uses the App Router root layout and does not import `next/document` or define a Pages Router `pages/` directory. The workflow also explicitly exported `NODE_ENV=development` to every step, including `next build`, which emitted a non-standard-environment warning. The corrective change removes that workflow-wide override so Next.js can use its normal production-build environment; the Medusa config has its own development fallback when `NODE_ENV` is unset. This is a diagnostic hypothesis, not a passing result; the next CI run must establish whether it resolves the failure.


### Attempt 7 — Next.js production build passes; Medusa CLI still emits a config-loader trace

Workflow run: https://github.com/mo3az-git/zamzam-store/actions/runs/40228924804  
Commit under test: 065d1d7d64aec180a649a6f5f3f432d6070f5414.

The run completed successfully. Exact metadata checks passed for 19 direct pins with no metadata-checker failures; all 59 TP registry rows were present, unique, and unchecked; strict dependency installation and `npm ls --all` passed; both workspace lint commands passed; Medusa baseline migrations completed against the disposable PostgreSQL service; and the Medusa and Next.js production-build commands returned exit code 0. The Next.js output includes both `/` and `/_not-found` as static routes, and removing the workflow-wide `NODE_ENV=development` override eliminated the previous `/404` failure.

**Remaining setup issue:** the Medusa build log still prints `ts-node cannot be loaded...` plus a `tsconfig-paths` `TypeError` indicating its `path` argument is undefined, before continuing to a successful build. Therefore the build command passes but its CLI/config-loader setup is not yet clean. The next run sets `NODE_ENV=production` only for the Medusa build step, leaving the migration step on the default development path, to test whether this removes the trace. This corrective run must be inspected before treating backend CLI setup as accepted.

The run also generated candidate `package-lock.json` and uploaded it with the logs in artifact `phase1-spike-evidence-065d1d7d64aec180a649a6f5f3f432d6070f5414`. The lockfile is not committed yet. The npm install log reports deprecated-package notices and six packages whose install scripts are not covered by npm's current `allowScripts` policy; review these before deciding whether to approve any install scripts. Neither warning changes the fact that this CI installation and both builds succeeded, but both require dependency/security review before claiming a clean reproducible baseline.


### Attempt 8 — Baseline CI passes with a clean Medusa build log

Workflow run (push): https://github.com/mo3az-git/zamzam-store/actions/runs/40229352092  
Workflow run (pull request): https://github.com/mo3az-git/zamzam-store/actions/runs/40229356289  
Commit under test: 21b3ba756f8acf012e9dbbc4cce12d5ebaa95be1.

Both the push-triggered and pull-request-triggered workflows completed successfully. The run passed metadata checks for 19 exact direct-pin entries, TP registry integrity, strict dependency installation, `npm ls --all`, both workspace lint commands, baseline Medusa migrations against disposable PostgreSQL, the Medusa backend build, and the Next.js production build. The previous `ts-node` / `tsconfig-paths` stack trace disappeared when `NODE_ENV=production` was set only for the Medusa build step. Migrations remain on the normal default development path. The Next.js build statically rendered `/` and `/_not-found`.

The run produced a candidate lockfile (lockfileVersion 3; 1,478 package entries). Its SHA-256 is `b875c1c96eace036de9297399e01235514ca45584bfbf65e960a85a7662903ce`; the resolved tree contains Next.js 15.5.28 and one root React/React DOM 18.3.1 pair, with no workspace-nested React copies. It remains an artifact, not a committed lockfile. The install log still has package deprecation notices and six dependencies with install scripts not yet covered by `allowScripts`; review those scripts and any needed approvals instead of blanket-approving them.

This is a successful **baseline scaffold compatibility run**, not Phase 1 completion: no TP behavior test was executed, explicit Redis lock acquisition/contention/timeout behavior is not yet evidenced, and all 59 TP statuses must remain unchecked.


### Attempt 9 — Upgrade candidate after locking-provider review; runtime blocker remains

The attempt-8 green run validated the 2.21.2 package cohort. The candidate direct Medusa pins were moved together to 2.22.1 and the full baseline CI rerun passed in [run #19](https://github.com/mo3az-git/zamzam-store/actions/runs/40230164420): exact package metadata, registry integrity, strict install, npm ls, lint, disposable PostgreSQL migrations, and both production builds. A fresh candidate lockfile (lockfileVersion 3; 1,471 entries) was generated with SHA-256 `f1dbb85d8b098a83f52aaaaa6af7ddce1540493b290577b0904f95733896f988`; it remains uncommitted and will change again because the targeted test harness adds direct dependencies.

The version change follows Medusa release v2.22.1 and merged PR [#17460](https://github.com/medusajs/medusa/pull/17460), which adds provider shutdown hooks to close the Redis client when a running application shuts down. See also the [v2.22.1 release notes](https://github.com/medusajs/medusa/releases/tag/v2.22.1).

**Important unresolved correctness risk:** the separate proposed fix for stable ordering of multi-key acquisitions, atomic owner-safe `releaseAll`, and same-owner re-entrancy ([PR #16284](https://github.com/medusajs/medusa/pull/16284)) is closed without being merged. Inspection of the published v2.22.1 `redis-lock.ts` still finds caller-order concurrent acquisition (`keys.map` / `promiseAll`) and the `awaitQueue` Lua branch; therefore the correctness issues reported in [#16285](https://github.com/medusajs/medusa/issues/16285) cannot be presumed fixed by upgrading. Separately, v2.22.1's provider loader still eagerly calls `connection.connect()`; the merged shutdown fix does not establish cleanup for migration-only loads as described in [#17220](https://github.com/medusajs/medusa/issues/17220), and PR [#17227](https://github.com/medusajs/medusa/pull/17227) was closed without merging. These findings are source-level compatibility risks requiring targeted evidence, not claims that the defects reproduced in our application.

The PostgreSQL locking provider is not an automatic fallback: the separate [#16994 report](https://github.com/medusajs/medusa/issues/16994) also alleges expired-lock recovery defects. Keep the Redis provider as a candidate only while dedicated real-Redis regression tests are run; do not merge the scaffold or start inventory/checkout concurrency code until these tests resolve the risk. Do not mark any of the 59 TP rows passed without their own evidence.

Required targeted checks before transition review: (1) reverse-order concurrent multi-key acquire with `awaitQueue`; (2) partial multi-key acquire failure cleanup; (3) `releaseAll` must never delete a lock owned by another caller; (4) same-owner re-entrancy; (5) provider shutdown closes clients; and (6) migration-only startup does not leak a Redis connection. Exercise both success and timeout/error paths against a real disposable Redis instance.

### Corrective changes in the current revision

- Add baseUrl "." to the backend tsconfig to support the Medusa CLI's tsconfig-paths loader.
- Make @medusajs/draft-order a direct backend dependency and add the peer packages used by the Medusa 2.21.2 default/admin module cohort, while sharing React/React DOM 18.3.1 across both workspaces.
- Align react-router-dom with the 7.18.2 version required by Medusa Dashboard 2.21.2. The install and backend build now pass.
- Unify React/React DOM at 18.3.1 across backend and storefront, and add a root tsconfig baseUrl for the Medusa CLI loader. Attempt 8 confirms strict installation and both builds pass with no Medusa config-loader stack trace when the backend build receives `NODE_ENV=production`.
- Configure projectConfig.redisUrl for local session storage and register the documented Redis Locking Module Provider using LOCKING_REDIS_URL, so the spike does not silently fall back to a fake Redis instance.
- Make the metadata checker robust to string-only npm view responses, remove the workflow-wide `NODE_ENV=development` override, and set `NODE_ENV=production` only for the Medusa build. Attempt 8 verifies the Next.js and Medusa builds both pass without the earlier framework/config-loader errors.


### Attempt 10 — Baseline compatibility passes; real-Redis locking regression fails

Workflow run (push): https://github.com/mo3az-git/zamzam-store/actions/runs/40231225995  
Workflow run (pull request): https://github.com/mo3az-git/zamzam-store/actions/runs/40231231384  
Commit under test: `53e59e83e5a94f3161109589819f5eaf165820e9`.

The exact package metadata check, TP registry integrity check, strict peer-dependency install, `npm ls --all`, workspace lint, baseline Medusa migrations against disposable PostgreSQL, Medusa production build, and Next.js production build all passed in this run.

The real-Redis regression completed 7 checks: **3 passed, 4 failed**.

| Check | Result | Evidence / implication |
|---|---|---|
| Basic acquire and owner-checked release | PASS | Basic single-key acquire/release works in this harness. |
| Failed multi-key acquire rolls back keys already acquired | FAIL | The first key remained held after a later key failed; partial acquisition cleanup is not safe. |
| Same-owner re-entry with `awaitQueue` | FAIL | Re-entry did not resolve within the 900 ms bound. |
| Opposite-order multi-key acquisition | FAIL | Concurrent callers acquiring `[key-a, key-b]` and `[key-b, key-a]` did not finish within 2.5 seconds. |
| `releaseAll` preserves a replacement lock acquired between read and delete | FAIL | A replacement lock owned by another caller was deleted in the injected race. |
| `releaseAll` preserves a different owner's lock in the non-racing case | PASS | The ordinary non-racing owner-scope check passed. |
| Provider shutdown closes its Redis client | PASS | The client emitted its terminal `end` event after provider shutdown. |

Focused inspection of the published v2.22.1 source (`packages/modules/providers/locking-redis/src/services/redis-lock.ts`) found implementation paths that match the failures: multi-key `acquire_` starts all key acquisitions concurrently with `keys.map(...)` and has no rollback for keys acquired before `promiseAll` rejects; the Lua `awaitQueue` branch returns `0` before checking whether the current owner matches; and `releaseAll` reads owners and then unlinks matching keys in a separate command, leaving a read/delete race. This is strong source-level corroboration, though the failing runtime checks remain the behavioral evidence. Do not mask them or mark the Redis check as passing. Preserve the failing tests and build/validate a safe locking strategy before any production checkout or inventory work. The PostgreSQL locking provider is not an automatic fallback and requires equivalent regression checks.

The migration log also includes repeated PostgreSQL warnings that `SET LOCAL` was issued outside transaction blocks. The migration command exited successfully, but these warnings should be investigated before treating migration behavior as clean.

This attempt does **not** pass any of the 59 application TP behavior cases. The TP registry remains unchanged and every TP status must remain `[ ]`.

## 4. Evidence workflow

The workflow at .github/workflows/phase1-spike.yml runs on pushes to main and phase-1 branches, pull requests to main, and manual dispatch. On a bootstrap run it creates a candidate package-lock.json and uploads the file and logs as an artifact. Review the dependency tree and commit the lockfile before treating later npm ci runs as the reproducible path.

The test registry script is a guardrail only: it asserts the presence of exactly 59 unique TP rows with all statuses unchecked. It does not execute or pass a TP behavior test.

## 5. Acceptance evidence ledger

| Evidence item | Status | Evidence required |
|---|---|---|
| Candidate versions published | Exact metadata, strict install, lint, migrations, and both builds passed on attempt 10 for the 2.22.1 candidate; full behavioral compatibility is still unverified and Redis regression is blocked | Continue with lockfile review, Redis locking resolution, and TP cases |
| Exact direct-pin metadata and peer requirements | Passed on attempt 10 for the 2.22.1 candidate cohort; no metadata checker failures | Preserve metadata output from attempt 10 and rerun after dependency changes |
| Dependency install with strict peer checks | Passed on attempt 9 for 2.22.1. Candidate lockfile has 1,471 entries and SHA-256 `f1dbb85d8b098a83f52aaaaa6af7ddce1540493b290577b0904f95733896f988`; the install also flagged deprecated transitive dependencies and six scripts outside `allowScripts`. | Review regenerated lockfile and each install script after adding the regression harness, then commit the current lockfile before relying on `npm ci` |
| npm ls --all dependency tree | Passed on attempt 10 for 2.22.1 | Preserve and review the latest full resolved tree |
| TP registry markup | Passed on attempt 8 | Exactly 59 unique rows and all remain unchecked; this is registry integrity only, not behavior execution |
| Backend/storefront lint | Passed on attempt 10 for 2.22.1 | Keep the CI lint evidence with the artifact |
| Medusa backend build | Passed on attempt 10 for 2.22.1 | Preserve the successful build log; investigate `SET LOCAL` warnings from migration step separately |
| Next.js storefront shell build | Passed on attempt 10 for 2.22.1 | Preserve successful production-build log |
| Baseline migrations | Command passed on attempt 10 against disposable PostgreSQL for 2.22.1, but repeated `SET LOCAL`-outside-transaction warnings require investigation | Preserve migration log and diagnose warning; custom-module migrations remain unimplemented/unverified |
| Redis locking semantic behavior | **BLOCKED:** attempt 10 ran 7 real-Redis checks; 3 passed and 4 failed (partial-acquire rollback, same-owner re-entry, reverse-order multi-key contention, owner-safe `releaseAll` race). Migration-only loader connection cleanup remains a separate lifecycle concern. | Investigate harness validity and provider source; retain failing regressions. Resolve all four failures or replace the provider strategy and pass equivalent tests before transition review |
| Native order correlation, inventory atomicity, checkout recovery, payment/webhook/refund behavior, restore | Pending; all 59 TP statuses remain unchecked | Test logs, exit codes, environment/package metadata, database assertions |
| Lockfile committed | Committed for Medusa 2.22.1 cohort (SHA-256 `c3de50651eccf1a8c6843b5c0e536de375d05b91a2bf7818fd94fdfa7c6b291f`). Enforced in CI via `npm ci --strict-peer-deps`. | Retain exact lockfile; verify clean `npm ci` on every change |

## 6. Guardrails

1. Do not mark any TP row passed based on documentation, package metadata, builds, migrations, or the registry-integrity script.
2. Do not begin catalog, real checkout/payment, custom inventory behavior, admin features, or production deployment until all 59 TP cases pass with evidence and the transition gate is reviewed.
3. Do not choose a payment gateway. Use a provider simulator for the Spike.
4. Keep production secrets out of the repository. The .env.example file contains local-only placeholders.
5. Any peer conflict, install/migration/build failure, Redis connection issue, or unexplained dependency duplication is a compatibility blocker; do not bypass it using --legacy-peer-deps or force flags.


### Phase 1 follow-up — tested Medusa cohort and dependency-resolution decision (2026-10-26)

- The Phase 1 Spike's tested Medusa cohort is **2.22.1** for `@medusajs/*`. This version was validated in CI run #74 and pinned in `package.json` and `package-lock.json`. It resolved clean-install peer dependencies and incorporated provider shutdown fixes.
- References elsewhere in the historical design/review documents to Medusa **2.21.2** record an earlier candidate cohort. They are historical for the Phase 1 Spike; they do not change the design rules or imply that 2.21.2 is being tested by the current workflow.
- Root devDependencies pin `tsconfig-paths@4.2.0` because Medusa CLI 2.22.1 calls `register({})` without declaring that package. Root pins `ajv@8.20.0`, `ajv-formats@2.1.1`, and `picomatch@3.0.2` satisfy optional peer ranges in the Medusa admin/dashboard tree and avoid incompatible versions being hoisted to the root. npm retains incompatible major versions as nested dependencies, allowing `npm ci --strict-peer-deps` to pass cleanly.
- `package-lock.json` is committed with SHA-256 `c3de50651eccf1a8c6843b5c0e536de375d05b91a2bf7818fd94fdfa7c6b291f`, matching the CI run #74 artifact byte-for-byte. The CI workflow enforces `npm ci --strict-peer-deps` with zero on-the-fly lockfile generation.
- No TP behavior case is run or accepted by this dependency decision; all 59 TP statuses stay unchecked `[ ]`.

## 7. Implementation plan for initial compatibility tests (TP-01, TP-02a, TP-03)

This section documents the concrete implementation plan for the first three canonical compatibility tests from the Technical Prototype Registry.

**Execution status:**
- **TP-02a (Distributed Cart Lock Acquisition):** executed once against the real Medusa container and disposable PostgreSQL/Redis; evidence is awaiting independent review.
- **TP-01 (Cart Creation with Batch Variant):** not executed.
- **TP-03 (Concurrent Cart Lock Rejection):** executed once against the real Medusa container and disposable PostgreSQL/Redis (workflow-level only, partial; HTTP-level 409 is NOT exercised); evidence is awaiting independent review.
- All 59 canonical TP rows in `docs/implementation-plan.md` remain strictly unchecked `[ ]`. The implementation plan below for TP-01 is a specification, not an executed test.

### Canonical TP-01: Cart Creation with Batch Variant
- **Canonical row definition (quoted verbatim from `docs/implementation-plan.md`):**
  - **Test ID:** `TP-01`
  - **Scenario Name & Scope:** `Cart Creation with Batch Variant`
  - **Setup & Inputs:** `Variant with `manage_inventory: false`.`
  - **Concurrent Interleaving / Injection:** `Standard `POST /store/carts` with line items.`
  - **Expected Observable Result & DB State:** `Cart created; native Medusa inventory checks skipped; line has `checkout_line_key` in metadata.`
- **Design document citations:**
  - `docs/data-model.md` §2.2 line 110 (`line_item.metadata`) defines `checkout_line_key` as a server-generated UUID string (example: `"d3b07384-d113-494b-9c8e-0b046a782298"`).
  - `docs/data-model.md` §3.1 line 227 (`cart_batch_reservation`) and line 328 (`order_batch_allocation`) define `checkout_line_key` as type `UUID NOT NULL`, uniquely identifying the cart line item across reservations and allocations.
- **What must be implemented in `apps/backend`:**
  - A cart/line-item workflow step or subscriber hook in `apps/backend` that generates a valid UUID upon item addition and writes it to `line_item.metadata` under the key `checkout_line_key`.
  - Verification that variant configuration `manage_inventory: false` bypasses native Medusa inventory reservation checks without throwing inventory validation errors.
  - Test runner script: `apps/backend/scripts/test-tp01-cart-creation.mjs` (status: to be created).
- **Fixtures needed:**
  - Disposable PostgreSQL container (`postgres:16.15-alpine`) with baseline schema.
  - Disposable Redis container (`redis:7.2.16-alpine`).
  - Medusa Store API prerequisites:
    - Default Sales Channel.
    - Publishable API Key linked to the sales channel (passed in request headers).
    - Region with active currency.
    - Product with at least one Product Variant configured explicitly with `manage_inventory: false`.
- **Evidence collection (read out-of-band and from API/DB):**
  - HTTP status code (`200` or `201`) and response body from `POST /store/carts`.
  - Database row inspection on `cart_line_item`: verify `metadata->>'checkout_line_key'` is present, non-null, and a valid UUID string matching the value to be referenced later by `cart_batch_reservation`.
  - Database inspection of native inventory tables: verify 0 inventory reservation rows created in native Medusa tables.
  - Pre- and post-test PostgreSQL snapshots of `cart` and `cart_line_item`.
- **Evidence directory and artifacts:**
  - Directory: `artifacts/tp-evidence/TP-01/` (as specified in `docs/phase1-tp-execution-register.md`)
  - Artifacts:
    - `result.json`: TP ID, status (`passed`, `failed`, or `blocked`), UTC start/end timestamps, exact commit SHA, Node/npm versions, package-lock SHA-256, DB/Redis image versions, test command, process exit code, failure summary.
    - `stdout.log` & `stderr.log`: raw terminal output.
    - `db-before.sql` & `db-after.sql`: pre- and post-execution database query snapshots.
    - `assertions.json`: machine-readable assertion results (HTTP 200/201, `checkout_line_key` present as valid UUID in metadata, zero native inventory reservations).
- **Blocking conditions (marked blocked instead of passed):**
  - Store API prerequisites (publishable key, sales channel, region, product variant) missing from the database.
  - Line-item metadata hook missing in `apps/backend`, resulting in carts created without `checkout_line_key` or with a non-UUID format.
  - Mocking API responses or database state instead of executing against the running Medusa application.

### Canonical TP-02a: Distributed Cart Lock Acquisition
- **Canonical row definition (quoted verbatim from `docs/implementation-plan.md`):**
  - **Test ID:** `TP-02a`
  - **Scenario Name & Scope:** `Distributed Cart Lock Acquisition`
  - **Setup & Inputs:** `Active cart ID `$CART_ID`.`
  - **Concurrent Interleaving / Injection:** `Call `acquireLockStep({ key: "cart:" + cart.id, ttl: 120, timeout: 5, ownerId: workerId })`.`
  - **Expected Observable Result & DB State:** `Lock acquired in Redis (`SET cart:... worker:... NX EX 120`); verifies nested workflow lock skip behavior.`
- **Design document citations:**
  - `docs/data-model.md` §3.1 lines 181-193 defines `cart_checkout_session` (columns: `cart_id` PK, `current_attempt_id` UUID, `epoch` BIGINT DEFAULT 1, `status` VARCHAR(32) DEFAULT 'in_progress').
  - `docs/order-and-inventory-workflows.md` §2.1 lines 217-224 (Stage 2) defines `acquireLockStep(key="cart:" + cart.id, timeout=5, ttl=120, ownerId=executionId)` prior to session/attempt mutations.
- **What must be implemented in `apps/backend`:**
  - Workflow steps `acquireLockStep` and `releaseLockStep`: Medusa core provides canonical implementations in `@medusajs/medusa/core-flows` (with built-in sub-workflow skipping via `parentStepIdempotencyKey`, timeout/retry loop, and compensation logic). Re-exporting them via `apps/backend/src/workflows/steps/acquire-lock.ts` ensures native framework compatibility without maintaining redundant custom code.
  - Nested workflow lock skip behavior: validated directly using Medusa core-flows `acquireLockStep`, which checks `parentStepIdempotencyKey` and executes `StepResponse.skip()` without attempting redundant lock acquisition or failing.
  - Test runner script: `apps/backend/scripts/test-tp02a-distributed-lock.mjs` running against the real Medusa container loaded from `apps/backend/medusa-config.ts` (using `@medusajs/medusa/loaders` matching `npx medusa exec`).
- **Fixtures needed:**
  - Disposable PostgreSQL container (`postgres:16.15-alpine`).
  - Disposable Redis container (`redis:7.2.16-alpine`) reachable via `REDIS_URL` / `LOCKING_REDIS_URL`.
  - Active Cart record in PostgreSQL with ID `$CART_ID`.
  - Authoritative `cart_checkout_session` record in PostgreSQL created directly through `BatchInventoryModuleService.createCartCheckoutSessions` resolved from the real Medusa container (with initial `epoch = 1`, `status = 'in_progress'`, and `current_attempt_id`), and verified via both the module service and raw SQL.
  - Unique worker identifier (`workerId`, e.g. UUID).
- **Evidence collection (read out-of-band and from API/DB):**
  - Direct Redis inspection via independent client (`ioredis`):
    - Note: keys are stored with the provider prefix configured in `medusa-config.ts` (`medusa_lock:`).
    - Verify key `medusa_lock:cart:$CART_ID` exists in Redis.
    - Verify key value matches `workerId`.
    - Verify `TTL medusa_lock:cart:$CART_ID` is a TTL greater than 110 seconds and at most 120 seconds.
    - Verify key is null (deleted) after `releaseLockStep`.
  - Step execution outcome: verify successful return from `acquireLockStep`.
  - Nested invocation verification: execute a nested lock call within the same worker context and assert lock skip without errors.
  - Database before/after snapshots of `cart_checkout_session` written as SQL queries and formatted results to `db-before.sql` and `db-after.sql`.
- **Evidence directory and artifacts:**
  - Directory: `artifacts/tp-evidence/TP-02a/` (as specified in `docs/phase1-tp-execution-register.md`)
  - Artifacts:
    - `result.json`: metadata, status, commit SHA, exit code.
    - `stdout.log` & `stderr.log`: raw terminal output.
    - `db-before.sql` & `db-after.sql`: database state snapshots.
    - `assertions.json`: assertions for key presence, matching ownerId, TTL greater than 110 seconds and at most 120 seconds, and nested lock skip pass.
- **Blocking conditions (marked blocked instead of passed):**
  - Redis connection failure or unconfigured `LOCKING_REDIS_URL`.
  - `acquireLockStep` step not implemented in `apps/backend`.
  - Redis locking provider failing to execute atomic `SET NX EX`.
  - Active cart record or associated `cart_checkout_session` record missing in PostgreSQL.
  - Mocking the Redis provider rather than verifying out-of-band Redis state.

### Canonical TP-03: Concurrent Cart Lock Rejection
- **Canonical row definition (quoted verbatim from `docs/implementation-plan.md`):**
  - **Test ID:** `TP-03`
  - **Scenario Name & Scope:** `Concurrent Cart Lock Rejection`
  - **Setup & Inputs:** `Lock key `cart:$CART_ID` held by Worker A.`
  - **Concurrent Interleaving / Injection:** `Worker B initiates checkout on same cart with timeout 5s.`
  - **Expected Observable Result & DB State:** `Worker B times out after 5s; throws `LockTimeoutError` mapped to 409 Conflict without reserving stock or altering epoch.`
- **Design document citations:**
  - `docs/data-model.md` §3.1 lines 181-193 defines `cart_checkout_session` as the authoritative table for checkout epoch (`cart_checkout_session.epoch`) and `current_attempt_id`.
  - `docs/data-model.md` §3.1 lines 220-239 defines `cart_batch_reservation` (pre-order reservations created during checkout).
  - `docs/data-model.md` §3.1 lines 320-334 defines `order_batch_allocation` (permanent batch allocations created upon order conversion).
  - `docs/order-and-inventory-workflows.md` §2.1 Stage 2 lines 218-222 specifies that on Redis lock timeout (>5s), the workflow catches `LockTimeoutError`, deletes any pending idempotency lease via CAS, and returns HTTP 409 Conflict without mutating session epoch or reserving stock.
  - `docs/architecture.md` §4.2 lines 130-165 specifies the explicit separation of Redis cart lock (`timeout = 5s, ttl = 120s`) from PostgreSQL lease authority, and CAS abort on Redis lock acquisition failure.

#### Concrete TP-03 Specification and Implementation Plan

The following concrete requirements define the execution contract for TP-03 (planning only; not implemented or executed in this commit):

1. **Minimum Checkout Entry Point (Workflow Contract):**
   - Must be implemented as an internal Medusa workflow (e.g. `stage2CheckoutLockWorkflow`), not a public storefront feature.
   - Contention setup: Worker A acquires and holds `cart:<cartId>` via `Modules.LOCKING` from the real Medusa container (with TTL = 120s, owner = `workerAId`).
   - Worker B executes the workflow against the same cart with `timeout: 5` and `ownerId: workerBId`.
   - After 5 seconds of Redis contention, `acquireLockStep` times out and throws `LockTimeoutError`.
   - Workflow error mapping: The workflow catches `LockTimeoutError` and rethrows `MedusaError(MedusaError.Types.CONFLICT, "Cart checkout lock timeout", "LOCK_TIMEOUT")`. TP-03 verifies this workflow-level behavior directly (no HTTP route is exercised). The register will record that HTTP-level 409 is NOT exercised and TP-03 remains "workflow-level only, partial" until a real route exists; it will never be described as fully passed or complete.

2. **Tables Asserted Unchanged and Snapshot Protocol:**
   - Snapshots captured immediately before Worker B execution (`db-before.sql` / `db-before.json`) and immediately after Worker B failure (`db-after.sql` / `db-after.json`).
   - Exact tables and columns verified identical:
     - `cart_checkout_session`: exactly 1 row; `epoch`, `current_attempt_id`, `status`, `created_at`, `updated_at`, `deleted_at` match before and after.
     - `cart_batch_reservation`: exactly 0 rows for the cart under test before and after.
     - Native Medusa inventory `reservation_item`: exactly 0 rows for the cart's variants under test before and after (verifying native reservations were not triggered).
   - Snapshot queries executed via direct PostgreSQL client and recorded in formatted evidence tables.
   - Note on `order_batch_allocation`: As decided by the owner, `order_batch_allocation` is written during order conversion and is covered by TP-09/10; it is removed from TP-03 assertions.

3. **Wall-Clock Contention Duration Measurement:**
   - Worker B's execution duration is measured using high-resolution wall-clock timing (`performance.now()`).
   - Timing begins immediately before calling Worker B's workflow execution and ends immediately when the 409 / `LockTimeoutError` is caught.
   - Assertion requirement: elapsed duration must be `5.0` seconds plus or minus `0.5` seconds (`4.5s <= duration <= 5.5s`).

4. **Out-of-Band Redis Preserved-Lock Verification:**
   - After Worker B fails and the error is asserted, an out-of-band Redis client directly inspects the lock key `medusa_lock:cart:<cartId>`.
   - Assertions:
     - Key exists in Redis (`EXISTS === 1`).
     - Key owner still matches Worker A (`GET === workerAId`).
     - Remaining TTL is positive (`TTL > 0`).
     - Proves Worker B did not overwrite, preempt, or delete Worker A's held lock.

5. **Size Cap and Shared Harness Architecture:**
   - Total size cap: The TP-03 runner script (`apps/backend/scripts/test-tp03-concurrent-lock-rejection.mjs`) and any new helpers must stay around **400 lines or less**.
   - Shared harness module: Extract reusable container bootstrap, PostgreSQL inspection client, Redis client, disposable target validation, and evidence serialization from `test-tp02a-distributed-lock.mjs` into a shared module (`apps/backend/scripts/shared/tp-harness.mjs`).
   - Zero-regression constraint: Refactoring TP-02a to use the shared harness must not alter TP-02a runtime behavior, assertions (exactly 39 assertions preserved), or CI green status.

6. **Owner Decisions for TP-03 Specification [DEFAULT-ASSUMPTIONS, owner may change]:**
   - **Decision 1 — Error mapping boundary:** The error mapping lives at the workflow boundary: the TP-03 workflow catches `LockTimeoutError` and throws `MedusaError(MedusaError.Types.CONFLICT, "Cart checkout lock timeout", "LOCK_TIMEOUT")`. TP-03 verifies the workflow-level behavior (no HTTP route). Record in the register that the HTTP-level 409 is NOT exercised and TP-03 stays "workflow-level only, partial" until a real route exists; never describe it as fully passed or complete.
   - **Decision 2 — Stage 2 isolation:** TP-03 tests Stage 2 (Redis cart lock) in isolation, identical to TP-02a. Stage 1 (idempotency lease CAS deletion) is covered by TP-12a/b/c and is out of scope for TP-03.
   - **Decision 3 — Worker A lock holding mechanism:** Worker A acquires `cart:<cartId>` through the real locking module resolved from the real Medusa container (`Modules.LOCKING`, same provider, distinct `workerAId`, `ttl = 120`) and holds it until the test ends; Worker B runs the real TP-03 workflow with `timeout: 5` on the same cart.
   - **Decision 4 — Custom table creation & assertion scope:** Create the real `cart_batch_reservation` table exactly per `docs/data-model.md` §3.1 (its own migration, DML model aligned with the table following the same model/migration reconciliation approach as `cart_checkout_session`, plus a reconciliation assertion). Remove `order_batch_allocation` from TP-03's assertions (it is written at order conversion, covered by TP-09/10). Assert unchanged: `cart_checkout_session` (`epoch`, `current_attempt_id`, `status`, `created_at`, `updated_at`, `deleted_at`), `cart_batch_reservation` has 0 rows for the cart, and native `reservation_item` has 0 rows for the cart's variants.

7. **Step Architecture, Discrimination, and Controls:**
   - **Step Selection (`stage2AcquireLockStep` vs `acquireLockStep`):** TP-02a exercises `@medusajs/medusa/core-flows` `acquireLockStep` to validate standard framework locking and nested sub-workflow lock inheritance. In contrast, TP-03 exercises a custom `stage2AcquireLockStep` (in `stage2CheckoutLockWorkflow`) because Stage 2 checkout specifications require wrapping lock acquisition in a retry loop with a 5-second timeout and mapping the contention error specifically to `MedusaError(CONFLICT, "Cart checkout lock timeout", "LOCK_TIMEOUT")`. Core-flows `acquireLockStep` does not provide this contention retry or domain error mapping.
   - **Contention Error Discrimination (`isLockContentionError`):** To prevent false-positive passes from non-contention failures (connection errors, signature bugs, provider faults), `stage2AcquireLockStep` catches and retries only genuine lock contention errors (`MedusaError` with type `conflict` and message starting with `Failed to acquire lock for key `). All other errors are immediately rethrown as-is without delay.
   - **Supplementary Negative Control:** Proved via `apps/backend/scripts/check-stage2-lock-negative-control.mjs`, which registers simulated locking failures (plain `Error` and `TypeError`) in a Medusa container and verifies immediate rethrow (< 1.0s) as-is without timeout or conversion to `LOCK_TIMEOUT`.
   - **Positive Control in Runner:** Before Worker A acquires the contention lock, Worker B executes `stage2CheckoutLockWorkflow` on the free cart, verifies lock ownership in Redis with TTL in `(110, 120]`, releases the lock via owner-checked release, and verifies its complete deletion. Asserted by: `control_worker_b_acquires_free_lock`, `control_redis_owner_is_worker_b`, and `control_lock_released_before_contention`.

- **Fixtures needed:**
  - Disposable PostgreSQL container (`postgres:16.15-alpine`).
  - Disposable Redis container (`redis:7.2.16-alpine`).
  - Active Cart record in PostgreSQL with ID `$CART_ID`.
  - Pre-existing `cart_checkout_session` row in PostgreSQL with known initial values (`epoch = 1`, `status = 'in_progress'`, and initial `current_attempt_id`).
  - Worker A pre-acquiring `cart:$CART_ID` in Redis with TTL >= 30 seconds.
- **Evidence collection (read out-of-band and from API/DB):**
  - Wall-clock execution timer: assert Worker B's attempt blocks for 5.0 seconds plus or minus 0.5 seconds before rejecting.
  - Workflow error class & code: assert `MedusaError.Types.CONFLICT` with code `"LOCK_TIMEOUT"` and message `"Cart checkout lock timeout"` thrown at workflow boundary (HTTP 409 route is not exercised).
  - PostgreSQL database before/after state diff:
    - Assert `cart_checkout_session.epoch and current_attempt_id are unchanged before/after` (verifying `db-before.sql` matches `db-after.sql` for `cart_checkout_session`).
    - Assert exactly 0 new rows in `cart_batch_reservation` for the cart under test.
    - Assert exactly 0 new reservation rows in Medusa native inventory/reservation tables (e.g. `reservation_item`), verifying native inventory checks remain bypassed.
  - Redis out-of-band key inspection: assert `cart:$CART_ID` remains owned by Worker A and was not overwritten or released by Worker B.
- **Evidence directory and artifacts:**
  - Directory: `artifacts/tp-evidence/TP-03/` (as specified in `docs/phase1-tp-execution-register.md`)
  - Artifacts:
    - `result.json`: metadata, status, commit SHA, exit code.
    - `stdout.log` & `stderr.log`: raw terminal output.
    - `db-before.sql` & `db-after.sql`: pre- and post-execution database query snapshots showing untouched `cart_checkout_session.epoch`, untouched `current_attempt_id`, and zero rows in `cart_batch_reservation` and native reservation tables.
    - `assertions.json`: assertions on timeout duration, `MedusaError(CONFLICT, LOCK_TIMEOUT)` workflow mapping, `cart_checkout_session.epoch and current_attempt_id are unchanged before/after`, zero reservations across custom and native tables, and preserved Worker A lock.
- **Blocking conditions (marked blocked instead of passed):**
  - Checkout workflow not implemented in `apps/backend`.
  - `LockTimeoutError` unhandled or returned as unexpected error instead of `MedusaError(CONFLICT, LOCK_TIMEOUT)`.
  - Worker B bypassing the lock or Worker A's lock being improperly overwritten.
  - State mutations (modifying `cart_checkout_session.epoch`, altering `current_attempt_id`, or creating rows in `cart_batch_reservation`) occurring before lock acquisition succeeds.
  - Simulating the timeout with mock timers instead of actual concurrent Redis contention.

### Lifecycle notes and owner default assumptions
- **Initial creation of `cart_checkout_session` [DEFAULT-ASSUMPTION, owner may change]:**
  `cart_checkout_session` is NOT created at cart creation. The first checkout attempt creates it using `INSERT ... ON CONFLICT (cart_id) DO UPDATE`, so the initial insert sets `epoch = 1`, `status = 'in_progress'`, and `current_attempt_id`, while subsequent checkout attempts increment the `epoch`. For TP-02a and TP-03 execution, the first checkout attempt manages this lifecycle transition according to this assumption.

### DML Model vs Design Schema Comparison (`cart_checkout_session`)

Medusa v2 Data Modeling Language (`model.define`) generates MikroORM schema definitions that diverge in specific column representations from the raw SQL schema specified in `docs/data-model.md` §3.1. To preserve design semantics while maintaining framework model compatibility, a baseline migration (`Migration20261026000001_CreateCartCheckoutSession`) creates the initial table, a semantic guard migration (`Migration20261026000002_AddCartCheckoutSessionSemanticGuards`) enforces design constraints, and a corrective migration (`Migration20261026000003_ConvertEpochToIntegerAndDropRawEpoch`) aligns `epoch` with `model.number()` as `INTEGER` without auxiliary columns:

| Column Name | Design Type (`docs/data-model.md` §3.1) | DML Generated Type (`toMikroOrmEntities`) | Semantic Reconciliation & Guard |
|---|---|---|---|
| `cart_id` | `VARCHAR(255) PK` | `text NOT NULL PK` | Generated as `text` by `model.text().primaryKey()`. Reconciled in PostgreSQL via check constraint `CONSTRAINT chk_ccs_cart_id_len CHECK (char_length("cart_id") <= 255)`. |
| `current_attempt_id` | `UUID NOT NULL` | `text NOT NULL` | Generated as `text` by `model.text()`. Reconciled in PostgreSQL via regex check constraint `CONSTRAINT chk_ccs_current_attempt_id_uuid CHECK ("current_attempt_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`. |
| `epoch` | `INTEGER NOT NULL, DEFAULT 1` [DEFAULT-ASSUMPTION] | `integer NOT NULL DEFAULT 1` | Generated as `integer` by `model.number().default(1)`. Reconciled via `Migration20261026000003` with check constraint `CONSTRAINT chk_ccs_epoch_positive CHECK ("epoch" >= 1)`. Eliminates the `raw_epoch` JSON column. Recorded as [DEFAULT-ASSUMPTION, owner may change: owner may revert to BIGINT if 2B limit is insufficient]. |
| `status` | `VARCHAR(32) NOT NULL DEFAULT 'in_progress'` + `chk_ccs_status` | `text NOT NULL DEFAULT 'in_progress'` + anonymous check | Generated by `model.enum(...)`. Reconciled in PostgreSQL via explicit named constraint `CONSTRAINT chk_ccs_status CHECK ("status" IN ('in_progress', 'completed', 'aborted', 'failed'))`. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | `timestamptz NOT NULL DEFAULT now()` | Semantically identical. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | `timestamptz NOT NULL DEFAULT now()` | Semantically identical. |
| `deleted_at` | *(Not in design document)* | `timestamptz NULL` + partial index | Injected by Medusa DML entity builder for soft-deletable entities. Safely defaults to NULL without affecting design invariants. |

- **Default Assumption on Epoch Type [DEFAULT-ASSUMPTION, owner may change]:**
  Following owner direction, `CartCheckoutSession` in DML uses `model.number().default(1)`, which produces a clean PostgreSQL `INTEGER` column and eliminates `raw_epoch`. `docs/data-model.md` §3.1 reflects `epoch INTEGER [DEFAULT-ASSUMPTION]`. If the 2-billion attempt threshold per cart is ever deemed insufficient, the owner may change this assumption back to `BIGINT`.

### Supplementary baseline checks (not TP cases)

These baseline diagnostic checks were used during early scaffold validation. They do **NOT** have TP IDs and **NEVER** count as TP acceptance evidence. All 59 canonical TP rows in `docs/implementation-plan.md` remain strictly independent and unchecked.

- **Baseline framework boot check:**
  - Verifies that `@medusajs/framework` initializes cleanly, loads configured modules, and instantiates the container without loader or TypeScript errors.
  - Script: `apps/backend/scripts/check-framework-boot.mjs` (status: to be created).
  - Scope: developer sanity verification only; not a TP row.
- **Baseline custom DML model & migration check:**
  - Verifies that Medusa v2 Data Modeling Language (`model.define`) generates valid schemas and applies migrations cleanly against disposable PostgreSQL.
  - Script: `apps/backend/scripts/check-dml-crud.mjs` (status: to be created).
  - Scope: developer sanity verification only; not a TP row.

### Current execution status for initial compatibility tests
- **TP-02a (Distributed Cart Lock Acquisition):** Executed once against the real Medusa container and disposable PostgreSQL/Redis services; hardened runtime evidence pending independent review. Implementation plan checkbox remains strictly unchecked `[ ]`.
- **TP-01 (Cart Creation with Batch Variant):** Not yet executed. Checkbox remains strictly unchecked `[ ]`.
- **TP-03 (Concurrent Cart Lock Rejection):** Executed once against the real Medusa container and disposable PostgreSQL/Redis services (workflow-level only, partial; HTTP-level 409 is NOT exercised); evidence pending independent review. Implementation plan checkbox remains strictly unchecked `[ ]`.
- **Canonical TP Checkboxes:** All 59 TP rows in `docs/implementation-plan.md` remain strictly `[ ]`.

### Referenced repository paths summary
- Existing files in `apps/backend`:
  - `apps/backend/medusa-config.ts` (exists)
  - `apps/backend/package.json` (exists)
  - `apps/backend/tsconfig.json` (exists)
  - `apps/backend/src/index.ts` (exists)
  - `apps/backend/src/modules/locking-redis/` (exists)
  - `apps/backend/src/modules/batch-inventory/` (exists)
  - `apps/backend/src/workflows/steps/acquire-lock.ts` (exists)
  - `apps/backend/src/workflows/test-tp02a-workflow.ts` (exists)
  - `apps/backend/src/workflows/stage2-checkout-lock-workflow.ts` (exists)
  - `apps/backend/scripts/check-locking-redis.mjs` (exists)
  - `apps/backend/scripts/check-locking-redis-edge-cases.mjs` (exists)
  - `apps/backend/scripts/check-stage2-lock-negative-control.mjs` (exists)
  - `apps/backend/scripts/test-tp02a-distributed-lock.mjs` (exists)
  - `apps/backend/scripts/test-tp03-concurrent-lock-rejection.mjs` (exists)
- Files to be created for subsequent TP execution:
  - `apps/backend/scripts/test-tp01-cart-creation.mjs` (to be created)
  - `apps/backend/scripts/check-framework-boot.mjs` (to be created)
  - `apps/backend/scripts/check-dml-crud.mjs` (to be created)
