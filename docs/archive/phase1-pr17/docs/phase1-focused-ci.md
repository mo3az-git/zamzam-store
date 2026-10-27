# Phase 1 CI: focused development vs full acceptance evidence

## Developer push behavior
- Pushes to `phase-1/**` use `.github/workflows/phase1-focused.yml`, and the selector `scripts/select-focused-ci.mjs`.
- The selector examines the changed files against the previous push SHA; missing ancestry, unknown paths, shared tests, manifests, workflow changes, and the canonical TP plan **fail closed** to all five focused groups.
- Docs-only changes outside the canonical `docs/implementation-plan.md` select **no behavioral suite**. The selector and its safety tests still run.
- Relevant groups: `locks`, `inventory`, `checkout`, `payment`, and `security`. Each uses disposable PostgreSQL/Redis, migrations, exact npm install, and the existing allowlisted TP evidence runner. Suite jobs can run concurrently, but test cases within a suite remain serial.
- Manual focused run: Actions → **Phase 1 Focused Developer CI** → Run workflow → choose the desired branch and suite. `all` selects all five focused groups; `auto` with no valid push parent conservatively selects all.
- **TP-01 remains unauthorized:** absent from the selector and evidence runner. No focused command executes it.

## Full verification is mandatory before acceptance
- Full `.github/workflows/phase1-spike.yml` now automatically runs for pushes to `main` and pull requests targeting `main`. It is also available via Actions → **Phase 1 Technical Compatibility Spike** → Run workflow on the exact candidate branch.
- Before independent acceptance of a TP, branch promotion/merge, or release, run the **full** workflow on the exact candidate SHA and review its raw logs, real behavioral assertions, DB snapshots, cleanup results, and evidence artifact. **A green focused workflow is never formal TP acceptance or proof of complete runtime compatibility.**
- Full workflow performs builds, dependency metadata/tree checks, rollback, the current TP matrix, and evidence aggregation omitted from the focused path.
- A draft PR targeting a `phase-1/**` base will not automatically trigger the full workflow; the reviewer must manually dispatch it, inspect the run SHA, and record the result. Do not treat a focused CI green badge as sufficient to merge.
- No TP checkbox or the 59-case registry may be changed by these workflows. TP-01 must remain unexecuted, and any resulting full-gate blocker must be reported rather than bypassed.

## Conservative change routing

| Changed area | Minimum focused groups |
|---|---|
| `order-operations/**`, `test-tp05*` | payment |
| Batch inventory ledger, migrations, shared inventory runner | inventory + checkout + payment |
| Other batch-inventory, native order, recovery, reconciliation | inventory + checkout + payment |
| Redis locking, checkout lock, mutation guards | locks + checkout |
| Security and TP-21c fixtures | security |
| Storefront | locks + checkout |
| Unknown/shared build, workflow, registry, or scripts | all five |
| Other docs-only | selector checks only |

The selector contains invariant tests at `scripts/test-focused-ci-selector.mjs`; these run in the planning job before a suite is selected.

## Evidence limitations

- Per-suite logs remain separated in GitHub Actions artifacts named `phase1-focused-<suite>-<sha>`.
- Changed-file routing is a **developer feedback optimization**, not a security proof or a replacement for full regression.
- Any changed interface between Medusa, order records, payment and inventory may warrant manually running other groups or the full workflow.
- This change affects only branches containing the focused workflow and trigger modification; other existing branches keep their old workflow behavior until they explicitly incorporate it.
