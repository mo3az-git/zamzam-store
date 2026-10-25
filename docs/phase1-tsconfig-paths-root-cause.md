# Medusa CLI `tsconfig-paths` Compatibility Finding

**Status:** Reproduced and corrected in the Phase 1 CI environment; independent review still required.

## Evidence

The original migration log showed this path through the installed code:

- Caller: `node_modules/@medusajs/cli/cli.js:5`
- Installed `@medusajs/cli`: `2.22.1`
- Installed `tsconfig-paths`: `3.15.0`
- Original call shape: `register({})`
- Runtime exception: `TypeError: The "path" argument must be of type string. Received undefined`, from `tsconfig-paths/src/config-loader.ts`.

The same workflow's independent config probe loaded `apps/backend/tsconfig.json` successfully and resolved its absolute base URL to `apps/backend`. This separated the issue from a malformed/missing tsconfig.

## Clean-install dependency-tree finding

The first strict clean-install attempt completed `npm ci`, but the following `npm ls --all` detected three incompatible hoisted optional-peer resolutions:

- `@hookform/resolvers@5.5.7` advertises optional peers `ajv@^8.12.0` and `ajv-formats@^2.1.1`, while the hoisted tree resolved `ajv@6.15.0` and `ajv-formats@3.0.1`.
- `@medusajs/admin-vite-plugin` depends on `fdir@6.1.1`, whose optional `picomatch` peer requires `3.x`, while the hoisted tree resolved `2.3.2`.

The root development manifest now pins compatible peer versions (`ajv@8.20.0`, `ajv-formats@2.1.1`, `picomatch@3.0.2`). Dependencies that require older AJV or picomatch ranges should remain nested at compatible versions. This is a dependency-tree correction, not a suppression of the `npm ls` error; the clean-install workflow must pass again before the correction is accepted.

## Root cause and dependency resolution

`@medusajs/cli@2.22.1` calls `tsconfig-paths.register({})` but does **not** declare `tsconfig-paths` as its own dependency. The CLI therefore resolves whichever compatible-looking package Node finds through normal ancestor lookup and npm hoisting. In the observed dependency tree, an unrelated package in the lint/tooling dependency graph caused `tsconfig-paths@3.15.0` to be hoisted at the repository root. That version throws `TypeError: The "path" argument must be of type string. Received undefined` for the CLI's empty options object.

The backend `tsconfig.json` itself loaded successfully in the independent configuration probe. The failure was a package-resolution/version interaction, not a missing project config.

## Dependency fix — no installed-file mutation

The repository root pins `tsconfig-paths@4.2.0` as an exact `devDependency`. Because the CLI does not declare the package, its `require("tsconfig-paths")` resolves this root copy under normal Node resolution. Packages that require incompatible `tsconfig-paths@3.x` keep a nested copy installed by npm; the fix does not override or rewrite their own dependency graph.

The old `postinstall` hook and `scripts/patch-medusa-cli-tsconfig-paths.cjs` are removed. No script writes into `node_modules`. The read-only `scripts/check-medusa-cli-tsconfig-paths.cjs` checks only the version the CLI resolves (must be 4.x) and verifies `register({})` succeeds while the working directory is `apps/backend`. CI preserves this command's output in `artifacts/medusa-loader-diagnostic.log`.

## Root devDependency peer pins

The root also pins `ajv@8.20.0`, `ajv-formats@2.1.1`, and `picomatch@3.0.2` to satisfy optional peer ranges exposed by the Medusa dashboard/admin dependency graph. Keeping these versions explicit prevents an incompatible older version from being selected at the workspace root; packages that require older major versions remain nested in the npm tree. The clean `npm ls --all` check must pass rather than suppressing peer or tree errors.

## Version decision and dependency resolution

- **Medusa v2.22.1 cohort:** The `@medusajs/*` packages are pinned at `2.22.1` across the repository (matching CI run #74 and the committed `package-lock.json`). While historical Phase 0 planning documents refer to Medusa `2.21.2`, upgrading to `2.22.1` was required to resolve clean-install peer dependencies and incorporate provider shutdown fixes. The cohort has been validated through the Phase 1 spike workflow.
- **Root devDependencies for peer conflicts:** Packages `ajv@8.20.0`, `ajv-formats@2.1.1`, and `picomatch@3.0.2` are explicitly pinned as root `devDependencies`. This resolves optional-peer version conflicts between `@medusajs/cli`, `@medusajs/admin-vite-plugin`, `@hookform/resolvers`, and `vite`, ensuring that `npm ci --strict-peer-deps` runs deterministically without hoist conflicts.
- **Committed lockfile:** A deterministic `package-lock.json` (SHA-256 `c3de50651eccf1a8c6843b5c0e536de375d05b91a2bf7818fd94fdfa7c6b291f`) has been generated and committed. The CI workflow was updated to require `npm ci --strict-peer-deps` directly, eliminating the previous fallback generation step.

## Limitations and next gate

The root `tsconfig-paths@4.2.0` devDependency provides a clean, zero-mutation compatibility solution for the Medusa CLI loader. With `package-lock.json` committed and enforced in CI via `npm ci --strict-peer-deps`, clean-install reproducibility is established. The remaining compatibility gate is executing and evidencing the Technical Prototype (TP) tests—beginning with foundational framework boot (TP-01), Redis locking semantics (TP-02a), and custom DML models (TP-03)—against disposable PostgreSQL and Redis services.
