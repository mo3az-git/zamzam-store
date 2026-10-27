# Zamzam Store — Owner-Authorized MVP-First Policy (October 27, 2026)

Source: [PR #20](https://github.com/mo3az-git/zamzam-store/pull/20) `b7ab7e67c88af9836bbdbf37b19f29a85ada91d6`.

The following section is **copied from PR #20** and is also incorporated into `docs/implementation-plan.md`. If text elsewhere conflicts with this amendment about permission to begin MVP feature development, apply this current policy. This does **not** approve live checkout or release.

## Owner Decision — MVP-First Delivery Policy (2026-10-27)

**Decision:** Prioritize a functioning MVP before exhaustive formal TP execution. This amendment supersedes earlier text **only where it blocks development solely because the entire 59-case TP suite has not passed**; other architecture, compliance, and safety restrictions remain in force.

- **Development gate:** Phase 2 catalog/Arabic UI and later MVP workstreams may start in isolated feature branches and draft PRs. Incremental builds, linting, targeted component/API tests, and integration checks relevant to changed code continue. Prevent regressions rather than requiring every unrelated TP case for each feature.
- **High-risk workflows:** Before integrating or demonstrating an operable real checkout, verify critical order uniqueness, EGP total correctness, reservation/stock invariants, concurrency/idempotency, payment callback signature and authorization, compensation and failure-path handling, as applicable. Simulators are not production payment proof.
- **Formal TP gate:** Preserve exactly 59 canonical cases and untouched acceptance markers. Schedule the complete suite for hardening/pre-release after MVP integration; do not label deferred tests as passed. **TP-01 stays unauthorized** and may not be run or disguised as a differently named test. The formal all-59 gate remains unresolved until a later, separate owner decision about TP-01; this policy does not silently waive it.
- **Release gate:** No public launch, real customer transactions, production payment enablement, or claimed operational readiness until formal acceptance, security/concurrency/recovery checks, required regulatory/content/operational launch gates, and explicit owner release approval are recorded. Deployment of isolated nonproduction previews is distinct from release.
- **Branch discipline:** Existing PRs remain draft; do not merge, rebase other owners' branches, alter historical test evidence, or tick acceptance checkboxes without explicit authorization. Track deferred work in a separate backlog and label incomplete evidence honestly.
