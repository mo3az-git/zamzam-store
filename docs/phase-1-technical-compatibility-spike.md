# Phase 1 — Technical Compatibility Spike

**Status:** Baseline compatibility checks passed on Medusa 2.22.1, but the first real-Redis regression failed **4 of 7 checks** in attempt 10. Redis locking is a blocking risk. The candidate lockfile is generated as a CI artifact but not reviewed/committed. All 59 TP behavior cases remain unchecked.  
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

These are observed failures in the current test harness against the selected `@medusajs/locking-redis@2.22.1` candidate. Do not mask them or mark the Redis check as passing. First determine whether each failure reflects the provider implementation or a defect in the harness through focused source inspection and a minimal reproduction; preserve the failing tests as regression cases. If confirmed as provider defects, choose and validate a safe locking strategy before any production checkout or inventory work. The PostgreSQL locking provider is not an automatic fallback and requires equivalent regression checks.

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
| Lockfile committed | Pending; attempt-8 lockfile belongs to Medusa 2.21.2 and must not be reused | Review and commit the regenerated 2.22.1 package-lock.json; switch subsequent CI to `npm ci` |

## 6. Guardrails

1. Do not mark any TP row passed based on documentation, package metadata, builds, migrations, or the registry-integrity script.
2. Do not begin catalog, real checkout/payment, custom inventory behavior, admin features, or production deployment until all 59 TP cases pass with evidence and the transition gate is reviewed.
3. Do not choose a payment gateway. Use a provider simulator for the Spike.
4. Keep production secrets out of the repository. The .env.example file contains local-only placeholders.
5. Any peer conflict, install/migration/build failure, Redis connection issue, or unexplained dependency duplication is a compatibility blocker; do not bypass it using --legacy-peer-deps or force flags.
