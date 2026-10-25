# Zamzam Store — Phase 1 scaffold

Arabic-first e-commerce for imported packaged Zamzam water and dates in Egypt.

## Current state

- Phase 0 design acceptance is recorded; runtime compatibility and safety are not verified.
- Phase 1 begins with a minimum monorepo scaffold and repeatable compatibility evidence.
- The storefront is a technical placeholder only. No catalog, checkout, payment, inventory feature, admin customization, or production feature work is included.
- All 59 runtime Technical Prototype (TP) rows remain unexecuted and unchecked.

## Candidate toolchain

- Node.js 24.22.1 (see .nvmrc)
- npm workspaces with strict peer-dependency enforcement
- Medusa direct-package candidate cohort 2.22.1 (rerun compatibility CI before acceptance)
- Next.js 15.5.28 with React / React DOM 18.3.1 (shared across both workspaces to keep the hoisted runtime consistent)
- PostgreSQL 16.15 and Redis 7.2.16 images pinned by digest in compose.yaml

These pins are candidates, not a compatibility sign-off. The first CI run generates a candidate lockfile as an artifact; review and commit it before relying on npm ci for subsequent runs.

## Local setup (disposable development data only)

1. Install Node.js 24.22.1 and Docker Desktop / Docker Engine.
2. Copy .env.example to .env and change the local-only password and secrets.
3. Start the local services: `docker compose up -d postgres redis`.
4. Install dependencies: `npm install --strict-peer-deps`.
5. Check registry integrity: `npm run spike:registry`.
6. Check package metadata: `npm run spike:package-metadata`.
7. Run `npm run lint`, then `npm run build`.
8. Apply baseline Medusa migrations: `npm run db:migrate`.

Do not run against production data. Keep production secrets out of the repository. Never bypass conflicts using `--legacy-peer-deps` or force flags.

## Evidence policy

The phase-1-spike workflow and `docs/phase-1-technical-compatibility-spike.md` describe evidence collection. The registry script checks only that 59 unique TP rows exist and remain unchecked; it does not test application behavior. A green metadata/install/build job does not mean the 59 TP behavior cases passed. No TP row may be marked passed without linked logs, exit codes, environment/package metadata, and relevant database assertions. Use a provider simulator only; do not select a payment gateway on the owner's behalf.
