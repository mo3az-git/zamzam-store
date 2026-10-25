# Phase 1 — Technical Compatibility Spike

**Status:** Baseline CI checks passed on attempt 7 (package metadata, strict install, lint, disposable PostgreSQL migrations, and both builds); Medusa build still emits a non-fatal CLI config-loader stack trace. TP behavior suite and lockfile review remain pending.  
**Starting commit:** 404bf23275d67cc6274ed567779081c25f676100 (Phase 0 design accepted; runtime unverified).  
**Scope boundary:** initial monorepo scaffold, package/peer metadata, strict dependency resolution, lint/build, and baseline Medusa migrations against a disposable database; then the documented TP cases. No production feature work is included.

## 1. Repository baseline

At the starting commit, Git contained the ten Phase 0 Markdown documents and no application source, package manifests, lockfile, or CI workflow. This branch proposes only a minimal Medusa configuration shell, a Next.js placeholder page, disposable local services, and repeatable validation scripts.

## 2. Candidate package versions

The version pins below are candidates from the project design and public package listings consulted on 2026-10-25. Publishing of an individual version is not proof that the cohort works together.

- Node.js 24.22.1 LTS, published 2026-10-21: https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
- Next.js 15.5.28: https://www.npmjs.com/package/next?activeTab=versions
- React 18.3.1 and React DOM 18.3.1 across both workspaces. Attempt 5 exposed a duplicate React runtime during App Router prerender; the unified pin removed that specific duplicate-version setup, but production-build compatibility still requires a clean CI pass: https://www.npmjs.com/package/react?activeTab=versions and https://www.npmjs.com/package/react-dom?activeTab=versions
- Medusa framework/server/CLI, admin SDK, draft-order plugin, test-utils and JS SDK version 2.21.2: https://www.npmjs.com/package/%40medusajs/framework, https://www.npmjs.com/package/%40medusajs/medusa, https://www.npmjs.com/package/%40medusajs/cli, https://www.npmjs.com/package/%40medusajs/admin-sdk, https://www.npmjs.com/package/%40medusajs/draft-order, https://www.npmjs.com/package/%40medusajs/test-utils, https://www.npmjs.com/package/%40medusajs/js-sdk
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

### Corrective changes in the current revision

- Add baseUrl "." to the backend tsconfig to support the Medusa CLI's tsconfig-paths loader.
- Make @medusajs/draft-order a direct backend dependency and add the peer packages used by the Medusa 2.21.2 default/admin module cohort, while explicitly keeping the backend React 18 / storefront React 19 split.
- Align react-router-dom with the 7.18.2 version required by Medusa Dashboard 2.21.2. The install and backend build now pass.
- Unify React/React DOM at 18.3.1 across backend and storefront, and add a root tsconfig baseUrl for the Medusa CLI loader. Attempt 7 confirms strict installation and both builds pass, but the Medusa config-loader trace still needs investigation.
- Configure projectConfig.redisUrl for local session storage and register the documented Redis Locking Module Provider using LOCKING_REDIS_URL, so the spike does not silently fall back to a fake Redis instance.
- Make the metadata checker robust to string-only npm view responses and remove the workflow-wide `NODE_ENV=development` override; both builds pass in attempt 7. The current follow-up sets `NODE_ENV=production` only for the Medusa build to determine whether this removes the non-fatal CLI config-loader trace.

## 4. Evidence workflow

The workflow at .github/workflows/phase1-spike.yml runs on pushes to main and phase-1 branches, pull requests to main, and manual dispatch. On a bootstrap run it creates a candidate package-lock.json and uploads the file and logs as an artifact. Review the dependency tree and commit the lockfile before treating later npm ci runs as the reproducible path.

The test registry script is a guardrail only: it asserts the presence of exactly 59 unique TP rows with all statuses unchecked. It does not execute or pass a TP behavior test.

## 5. Acceptance evidence ledger

| Evidence item | Status | Evidence required |
|---|---|---|
| Candidate versions published | Source-listed; cohort compatibility unverified | npm metadata captured by CI for exact direct pins |
| Exact direct-pin metadata and peer requirements | Passed on attempt 7 for 19 exact direct-pin entries; no checker failures | Captured metadata JSON and peer requirements in the run artifact |
| Dependency install with strict peer checks | Passed on attempt 7; candidate lockfile is artifact-only and has not yet been reviewed/committed; npm flagged six install scripts outside the current allowScripts policy | Review lockfile, deprecated dependency warnings, and install-script policy; then commit lockfile before relying on `npm ci` |
| npm ls --all dependency tree | Passed on attempt 7 after React/React DOM were aligned to 18.3.1 in both workspaces | Review captured full dependency-tree log for duplicate/runtime issues |
| TP registry markup | Passed on attempt 7 | Exactly 59 unique rows and all remain unchecked; this is registry integrity only, not behavior execution |
| Backend/storefront lint | Passed on attempt 7 | Keep lint evidence with the run artifact |
| Medusa backend build | Exit code 0 on attempt 7, but log contains a non-fatal `ts-node` / `tsconfig-paths` error with an undefined path; latest workflow sets `NODE_ENV=production` for the backend build only and awaits rerun | Successful build plus a clean config-loader log with no unresolved stack trace |
| Next.js storefront shell build | Passed on attempt 7 after removal of the workflow-wide `NODE_ENV=development` override; the build statically rendered `/` and `/_not-found` | Production-build log in the run artifact; repeat with future dependency/config changes |
| Baseline migrations | Passed on attempt 7 against disposable PostgreSQL | Preserve the migration log; app-specific custom-module migrations are not yet implemented or tested |
| Redis connection/locking provider | Migrations passed with locking module configured; explicit lock contention behavior still unverified | Successful lock acquire/release/timeout integration evidence |
| Native order correlation, inventory atomicity, checkout recovery, payment/webhook/refund behavior, restore | Pending; all 59 TP statuses remain unchecked | Test logs, exit codes, environment/package metadata, database assertions |
| Lockfile committed | Pending candidate resolution/review | Reviewed package-lock.json committed; use npm ci thereafter |

## 6. Guardrails

1. Do not mark any TP row passed based on documentation, package metadata, builds, migrations, or the registry-integrity script.
2. Do not begin catalog, real checkout/payment, custom inventory behavior, admin features, or production deployment until all 59 TP cases pass with evidence and the transition gate is reviewed.
3. Do not choose a payment gateway. Use a provider simulator for the Spike.
4. Keep production secrets out of the repository. The .env.example file contains local-only placeholders.
5. Any peer conflict, install/migration/build failure, Redis connection issue, or unexplained dependency duplication is a compatibility blocker; do not bypass it using --legacy-peer-deps or force flags.
