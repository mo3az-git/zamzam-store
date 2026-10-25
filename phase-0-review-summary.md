# Phase 0 Technical Review & Architecture Summary
## Project: Arabic-First E-Commerce Store for Imported Food Products (Egypt)
**Document Status:** Revision 19 — Electronic Payment + COD and Phase 0 Design Closure (Design Revision; Runtime Unverified)  
**Date:** 2026-10-25  
**Authoritative Scope:** Phase 0 Technical Discovery & Architectural Design  
**Inventory Ledger Task 1.1 Decision:** `DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`  
**Executive Review Decision:** **`PHASE 0 DESIGN CLOSURE DEFINED; CROSS-DOCUMENT REVIEW/SIGN-OFF PENDING`**  
*(Phase 0 closes on design/documentation consistency and recorded owner decisions only. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. A restricted Spike may run before Phase 0 sign-off; store feature development remains blocked pending evidence review and launch gates.)*

---

## 1. Executive Overview

This summary synthesizes the architectural decisions, operational protocols, data models, and verification requirements finalized across the Phase 0 design documents for an Arabic-first e-commerce store dedicated to imported packaged food products (packaged Zamzam water and packaged dates) in Egypt.

The system is designed on:
- **Next.js 15.5.28** with candidate `react@19.3.1`, `react-dom@19.3.1`, Tailwind CSS 3.4.17, and TypeScript 5.5.4; peer compatibility and builds remain untested.
- **Medusa v2.21.2 common stable direct-package candidate cohort (compatibility untested)**: `@medusajs/framework@2.21.2`, `@medusajs/medusa@2.21.2`, `@medusajs/cli@2.21.2`, and `@medusajs/js-sdk@2.21.2`. Internal packages are resolved through the package graph and must be inspected in the installed lockfile.
- **Node.js 24.22.1 target LTS**; the earlier `v24.15.0` local-development value is historical and is not evidence of the current Revision 19 build runtime.
- **PostgreSQL 16.15 target** and **Redis 7.2.16 target**; database migrations and lock behavior remain untested.

In strict adherence to the Anti-Overclaiming, Evidence Discipline, and Honest Reporting rules:
- **Phase 0 closure basis:** Design/documentation consistency and recorded owner decisions only. All eight acceptance criteria remain explicitly unchecked (`[ ]`); this summary does not tick any box or claim runtime evidence.
- **Pre-sign-off Spike boundary:** Limited scaffolding and compatibility/evidence work for the documented TP suite is permitted before Phase 0 sign-off. Store feature development is not permitted; installs, builds, migrations, and tests remain unexecuted until actually run and evidenced.
- **Validation Taxonomy Enforced:** Zero claims are marked `[VALIDATED-TEST]` in Phase 0. All untested custom mechanisms are accurately labeled `[PROPOSED]`.

---

## 2. Key Remediated Blockers (Historical Revision 12/13 Findings; Current Design Carried into Revision 19)

| Domain | Issue / Risk Identified | Current Documented Resolution (Revision 19; earlier revisions are history) | Validation Tier |
|---|---|---|:---:|
| **Inventory Movement Ledger Contract (Task 1.1)** | Ambiguous single delta column, conversion snapshot unisolated join, lock ordering inversion between cleanup and checkout, missing pre-mutation deduplication check, absence of ledger immutability trigger. | Adopted canonical 3-delta contract (`quantity_on_hand_delta`, `quantity_reserved_delta`, `quantity_quarantined_delta`), required 6 before/after balance snapshots with non-negativity and tri-balance check constraints. Revised the lock rule to a cross-domain hierarchy: existing-order advisory root before custom row locks; order-before-session/attempt for order-associated checkout; proven pre-order session/attempt before batch; sorted batch locks before inventory child rows; return-stock and refund transactions separated. Restricted conversion allocations and movements strictly to `:validated_cbr_ids`. Read snapshots directly from locked batch rows. Cleanup workflow revalidates status under lock, uses `reservation.quantity`, permits exact replay only when reservation state is already `expired`, treats active-state/movement mismatch as integrity divergence, and rejects semantic key collisions with 409 Conflict. Enforced database-level append-only immutability via trigger `trg_inventory_movement_immutable` and `REVOKE UPDATE, DELETE, TRUNCATE`. | `[PROPOSED]` |
| **Lock & Lease Separation** | Conflating Redis lock with DB lease without renewal mechanism. DB heartbeat updating when Redis lock lost. | Explicit separation: Redis lock TTL 120s with 30s heartbeat calling `extendLock` Lua command in `@medusajs/locking-redis`. If Redis lock lost, worker aborts immediately and refuses to update PostgreSQL. CAS abort deletes pending lease on lock timeout. | `[PROPOSED]` / `[SOURCE-VERIFIED]` |
| **Cart Mutation Guard Policy** | Timestamp aging authorized cart mutation directly while session remained `in_progress`. | Policy enforced: mutations strictly rejected (409 Conflict) while session is `in_progress`. Timestamp aging does NOT authorize mutation. Mutation permitted only after explicit recovery controller verifies lease is dead (>120s), increments epoch, and sets session to `aborted`. | `[PROPOSED]` |
| **Immutable Attempt Entity (`cart_checkout_attempt`)** | Storing mutable `order_id` on session allowed races where stale workers cancelled newer attempt orders. | Created `cart_checkout_attempt` to track attempt history, lease ownership, and order association. A stale worker must validate authoritative order binding, the current attempt/epoch, and explicit cancellation eligibility before any cancellation. If order correlation or cancellation outcome is uncertain, the workflow enters `needs_reconciliation` and must not cancel, release inventory, or create another order. | `[PROPOSED]` |
| **Complete Reservation Conversion** | Conversion used zero affected rows as sole diagnostic without distinguishing failure types. | Conversion row-locks session, attempt, and active unexpired reservations (`expires_at > NOW()`). Validates exact reservation counts and line keys, inserts allocations and movements in the same transaction, and transitions reservations to `status = 'converted'`. Diagnostic error codes distinguish stale attempts, expired reservations, missing rows, and quantity mismatches. | `[PROPOSED]` |
| **Canonical 7-Checkpoint Crash Recovery** | Conflated distinct durable checkpoints and lacked single source matrix. Ambiguity on reservation retention. | Formulated Authoritative 7-Checkpoint Crash Recovery Matrix (CP-1 to CP-7). Standardized on retaining converted reservations permanently as `status = 'converted'`, excluding them from expired cleanup crons. | `[PROPOSED]` |
| **Four-Actor Dual-Control Refund Lifecycle** | Stored only 2 actor columns, omitting payout operator and reconciler. Concurrency races during intent creation. Ciphertext nondeterminism in replays. | Added explicit columns: `requested_by`, `approved_by`, `disbursed_by`, and `reconciled_by`, with completion constraints requiring four distinct actors. Every compliant return/refund mutation acquires the shared order-scoped advisory root before return request -> COD record -> refund record -> payout attempts; database triggers may additionally lock the native order row as defense-in-depth. Runtime lock behavior remains untested. Stable keyed HMAC `recipient_fingerprint` ensures replay hashes remain stable under fresh AES-256-GCM nonces. A submitted payout requires a nonempty external reference; an unknown payout outcome reserves capacity and cannot be resent automatically. | `[PROPOSED]` |
| **Return Triggers & Reactivation Protection** | Item insert raced with parent request status change. Multi-row items in reactivated requests were not aggregated, causing over-return bypass. | Parent request row-locked `FOR SHARE` during item insert; rejects insert if parent terminal. Row-level and statement-level guards aggregate multi-row inserts by `(line_item_id, batch_id)` and order version; reactivation also aggregates the full request. Completion requires finalized inspections, a frozen owner-policy-approved refund amount, and exact reconciled refund total. Direct/invalid completion is rejected; completed requests and return-item identity/quantity are immutable. All remain `[PROPOSED]` until TP-23 executes. | `[PROPOSED]` |
| **Deterministic 10-Branch Idempotency Semantics** | Inconsistency regarding expired completed keys when row remained present in DB. | Fully codified all 10 expiration and replay branches: expired rows still physically present return stored response (200 OK) with `X-Idempotency-Status: replayed-expired`. Completed carts reject retries with 409 Conflict even after cron deletion. | `[PROPOSED]` |
| **Historical package registry claim (superseded)** | Prior revisions asserted a uniform `2.22.1` cohort; those claims are not the selected current Revision 19 baseline. | The current Revision 19 candidate remains direct-package `2.21.2`, pending exact peer metadata, lockfile resolution, install, dependency-tree inspection, and builds; Revision 16 is the historical selection point. | `[PROPOSED — COMPATIBILITY UNTESTED]` |
| **Canonical TP ID Registry** | Disagreement between Implementation Plan and Summary on test subcase IDs. | The canonical TP registry carries TP-01 through TP-24c and adds TP-25a through TP-25d for payment failure/abandonment, webhook idempotency/order/signature handling, payment/order-creation compensation, and partial refund/gateway timeout; all remain unchecked. | `[PROPOSED]` |



### 2.1 Historical Revision 15/16 Task 1.1 Notes — Superseded by Revision 18 and Carried Forward in Revision 19

- Cleanup replay is valid only for an already-`expired` reservation with an exact matching `reservation_release` movement; an active reservation with the same movement is an integrity divergence, not a state transition to repair silently.
- Conversion retries validate the complete committed set of reservation states, allocation rows, and informational movement rows. Atomic rollback means a partial conversion state is treated as integrity divergence, not as an ordinary replay.
- `inventory_movement.deduplication_key` uses `VARCHAR(128)` and the shared `inv:v1:{movement_type}:{sha256hex}` format, whose maximum length is 122 characters.
- TP-24c separates application-role permission checks (including TRUNCATE) from trigger checks for UPDATE/DELETE.
- The implementation plan contains 59 listed test rows; all remain unchecked. No `[VALIDATED-TEST]` evidence was created by this document revision.

See `phase-0-change-log.md` §4.5 for the operation-level SQL-to-schema audit. Phase 0 design closure is defined by documentation consistency and recorded owner decisions; formal cross-document review/sign-off remains pending.

---

## 3. Technical Prototype Gate (Canonical TP ID Registry)

Phase 1 includes a dedicated **Technical Prototype Gate** consisting of 59 listed test rows (including lettered subcases and TP-25a through TP-25d); all remain unchecked:

- **TP-01:** Cart creation with `manage_inventory: false`.
- **TP-02:** Distributed cart locking (`TP-02a`: lock acquisition & sub-workflow skip; `TP-02b`: Redis lock renewal & heartbeat coordination; `TP-02c`: lock timeout CAS lease abort).
- **TP-03:** Concurrent cart lock rejection (409 Conflict on 5s timeout).
- **TP-04:** Cart mutation protection (`TP-04a`: mutation blocked during active checkout; `TP-04b`: mutation rejected after 120s without explicit recovery abort).
- **TP-05:** Built-in payment provider `pp_system_default` evaluation.
- **TP-06:** Batch reservation deduplication (`TP-06a`: multi-line reservation on same batch with unique line keys, 3-delta ledger deltas, and accurate snapshots; `TP-06b`: movement deduplication key replay vs conflicting delta & transaction rollback).
- **TP-07:** Expired reservation cleanup (`TP-07a`: UTC `NOW()`, deterministic `ORDER BY id ASC` batch locks, guarded balance decrements using `candidate.quantity`, canonical hashed `reservation_release`/`cleanup` key, snapshots matching locked batch; `TP-07b`: concurrent cleanup and checkout overlap under the documented 7-step lock ordering (deadlock outcome remains untested), atomic conversion with informational 0-delta movement).
- **TP-08:** Native cart completion and durable attempt correlation (`TP-08a`: `completeCartWorkflow.runAsStep({ input: { id: cart.id } })` after a durable pre-call marker; `TP-08b`: uncertain creation outcome recovered by cart-based order lookup without assuming custom order metadata).
- **TP-09:** Deterministic line-item allocation via `checkout_line_key`, informational `allocation_conversion` movement logging, and ambiguity rejection saga.
- **TP-10:** Split-batch multi-lot deterministic mapping, multi-movement conversion, and integral quantity verification.
- **TP-11:** Saga compensation rollback on simulated step failure, with reservation release movement and balance recovery.
- **TP-12:** Atomic idempotency lease protocol (`TP-12a`: `INSERT ... ON CONFLICT` acquisition & replay; `TP-12b`: stale lease takeover at 120s; `TP-12c`: cross-key cart collision guard).
- **TP-13:** Crash recovery across 7 checkpoints (`TP-13a` through `TP-13g`) with zombie worker fencing and 14-day retention check.
- **TP-14:** Idempotency validation (`TP-14a`: payload hash mismatch rejection; `TP-14b`: post-14-day retention rejection on completed cart).
- **TP-15:** Fencing and stale worker order cancellation safety (`TP-15a`: guarded conversion epoch fencing rejection; `TP-15b`: stale worker must verify authoritative binding, current attempt/epoch, and cancellation eligibility; unknown outcome cannot be cancelled; `TP-15c`: stale worker takeover update rejection).
- **TP-16:** Custom shipping price calculation from `shipping_delivery_zone` returning major units (50 EGP = 50.00).
- **TP-17:** Shipping address governorate change and cart total recalculation.
- **TP-18:** Unsupported governorate shipping rejection.
- **TP-19:** Client-tampered shipping fee resistance.
- **TP-20:** Guest access security (`TP-20a`: atomic single-use claim code exchange via Redis `GETDEL`; `TP-20b`: session cookie `Path=/` and order isolation assertion).
- **TP-21:** Refund Replay & 4-Stage Dual-Control Workflow (`TP-21a`: replay with stored hash; `TP-21b`: replay tampering rejection; `TP-21c`: recipient hash stability under fresh AES nonces; `TP-21d`: 4-stage lifecycle progression; `TP-21e`: separation of duties enforcement; `TP-21f`: mandatory transfer reference).
- **TP-22:** Cumulative refund capacity (`TP-22a`: repeated partial refunds & dynamic capacity guard; `TP-22b`: refund exceeding collected cash capacity rejection).
- **TP-23:** PostgreSQL return triggers (`TP-23a`: `trg_check_return_quantity` enforcement; `TP-23b`: parent return request row lock FOR SHARE; `TP-23c`: illegal direct-completion rejection; `TP-23d`: initial multi-row INSERT aggregation plus reactivation aggregation; `TP-23e`: deterministic lock ordering; `TP-23f`: terminal completed return immutability).
- **TP-24:** Disaster recovery verification (`TP-24a`: schema consistency queries against `"order"`, `order_item`, `order_line_item`, `order_batch_allocation`, `inventory_batch`, and `inventory_movement` ledger invariant audit; `TP-24b`: COD and operational state synchronization; `TP-24c`: append-only movement ledger immutability enforcement via trigger and permission revocation).

---

## 4. Authoritative Product-Owner Launch Gates (Gates 1 through 6)

Production sales must remain disabled until the Business Owner formally signs off on all six of the following launch gates:

1. **Gate 1: Zamzam Water Authenticity and Labeling Verification — blocks launch only:** Written owner confirmation that packaging, source, and distribution comply with Egyptian consumer protection and applicable export requirements. Product copy must remain factual without unverified origin or health claims.
2. **Gate 2: Date Packaging and Production Date Inspection — blocks launch only:** Physically verify that stamped expiration dates and lot numbers match inventory batch records.
3. **Gate 3: Egyptian Governorate Delivery Rate Matrix — blocks launch only:** Owner approval of final flat shipping rates per governorate in `shipping_delivery_zone` (major EGP units).
4. **Gate 4: Commercial Terms, Legal Policies & Food Return Policy — defaults recorded as [DEFAULT-ASSUMPTION]:** Shipping is refunded for merchant-caused returns and not for change-of-mind returns. Opened food/water items are not accepted for change of mind; [DEFAULT-ASSUMPTION] D-4 accepts sealed change-of-mind returns for item price only, without shipping, and the owner may change this default. Opened or sealed items with a defect, damage on receipt, or an expired date receive a full item-price refund plus shipping under the shipping rule. The tax-inclusive item-price basis is the amount actually paid after discounts under [DEFAULT-ASSUMPTION] D-2; owner may change it; see the Default Assumptions Register. An undelivered electronically paid order receives a system-computed full refund (items plus shipping) routed through admin approval/override with an audited reason. [DEFAULT-ASSUMPTION] D-2 sets tax-inclusive paid-amount basis (accountant confirmation before launch); D-3 proposes full items-plus-shipping with no automatic withholding and audited admin override; D-5 requires qualified lawyer review of Arabic policy text before publication. Owner may change these defaults; see the Default Assumptions Register.
5. **Gate 5: Database Disaster Recovery Verification Drill — blocks launch only:** Staging restore drill and documented query evidence joining through `order_item` are required before launch; they are runtime evidence, not Phase 0 design closure.
6. **Gate 6: Electronic Payment + COD — decided, with open parameters:** MVP offers electronic payment and COD side by side. [DEFAULT-ASSUMPTION] D-1: no gateway is selected, and the Phase 1 Spike uses a provider simulator. Vendor selection happens before launch using the criteria in the Default Assumptions Register; owner may change this default.

---

## 5. Phase 0 Design Acceptance Criteria Checklist (Revision 19)

| Criterion | Target Requirement | Status |
|---|---|:---:|
| **1. Architecture & Compatibility (design only)** | Candidate versions, module boundaries, and cart-locking contract documented; package compatibility/build evidence is deferred to the Phase 1 Spike. | `[ ] Pending Owner Review` |
| **2. Authoritative Inventory Strategy** | Tri-state balance model, two-phase reservation with canonical `checkout_attempt_id` and server `checkout_line_key`, immutable attempt history (`cart_checkout_attempt`), movement ledger with dedicated `deduplication_key`. | `[ ] Pending Owner Review` |
| **3. Unified Workflows & State Machines** | Reconciled state machines, separating delivery failure (`undelivered_returned`) from customer returns, non-terminal `partially_returned` / `partially_refunded`, terminal `collection_failed`. | `[ ] Pending Owner Review` |
| **4. Sagas & Crash Recovery** | Orchestrated checkout with compensation, deterministic mapping via `checkout_line_key`, crash recovery across 7 checkpoints, 4-stage Preventive Dual-Control Refund Protocol with complete actor separation. | `[ ] Pending Owner Review` |
| **5. Security & Deployment Specification** | Atomic single-use claim code via Redis `GETDEL`, session cookie (`Path=/`), phone OTP, decoupled 14-day idempotency retention, trusted reverse-proxy IP handling, sanitized audit logging. | `[ ] Pending Owner Review` |
| **6. Risk & Taxonomy Register** | Strict adherence to `[VERIFIED-DOCS]`, `[SOURCE-VERIFIED]`, `[PROPOSED]`, and `[OWNER-DECISION]`. Zero `[VALIDATED-TEST]` in Phase 0. | `[ ] Pending Owner Review` |
| **7. Acceptance Test Plan** | Explicit criteria for Tests A through I, TP-01 through TP-24c, and new payment-related rows TP-25a through TP-25d; 59 listed test rows in total. All remain unchecked. | `[ ] Pending Owner Review` |
| **8. Owner Decisions & Launch Gates** | Documentation is consistent; Defaults D-1 through D-6 are recorded as [DEFAULT-ASSUMPTION] entries that the owner may change; see the Default Assumptions Register. Gates 1, 2, 3, and 5 block launch only. | `[ ] Pending Owner Review` |

---

## 6. Phase 0 Documentation Deliverable Index

All nine canonical Phase 0 documents are located in `docs/`:

1. [Architecture & System Design](architecture.md)
2. [Data Model & Schema Specifications](data-model.md)
3. [Order, Inventory & State Workflows](order-and-inventory-workflows.md)
4. [Security, Privacy & Deployment Architecture](security-and-deployment.md)
5. [Risk Register & Business Assumptions](risk-and-assumptions.md)
6. [Implementation Plan & Phase Breakdown](implementation-plan.md)
7. [Phase 0 Detailed Change Log](phase-0-change-log.md)
8. [Phase 0 Review & Architecture Summary](phase-0-review-summary.md)
9. [Phase 0 Technical Review & Remediation Report](phase-0-review-report.md)


## 7. Revision 19 — Current Workstreams and Phase 0 Design-Closure Status

The following updates address the remaining documentation workstreams but do not claim runtime validation:

- **Medusa order correlation:** use `completeCartWorkflow.runAsStep({ input: { id: cart.id } })`; persist `order_creation_started` before invocation; correlate by `cart_id`; never require unsupported attempt metadata; unknown outcomes stop automatic checkout recovery. `[PROPOSED]`.
- **Return correctness:** save `order_version` in allocations and return requests, define explicit customer/depot return status transitions, create depot requests directly in `pending_inspection` when fulfillment reaches `returned_to_warehouse`, reject direct/invalid completion, freeze completed request rows, and forbid return-item identity/quantity rewrites. Financial completion is independent of restock approval once inspections and exact refund settlement are final. `[PROPOSED]`.
- **Refund safety:** durable `refund_disbursement_attempt`, unknown-outcome status, no automatic resend under uncertainty, distinct requester/approver/disburser/reconciler, fail-closed intent idempotency. `[PROPOSED]`.
- **Version and response contracts:** exact candidate direct pins, pending peer/lockfile/build checks, and intentional distinction between initial transient claim-code response and sanitized idempotent replay. `[PROPOSED]`.
- **Tests A-I:** documented in `implementation-plan.md` as document-level review checks, separate from TP runtime scenarios. All remain unchecked.

**Current decision:** Phase 0 closes on design/documentation consistency and recorded owner decisions only; cross-document review/sign-off remains pending. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. All Phase 0 acceptance criteria and TP statuses remain unchecked (`[ ]`); no runtime test is claimed passed.


## Historical Revision 18 Runtime Evidence Note (Evidence Boundary Retained in Revision 19)

The return/inventory lock-order specification has been revised to separate return-request creation/state validation from physical return-stock mutation, and the `return_item` UPDATE trigger no longer takes native order/order-item locks in the batch-first path. This is a documentation-level lock-order correction only. The supplied workspace does not contain the application repository, package lockfile, migrations, test harness, or configured PostgreSQL/Redis services; consequently no package build, migration, trigger execution, concurrency test, or TP compatibility test has been run here. The cross-domain concurrency gate remains OPEN pending Phase 1 Spike evidence; that runtime gate does not by itself prevent Phase 0 design closure.