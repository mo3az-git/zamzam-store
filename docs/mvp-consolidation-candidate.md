# MVP Consolidated Candidate — Integration Review (2026-10-27)

**State: draft and isolated; NOT merged to main, NOT production-ready, and NOT a real-customer checkout.**

## Baselines, scope and provenance

| Origin | Exact commit | What was preserved |
| --- | --- | --- |
| Backend PR #19 | `0879ef305cc6c32f9260098188db0ce457973ed1` | Full latest tested backend tree, order/FEFO reservations and conversion, recovery, post-completion COD/simulated-electronic persistence, original CI/test harness, security and migrations |
| Frontend PR #24 | `3a3f3f27129dddec5d00595cae81f20a5c248c93` | Complete `apps/storefront/` tree: bilingual Arabic/English catalog, proper EGP `region_id` pricing context, RTL/LTR, categories, product variants, pages, SEO and targeted tests |
| Owner policy PR #20 | `b7ab7e67c88af9836bbdbf37b19f29a85ada91d6` | MVP-first section applied **to the backend's current implementation plan**, preserving its v2.22.1 / React 18.3.1 candidate pins and existing TP rows |
| Interface PR #25 | `b390cba88378901d3bd7c3266a6fb841bf541cb8` | Strict **proposed-only** response JSON Schema, fail-closed examples and cross-agent handoff |

The content commit records the two application source heads as parents so historical source ancestry remains accessible. The frontend tree is overlaid **only under `apps/storefront/`**, removing the obsolete `app/layout.tsx` and `app/page.tsx` placeholders in the backend. No backend implementation or migrations were replaced by the storefront branch. Existing backend workflows remain historical; a **dedicated targeted integration CI** is added and does not run the formal TP tests.

## Checks and safety boundary

Run against this **specific integrated commit**:
1. Pinned `npm ci`; `node --experimental-strip-types --test apps/storefront/tests/*.test.mjs`.
2. `npm run lint`, `npm run db:migrate` on disposable PostgreSQL + Redis, `npm run build:backend` and `npm run build:storefront`.
3. Proposed schema tests via `python -m unittest discover -s contracts -p 'test_mvp_interface.py' -v`.
4. Further risk-based backend integration testing in disposable services **before exposing new public cart/checkout APIs**. The backend PR #19 has prior full green CI (run 40493938398) on its *own* source head; that is not sufficient to assert end-to-end readiness on this integrated candidate.

**Not implemented by consolidation:** public cart creation/ownership, public batch-availability, safe user-facing checkout API, real electronic gateway or COD collection, cross-app runtime e2e, real guest claim/OTP or customer orders. Frontend remains read-only for purchasing. No client prices or order IDs are accepted as purchase authority.

## Future cleanup (not yet executed)

- Keep PR #19 and PR #24 open as historical source PRs until this integration candidate is independently verified and approved.
- PR #23 has a separate pure quote-validator and test (unique source code) absent from PR #19; evaluate for targeted port, **not** wholesale merge.
- PR #18 proposed planning documents explicitly contain an *outdated phase gate*; review before importing.
- After checks and owner approval, retarget or close stacked Draft PRs in dependency order, preserving any useful unique CI/notes before deleting remote branches.
- TP-01 unauthorized; all 59 formal TP statuses and canonical rows unchanged. No PR merged to `main`.
