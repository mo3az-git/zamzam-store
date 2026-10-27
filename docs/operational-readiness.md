# Zamzam Store operational readiness (nonproduction)

**Decision: NOT READY for production.** This review is a deployment preparation artifact only. It does not authorize a release, merchant transaction, or canonical Technical Prototype (TP) acceptance. TP-01 was not run; no canonical acceptance state was changed.

## Assessment

| Area | Observed evidence | Readiness / required action |
|---|---|---|
| Build and CI | npm workspaces, lockfile v3, lint/build and disposable Postgres/Redis integration workflow exist. Consolidated workflow currently runs on selected branch pushes/manual dispatch, not pull requests. | Good nonproduction foundation. Add the PR trigger and static ops preflight in this change. Pin CI Postgres/Redis service images by digest as compose does. Keep workflow permissions read-only. |
| Runtime / dependencies | `.nvmrc`, root engine and lockfile specify Node 24.22.1 / 24.22.x; Medusa packages 2.22.1, Next 15.5.28, React 18.3.1; Postgres 16.15 and Redis 7.2.16 are pinned by digest in local compose. | Pins are internally aligned; the integration workflow still uses floating major/minor service tags. Compatibility is only as strong as green CI on the exact proposed SHA. |
| Deployment | No production deployment workflow or infrastructure-as-code is present in the reviewed paths. | Hosting topology, regions, network boundaries, autoscaling, TLS, WAF/CDN, and deployment ownership remain to be selected and reviewed. No release performed. |
| Environments | Local examples and CI ephemeral service profile exist. No verified preview/staging/production accounts, secret stores, or promotion gates are defined. | Keep each environment isolated. Preview access must remain protected; preview/staging use synthetic data and provider simulators only. Production is blocked until gates below are signed off. |
| Environment validation | Medusa config requires production Redis URLs and 32-character JWT/cookie secrets; local fallbacks exist outside production. `DATABASE_URL` is passed through without an explicit production-required check. | Add fail-closed validation for DB URL, TLS requirements, allowed origins, and secret rotation policy before release. Never copy local or CI secrets into a hosted environment. |
| Secrets | `.env` is ignored and `.env.example` labels values local-only. CI contains fixed fake values for disposable services. | Keep CI values synthetic and scoped. Use a managed secret store, least-privilege service identities, rotation, audit trails, and redacted incident access. No secrets in artifacts/logs/issues. |
| PostgreSQL | Compose uses a named volume and readiness probe. CI migrates an ephemeral database. | Production needs private managed PostgreSQL, TLS, encrypted storage, HA/PITR, tested restore, connection limits/pooling, alerting, and a migration identity separate from the runtime role. Set and approve RPO/RTO first. |
| Redis | Compose enables AOF and a named volume, with ping health check; no auth is configured locally. Redis is used for sessions/cache and distributed checkout locks. | Production needs private authenticated TLS Redis, capacity/eviction policy, availability monitoring, persistence policy, and an explicit recovery plan. Loss of lock/session state must fail closed; do not treat Redis as the inventory/order system of record. |
| Migrations | CI applies Medusa and custom-module migrations to disposable PostgreSQL. A dedicated isolated rollback test exists. | Production sequence: backup/restore point → deploy backward-compatible expand migration → verify schema → deploy app → verify → later contract cleanup. Never run `down` against production as an automatic rollback. Data-destructive or lossy downs require a separately reviewed forward repair. |
| Health / telemetry | Compose checks Postgres readiness and Redis ping. No application-specific readiness route or production telemetry provider was found in the reviewed source. | Provide external HTTPS synthetic check plus app liveness/readiness. Readiness should validate DB and required Redis dependencies with bounded timeouts; liveness must not restart-loop on a transient dependency outage. Alert on errors, saturation, queue lag, DB pool, Redis, and backup freshness. |
| Business operations | Checkout/inventory/payment/shipping code and CI-focused checks exist, but green tests do not establish production operations or merchant approval. | Keep orders, COD, electronic payments, and shipping disabled until explicit acceptance gates and staffed procedures are in place. |

## Environment configuration matrix

| Setting / control | Development | Preview | Staging | Production |
|---|---|---|---|---|
| Data | Disposable local fixtures | Synthetic, isolated per preview | Synthetic or anonymized; isolated project/account | Merchant-approved live data only after release gate |
| Database / Redis | Compose local services | Dedicated isolated services; no shared production state | Production-like managed services and restore drill | Private managed HA services, TLS, backups/PITR, least privilege |
| Secrets | `.env` copied from examples; local-only values | Scoped secret store, unique per environment, no production secrets | Unique staging secret set; sandbox credentials only | Managed secret store, rotation/audit, no CI or preview reuse |
| External effects | Disabled/simulated | Disabled/sandbox; no public preview | Provider simulators/sandbox; no real dispatch/charge | Disabled until merchant/provider approvals, then explicitly enabled |
| Access | Developer workstation | Protected preview; authenticated allowlist | Staff only, MFA | Least privilege, MFA, audited break-glass |
| Deploy/migrate | Manual local | Automated checks; no production promotion | Approved staged rollout after checks | Manual approval gate, one immutable SHA, no direct branch deploy |
| Data retention | Resettable | Short-lived; purge on preview deletion | Defined and periodically purged | Approved legal/merchant retention policy and deletion process |

Required environment variables include `DATABASE_URL`, `REDIS_URL`, `LOCKING_REDIS_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, and storefront backend/public publishable-key settings. Public `NEXT_PUBLIC_*` values must contain no private credentials. Validate allowed origins exactly; do not use wildcard CORS for authenticated/admin APIs. Runtime and migration credentials must be distinct.

## Monitoring and structured logging

### Health checks and alerts

- **Liveness:** process/event loop responds; no downstream network checks. Restart only after repeated liveness failure.
- **Readiness:** bounded PostgreSQL query and Redis ping/lock-provider connectivity, migration/schema version, and app startup completion. Return non-ready during failed initialization or incompatible schema.
- **Synthetic:** protected nonproduction HTTPS GET of storefront landing/catalog plus backend health. Do not submit carts, create orders, reserve inventory, send messages, charge, or call shipping labels.
- **Signals:** request rate, error rate, latency percentiles; Node heap/event loop; DB connections, lock waits, deadlocks, disk, replication/PITR age; Redis memory, evictions, rejected connections, persistence/replication; background job retries/lag; backup age and last restore drill.
- **Initial alert policy:** page on sustained checkout/API failures, DB/Redis unavailability, suspected duplicate order/payment or inventory mismatch, exhausted storage, or missed backup objective. Ticket on rising latency/error budget, queue lag, and expiring certificates/secrets. Set thresholds from measured staging baselines before production.

### Log event contract

Emit one JSON object per event: `timestamp`, `severity`, `service`, `environment`, `version` (commit SHA), `event`, `request_id`, `correlation_id`, `trace_id`, `duration_ms`, `outcome`, and safe entity references. Propagate request/correlation IDs across storefront BFF, backend, workers, and provider adapters. Use stable event names and bounded-cardinality labels; never log credentials, access tokens, cookies, full addresses, phone/email, payment instrument data, OTPs, claim codes, or raw idempotency keys. Hash/pseudonymize any operational reference that could identify a person; enforce retention and access controls.

| Domain | Suggested events and safe fields |
|---|---|
| Inventory | `inventory.reservation.created|rejected|converted|released`, SKU/internal batch ID, quantity, reservation/order internal ID, reason code, ledger transaction ID. Never expose customer data. Alert on negative available quantity, duplicate ledger key, and reconciliation mismatch. |
| Checkout | `checkout.attempt.started|replayed|conflict|reconciled`, attempt ID, cart internal ID, idempotency outcome (not key), state transition, lock wait, correlation ID. Alert on stale pending attempts and unknown order correlation. |
| Shipping | `shipping.quote.requested|rejected|selected|dispatch_blocked`, normalized governorate code, quote/provider ID, service class, outcome and latency. No recipient name/address/phone or label URL/token. |
| Payments | `payment.intent.created|authorized|failed|voided|refund_requested|reconciled`, provider reference in restricted/pseudonymized form, method class, amount/currency, idempotency outcome, state transition. Never log PAN/CVV/bank secrets, webhook signatures, or payment tokens. Alert on duplicate/unknown settlement and reconciliation drift. |

## Backup, restore, rollback, and incident runbooks

### Backup and restore

1. Before production design approval, set business-approved RPO/RTO, retention, encryption/key custody, residency, and restore authority.
2. Configure automated encrypted PostgreSQL backups plus point-in-time recovery and monitor last successful backup/replication lag. Back up only what the recovery design requires; Redis persistence is not a substitute for PostgreSQL backups.
3. Restrict backup access separately from runtime access; audit reads and test immutable/off-account copies if supported.
4. At least quarterly and before a material release, restore to an isolated environment, verify schema/migration state, order/inventory ledger consistency, representative read paths, and measured recovery time. Never restore over production as a drill.
5. Keep a restore record: source backup/point, operator/approver, target isolation, checksums, duration, validation results, and cleanup confirmation. Purge drill data securely.

### Deployment and rollback

1. Confirm Draft PR review, exact commit SHA, green required CI, approved change window, on-call owner, backup freshness, and no open incident. Confirm merchant/payment/shipping launch gates separately.
2. Deploy the same immutable artifact/SHA to protected staging; run health, read-only catalog, DB/Redis, and synthetic UI checks. No live side effects.
3. For a future production change, take/verify recovery point; apply backward-compatible migrations once using the migration identity; wait for completion; deploy application; verify health and business invariants. Do not run migration commands concurrently from app replicas.
4. If app checks fail, stop rollout and route traffic back to the last known-good application artifact only when the current schema remains backward-compatible. Preserve evidence and data; disable affected feature flags. Never automatically execute a database `down` migration.
5. If schema/data compatibility is uncertain, halt writes/checkout under the approved incident procedure, preserve database state, and use a reviewed forward-fix or point-in-time recovery plan. PITR may lose writes after the recovery point and requires incident commander/merchant approval.
6. Reconcile orders, reservations, inventory ledger, payments, and dispatch records before restoring affected actions. Record SHA, migration IDs, timeline, impact, decision, and verification.

### Incident response

1. Declare severity and incident commander; page backend, database, security, and merchant operations owners as relevant. Preserve UTC timeline and correlation IDs.
2. Contain safely: disable affected checkout/payment/shipping capability or place the storefront into read-only mode. Do not manually release inventory or retry charges/dispatches while outcomes are ambiguous.
3. Preserve logs/metrics/audit records with access controls; avoid copying secrets or customer data into chat/tickets. Rotate a credential only when exposure is suspected and follow dependency rotation order.
4. Establish authoritative state from PostgreSQL and provider reconciliation. Resolve unknown checkout/order/payment/shipping outcomes before retry, cancellation, refund, or reservation release.
5. Recover using the rollback/restore decision tree above; require a second operator for data restore or settlement-affecting action. Validate invariants and synthetic checks before re-enabling a capability.
6. Notify affected parties through approved channels, complete a blameless timeline/root-cause and corrective-action review, and retain evidence under the approved policy.

## Production blockers and approvals

- Infrastructure provider, account ownership, region/data residency, network model, WAF/CDN, certificates, deploy identity, scaling limits, and cost ceilings are not established in this repo.
- No confirmed production secret store, separate migration identity, managed PostgreSQL HA/PITR, managed Redis availability/persistence, central log/trace/alert destination, or on-call rotation/runbook ownership.
- RPO/RTO, retention/deletion, restore frequency, capacity/load baseline, SLOs, alert thresholds, incident severity/communications, and disaster-recovery authority require owner approval.
- Merchant must approve product/catalog content, inventory source and reconciliation, pricing/tax/invoicing rules, order fulfillment process, returns/refunds, customer support, privacy/retention, and launch window.
- Payment provider/merchant underwriting and production credentials, webhook verification/replay process, settlement/refund reconciliation, and explicit electronic-payment activation approval are missing.
- COD collection/remittance, refusal/return, reconciliation, courier contract, service zones/rates, label/dispatch workflow, and explicit shipping activation approval are missing.
- No live orders, COD, electronic payments, or shipping may be enabled until the merchant and operational owners approve those gates and a separate release authorization is recorded.

## Safe validation coverage

`node scripts/ops-readiness-check.mjs` is a local/static check: it validates the tracked runtime pins, local-only env examples, and disposable Compose service safety without connecting to services or printing values. The consolidated CI will run it on pull requests and branch pushes. Existing nonproduction workflow covers migrations/build plus storefront and isolated integration checks; those results are not production approval, formal TP acceptance, or evidence for TP-01.
