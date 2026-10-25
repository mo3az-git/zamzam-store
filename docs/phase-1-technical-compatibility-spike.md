# Phase 1 — Technical Compatibility Spike

**Status:** Scaffold proposed on a review branch; automated runtime evidence pending.  
**Starting commit:** 404bf23275d67cc6274ed567779081c25f676100 (Phase 0 design accepted; runtime unverified).  
**Scope boundary:** initial monorepo scaffold, package/peer metadata, strict dependency resolution, lint/build, and baseline Medusa migrations against a disposable database; then the documented TP cases. No production feature work is included.

## 1. Repository baseline

At the starting commit, Git contained the ten Phase 0 Markdown documents and no application source, package manifests, lockfile, or CI workflow. This branch proposes only a minimal Medusa configuration shell, a Next.js placeholder page, disposable local services, and repeatable validation scripts.

## 2. Candidate package versions

The version pins below are candidates from the project design and public package listings consulted on 2026-10-25. Publishing of an individual version is not proof that the cohort works together.

- Node.js 24.22.1 LTS, published 2026-10-21: https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v24.22.1.md
- Next.js 15.5.28: https://www.npmjs.com/package/next?activeTab=versions
- React 19.3.1 and React DOM 19.3.1: https://www.npmjs.com/package/react?activeTab=versions and https://www.npmjs.com/package/react-dom?activeTab=versions
- Medusa framework/server/CLI and JS SDK 2.21.2: https://www.npmjs.com/package/%40medusajs/framework, https://www.npmjs.com/package/%40medusajs/medusa, https://www.npmjs.com/package/%40medusajs/cli, https://www.npmjs.com/package/%40medusajs/js-sdk
- PostgreSQL 16.15 image digest: https://hub.docker.com/layers/library/postgres/16.15/images/sha256-b0c06b134b08ce49214ebb783d292c7cd9527136f30691408e98d2d40d9a5070?tab=layers
- Redis 7.2.16 image digest: https://hub.docker.com/layers/library/redis/7.2.16/images/sha256-da115d3817f5c0a2c080ea685836bde82bf550bbecdebb12074577ee43926cde

The CI workflow captures exact direct-package metadata (version, peerDependencies, engines), installs with strict peer checks, records the resolved tree, runs lint/build, and applies baseline migrations to disposable PostgreSQL. Package compatibility is not accepted until those steps pass and their logs are inspected.

## 3. First CI attempt and corrective action

Run 1 used commit ca24542b2302fd8509e04aa8bc0d18bc7a726025. The exact package metadata check, TP-registry markup guard, dependency installation with strict peer checks, npm ls --all, and workspace lint all passed. The baseline migration step failed before completing because the Medusa CLI reported that ts-node was missing, then could not load apps/backend/medusa-config. Backend and storefront builds were consequently skipped. This is recorded as a genuine initial failure, not a passing migration.

The scaffold now adds ts-node 10.9.2 and the SWC transpiler support used by the Medusa starter TypeScript configuration. CI must rerun and validate the fix. A successful metadata/install/build run still does not establish the behavior of the 59 TP scenarios.

## 4. Evidence workflow

The workflow at .github/workflows/phase1-spike.yml runs on pushes to main and phase-1 branches, pull requests to main, and manual dispatch. On a bootstrap run it creates a candidate package-lock.json and uploads the file and logs as an artifact. Review the dependency tree and commit the lockfile before treating later npm ci runs as the reproducible path.

The test registry script is a guardrail only: it asserts the presence of exactly 59 unique TP rows with all statuses unchecked. It does not execute or pass a TP behavior test. Redis is provisioned for the spike, but Redis-backed Medusa locking and the detailed TP harness are not implemented in this scaffold.

## 5. Acceptance evidence ledger

| Evidence item | Status | Evidence required |
|---|---|---|
| Main candidate versions published | Source-listed; cohort compatibility unverified | npm metadata captured by CI for exact direct pins |
| Peer metadata and dependency resolution | Passed on first run | Metadata JSON, install log, candidate lockfile, npm ls --all; repeat after changes |
| TP registry markup | Passed on first run | Exactly 59 unique rows remain unchecked; no behavior test executed |
| Backend/storefront lint | Passed on first run | Repeat after changes |
| Medusa backend build | Pending; skipped after migration failure | Zero exit code and CI log |
| Next.js storefront shell build | Pending; skipped after migration failure | Zero exit code and CI log |
| Baseline migrations | Failed on first run due to missing ts-node / config-loader setup | Repeat after correction; success against disposable PostgreSQL and log |
| Redis connection/lock semantics | Pending; not wired into application config | Reproducible connection and locking evidence |
| Native order correlation, inventory atomicity, checkout recovery, payment/webhook/refund behavior, restore | Pending; all 59 TP statuses remain unchecked | Test logs, exit codes, environment/package metadata, database assertions |
| Lockfile committed | Pending first resolution and human review | Reviewed package-lock.json committed; use npm ci thereafter |

## 6. Guardrails

1. Do not mark any TP row passed based on documentation, package metadata, builds, or the registry-integrity script.
2. Do not begin catalog, real checkout/payment, custom inventory behavior, admin features, or production deployment until all 59 TP cases pass with evidence and the transition gate is reviewed.
3. Do not choose a payment gateway. Use a provider simulator for the Spike.
4. Keep production secrets out of the repository. The .env.example file contains local-only placeholders.
5. Any peer conflict, install/migration/build failure, or unexplained dependency duplication is a compatibility blocker; do not bypass it using --legacy-peer-deps or force flags.
