# Phase 0 Technical Review & Architecture Remediation Report
## Project: Arabic-First E-Commerce Store for Imported Food Products (Egypt)
**Document Status:** Revision 19 — Electronic Payment + COD and Phase 0 Design Closure (Design Revision; Runtime Unverified)  
**Date:** 2026-10-25  
**Inventory Ledger Task 1.1 Decision:** `DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`  
**Architectural Decision:** **`PHASE 0 DESIGN CLOSURE DEFINED; CROSS-DOCUMENT REVIEW/SIGN-OFF PENDING`**  
*(Phase 0 closes on design/documentation consistency and recorded owner decisions only. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. A restricted Spike may run before Phase 0 sign-off; store feature development remains blocked pending evidence review and launch gates.)*

---

## 1. Executive Decision and Honest Technical Summary

### 1.1 Current Decision: `PHASE 0 DESIGN CLOSURE DEFINED; CROSS-DOCUMENT REVIEW/SIGN-OFF PENDING`

Revision 19 records the current design state for electronic payment plus COD, refund approval/override controls, Phase 0 design closure, and the inventory-ledger/checkout/return/version-replay contracts carried forward from Revision 18. The changes address identified design defects on paper, but no local compatibility build, database migration, concurrent transaction test, or external payout test has been executed as part of this revision. The candidate package cohort remains provisional, and all current custom mechanisms remain `[PROPOSED]` until the required evidence is produced.

**Inventory-ledger Task 1.1 status:** `DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`. This is a documentation-level result only. The updated design corrects cleanup replay/state-divergence handling, defines conversion recovery as complete-state validation rather than movement-only replay, supplies an operation-level schema cross-reference, adopts bounded SHA-256 operation keys, and separates database privilege testing from trigger testing. All prototype tests remain unexecuted. The inventory-ledger contract was first revised in Revision 15; Revision 16 retained it as documentation-only (historical), and Revision 19 carries it forward while extending the surrounding checkout, return, refund, payment, version, and acceptance contracts. Cross-document consistency is not a substitute for executable validation; all affected workflows remain `[PROPOSED]` and must be audited against the current files.

However, in strict compliance with the **Anti-Overclaiming, Evidence Discipline, and Honest Technical Reporting Rules**:
1. **Phase 0 closure is design/documentation based.** All eight Phase 0 acceptance criteria remain explicitly unchecked (`[ ]`); closure requires consistent documents and recorded owner decisions, not runtime evidence.
2. **A limited Phase 1 Technical Compatibility Spike may run before Phase 0 sign-off.** It is restricted to compatibility/evidence work and the documented TP scenarios; store feature development remains blocked.
3. **Spike boundary:** The Spike may scaffold only what is necessary to evaluate package compatibility and execute documented evidence scenarios. It may not implement storefront/catalog/checkout features or broaden into general store development.
4. **Evidence boundary:** A documented API does not prove integration correctness; theoretical lock analysis does not prove runtime concurrency safety. Install/build/migration/concurrency/restore evidence remains assigned to the Phase 1 Spike and launch gates. No evidence is claimed executed in this revision.



### 1.2 Inventory Ledger Task 1.1 Closeout Boundary (Documentation Only)

**Historical-version warning:** Sections below that cite `@medusajs/*@2.22.1` record claims and source inspections from earlier revisions only. Historically, Revision 16 did not use those claims as proof for its then-candidate `2.21.2` cohort. Current compatibility remains `[PROPOSED]` until the candidate packages are installed, inspected, locked, and built.

The inventory ledger task is **not runtime-closed**. The documentation now has an explicit cross-domain locking hierarchy, but the actual PostgreSQL interleavings remain pending. The closure does not establish runtime correctness, absence of deadlocks, or successful integration with Medusa/MikroORM. Prototype scenarios TP-06a/b, TP-07a/b, TP-09/10/11, TP-24a and TP-24c-A/B remain unchecked. If execution reveals a violation, reopen Task 1.1 and preserve the failed evidence; do not silently rewrite expected results to match behavior.

---

## 2. Severity-Ranked Issue Register (Historical Findings; Revision 19 Current Design Corrections)

| Issue ID | Severity | Original Review Issue | Current Documented Correction (Revision 19; prior revision notes are historical) | Affected Documents | Validation Tier | Closure Evidence Required |
|---|:---:|---|---|---|:---:|---|
| **ISSUE-01** | **Critical** | **Separate Redis Lock from PostgreSQL Lease:** Revision 11 called lock and lease "coordinated" without a renewal mechanism. Heartbeat updated DB even if Redis lock was lost. | Explicit separation: Redis cart lock TTL 120s with 30s heartbeat calling `extendLock` Lua command in `@medusajs/locking-redis`. If Redis lock lost, worker aborts immediately and refuses to update PostgreSQL. CAS abort deletes pending lease on lock timeout. | `architecture.md`, `order-and-inventory-workflows.md`, `security-and-deployment.md`, `risk-and-assumptions.md` | `[PROPOSED]` / `[SOURCE-VERIFIED]` | Execution of TP-02b and TP-02c under simulated delays and Redis lock loss. |
| **ISSUE-02** | **Critical** | **Safe Cart Mutation Protection Policy:** Mutation guard stopped blocking `in_progress` sessions when timestamps aged past 120s without an active abort action. | Enforced strict policy: mutations strictly rejected (409 Conflict) while session is `in_progress`. Timestamp aging does NOT authorize mutation. Mutation permitted only after explicit recovery controller verifies lease is dead (>120s), increments epoch, and sets session to `aborted`. | `architecture.md`, `order-and-inventory-workflows.md`, `security-and-deployment.md` | `[PROPOSED]` | Execution of TP-04a and TP-04b with logged terminal output. |
| **ISSUE-03** | **Critical** | **Immutable Attempt Entity (`cart_checkout_attempt`):** Storing mutable `order_id` on session allowed races where stale workers cancelled newer attempt orders. | Created `cart_checkout_attempt` to retain attempt history, lease ownership, and order association. A worker must establish authoritative binding, current attempt/epoch ownership, and cancellation eligibility; unknown correlation/outcome enters `needs_reconciliation` and prohibits cancellation, release, or new-order creation. | `architecture.md`, `data-model.md`, `order-and-inventory-workflows.md`, `risk-and-assumptions.md` | `[PROPOSED]` | Execution of TP-08b and TP-15b. |
| **ISSUE-04** | **Critical** | **Complete Reservation-to-Allocation Conversion:** Conversion used zero affected rows as sole diagnostic without distinguishing failure types. | Conversion row-locks session, attempt, and active unexpired reservations (`expires_at > NOW()`). Validates exact reservation counts and line keys, inserts allocations and movements in the same transaction, and transitions reservations to `status = 'converted'`. Diagnostic error codes distinguish stale attempts, expired reservations, missing rows, and quantity mismatches. | `architecture.md`, `data-model.md`, `order-and-inventory-workflows.md` | `[PROPOSED]` | Execution of TP-09, TP-10, and TP-15a. |
| **ISSUE-05** | **Critical** | **Canonical 7-Checkpoint Crash Recovery Matrix:** Conflated distinct durable checkpoints and lacked single source matrix. Ambiguity on reservation retention. | Formulated Authoritative 7-Checkpoint Crash Recovery Matrix (CP-1 to CP-7). Standardized on retaining converted reservations permanently as `status = 'converted'`, excluding them from expired cleanup crons. | `order-and-inventory-workflows.md`, `security-and-deployment.md`, `implementation-plan.md` | `[PROPOSED]` | Execution of TP-13a through TP-13g. |
| **ISSUE-06** | **Critical** | **Four-Actor Dual-Control Refund Lifecycle:** Stored only 2 actor columns, omitted payout operator/reconciler, and lacked safe recovery for uncertain external outcomes. | Added `requested_by`, `approved_by`, `disbursed_by`, and `reconciled_by`, with completion requiring four distinct actors. Return/refund application mutation order is order-scoped advisory lock -> return request -> COD record -> refund intent -> payout attempts; trigger-internal native order row locks are defense-in-depth. Completion requires a submitted child attempt whose reference and independent reconciler match the parent refund record. Unknown outcomes reserve capacity and prohibit blind resend. | `data-model.md`, `order-and-inventory-workflows.md`, `security-and-deployment.md`, `risk-and-assumptions.md` | `[PROPOSED]` | Execution of TP-21a through TP-21f and TP-22a/b. |
| **ISSUE-07** | **Critical** | **Return Triggers & Reactivation Protection:** Item insert raced with parent request status change. Multi-row items in reactivated requests were not aggregated, causing over-return bypass. | Parent request row-locked `FOR SHARE` during item insert; row-level and statement-level insert guards aggregate same-statement rows by order version, line, and batch; reactivation aggregates all request rows. Direct/invalid completion is rejected; customer-return completion requires finalized inspection, a frozen owner-policy-derived amount, and exact reconciled refund total. Completed requests and return-item identity/quantity are immutable. | `data-model.md`, `order-and-inventory-workflows.md`, `risk-and-assumptions.md` | `[PROPOSED]` | Execution of TP-23a through TP-23f. |
| **ISSUE-08** | **High** | **Deterministic 10-Branch Idempotency Semantics:** Inconsistency regarding expired completed keys when row remained present in DB. | Fully codified all 10 expiration and replay branches: expired rows still physically present return stored response (200 OK) with `X-Idempotency-Status: replayed-expired`. Completed carts reject retries with 409 Conflict even after cron deletion. | `security-and-deployment.md`, `data-model.md`, `order-and-inventory-workflows.md` | `[PROPOSED]` | Execution of TP-14a and TP-14b. |
| **ISSUE-09** | **High** | **Historical package-version assertion:** Prior revisions assumed one uniform `2.22.1` cohort. | This is a historical claim only and is superseded for the current design. The current Revision 19 design retains direct-package `2.21.2` as a provisional candidate; its full peer/dependency graph, lockfile, installation, and builds have not been verified. | `architecture.md`, `implementation-plan.md` | `[PROPOSED — CURRENT COHORT UNVERIFIED]` | Capture current package metadata, commit lockfile, install and build the candidate cohort. |
| **ISSUE-10** | **Medium** | **Canonical TP ID Registry:** Disagreement between Implementation Plan and Summary on test subcase IDs. | Revision 19 carries the canonical TP registry TP-01 through TP-24c and adds TP-25a through TP-25d for payment failure/abandonment, webhook idempotency/order/signature handling, payment/order-creation compensation, and partial refund/gateway timeout. | `implementation-plan.md`, `phase-0-review-summary.md` | `[PROPOSED]` | Successful execution of prototype suite. |
| **ISSUE-11** | **Critical** | **Inventory Movement Ledger Contract & Concurrency Gaps (Task 1.1):** Ambiguous single delta column, unisolated snapshot capture in conversion SQL, lock ordering inversion between cleanup and checkout, missing pre-mutation deduplication check, absence of ledger immutability trigger. | Reconciled `inventory_movement` schema with 3 independent integer deltas (`quantity_on_hand_delta`, `quantity_reserved_delta`, `quantity_quarantined_delta`), required 6 balance snapshots with non-negativity and tri-balance check constraints. The inventory batch-before-child rule was documented in Revision 15/16; the Revision 18 design superseded its incomplete scope with a cross-domain hierarchy carried forward in Revision 19, including order-associated checkout and return-trigger paths. Conversion inserts restricted strictly to `:validated_cbr_ids` and snapshots read directly from locked batch rows. Cleanup workflow revalidates status under lock, uses `candidate.quantity`, permits exact replay only when the reservation is already `expired`, treats an active reservation with an existing cleanup movement as `INVENTORY_LEDGER_RESERVATION_STATE_DIVERGENCE`, and rejects semantic key collisions with 409 Conflict. Enforced database-level append-only immutability via trigger `trg_inventory_movement_immutable` and `REVOKE UPDATE, DELETE, TRUNCATE`. | `data-model.md`, `architecture.md`, `order-and-inventory-workflows.md`, `implementation-plan.md`, `risk-and-assumptions.md`, `security-and-deployment.md`, `phase-0-change-log.md`, `phase-0-review-summary.md`, `phase-0-review-report.md` | `[PROPOSED]` | Execution of TP-06a, TP-06b, TP-07a, TP-07b, TP-09, TP-10, TP-11, TP-24a, and TP-24c. |

---

## 3. Official Source Links & Published Package Versions

All framework claims in Revision 12 were verified against live npm package registry metadata and extracted package source code on **October 24, 2026**:

1. **Medusa v2 Locking Steps & Redis Locking Provider:**
   - Packages: `@medusajs/core-flows@2.22.1` and `@medusajs/locking-redis@2.22.1`.
   - Source Inspection: `redis-lock.js` defines custom Lua commands:
     - `acquireLock`: `SET key ownerId NX EX ttl` (XX extension if owner matches).
     - `extendLock`: Checks `redis.call('GET', key) == ownerId`, calls `EXPIRE key ttl`, returns `1` or `0`.
     - `releaseLock`: Checks `redis.call('GET', key) == ownerId`, calls `DEL key`, returns `1` or `0`.
   - Step Inspection: `acquireLockStep` in `@medusajs/core-flows` skips locking on sub-workflows when `parentStepIdempotencyKey` exists unless `executeOnSubWorkflow: true`.
2. **Medusa v2 Order Module Schema & Join Models:**
   - Package: `@medusajs/order@2.22.1` (`models/order-item.js` and `models/line-item.js`).
   - Verification: `Order` entities link to `OrderLineItem` records via `OrderItem` join entity (`order_item.order_id` and `order_item.item_id = order_line_item.id`). Ordered quantity resides on `order_item.quantity: BigNumber`.
3. **Live npm Registry Status (Queried Oct 24, 2026):**
   - `@medusajs/framework`: version `2.22.1`, dist-tag `latest: 2.22.1`, engines: `{ node: ">=22.22.0" }`.
   - `@medusajs/medusa`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/core-flows`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/order`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/locking-redis`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/types`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/js-sdk`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/cli`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - `@medusajs/utils`: version `2.22.1`, dist-tag `latest: 2.22.1`.
   - Node.js LTS: Local environment is `v24.15.0`; target production runtime is `24.22.1` Maintenance LTS (both `>=22.22.0`).
   - Next.js: `15.5.28` (Maintenance LTS release stream).

---

## 4. Cross-Document Consistency Matrix (Historical Revision 15 Snapshot; Current Design Carried Forward in Revision 19)

| Topic | Architecture | Data Model | Workflows | Security | Risks | Implementation | Change Log | Summary | Report | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Inventory Movement Ledger Contract** | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Redis Lock vs DB Lease Separation** | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Cart Mutation Guard Policy** | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Immutable Attempt Entity (`cart_checkout_attempt`)** | Aligned | Aligned | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Canonical 7-Checkpoint Crash Recovery Matrix** | Aligned | N/A | Aligned | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Converted Reservation Retention Policy** | Aligned | Aligned | Aligned | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Return Triggers & Reactivation Protection** | Aligned | Aligned | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Four-Actor Dual-Control Refund Lifecycle** | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Deterministic 10-Branch Idempotency Semantics** | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |
| **Candidate Medusa direct-package cohort (`2.21.2`)** | Aligned | N/A | N/A | Aligned | N/A | Aligned | Aligned | Aligned | Aligned | `PROPOSED — INSTALL/BUILD REQUIRED` |
| **Launch Gates 1 through 6** | N/A | Aligned | N/A | N/A | Aligned | Aligned | Aligned | Aligned | Aligned | `OWNER-DECISION` |
| **Review Decision: NOT READY** | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | Aligned | `CONSISTENT` |

---

## 5. Authoritative 7-Checkpoint Crash Recovery Matrix

| Checkpoint | Last Known Operation | Durable Database State | Native Medusa Order | Attempt-Order Association | Authoritative Attempt & Epoch | Operational & COD Records | Recovery Action | Permitted Mutations | Prohibited Operations | Outcome | Test ID |
|---|---|---|:---:|:---:|---|:---:|---|---|---|:---:|:---:|
| **CP-1: Pre-Reservation** | Crash during or before CBR creation. | `idempotency_key` (`status='pending'`); `cart_checkout_session` (`epoch=E`, `status='in_progress'`); 0 CBR rows. | **No** | None | Attempt A uncommitted. If lease expired (>120s), new Attempt B claims lease. | None | **Compensate Old Attempt:** Advance session epoch to `E+1`, create Attempt B, execute fresh FEFO reservation. | Insert CBR rows for Attempt B. Increment epoch to `E+1`. | Do not complete cart under old attempt A. | Succeeded with new order, or 409 if out of stock. | `TP-13a` |
| **CP-2: Post-Reservation, Pre-Order** | CBR committed; crashed before native order creation. | `idempotency_key` (`status='pending'`); `cart_batch_reservation` (`status='active'`, `attempt=A`); no native order. | **No** | None | Attempt A valid until CBR expiry (15m). If lease expired, Attempt B claims lease. | None | **Fence Old & Re-reserve:** Attempt B advances session epoch to `E+1`. Releases Attempt A reservations via canonical hashed `reservation_release`/`cleanup` keys. Reserves fresh stock. | Release old CBR; insert new CBR; advance epoch to `E+1`. | Do not execute native order creation under old attempt A. | 201 Created under Attempt B. | `TP-13b` |
| **CP-3: Order Creation Started, Outcome/Association Unresolved** | Attempt status committed as `order_creation_started`; native invocation result may be unknown. | Attempt has `attempt_status='order_creation_started'` and `order_correlation_status='pending_correlation'`; order may exist without a written binding. | **Unknown until queried** | Pending | Query orders by `cart_id`; no metadata assumption. | None until correlation is definitive | Bind only one order to one unresolved current attempt; zero with unknown invocation waits; multiple candidates stop for reconciliation. | No second order, epoch advance, release, or cancellation during uncertainty. | Resume after correlation; otherwise manual reconciliation. | `TP-13c` |
| **CP-4: Post-Association, Pre-Conversion** | Order is authoritatively correlated; crash occurred before conversion transaction committed. | Native `Order` exists; `cart_checkout_attempt.order_id` bound; CBR (`status='active'`); 0 allocations. | **Yes** | Exists (`correlated`) | Attempt A, Epoch E. | None | **Resume Guarded Conversion:** If reservations remain unexpired, resume the guarded conversion over the exact validated set. If expired/superseded, the recovery controller may cancel only the definitively correlated order under an authoritative cancellation policy. | Release stock only after cancellation/compensation is definitively confirmed and the inventory ledger transition commits. | Never recreate the order. If binding/cancellation is uncertain, mark `needs_reconciliation`, retain the inventory/epoch fence, and do not release stock or start another order. | 201 Created if resumed; 409/503/202 for definitive cancellation or uncertainty according to the API contract. | `TP-13d` |
| **CP-5: Post-Conversion, Pre-Downstream** | Conversion committed; crashed before operational/COD record initialization. | Native `Order` exists; CBR (`status='converted'`); `order_batch_allocation` rows exist; `cart_checkout_session` (`status='completed'`); operational/COD absent. | **Yes** | Exists (`correlated`) | Attempt A, Epoch E. | Absent | **Initialize Downstream:** Core stock conversion is complete. Initialize missing `order_operational_state` (`status='new'`) and `cod_collection_record` (`status='unpaid'`). | Insert `order_operational_state`, insert `cod_collection_record`. | **NEVER alter inventory balances or re-convert allocations!** | 201 Created with order summary. | `TP-13e` |
| **CP-6: Post-Downstream, Pre-Idempotency** | Downstream initialized; crashed before `idempotency_key` marked completed. | All commerce, operational, and financial records exist and are consistent; `idempotency_key` (`status='pending'`). | **Yes** | Exists (`correlated`) | Attempt A, Epoch E. | Present (`new`, `unpaid`) | **Finalize Idempotency Key:** Update `idempotency_key` to `status='completed'` with response payload. Mark `cart_checkout_attempt` completed. | Update `idempotency_key` to `status='completed'`. | Zero inventory, order, or operational changes. | 201 Created with stored response. | `TP-13f` |
| **CP-7: Post-Completion Replay** | Idempotency finalized; client retried request or network stalled during response. | All records consistent; `idempotency_key` (`status='completed'`). | **Yes** | Exists (`correlated`) | Attempt A, Epoch E. | Present | **Immediate Safe Replay:** Read stored `response_code` and `response_body`. Return immediately. | Absolutely zero database writes. | Zero state mutations. | 200/201 Immediate Replay. | `TP-13g` |

---

## 6. Revision 12 Independent Findings

During the Revision 12 independent audit, the following findings, source investigations, and concrete corrections were established:

### 6.1 Separation of Redis Lock from PostgreSQL Lease
- **Finding:** Describing Redis locks and DB leases as "coordinated" merely because both had 120s TTL created false security. Heartbeats updated PostgreSQL without proving that the Redis lock was still held. Furthermore, if Redis lock acquisition timed out, the pending lease remained orphaned.
- **Correction:** Established explicit separation: Redis cart lock TTL is 120s (`acquireLockStep`). Active workers execute a synchronized 30s background heartbeat. In each tick, the worker calls Redis `extendLock("cart:" + cart_id, worker_owner_id, 120)`. If Redis returns `0` (lock lost) or fails, the worker trips an `AbortController` and refuses to update PostgreSQL. If lock acquisition times out (>5s), worker CAS deletes the pending lease before returning 409 Conflict.
- **Validation Tier:** `[PROPOSED]` / `[SOURCE-VERIFIED]`. Requires TP-02b and TP-02c execution.

### 6.2 Safe Cart Mutation Guard Policy
- **Finding:** Cart mutation guards stopped blocking `in_progress` sessions when `locked_at` was older than 120s. Timestamp aging authorized mutations directly while checkout might still be active.
- **Correction:** Cart mutations require acquiring the Redis cart lock and querying `cart_checkout_session`. If `status = 'in_progress'`, mutation is strictly blocked (409 Conflict). Timestamp aging NEVER authorizes mutation directly. Mutation is allowed only after an explicit recovery controller verifies that the lease is dead (>120s), increments the epoch, and sets session status to `aborted`.
- **Validation Tier:** `[PROPOSED]`. Requires TP-04a and TP-04b execution.

### 6.3 Immutable Attempt Entity (`cart_checkout_attempt`)
- **Finding:** Storing mutable `order_id` directly on `cart_checkout_session` allowed newer attempts to race with stale workers cancelling orders, and made recovery after crashes ambiguous.
- **Correction:** Created `cart_checkout_attempt` to record attempt history, lease ownership, attempt status, and order association. Stale workers verify `cart_checkout_attempt.order_id === :order_id` before invoking `cancelOrderStep`, ensuring a stale worker can never cancel an order owned by a newer attempt.
- **Validation Tier:** `[PROPOSED]`. Requires TP-08b and TP-15b execution.

### 6.4 Complete Reservation Conversion Transaction
- **Finding:** Conversion used "zero affected rows" as the sole diagnostic for all conversion failures, masking whether a failure was caused by stale attempts, expired reservations, missing rows, or quantity mismatches.
- **Correction:** Conversion step row-locks session, attempt, and active unexpired reservations (`expires_at > NOW()`). Validates exact reservation counts and line keys, inserts allocations and movements in the same transaction, and transitions reservations to `status = 'converted'`. Diagnostic error codes distinguish `STALE_CHECKOUT_ATTEMPT`, `RESERVATIONS_EXPIRED`, `MISSING_RESERVATIONS`, `QUANTITY_MISMATCH`, and `PARTIAL_ALLOCATION_MISMATCH`.
- **Validation Tier:** `[PROPOSED]`. Requires TP-09, TP-10, and TP-15a execution.

### 6.5 Converted Reservation Retention Policy
- **Finding:** Documentation conflicted on whether converted reservations remain in the database or are deleted.
- **Correction:** Unified on retaining converted reservations permanently as `status = 'converted'` with `converted_at TIMESTAMPTZ`. They are never deleted upon conversion and are excluded from expired cleanup crons (`status = 'active' AND expires_at < NOW()`), providing a permanent audit trail.
- **Validation Tier:** Policy Alignment.

### 6.6 Four-Actor Dual-Control Refund Lifecycle
- **Finding:** `refund_record` stored only `operator_id` and `supervisor_id`, omitting the actual disbursement operator and reconciler. Concurrency races existed during intent creation. Nondeterministic encryption ciphertexts could cause replay hash mismatches.
- **Correction:** Added explicit columns: `requested_by`, `approved_by`, `disbursed_by`, `reconciled_by` with check constraint `chk_refund_actors`. Refund-intent creation locks `return_request` first and then `cod_collection_record`; all refund capacity checks run under that order/return lock order. Stable keyed HMAC `recipient_fingerprint` ensures hash stability under fresh AES-256-GCM nonces. A submitted payout requires a nonempty `external_reference`; unknown external outcomes retain refund capacity and prohibit blind resubmission.
- **Validation Tier:** `[PROPOSED]`. Requires TP-21a through TP-21f and TP-22a/b execution; unknown provider outcomes and four-way actor separation remain untested.

### 6.7 Return Triggers & Reactivation Protection
- **Finding:** Return-item inserts could race with parent return-request status changes. Reactivation triggers checked items one at a time, failing to aggregate multiple rows for the same line and batch within the reactivated request.
- **Correction:** Parent request row-locked `FOR SHARE` during item insert; rejects insert if parent is terminal. Reactivation trigger aggregates return items by `(line_item_id, batch_id)` before checking limits. Rejects direct transitions to `completed`. Terminal completed returns are immutable.
- **Validation Tier:** `[PROPOSED]`. Requires TP-23a through TP-23f execution.

### 6.8 Deterministic 10-Branch Idempotency Semantics
- **Finding:** Inconsistency regarding expired completed keys when row remained present in DB before cron cleanup.
- **Correction:** Codified all 10 expiration and replay branches: expired rows still physically present return stored response (200 OK) with `X-Idempotency-Status: replayed-expired`. Completed carts reject retries with 409 Conflict even after cron deletion.
- **Validation Tier:** `[PROPOSED]`. Requires TP-14a and TP-14b execution.

### 6.9 Historical Revision 18 Inventory Movement Ledger Remediation (Carried Forward in Revision 19)
- **Finding:** In Revision 13, cleanup locked batches before reservations (`ORDER BY id ASC`), whereas conversion locked reservations before joining batches without locks, creating deadlock vulnerabilities (`40P01`). Conversion SQL joined `inventory_batch` without snapshot isolation. Conversion inserts used broad attempt IDs rather than `:validated_cbr_ids`. Cleanup lacked pre-mutation deduplication checks, and the ledger lacked database-enforced immutability.
- **Correction:** The Revision 18 design defined the cross-domain order advisory/session/attempt/batch/child-row hierarchy, carried forward in Revision 19. This supersedes the earlier inventory-only statement and remains `[PROPOSED]` until PostgreSQL concurrency tests execute. Conversion uses only `:validated_cbr_ids`, inserts informational movements from batch rows locked earlier in the transaction, and requires complete-state validation for recovery. Cleanup accepts replay only when the reservation is already `expired` and the semantic movement matches; an active reservation paired with an existing movement is a state divergence, not a silent repair. Added a database trigger for `UPDATE`/`DELETE` rejection and separate app-role revocation of `UPDATE`, `DELETE`, and `TRUNCATE`. TP-24c defines separate permission and trigger subcases. These are documented contracts only; all tests remain unchecked (59 listed rows in the current plan).
- **Validation Tier:** `[PROPOSED]`. Requires TP-06a, TP-06b, TP-07a, TP-07b, TP-09, TP-10, TP-11, TP-24a, and TP-24c execution.

---

## 7. Explicit Unresolved Project-Owner Decisions (Launch Gates 1 to 6)

Production sales must remain disabled until the Business Owner formally signs off on all six of the following launch gates:

1. **Gate 1: Zamzam Water Authenticity and Labeling Verification — blocks launch only:** Written confirmation that packaging, source, and distribution comply with applicable Egyptian consumer protection and export requirements. Product copy must remain factual without unverified origin or health claims.
2. **Gate 2: Date Packaging and Production Date Inspection — blocks launch only:** Physically verify that stamped expiration dates and lot numbers match inventory batch records.
3. **Gate 3: Egyptian Governorate Delivery Rate Matrix — blocks launch only:** Approve final flat shipping rates per governorate in `shipping_delivery_zone` (major EGP units).
4. **Gate 4: Commercial Terms, Legal Policies & Food Return Policy — decided, with open parameters:** The system computes a proposed refund from return items, item price, shipping share, and goods-condition rules. An admin may approve or override it; every override records reason and approver, and `approved_refund_amount` freezes after approval. `Owner input required`: should shipping be refunded, fully or proportionally? What deduction, if any, applies to opened items? Item-price/tax treatment and undelivered-electronic-order policy also need explicit owner input. Arabic legal terms still require approval/review.
5. **Gate 5: Database Disaster Recovery Verification Drill — blocks launch only:** Execute a staging backup-and-restore drill and retain reproducible query output joining through `order_item`. This is operational launch evidence, not a Phase 0 design-closure prerequisite.
6. **Gate 6: Electronic Payment + COD — decided, with open parameters:** The MVP offers electronic payment and COD side by side. `Owner input required`: which electronic payment gateway should be selected for the MVP? No provider is selected in this revision.

---

## 8. Precise Statement of What Remains Unverified

In accordance with Engineering Rule 9 (Claim Discipline):

1. **Historical source/document observations only (not current-candidate integration proof):**
   - Earlier revisions inspected Medusa v2 core locking step types (`AcquireLockStepInput`, `ReleaseLockStepInput`) in `@medusajs/core-flows@2.22.1`.
   - Earlier revisions inspected Redis locking provider custom commands (`acquireLock`, `extendLock`, `releaseLock`) in `@medusajs/locking-redis@2.22.1`.
   - Nested workflow lock skip behavior when `parentStepIdempotencyKey` is present in that earlier source.
   - Earlier source inspection of the Medusa v2 Order Module schema and `OrderItem` join relationship (`@medusajs/order@2.22.1`).
   - Medusa v2 Fulfillment Module major currency unit representation for calculated shipping.
   - Built-in payment provider ID (`pp_system_default`) and manual authorization behavior.
   - Medusa Remote Links (`defineLink`) architecture.
   - Historical observations of Node.js 22/24 support timelines and npm package releases. Prior claims that `@medusajs/framework@2.22.1` was the current `latest` are superseded and are not used to select the current Revision 19 candidate cohort.
2. **What remains UNVERIFIED in code (`[PROPOSED]` — to be proven in TP-01 through TP-25d):**
   - Clean `npm run build` and runtime behavior across Next.js 15.5.28, React/react-dom 19.3.1, and the candidate Medusa v2.21.2 cohort in this monorepo workspace. This has not yet been executed.
   - Real-world database performance of `ORDER BY id ASC FOR UPDATE` during high-concurrency checkout and cleanup races under the 7-step lock ordering rule.
   - Database trigger immutability enforcement (`trg_inventory_movement_immutable`) and snapshot arithmetic validation under production workloads.
   - PostgreSQL trigger execution performance under concurrent multi-line return and reactivation requests.
   - Storefront layout rendering in React 19 / Next.js 15 under Arabic RTL viewports.
   - Physical courier delivery success rates and cash remittance turnaround times in Egypt.
3. **Execution Commitment:**
   No capability labeled `[PROPOSED]` will be promoted to `[VALIDATED-TEST]` until the corresponding test scenario has physically executed and generated verifiable log output.

---

## 9. Deliverable Index

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


---

## 7. Revision 19 Current-State Addendum (Revision 18 Lock-Order Design Carried Forward)

This Revision 19 current-state addendum supersedes older package-currentness and checkout-correlation claims in the historical review sections above. Earlier version/source inspections are historical investigation records; they do not prove compatibility with the current Revision 19 candidate cohort.

### 7.1 Medusa workflow contract
- Correct input shape is specified as `completeCartWorkflow.runAsStep({ input: { id: cart.id } })`; no unsupported sibling-level `metadata` input is relied on.
- Attempt state is committed as `order_creation_started` / `pending_correlation` before native invocation. Correlation uses `cart_id` and exactly one unresolved attempt. Unknown outcomes do not trigger order recreation, epoch advancement, reservation release, or cancellation.
- Status: `[PROPOSED]`; TP-08a, TP-08b, TP-13c remain unchecked.

### 7.2 Returns
- The historical Revision 18 lock-order design, carried forward in Revision 19, uses a shared order-scoped advisory root lock for compliant custom writes. Return request creation/quantity validation must not later acquire batch locks in the same transaction; physical stock return/quarantine/restock follows order advisory -> return-request root -> sorted batch rows -> child rows. Refund/disbursement remains a separate non-inventory transaction. Allocations and return requests record `order_version`. Version matching is used for order item and allocation checks. Completed requests are immutable across all fields; return item identity and quantity cannot be rewritten. Completion requires finalized inspection, a frozen supervisor-approved refund amount, and the exact reconciled refund total (or `collection_failed` for an undelivered depot return). The system-computed refund decision is recorded under Gate 4; shipping-refund and opened-item deduction parameters remain `Owner input required`.
- Application write paths must acquire the shared order-scoped advisory lock before row-level mutation; trigger-internal native order row locks remain defense-in-depth. Ordinary app writes must not bypass the workflow. Row-level triggers do not justify a zero-deadlock claim; concurrency tests remain mandatory.
- Status: `[PROPOSED]`; TP-23a-f remain unchecked.

### 7.3 Refunds
- `refund_disbursement_attempt` durably tracks each external payout attempt. `disbursement_unknown` reserves refund capacity and prevents blind resend. Completion requires a unique requester, approver, disburser, and reconciler; the idempotency conflict path fails closed if no row is returned.
- Manual transfer at-most-once execution cannot be guaranteed if the provider has no idempotency API; uncertain outcomes require evidence-based reconciliation.
- Status: `[PROPOSED]`; TP-21/22 remain unchecked.

### 7.4 Versions and response replay
- Exact target candidate cohort: Medusa framework/server/CLI/SDK `2.21.2`, Node `24.22.1`, Next `15.5.28`, React/react-dom `19.3.1`, PostgreSQL `16.15`, Redis `7.2.16`. Package metadata and npm tags vary across publish timing; package existence does not prove peer-compatible installation.
- Required but unexecuted: `npm view` metadata capture, lockfile commit, `npm ci`, dependency-tree audit, backend and storefront builds, migrations, and TP execution.
- Initial claim code is transient; durable idempotency response is sanitized. Replay preserves order/status identity but intentionally does not reproduce the one-time claim code or initial response body byte-for-byte.

### 7.5 Acceptance
- The A-I document-level review checks are added to `implementation-plan.md`; none are accepted yet. All TP status markers remain `[ ]`.
- Phase 0 closes on design/documentation consistency and recorded owner decisions only; cross-document review/sign-off remains pending. Runtime evidence is deferred to the Phase 1 Spike. All criteria and TP markers remain unchecked (`[ ]`).


### 7.6 Historical Revision 18 Lock-Order Reconciliation (Carried Forward in Revision 19)
- **Documentation decision:** The former inventory-only lock sequence did not explicitly reconcile existing-order checkout conversion with return/refund trigger locking. The Revision 18 design historically added one cross-domain rule in `architecture.md` §7.2, `data-model.md` §5.4, and `order-and-inventory-workflows.md` §6.2, plus per-operation sequences in `phase-0-change-log.md` §4.4.
- **Order-root serialization:** Existing-order custom workflows use the same transaction-scoped advisory key before row-level mutation; if cart session/attempt rows are also involved, order advisory precedes them. A proven pre-order transaction locks session/attempt only and must commit before native order creation.
- **Inventory rows:** Batch IDs are discovered non-lockingly and all affected batches are locked by ascending ID before reservation/allocation child rows in transactions that mutate stock.
- **Return/refund boundary:** Return validation, physical return stock mutation, and refund disbursement/reconciliation are separate transactions. This distinction is required for the documented lock order.
- **Execution attempt:** Actual compatibility tests were not run. This workspace has no application source repository/package manifest/lockfile, no implemented TP harness, and no PostgreSQL or Redis service. A static audit of Markdown is not a substitute for package installation/build, migrations, or real concurrency execution.
- **Current decision:** `TASK 1.1 DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`. The lock protocol remains runtime-unverified; this does not prevent Phase 0 design closure because runtime evidence belongs to the Phase 1 Spike.


## Historical Revision 18 Runtime Evidence Note (Evidence Boundary Retained in Revision 19)

The return/inventory lock-order specification has been revised to separate return-request creation/state validation from physical return-stock mutation, and the `return_item` UPDATE trigger no longer takes native order/order-item locks in the batch-first path. This is a documentation-level lock-order correction only. The supplied workspace does not contain the application repository, package lockfile, migrations, test harness, or configured PostgreSQL/Redis services; consequently no package build, migration, trigger execution, concurrency test, or TP compatibility test has been run here. The cross-domain concurrency gate remains OPEN pending Phase 1 Spike evidence; this runtime gate does not itself block Phase 0 design closure.