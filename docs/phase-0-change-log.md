# Phase 0 Change Log & Technical Review Response (Current Canonical Revision 19; Historical Entries Preserved)
## Project: Arabic-First E-Commerce Store for Imported Food Products (Egypt)
**Document Status:** Revision 19 — Electronic Payment and Phase 0 Design Closure (Design Revision; Runtime Unverified)  
**Date:** 2026-10-25  
**Inventory Ledger Task 1.1 Decision:** `DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`
**Phase 0 Design Closure Decision:** `PHASE 0 DESIGN ACCEPTED BY OWNER; RUNTIME EVIDENCE DEFERRED TO PHASE 1 SPIKE`
*(Phase 0 closes on design/documentation and recorded owner decisions and default assumptions (owner may change) only. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. Gates 1, 2, 3, and 5 block launch only; Gate 4 includes recorded business rules and changeable defaults D-2 through D-5, and Gate 6 has a recorded payment-method choice plus unselected gateway default D-1. Store feature implementation remains blocked pending Spike evidence review and launch-gate completion.)*

---

## 1. Executive Summary & Anti-Overclaiming Notice

This document preserves earlier revision findings as explicitly historical records. **Current canonical state is Revision 19**, summarized below and in the Revision 19 section at the end. Historical status language, package cohorts, and cross-document matrices must not be read as the current decision.

In strict compliance with the **Anti-Overclaiming, Evidence Discipline, and Honest Reporting Rules**:
- **Prohibited Assurances Eliminated:** Terms such as "fully verified", "fully aligned", "all blockers resolved", "production-ready", "deadlock-free", "crash-proof", "completely idempotent", and "mathematically guarantees" have been removed from all architectural claims.
- **Evidence Tiers Enforced:**
  - `[VERIFIED-DOCS]`: Confirmed against official framework documentation with exact URLs.
  - `[SOURCE-VERIFIED]`: Inspected directly in published package tarballs on npm (e.g. `@medusajs/core-flows@2.22.1`, `@medusajs/order@2.22.1`, `@medusajs/locking-redis@2.22.1`).
  - `[VALIDATED-TEST]`: None in Phase 0. Reserved exclusively for tests executed in this environment with reproducible terminal output.
  - `[PROPOSED]`: Custom architectures, schemas, workflows, and test designs pending prototype execution.
  - `[OWNER-DECISION]`: Commercial, legal, or operational policies awaiting formal business owner approval.
- **Decisions:**
  - **Task 1.1 Status:** **`DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION DEFERRED TO PHASE 1 SPIKE`**. Revision 18 (historical design revision) introduced the lock hierarchy for existing-order custom workflows, pre-order cart-only flows, inventory child rows, return-trigger paths, and isolated refund/disbursement transactions. Revision 19 does not change that design. This is documentation status only, not runtime closure.
  - **Phase 0 Status:** **`DESIGN/DOCUMENTATION CLOSURE; RUNTIME EVIDENCE DEFERRED TO PHASE 1 SPIKE`**. Phase 0 closes on design/documentation and recorded owner decisions and default assumptions (owner may change) only. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. The TP registry contains 59 rows, including TP-25a through TP-25d; all existing `[ ]` statuses remain unchanged. Gates 1, 2, 3, and 5 block launch only. Gate 4 and Gate 6 use [DEFAULT-ASSUMPTION] D-1 through D-5; the owner may change these defaults. See the Default Assumptions Register. Store feature implementation remains blocked pending Spike evidence review and launch-gate completion.

---

## 2. Historical Resolution Notes from Revision 12/13 (Not Current Package or Runtime Evidence)

The rows in this section preserve the claims and investigation record of the earlier revisions. In particular, package `2.22.1` assertions below are historical records, not the current candidate cohort. The Revision 16 cohort discussion in the historical sections below is retained only as history; current candidate pins and their unverified status are described in the Revision 19 canonical documents.

### Workstream 1: Checkout Lock, Idempotency Lease, and Epoch-Fencing Protocol
- **Finding:** Redis cart lock TTL and PostgreSQL lease timeout were described as "coordinated" without establishing that a valid Redis lock remains held. Heartbeats updated PostgreSQL without confirming Redis lock ownership. Cart mutation protection authorized modifications when timestamps aged, without an active abort action. Reusing `cart_checkout_session.order_id` allowed newer workers to race with stale workers cancelling orders.
- **Remediation Taken:**
  1. **Separation of Lock & Lease:** Redis cart lock TTL is 120s with 5s acquisition timeout. Active workers execute a synchronized 30s heartbeat. In each tick, the worker calls Redis `extendLock("cart:" + cart_id, worker_owner_id, 120)`. If Redis returns `0` (lock lost) or fails, the worker trips an `AbortController` and refuses to update PostgreSQL. Only if Redis returns `1` does the worker update `idempotency_key.last_heartbeat_at`.
  2. **CAS Abort on Lock Timeout:** If lease acquisition succeeds but Redis lock acquisition times out (>5s), the worker executes a guarded CAS deletion `DELETE FROM idempotency_key WHERE key = :k AND lease_owner_id = :id AND status = 'pending'`, returning 409 Conflict without leaving an orphaned lease.
  3. **Cart Mutation Guard Policy:** Cart mutations require acquiring the Redis cart lock and querying `cart_checkout_session`. If `status = 'in_progress'`, mutation is strictly blocked (409 Conflict). A timestamp aging never authorizes mutation. Mutations are allowed only after an explicit recovery controller verifies that the heartbeat is dead (>120s), increments the epoch, and sets session status to `aborted`.
  4. **Immutable Attempt Entity (`cart_checkout_attempt`):** Introduced `cart_checkout_attempt` to record attempt history, lease ownership, attempt status, and order association. Stale workers verify `cart_checkout_attempt.order_id === :order_id` before invoking `cancelOrderStep`, preventing a stale worker from cancelling an order created by a newer attempt.
  5. **Complete Conversion Transaction:** `convertCartReservationsToAllocationsStep` row-locks session, attempt, and active unexpired reservations (`expires_at > NOW()`). Validates exact reservation counts and line keys, inserts allocations and movements in the same transaction, and transitions reservations to `status = 'converted'`. Diagnostic error codes distinguish stale attempts, expired reservations, missing rows, and quantity mismatches.

---

### Workstream 2: Canonical Seven-Checkpoint Crash Recovery Matrix
- **Finding:** Recovery descriptions differed across documents and conflated distinct checkpoints. Retention policy for converted reservations was ambiguous (some documents stated deleted, others stated converted).
- **Remediation Taken:**
  1. **Canonical Reservation Retention Policy:** Converted reservations are retained permanently with `status = 'converted'` and timestamp `converted_at`. They are never deleted upon conversion. Excluded from expired cleanup crons (`status = 'active' AND expires_at < NOW()`).
  2. **Canonical 7-Checkpoint Matrix:** Defined one authoritative matrix across all documents covering:
     - CP-1: Pre-Reservation.
     - CP-2: Post-Reservation, Pre-Order.
     - CP-3: Post-Order, Pre-Association.
     - CP-4: Post-Association, Pre-Conversion.
     - CP-5: Post-Conversion, Pre-Downstream.
     - CP-6: Post-Downstream, Pre-Idempotency.
     - CP-7: Post-Completion Replay.
  3. **Standardized Columns:** Replaced generic statuses with canonical column names `order_operational_state.operational_status` and `cod_collection_record.collection_status`.

---

### Workstream 3: Return-Quantity Triggers and Return-State Enforcement
- **Finding:** Return-item inserts could race with parent return-request status changes. Reactivation triggers checked items one at a time, failing to aggregate multiple rows for the same line and batch within the reactivated request. Direct transitions to `completed` were not blocked by database triggers.
- **Remediation Taken:**
  1. **Parent Request Row Lock FOR SHARE:** `check_cumulative_return_quantity` executes `SELECT return_status FROM return_request WHERE id = NEW.return_request_id FOR SHARE`. Rejects inserts if parent status is `completed`, `cancelled`, or `rejected`.
  2. **Multi-Row Reactivation Aggregation:** `check_return_request_reactivation` aggregates return items of the reactivated request by `(line_item_id, batch_id)` using `GROUP BY ri.line_item_id, ri.batch_id` before checking cumulative totals against batch allocations and line ordered counts.
  3. **Terminal Completed Immutability:** Trigger rejects any update to a `completed` return request (`OLD.return_status = 'completed' AND NEW.return_status != 'completed'`).
  4. **Domain Integrity:** Enforced integral quantities (`INTEGER NOT NULL CHECK (quantity > 0)`). Packaged-goods store policy prohibits modifying ordered quantities after checkout completes.

---

### Workstream 4: Refund Lifecycle and Real Separation of Duties
- **Finding:** `refund_record` stored only `operator_id` and `supervisor_id`, omitting the actual disbursement operator and reconciler. Concurrency races existed during intent creation. Nondeterministic encryption ciphertexts could cause replay hash mismatches.
- **Remediation Taken:**
  1. **Four-Actor Schema:** Added explicit columns to `refund_record`:
     - `requested_by VARCHAR(255) NOT NULL` (CS / Admin)
     - `approved_by VARCHAR(255) NULL` (Supervisor)
     - `disbursed_by VARCHAR(255) NULL` (Finance Operator)
     - `reconciled_by VARCHAR(255) NULL` (Finance Supervisor)
  2. **Separation of Duties Constraints:** Database check constraint `chk_refund_actors` enforces:
     - `approved_by != requested_by`
     - `disbursed_by != approved_by`
     - `reconciled_by != disbursed_by`
  3. **Stable Keyed HMAC Fingerprint:** Normalized recipient plaintext is hashed using HMAC-SHA256 (`recipient_fingerprint`) before AES-256-GCM encryption. Ensures identical requests produce identical `request_hash` values regardless of fresh encryption nonces.
  4. **Mandatory Disbursement Reference:** Constraint `chk_disbursement_reference` requires non-empty `external_reference` when entering `disbursement_submitted` or `completed`. Replays with identical reference return existing status; conflicting references return 409 Conflict.
  5. **Atomic Capacity Check Under Lock:** Intent creation row-locks `cod_collection_record` (`FOR UPDATE`) FIRST, re-checks existing idempotency key, sums active refund intents, and inserts intent atomically.

---

### Workstream 5: Deterministic Idempotency Expiration Semantics
- **Finding:** Documents contradicted each other regarding expired completed keys when the database row remained present before cron cleanup.
- **Remediation Taken:**
  - Formulated an authoritative 10-branch expiration and replay matrix:
    - Same key, same payload before expiry: 200/201 stored response.
    - Same key, different payload before expiry: 409 Conflict.
    - Active pending lease (<120s heartbeat): 409 Conflict.
    - Stale pending lease (>120s without heartbeat): Takeover via CAS update.
    - Expired completed/failed key, DB row present (`expires_at < NOW()`): Return stored response (200 OK) with `X-Idempotency-Status: replayed-expired`.
    - Expired key deleted by cron: Check `cart_checkout_session`: if `completed`, reject with 409 Conflict. If cart abandoned, allow fresh attempt.
    - Completed cart submitted with fresh key after retention: 409 Conflict.
    - Failed attempt retry with fresh key: Allowed if session is aborted/failed.
    - Lock acquisition timeout: CAS delete pending lease before returning 409.
    - Retention cleanup during concurrent request: Cleanup cron deletes ONLY `status IN ('completed', 'failed') AND expires_at < NOW()`. Pending/active keys never deleted by automated cron.

---

### Workstream 6: Comprehensive Cross-Document Inconsistency Audit
- **Finding:** Field names, crash boundaries, and state machines needed physical cross-document alignment.
- **Remediation Taken:**
  - Reconciled all nine canonical documents in `docs/`. Audited every reference against canonical table columns and state machines.

---

### Workstream 7: Historical Revision 12/13 Package Registry Claims (Superseded in Revision 16; Historical)
- **Historical finding:** Earlier revisions recorded exact package versions and dist-tags, including a blanket `2.22.1` claim. This historical record must not be treated as current compatibility evidence for Revision 16 or Revision 19.
- **Historical registry notes (recorded in earlier revisions; not authoritative for Revision 19 pin selection):**
  - `@medusajs/framework`: version `2.22.1`, `dist-tags.latest: 2.22.1`, `engines: { node: ">=22.22.0" }`.
  - `@medusajs/medusa`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/core-flows`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/order`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/locking-redis`: version `2.22.1`, `dist-tags.latest: 2.22.1`. Inspected `redis-lock.js`: verified `extendLock` Lua command.
  - `@medusajs/types`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/js-sdk`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/cli`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - `@medusajs/utils`: version `2.22.1`, `dist-tags.latest: 2.22.1`.
  - Node.js LTS: Local environment is `v24.15.0`; target production runtime is `24.22.1` Maintenance LTS (both `>=22.22.0`).
  - Next.js: `15.5.28` (Maintenance LTS release stream).

---

### Workstream 8: Historical TP ID Registry Reconciliation (Revision 16; Historical)
- **Finding:** `TP-02b` and `TP-06a/b` were defined differently across Implementation Plan and Summary.
- **Remediation Taken:**
  - Standardized on one TP ID registry (TP-01 through TP-24c); the Revision 16 implementation plan listed 55 test rows including lettered subcases, all unchecked at that revision. Revision 19 adds TP-25a through TP-25d for 59 rows total; all remain unchecked.

---

## 3. Historical Revision 13 Bounded Task 1 Remediation Log (Inventory Movement Ledger Contract)

### 3.1 Defect Analysis & Root Causes
1. **Schema Divergence in `inventory_movement`:** `data-model.md` defined `inventory_movement` with a single ambiguous `delta_quantity` column, lacking independent deltas for the batch model's three balance dimensions (`quantity_on_hand`, `quantity_reserved`, `quantity_quarantined`), snapshots, references, and actor fields used in workflow examples.
2. **Conversion SQL Insert Mismatch:** In `architecture.md` Section 4.6, reservation-to-allocation conversion SQL inserted into `delta_quantity` rather than the canonical 3-delta contract.
3. **Reservation Row Quantity Name Collision:** In `order-and-inventory-workflows.md` line 284, the expired-reservation cleanup code accessed `candidate.quantity_reserved` instead of the canonical `cart_batch_reservation.quantity` column.
4. **Batch Inception Invariant Gap:** The invariant $\text{quantity\_on\_hand} = \sum \text{quantity\_on\_hand\_delta}$ lacked an explicit batch initialization and initial receipt policy to guarantee correctness from lot inception.

### 3.2 Remediation Applied
- **Canonical Schema Alignment:** Reconciled `inventory_movement` in [data-model.md](data-model.md) to define: `id`, `deduplication_key`, `batch_id`, `variant_id`, `movement_type`, `quantity_on_hand_delta`, `quantity_reserved_delta`, `quantity_quarantined_delta`, `quantity_on_hand_before`, `quantity_on_hand_after`, `quantity_reserved_before`, `quantity_reserved_after`, `quantity_quarantined_before`, `quantity_quarantined_after`, `reference_type`, `reference_id`, `reason`, `actor_id`, `created_at`.
- **Integrity Constraints:** Added `chk_movement_snapshots`, `chk_movement_delta_nonzero` (exempting informational `allocation_conversion` 0-deltas), `chk_movement_delta_semantics` (restricting exact allowed sign/dimensions per movement type), and `chk_movement_reason`.
- **Reservation Quantity Reconciled:** Replaced `candidate.quantity_reserved` with `candidate.quantity` in [order-and-inventory-workflows.md](order-and-inventory-workflows.md) and confirmed consistent use across all documentation.
- **Conversion SQL Insert Corrected:** Updated conversion query in [architecture.md](architecture.md) to insert all canonical columns joining locked `inventory_batch` for snapshots.
- **Atomic Balance & Movement Protocol:** Documented deterministic `SELECT ... FOR UPDATE` batch lock ordering (`ORDER BY id ASC`), attribute-verifying deduplication check, safe replay on exact match (0 balance change), 409 Conflict rollback on attribute collision, and batch inception receipt policy across [data-model.md](data-model.md), [architecture.md](architecture.md), and [order-and-inventory-workflows.md](order-and-inventory-workflows.md).
- **Disaster Recovery Query Added:** Added Query 5 in [security-and-deployment.md](security-and-deployment.md) auditing per-batch ledger deltas against current balances.
- **Prototype Tests Aligned:** Updated `TP-06a`, `TP-06b`, `TP-07a`, `TP-07b`, `TP-09`, `TP-10`, `TP-11`, and `TP-24a` in [implementation-plan.md](implementation-plan.md); all statuses remain unchecked `[ ]`.

### 3.3 Deferred Findings (Out-of-Scope Revision 12 Items)
In accordance with prompt Section 3 scope boundaries, the following items remain open and deferred to subsequent tasks:
1. Runtime verification of Redis cart lock and PostgreSQL lease coordination spike (`TP-02a-c`, `TP-03`).
2. Execution of return-state triggers (`trg_check_return_quantity`, `trg_check_return_request_reactivation`) and terminal immutability (`TP-23a-f`).
3. Execution and runtime verification of 4-stage dual-control refund lifecycle and actor separation check constraints (`TP-21a-f`).
4. Framework package compatibility spike execution under `@medusajs/medusa@2.22.1`.

---

## 4. Historical Revision 15 Task 1.1 Findings and Remediation Log (Inventory Ledger; carried forward into Revision 16)

### 4.1 Confirmed Revision 13 Defects & Root Causes

During the Revision 15 Task 1.1 technical audit, the following concrete design defects, lock ordering inconsistencies, and runtime integrity gaps were identified in the Revision 13 documents:

1. **Deadlock Risk via Lock Inversion Between Cleanup & Conversion:**
   - *Defect:* In [order-and-inventory-workflows.md](order-and-inventory-workflows.md), `cleanupExpiredReservationsWorkflow` acquired row locks on `inventory_batch` (`ORDER BY id ASC FOR UPDATE`) before locking reservations. Conversely, in [architecture.md](architecture.md#46-complete-reservation-to-allocation-conversion), the reservation-to-allocation conversion step locked `cart_batch_reservation` rows first and then joined `inventory_batch` without locking. Under concurrent checkout and expired-reservation cleanup on the same batch lots, this inverted order created high deadlock susceptibility (`40P01`).
   - *Root Cause:* Absence of a unified, cross-workflow transaction protocol specifying the global lock acquisition order across all entities.

2. **Unisolated Snapshot Capture in Conversion Query:**
   - *Defect:* In [architecture.md](architecture.md#46-complete-reservation-to-allocation-conversion), the conversion query inserted `before` and `after` balance snapshots into `inventory_movement` by joining `inventory_batch` without locking or transactional snapshot isolation. If a concurrent transaction updated batch balances, the captured snapshots would diverge from the true pre- and post-mutation balances.
   - *Root Cause:* Movement inserts were written as an unisolated `SELECT ... JOIN` rather than reading directly from explicitly row-locked batch rows.

3. **Unfiltered Reservation Scope in Conversion Allocations and Movements:**
   - *Defect:* In [architecture.md](architecture.md#46-complete-reservation-to-allocation-conversion), step 5 locked and validated active unexpired reservations into `:validated_cbr_ids`, but subsequent insert queries for `order_batch_allocation` and `inventory_movement` filtered broadly by `WHERE checkout_attempt_id = :attempt_id`. If an expired or cancelled reservation existed for that attempt, it would be illegally converted into an allocation.
   - *Root Cause:* Disconnect between the validation filter and downstream insertion predicates.

4. **Missing Deduplication Replay & Collision Protocol in Cleanup Code:**
   - *Defect:* In [order-and-inventory-workflows.md](order-and-inventory-workflows.md), the expired cleanup snippet executed `UPDATE inventory_batch` without first querying whether a movement with key the canonical hashed cleanup key generated by `movementDedupKey` already existed. A re-run of the cleanup job on an already-released reservation would decrement `quantity_reserved` multiple times. Furthermore, no 409 Conflict rollback was specified if a deduplication key collided with different attributes.
   - *Root Cause:* Deduplication key logic was documented in narrative prose but omitted from the concrete TypeScript/SQL cleanup sequence.

5. **Lack of Database-Level Immutability Enforcement for Ledger:**
   - *Defect:* The movement ledger was described as "append-only", but [data-model.md](data-model.md) contained no PostgreSQL trigger or permission restrictions preventing administrative or application `UPDATE`, `DELETE`, or `TRUNCATE` operations on `inventory_movement`.
   - *Root Cause:* Relying on application-level conventions rather than database-enforced immutability.

6. **Incomplete Operational Preconditions Across Movement Types:**
   - *Defect:* In [architecture.md](architecture.md) and [order-and-inventory-workflows.md](order-and-inventory-workflows.md), operational preconditions were unspecified for several movement types (e.g., initial receipt, quarantine inspection, scrap), creating ambiguity for edge-case inventory mutations.
   - *Root Cause:* Movement types were documented primarily in terms of delta signs without explicit business state checks.

---

### 4.2 Earlier Remediation Record (Revision 13/14; Historical Context)

All changes have been applied directly to the canonical documents in `docs/`:

1. **[data-model.md#21-custom-data-models](data-model.md):**
   - Added `chk_movement_snapshots_nonnegative` ensuring all 6 snapshot columns are $\ge 0$.
   - Added `chk_movement_snapshots_tri_balance` enforcing exact tri-balance conservation: $\text{after} = \text{before} + \text{delta}$ for `on_hand`, `reserved`, and `quarantined`.
   - Added `trg_inventory_movement_immutable` and function `prevent_inventory_movement_modification()` raising exception `INVENTORY_MOVEMENT_IMMUTABLE` on any `UPDATE` or `DELETE`.
   - Added explicit SQL granting only `SELECT, INSERT` and executing `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE inventory_movement FROM medusa_app_user`.
2. **[data-model.md#5-batch-inventory-movement-ledger-and-balance-mutation-protocol](data-model.md):**
   - Defined the three canonical balance dimensions with zero ambiguity.
   - Specified the exact 5-step transaction sequence for initial batch receipt and lot inception.
   - Codified the authoritative 7-step Global Lock Ordering Rule across all operations.
   - Codified immutable semantic replay comparison attributes (`batch_id`, `variant_id`, `movement_type`, 3 deltas, `reference_type`, `reference_id`, `reason`).
3. **[architecture.md#46-complete-reservation-to-allocation-conversion](architecture.md#46-complete-reservation-to-allocation-conversion):**
   - Replaced conversion transaction SQL:
     - Step 4 now locks affected `inventory_batch` rows in `ORDER BY id ASC FOR UPDATE` *before* locking reservations.
     - Step 5 locks active unexpired reservations `ORDER BY id ASC FOR UPDATE` and captures `:validated_cbr_ids`.
     - Step 6 strictly filters `order_batch_allocation` inserts with `WHERE cbr.id = ANY(:validated_cbr_ids)`.
     - Step 7 inserts `inventory_movement` records filtered strictly by `:validated_cbr_ids`, capturing before/after snapshots directly from the locked `inventory_batch` rows (`ib`).
     - Step 8 enforces strict cardinality assertions before committing.
4. **[architecture.md#7-batch-inventory-movement-ledger--concurrency-control](architecture.md):**
   - Added complete operational preconditions for all 10 movement types.
   - Codified the 7-step Global Lock Ordering Rule.
   - Codified semantic replay comparison attributes and batch inception receipt policy.
5. **[order-and-inventory-workflows.md#4-expired-reservation-cleanup-workflow](order-and-inventory-workflows.md):**
   - Replaced `cleanupExpiredReservationsWorkflow` execution logic:
     - Step 2 determines affected batch IDs and locks `inventory_batch` rows in `ORDER BY id ASC FOR UPDATE`.
     - Step 3 locks candidates in `cart_batch_reservation` in `ORDER BY id ASC FOR UPDATE`, re-checking `status === 'active' AND expires_at < NOW()`.
     - Step 4 checks the canonical hashed cleanup key generated by `movementDedupKey`. On exact match, treats as safe replay (0 balance decrement). On attribute collision, aborts with 409 Conflict.
     - Step 5 decrements `quantity_reserved` by `reservation.quantity` (canonical field name).
     - Step 6 inserts `inventory_movement` with snapshots taken from the row-locked batch.
6. **[order-and-inventory-workflows.md#6-authoritative-inventory-movement-type-matrix](order-and-inventory-workflows.md):**
   - Fixed KaTeX syntax on `return_restock` (removed stray backtick).
   - Added operational preconditions for all 10 movement types.
   - Added Section 6.2 (Global Lock Ordering Rule) and Section 6.3 (Semantic Replay Comparison Fields).
7. **[implementation-plan.md#42-prototype-test-scenarios](implementation-plan.md):**
   - Updated `TP-06a`, `TP-06b`, `TP-07a`, `TP-07b`, `TP-09`, `TP-10`, `TP-11`, and `TP-24a` to reflect 3 deltas, locked snapshots, deduplication replay, conflict rollback, and validated reservation sets.
   - Added `TP-24c` (Append-Only Movement Ledger Immutability Enforcement). In that historical revision, the registry contained 55 listed test rows, including lettered subcases; all remained unchecked. Revision 19 adds TP-25a through TP-25d, bringing the registry to 59 rows; all remain unchecked `[ ]`.
8. **[risk-and-assumptions.md#1-critical-technical-risks](risk-and-assumptions.md):**
   - Historical Revision 15 claim (superseded): the batch-before-reservation ordering was documented for cleanup/conversion, but did not yet define cross-domain ordering with native-order/return triggers. Revision 17 replaces the incomplete rule with the cross-domain hierarchy in §4.4; runtime deadlock behavior remains unverified.
   - Updated `R-17`: included append-only immutability trigger enforcement and exact semantic attribute matching.
9. **[security-and-deployment.md#42-disaster-recovery-ledger-queries](security-and-deployment.md):**
   - Added Query 6 verifying snapshot validity, non-negativity, and tri-balance invariant compliance across all historical movement rows.

---

### 4.3 Historical Final Canonical Movement Matrix (Revision 15)

The following matrix records the Revision 15 design snapshot only; it is historical, not the current canonical matrix. Readable key examples mentioned in the historical Revision 13/14 findings are legacy examples, not persisted keys in Revision 15.

| Movement type | On-hand delta | Reserved delta | Quarantined delta | `reference_type` | `reference_id` | `operation_subkey` | Guard / invariant |
|---|---:|---:|---:|---|---|---|---|
| `receipt` | `+N` | `0` | `0` | `receipt` | `receipt_operation_id` | Intake-line ID when needed | Batch begins at zero; batch creation, balance update, and receipt movement commit atomically. |
| `reservation` | `0` | `+N` | `0` | `cart_reservation` | Reservation ID | Empty | Available stock is at least N; reservation and balance update are atomic. |
| `reservation_release` | `0` | `-N` | `0` | `cleanup` or `saga_cancel` | Reservation ID | Empty | Release an active reservation at most once; use the canonical reservation quantity. |
| `allocation_conversion` | `0` | `0` | `0` | `order_allocation` | Order ID | `checkout_line_key` | Informational event only; exact validated reservation/allocation state is required. |
| `fulfillment` | `-N` | `-N` | `0` | `fulfillment` | Fulfillment ID | Line-item ID | Matching allocated quantity must exist; decrement on-hand and reserved together. |
| `return_quarantine` | `+N` | `0` | `+N` | `return_quarantine` | Return ID | Return-item ID | Physical return received; same returned units cannot be counted twice. |
| `return_restock` | `0` | `0` | `-N` | `return_restock` | Return ID | Return-item ID | Inspection approved; quarantined stock is sufficient. |
| `damage_writeoff` | `-N` | `0` | `-N` | `damage_writeoff` | Write-off ID | Empty | Units were quarantined; nonblank reason required. |
| `expiry_quarantine` | `0` | `0` | `+N` | `expiry_quarantine` | Quarantine operation ID | Empty | Reclassify only eligible unreserved sellable units. |
| `manual_correction` | Authorized signed deltas | Authorized signed deltas | Authorized signed deltas | `manual_correction` | Adjustment ID | Empty | Authorized actor, nonblank reason, and valid resulting balances required. |

All producers use `inv:v1:{movement_type}:{lowercase_sha256_hex}`. The digest is SHA-256 over the UTF-8 bytes of the compact JSON array `["inv-v1", movement_type, batch_id, reference_type, reference_id, operation_subkey]`. The array always has those six string values in that order; use an empty string for an unused subkey. With `movement_type` limited to 50 characters, the maximum persisted key length is 122 characters and fits `VARCHAR(128)`. Semantic attributes are compared independently of the hash; a matching key is a replay only when both semantic attributes and associated domain state are consistent.

Canonical identity fields are: receipt = stable `receipt_operation_id` plus optional intake-line subkey; reservation = reservation ID; reservation release = `cleanup` or `saga_cancel` plus reservation ID; allocation conversion = order ID plus `checkout_line_key`; fulfillment = fulfillment ID plus line-item ID; return movements = return ID plus return-item ID; write-off = write-off ID; expiration quarantine = quarantine operation ID; manual correction = adjustment ID.

---

### 4.4 Historical Revision 18 Cross-Domain Lock-Order Decision (Design Retained in Revision 19)

Revision 16's historical inventory-only sequence (session/attempt -> batch -> reservation/allocation) did not state how it coexisted with return triggers that lock the native order and return rows, nor did it distinguish order-associated cleanup from proven pre-order cleanup. Revision 18 introduced the cross-domain hierarchy in `architecture.md` §7.2, `data-model.md` §5.4, and `order-and-inventory-workflows.md` §6.2; Revision 19 retains that design unchanged.

**Canonical application rule:**

1. Existing-order custom workflows acquire `pg_advisory_xact_lock(hashtextextended('phase0:order:' || order_id, 0))` before any row-level lock or custom-row mutation for that order. Multiple order advisory locks are acquired in ascending lexical `order_id` order.
2. If both existing order and cart checkout authority are needed, order advisory lock precedes `cart_checkout_session`, then `cart_checkout_attempt`.
3. A proven pre-order cart transaction has no order ID: it locks `cart_checkout_session` then `cart_checkout_attempt`, commits before native order creation, and may not acquire an order advisory lock later in that transaction.
4. Required domain roots are locked before inventory rows. Determine batch IDs without locking child rows; lock all affected batches by ascending ID; then lock/revalidate the relevant reservation/allocation/return child rows in deterministic per-table order.
5. Physical return receipt/quarantine/restock and refund/disbursement/reconciliation are separate transactions. The former may lock batches; the latter uses order -> return request -> COD -> refund -> disbursement-attempt order and never locks inventory batches.
6. Application workflows must acquire the advisory root before mutation. PostgreSQL triggers that take a native order row lock remain defense-in-depth; they cannot reorder a row tuple lock already taken by a non-compliant UPDATE. Direct/privileged SQL can still be deadlock-aborted; no zero-deadlock claim is made before PostgreSQL concurrency tests.

| Operation | Canonical lock order | Runtime status |
|---|---|---|
| Pre-order reservation creation | Redis cart lock -> session -> attempt -> sorted batches -> reservation children -> ledger/mutation | `[PROPOSED]`; TP-06/07 unchecked |
| Order correlation and existing-order conversion | Order advisory -> session -> attempt -> sorted batches -> reservation/allocation/required child rows -> ledger/state writes | `[PROPOSED]`; TP-08/09/10/13 unchecked |
| Cleanup on a pre-order/aborted attempt | Prove no native order and no unknown native outcome -> session -> attempt -> sorted batches -> reservation rows -> release/movement | `[PROPOSED]`; TP-07 unchecked |
| Cleanup for order-associated attempt | Order advisory -> session -> attempt -> sorted batches -> reservation rows; stop for unknown correlation/outcome | `[PROPOSED]`; TP-07/13 unchecked |
| Fulfillment and physical return stock mutation | Order advisory -> required operation/return root -> sorted batches -> allocation/return child rows -> movement | `[PROPOSED]`; TP-23/fulfillment tests unchecked |
| Return request/quantity validation only | Order advisory -> return request -> trigger-checked order/allocation child rows; no batch mutation in this transaction | `[PROPOSED]`; TP-23 unchecked |
| Refund disbursement/reconciliation | Order advisory -> return request -> COD -> refund -> attempts ascending; no batch lock | `[PROPOSED]`; TP-21/22 unchecked |

The prescribed sequences are a consistent design rule across application workflows, but **deadlock freedom has not been demonstrated**. TP-07b and TP-23e must run against actual PostgreSQL with controlled interleavings, including one negative test through an intentionally non-compliant privileged connection where the expected result may be deadlock detection and full rollback.

### 4.5 Historical Revision 16 Inventory Ledger SQL-to-Schema Cross-Reference Audit (Documentation Only)

This is a documentation review of actual schema definitions and the SQL/workflow examples in the canonical files. It is **not runtime verification**. All prototype tests remain unchecked. The schema authority is `data-model.md`, Section 3.1 `inventory_movement` and Section 5; conversion SQL authority is `architecture.md`, Section 4.6; cleanup workflow authority is `order-and-inventory-workflows.md`, Section 4.

| # | Canonical location / operation | Table and fields referenced | Schema fields exist? | Lock/transaction contract | Replay/conflict contract | Result | Evidence / note |
|---|---|---|---|---|---|---|---|
| 1 | `data-model.md` §5.3 — initial receipt | `inventory_batch`: `id`, three balances; `inventory_movement`: `id`, `deduplication_key`, `batch_id`, `variant_id`, `movement_type`, three deltas, six snapshots, `reference_type`, `reference_id`, `reason`, `actor_id`, `created_at` | Yes | Batch creation, balance update, and receipt row are one transaction; zero-to-intake snapshots | Shared key helper; stable receipt operation/batch identity required for retry | PASS (document contract) | `data-model.md` §§3.1, 5.3, 5.6 |
| 2 | `order-and-inventory-workflows.md` §2.1 — FEFO reservation creation | Batch balances plus reservation fields; movement fields listed in the canonical schema | Yes at schema-contract level | Session/attempt authority, ascending batch locks, then reservation writes; one transaction | Exact replay compares movement semantic attributes before a balance mutation | PASS (workflow contract only) | The workflow does not include a complete standalone SQL insert for every field; not runtime tested |
| 3 | `order-and-inventory-workflows.md` §4 — expired-reservation cleanup | All 19 columns declared in `inventory_movement`, with `reason=NULL`, `reference_type='cleanup'`, `reference_id=reservation.id`, `actor_id='SYSTEM'` | Yes | One attempt per transaction; order advisory before session/attempt when order-associated (and only after definitive cancellation); session/attempt for proven pre-order aborted attempt; sorted batch rows before reservation rows; balance, movement, status atomic | Exact replay only if reservation is already `expired`; matching movement with `active` reservation is integrity divergence; mismatched key is 409 | PASS (document contract) | Cleanup insert in §4 matches the schema in `data-model.md` §3.1 |
| 4 | `order-and-inventory-workflows.md` §3.2/§4 — saga compensation/release | Reservation row plus movement's three deltas, snapshots, references, reason and actor | Yes at schema-contract level | Same global batch-before-child ordering; guarded decrement and ledger insert atomic | Canonical hashed `reservation_release`/`saga_cancel` key; repeat release cannot decrement twice | PASS (workflow contract only) | No separate full SQL insert is supplied for all fields; runtime test remains unchecked |
| 5 | `architecture.md` §4.6 — reservation-to-allocation conversion | `cart_batch_reservation` IDs/status/quantity/line key; `inventory_batch` three balances; `order_batch_allocation`; all `inventory_movement` fields | Yes | Existing-order advisory root -> session -> attempt -> sorted batch locks -> validated reservations/allocations; one transaction | Committed conversion is validated as a complete state; partial movement/allocation/status combinations are integrity errors, not `NOT EXISTS` replays | PASS (document contract) | Uses exact `:validated_cbr_ids`; 0-delta snapshots from retained locked batch rows |
| 6 | `order-and-inventory-workflows.md` §6 — fulfillment | Three balance deltas, six snapshots, reference type/ID, key, reason, actor, timestamp | Yes at schema-contract level | Order advisory/root locks first, then affected batches ascending, then allocations; decrement on-hand and reserved atomically with movement insert | `fulfillment` identity includes fulfillment ID, batch ID, line-item subkey | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section; its contract matches `architecture.md` §7 |
| 7 | `order-and-inventory-workflows.md` §6 — return quarantine | Three deltas, snapshots, return reference, key | Yes at schema-contract level | Order advisory and return-request root first, then batch lock, then return/allocation child rows; receipt and quarantine increments atomic | Return item/batch subkey prevents collision between items in one return | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section; test TP-23 remains unchecked |
| 8 | `order-and-inventory-workflows.md` §6 — return restock | Three deltas, snapshots, return reference, key | Yes at schema-contract level | Order advisory and return-request root first, then batch lock, then return/allocation child rows; guarded quarantine decrement and movement insertion atomic | Return item/batch subkey; exact replay has zero additional decrement | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section |
| 9 | `order-and-inventory-workflows.md` §6 — damage write-off | Three deltas, snapshots, write-off reference, reason, actor | Yes at schema-contract level | Batch lock, quarantine precondition, guarded paired on-hand/quarantine decrement | Adjustment/write-off identity key; reason required and compared | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section |
| 10 | `order-and-inventory-workflows.md` §6 — expiry quarantine | Three deltas, snapshots, quarantine reference, key | Yes at schema-contract level | Batch lock; only unreserved sellable stock may be reclassified; no active reservation may be affected | Operation ID plus batch identity; replay does not re-quarantine | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section |
| 11 | `order-and-inventory-workflows.md` §6 — manual correction | Three deltas, snapshots, adjustment reference, reason, actor | Yes at schema-contract level | Authorized actor, explicit reason, guarded balance constraints, atomic movement | Adjustment ID plus batch identity; reason and actor compared on replay | NOT APPLICABLE — WORKFLOW CONTRACT ONLY | No full SQL insert in this section |
| 12 | `security-and-deployment.md` §4.2 — ledger reconciliation | `inventory_batch` balances and aggregate `inventory_movement` deltas | Yes | Diagnostic read only; not a balance mutation or substitute for transactional correctness | No new movement key; reports divergences | PASS (query/schema contract) | Reconciliation remains unexecuted |
| 13 | `implementation-plan.md` — TP-06a/b, TP-07a/b, TP-09/10/11, TP-24a/c | Expected fields and ledger invariants as listed in `data-model.md` | Yes at test-contract level | Tests specify lock/transaction assertions; tests have not run | TP-24c separates app-role privileges from trigger enforcement | PASS (test definition only) | Every affected status remains `[ ]`; this is not test evidence |

**Canonical identifier/key corrections:** movement IDs use `mov_` plus UUID and the schema defines `VARCHAR(40)`, persisted keys use `inv:v1:{movement_type}:{sha256hex}`, conversion uses `reference_type='order_allocation'` and `reference_id=order_id`, cleanup uses `reference_type='cleanup'` and `reference_id=reservation.id`, `reason` is nullable except when required by movement-type policy, and `chk_movement_reason` requires nonblank trimmed text—not a length greater than five. All examples and schemas were reconciled to this contract.

### 4.6 Prototype Test Scenario Updates

The following test scenarios in [implementation-plan.md](implementation-plan.md) were updated or added to validate the inventory ledger contract. They are test definitions only; all test statuses remain unchecked `[ ]` and no runtime outcome is claimed:

1. **`TP-06a`:** Multi-line reservation on same batch with unique server line keys, 3-delta ledger deltas (`0, +N, 0`), row-locked before/after snapshots, and atomic balance increments. `[ ] Proposed`
2. **`TP-06b`:** Reservation/movement replay vs collision: defines assertions for reuse of the persisted reservation ID, zero balance/row changes on exact replay, 409 Conflict on changed semantic intent, integrity error on contradictory reservation/movement state, and complete rollback after injected ledger-insert failure. The scenario remains unchecked and unexecuted. `[ ]`
3. **`TP-07a`:** Expired reservation cleanup: deterministic batch-first locks, guarded decrement using `reservation.quantity`, canonical hashed `reservation_release`/`cleanup` key, and snapshots from locked balances. Exact replay is permitted only for `expired` plus matching movement; `active` plus matching movement and `expired` without movement are integrity-divergence cases. Scenario remains unchecked. `[ ]`
4. **`TP-07b`:** Concurrent cleanup and checkout conversion overlap: exercises the documented lock order with explicit interleaving and asserts consistent reservation, allocation, balance, and movement state. The no-deadlock outcome remains untested; status is `[ ]`.
5. **`TP-09`:** Deterministic line-item allocation via `checkout_line_key`, informational `allocation_conversion` movement logging, and ambiguity rejection saga. `[ ] Proposed`
6. **`TP-10`:** Split-batch multi-lot deterministic mapping, multi-movement conversion, and integral quantity verification. `[ ] Proposed`
7. **`TP-11`:** Saga compensation rollback on simulated step failure, with reservation release movement and balance recovery. `[ ] Proposed`
8. **`TP-24a`:** Disaster recovery database consistency queries joining through `"order"`, `order_item`, `order_line_item`, `order_batch_allocation`, `inventory_batch`, and `inventory_movement` ledger invariant audit. `[ ] Proposed`
9. **`TP-24c` (NEW, subcases A/B):** A tests that the application role lacks `UPDATE`, `DELETE`, and `TRUNCATE` privileges. B uses a non-owner role with those statement privileges to confirm the row trigger blocks `UPDATE` and `DELETE` with `INVENTORY_MOVEMENT_IMMUTABLE`. Both are unchecked and unexecuted.

---

### 4.7 Historical Task 1.1 Acceptance Self-Audit (Revision 16 Documentation Snapshot)

The results below cover documentation-level contract consistency only. They do not imply runtime validation. The registry's status markers remain unchecked.

| # | Acceptance criterion | Result | Direct evidence |
|---|---|:---:|---|
| 1 | Three balance dimensions have consistent meanings and sum invariants. | **PASS** | `data-model.md` §§5.1–5.2; `architecture.md` §7; `order-and-inventory-workflows.md` §6.1 |
| 2 | All ten movement types have consistent delta rules and operational preconditions. | **PASS** | `architecture.md` §7; `order-and-inventory-workflows.md` §6; `data-model.md` §3.1 |
| 3 | Six snapshots have nonnegative/tri-balance constraints and delta arithmetic. | **PASS** | `data-model.md` §3.1 `chk_movement_snapshots_*`; `data-model.md` §5.2 |
| 4 | Snapshot data is sourced from locked rows in the same transaction. | **PASS** | `architecture.md` §4.6 steps D/I; `order-and-inventory-workflows.md` §4 steps 2/5 |
| 5 | A cross-domain lock hierarchy is documented consistently for compliant custom workflows; runtime deadlock behavior remains untested. | **PASS (DOCUMENTATION ONLY)** | `data-model.md` §5.4; `architecture.md` §7.2; `order-and-inventory-workflows.md` §6.2; this file §4.4 |
| 6 | Conversion uses exactly the locked and validated reservation set. | **PASS** | `architecture.md` §4.6 steps E/H/I and cardinality assertions |
| 7 | Exact replay, conflicting key reuse, and inconsistent state are distinguished. | **PASS** | `data-model.md` §§5.5–5.6; `order-and-inventory-workflows.md` §4 replay decision table; `architecture.md` §4.6 recovery semantics |
| 8 | Balance changes, ledger insertion, and relevant reservation transitions are atomic. | **PASS** | `architecture.md` §4.6; `order-and-inventory-workflows.md` §4 |
| 9 | Ledger immutability distinguishes UPDATE/DELETE trigger enforcement from TRUNCATE privilege enforcement. | **PASS** | `data-model.md` §3.1; `implementation-plan.md` TP-24c-A/B |
| 10 | Deduplication key encoding is deterministic and guaranteed to fit the column. | **PASS** | `data-model.md` §5.6; `architecture.md` §7.1; `order-and-inventory-workflows.md` §6.3 |
| 11 | Every in-scope schema/SQL/workflow reference has an operation-level audit row. | **PASS** | This section §4.5, operations 1–13 |
| 12 | Test IDs, row counts, and status language are coherent. | **PASS** | `implementation-plan.md` canonical registry and count note; all status cells remain `[ ]` |
| 13 | Review artifacts accurately distinguish documentation consistency from runtime testing. | **PASS** | This self-audit; `phase-0-review-summary.md` Task 1.1 section; `phase-0-review-report.md` Task 1.1 section |

**Historical Revision 16 Task 1.1 decision:** `TASK 1.1 DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`. This was the status recorded in that revision, not the current Phase 0 decision. Revision 19 retains the documented lock design without claiming runtime validation; runtime evidence belongs to the Phase 1 Spike.

### 4.8 Historical Deferred Findings (Out-of-Scope Items)

In strict compliance with prompt Section 3 scope boundaries, the following non-inventory items remain deferred to subsequent review tasks:
1. Runtime verification of Redis cart lock and PostgreSQL lease coordination spike (`TP-02a-c`, `TP-03`).
2. Execution of return-state triggers (`trg_check_return_quantity`, `trg_check_return_request_reactivation`) and terminal immutability (`TP-23a-f`).
3. Execution and runtime verification of 4-stage dual-control refund lifecycle and actor separation check constraints (`TP-21a-f`).
4. Framework package compatibility spike for the Revision 16 candidate cohort (`@medusajs/medusa@2.21.2` and the other direct Medusa pins) was deferred in that historical revision. Package metadata, peer resolution, lockfile installation, dependency-tree inspection, migrations, and builds were not claimed as executed.

---

## 5. Historical Cross-Document Consistency Matrix (Revision 16 Snapshot — Documentation Only; Not Current)

| Specification Topic | Architecture | Data Model | Workflows | Security | Risks | Implementation | Change Log | Summary | Report | Status | Evidence / Notes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **Inventory Movement Ledger Contract (Task 1.1)** | [Sec 7](architecture.md) | [Sec 3.1 & 5](data-model.md) | [Sec 4 & 6](order-and-inventory-workflows.md) | [Sec 4.2](security-and-deployment.md) | [R-15, R-17](risk-and-assumptions.md) | [TP-06a/b, 07a/b, 24a/c](implementation-plan.md) | [Sec 4.5](phase-0-change-log.md#45-historical-revision-16-inventory-ledger-sql-to-schema-cross-reference-audit-documentation-only) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-CONSISTENT; RUNTIME UNTESTED` | See operation-level audit in §4.5; all prototype statuses remain `[ ]` and no runtime test is claimed. |
| **Redis Lock vs DB Lease Separation** | [Sec 4.2](architecture.md) | N/A | [Sec 3.1](order-and-inventory-workflows.md) | [Sec 1.1](security-and-deployment.md) | [R-03](risk-and-assumptions.md) | [TP-02b](implementation-plan.md) | [Sec 2](phase-0-change-log.md#workstream-1-checkout-lock-idempotency-lease-and-epoch-fencing-protocol) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | 120s TTL; 30s heartbeat; `extendLock` contract documented; candidate-version behavior and races remain untested. |
| **Cart Mutation Guard Policy** | [Sec 4.3](architecture.md) | N/A | [Sec 2.1](order-and-inventory-workflows.md) | [Sec 1.1](security-and-deployment.md) | [R-03](risk-and-assumptions.md) | [TP-04a/b](implementation-plan.md) | [Sec 2](phase-0-change-log.md#workstream-1-checkout-lock-idempotency-lease-and-epoch-fencing-protocol) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | Mutation rejected on `in_progress`; aging does not authorize mutation. |
| **Immutable Attempt Entity (`cart_checkout_attempt`)** | [Sec 4.5](architecture.md) | [Sec 3.1](data-model.md) | [Sec 2.1](order-and-inventory-workflows.md) | N/A | [R-03](risk-and-assumptions.md) | [TP-08a/b](implementation-plan.md) | [Sec 2](phase-0-change-log.md#workstream-1-checkout-lock-idempotency-lease-and-epoch-fencing-protocol) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `CONSISTENT` | Durable pre-call attempt state; authoritative binding/cancellation required; unknown outcome fails closed. Runtime validation remains pending. |
| **Canonical 7-Checkpoint Crash Recovery Matrix** | [Sec 4.5-4.6](architecture.md) | N/A | [Sec 3.2](order-and-inventory-workflows.md) | [Sec 1.1](security-and-deployment.md) | N/A | [TP-13a-g](implementation-plan.md) | [Sec 2](phase-0-change-log.md#workstream-2-canonical-seven-checkpoint-crash-recovery-matrix) | [Sec 2](phase-0-review-summary.md) | [Sec 5](phase-0-review-report.md#5-authoritative-7-checkpoint-crash-recovery-matrix) | `DOC-ALIGNED; RUNTIME UNTESTED` | Checkpoint IDs and conservative recovery prohibitions are aligned on paper; invocation and recovery behavior remain untested. |
| **Converted Reservation Retention Policy** | [Sec 4.6](architecture.md#46-complete-reservation-to-allocation-conversion) | [Sec 3.1](data-model.md) | [Sec 3.2](order-and-inventory-workflows.md) | [Sec 1.1](security-and-deployment.md) | N/A | [TP-13e](implementation-plan.md) | [Sec 2](phase-0-change-log.md#workstream-2-canonical-seven-checkpoint-crash-recovery-matrix) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | Retained as durable rows with `status = 'converted'`; cleanup excludes them by status. |
| **Return Triggers & Completion Contract** | [Sec 2.1](architecture.md) | [Sec 4](data-model.md) | [Sec 1.1](order-and-inventory-workflows.md) | N/A | [R-16, Gate 4](risk-and-assumptions.md) | [TP-23a-f](implementation-plan.md) | [Sec 8.2](phase-0-change-log.md#82-returns-and-order-version-semantics) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | Parent order/request locking, row- and statement-level aggregation, frozen valuation, exact refund settlement, and terminal immutability are specified; TP-23 remains `[ ]`. |
| **Four-Actor Dual-Control Refund Lifecycle** | N/A | [Sec 3.2](data-model.md) | [Sec 5](order-and-inventory-workflows.md) | [Sec 1.5](security-and-deployment.md) | [R-14, R-21, R-25](risk-and-assumptions.md) | [TP-21a-f, TP-22a/b](implementation-plan.md) | [Sec 8.3](phase-0-change-log.md#83-refund-disbursement-unknown-outcome-handling) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | Distinct actors, order-rooted lock order, unknown-outcome capacity reservation, matching parent/child reference and reconciliation evidence are specified; TP-21/22 remain `[ ]`. |
| **Deterministic 10-Branch Idempotency Semantics** | N/A | [Sec 3.4](data-model.md) | [Sec 3.1](order-and-inventory-workflows.md) | [Sec 1.1](security-and-deployment.md) | [R-09](risk-and-assumptions.md) | [TP-12a, TP-13c, TP-14a/b](implementation-plan.md) | [Sec 8.5](phase-0-change-log.md#85-initial-claim-versus-replay-response) | [Sec 2](phase-0-review-summary.md) | [Sec 2](phase-0-review-report.md) | `DOC-ALIGNED; RUNTIME UNTESTED` | Initial transient claim and sanitized replay differ intentionally; ambiguous native order outcomes retain the attempt fence. |
| **Historical candidate version cohort (`2.21.2` Medusa, Node 24.22.1, React 19.3.1, PostgreSQL 16.15, Redis 7.2.16)** | [Sec 3](architecture.md) | N/A | N/A | [Sec 3](security-and-deployment.md) | N/A | [Sec 2](implementation-plan.md) | [Sec 2](phase-0-change-log.md) | [Sec 1](phase-0-review-summary.md#1-executive-overview) | [Sec 3](phase-0-review-report.md) | `PROPOSED` | Published package candidates were checked online on 2026-10-25; no lockfile, install, peer-resolution, migration, or build was executed. Exact compatibility remains a gate.
| **Historical Launch Gates 1 through 6 status** | N/A | [Sec 2](data-model.md) | N/A | N/A | [Sec 4](risk-and-assumptions.md) | [Sec 2](implementation-plan.md) | [Sec 1](phase-0-change-log.md) | [Sec 4](phase-0-review-summary.md#4-authoritative-product-owner-launch-gates-gates-1-through-6) | [Sec 7](phase-0-review-report.md#7-explicit-unresolved-project-owner-decisions-launch-gates-1-to-6) | `HISTORICAL OWNER-DECISION SNAPSHOT` | This Revision 16 matrix predates the Revision 19 owner decisions; it is not current gate status. |
| **Historical review decision: NOT READY** | [Header](architecture.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](data-model.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](order-and-inventory-workflows.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](security-and-deployment.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](risk-and-assumptions.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](implementation-plan.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](phase-0-change-log.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](phase-0-review-summary.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | [Header](phase-0-review-report.md#project-arabic-first-e-commerce-store-for-imported-food-products-egypt) | `HISTORICAL SNAPSHOT` | This row records the Revision 16 decision only; Revision 19 defines current Phase 0 design closure and launch-gate status. |

---

## 6. Deliverable Index

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

## 7. Numbering Note

The historical numbering skips from §6 to §8; no separate §7 content was present in the existing change log. This note records the gap without changing the historical sections.


## 8. Historical Revision 16 — Remaining Architecture Workstreams (Historical Status Only)

This section preserves the Revision 16 workstream record only. It does not supersede Revision 19 documents or describe current status. Older entries above are historical revision records; the Revision 19 section at the end is the current change-log summary.

### 8.1 Medusa order correlation
- Replaced the unsupported sibling-level `metadata` argument with the documented `completeCartWorkflow.runAsStep({ input: { id: cart.id } })` contract.
- Persisted `order_creation_started` / `pending_correlation` before native order completion.
- Recovery uses the native `cart_id` query and a unique unresolved attempt; it does not require order metadata. Unknown outcome prevents second order creation, epoch advancement, reservation release, and cancellation. Ambiguity stops for reconciliation.
- Validation: `[PROPOSED]`; TP-08a, TP-08b, and TP-13c remain `[ ]`.

### 8.2 Returns and order-version semantics
- Added saved `order_version` to return requests and allocations. The return guards compare that captured version, aggregate returned quantity by line/batch/version, reject direct creation/completion in invalid states, prohibit identity/quantity rewrites, and make completed requests immutable across all columns.
- Historical Revision 18 design note: application workflows acquire the transaction-scoped order advisory root before row-level return mutations; trigger-internal native order row locks remain defense-in-depth. Return-request validation, physical return-stock mutation, and payout/reconciliation are separated as specified in §4.4. Revision 19 retains this design unchanged; no runtime deadlock claim is made.
- Validation: `[PROPOSED]`; TP-23a through TP-23f remain `[ ]`.

### 8.3 Refund disbursement unknown-outcome handling
- Added `refund_disbursement_attempt` as the durable external payout attempt record; `disbursement_initiated` and `disbursement_unknown` preserve capacity and prevent blind resend. Unknown outcomes require independent evidence-based reconciliation. Return/refund writes follow native order -> return request -> COD -> refund -> attempt lock order. Completion requires four distinct actors and a submitted child attempt whose reference and reconciler match the parent refund record.
- The intent idempotency race now fails closed if a unique-key collision returns no row; no success response may be generated without a persisted/re-read intent. Completion additionally requires one matching submitted child attempt, a shared external reference, and identical independent reconciler identity on parent and child records.
- No absolute exactly-once external transfer guarantee is claimed when the payment provider has no idempotency API.
- Validation: `[PROPOSED]`; TP-21a through TP-21f and TP-22a/b remain `[ ]`.

### 8.4 Dependency version decision
- Historical Revision 16 candidate note: with package publishing staggered across the Medusa 2.22.x family, Revision 16 initially selected an exact `2.21.2` direct-package candidate cohort as a reproducible candidate rather than asserting every `2.22.1` package is published/compatible. Node.js `24.22.1`, React/react-dom `19.3.1`, PostgreSQL `16.15`, Redis `7.2.16`, and Next.js `15.5.28` were recorded as candidate pins. This is a historical selection note, not runtime compatibility evidence.
- The candidate is not accepted until package metadata, peer requirements, lockfile, `npm ci`, dependency tree, migration, and production builds are verified.

### 8.5 Initial claim versus replay response
- Initial response may contain a transient one-time claim code. Persisted idempotency response contains only a sanitized safe body and order identity. Replay intentionally does not return the plaintext claim code; therefore TP-12a no longer asserts byte-for-byte response-body equality.

### 8.6 Evidence and acceptance
- Historical Revision 16 record: prototype statuses remained unchecked. The revision made documentation-level corrections only; no runtime, concurrency, migration, build, payout, or Medusa workflow test was claimed as executed.
- Historical Revision 16 decision: Phase 0 was recorded as `NOT READY FOR PHASE 0 ACCEPTANCE — TARGETED REMEDIATION REQUIRED`. Revision 19 supersedes this status: Phase 0 closes on design/documentation and recorded owner decisions and default assumptions (owner may change) only; runtime evidence belongs to the Phase 1 Spike.


## 9. Historical Revision 18 — Lock-Order Reconciliation and Execution Evidence

### 9.1 Documentation changes
- Replaced the inventory-only session/attempt-first statement with a cross-domain hierarchy that handles existing-order workflows, pre-order checkout, order-associated cleanup, physical returns, and isolated refund transactions.
- Introduced a shared transaction-scoped order advisory-lock key for custom workflows that mutate data associated with an existing order. The order ID is read non-lockingly, the advisory lock is acquired, and the association/version is revalidated before mutation.
- Required sorted `inventory_batch` locks before reservation/allocation/return child rows in transactions that mutate batch balances.
- Separated return-request/quantity validation from physical return-stock transactions, and separated physical inventory transactions from payout/disbursement/reconciliation.
- Corrected Task 1.1's decision label to avoid implying runtime or concurrency closure.

### 9.2 Execution attempted and actual result
- **Historical documentation review note:** the Revision 18 record described a static document-contract audit against the nine Revision 18 files. This is not runtime evidence and is retained as history only.
- **Actual compatibility tests:** NOT RUN. This workspace contains documentation only; there is no application repository, `package.json`, package lockfile, implemented custom workflow code, PostgreSQL server/client, Redis service, or executable TP harness available here. The local Node runtime is not the selected target runtime. A successful documentation check cannot substitute for `npm ci`, builds, migrations, or PostgreSQL/Redis concurrency tests.
- **Historical Revision 18 decision:** `TASK 1.1 DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING`; `NOT READY FOR PHASE 0 ACCEPTANCE — TARGETED REMEDIATION REQUIRED`. Revision 19 supersedes the Phase 0 acceptance wording: design/documentation and recorded owner decisions and default assumptions (owner may change) define Phase 0 closure; runtime evidence is deferred to the Phase 1 Spike.


## 10. Revision 19 — Phase 0 Design Closure and Electronic Payment Decisions (Documentation Only)

Revision 19 updates this change log to match the current canonical state recorded in `architecture.md`, `data-model.md`, `order-and-inventory-workflows.md`, `security-and-deployment.md`, `implementation-plan.md`, `risk-and-assumptions.md`, `phase-0-review-report.md`, and `phase-0-review-summary.md`. These are documentation changes only. No application code was written, and no install, build, migration, test, or runtime verification is claimed. No `[ ]` status was changed.

- **Phase 0 closure redefinition:** Phase 0 closes on design/documentation consistency and recorded owner decisions and default assumptions (owner may change) only. Runtime evidence belongs to the Phase 1 Technical Compatibility Spike. Store feature implementation remains blocked pending review of Spike evidence and completion of launch requirements.
- **Launch-gate classification:** Gates 1, 2, 3, and 5 block launch only; they do not block Phase 0 design closure. Gate 4 defaults D-2 through D-5 and Gate 6 default D-1 are [DEFAULT-ASSUMPTION] entries that the owner may change; see the Default Assumptions Register.
- **Electronic payment design (Gate 6):** MVP offers electronic payment and COD side by side. The architecture uses a hosted/redirect payment page and a provider-neutral payment abstraction. No gateway has been selected; gateway selection follows [DEFAULT-ASSUMPTION] D-1: no vendor is selected, and the Phase 1 Spike uses a simulator; owner may change this default; see the Default Assumptions Register.
- **Refund defaults (Gate 4):** The system computes the refund using the recorded item-price, shipping, and goods-condition rules. [DEFAULT-ASSUMPTION] D-2 sets tax-inclusive paid-amount basis, D-3 sets no automatic shipping withholding with an audited admin override, D-4 sets sealed change-of-mind item-price-only handling, and D-5 makes lawyer review of Arabic policy a launch gate. The owner may change these defaults; see the Default Assumptions Register.
- **Technical Prototype registry:** The registry grows from 55 to 59 rows with `TP-25a` through `TP-25d` for payment abandonment/failure, webhook idempotency/order/signature handling, payment/order-creation compensation, and partial-refund/gateway-timeout handling. All TP statuses remain `[ ]`; no row is claimed executed.
- **Gate 4 default assumptions (Revision 19 update; business defaults, not legal conclusions):** Shipping is refunded for merchant-caused returns and not for change-of-mind returns; opened food/water items are not accepted for change of mind, while opened or sealed items with a defect, damage on receipt, or an expired date receive a full item-price refund plus shipping under the shipping rule. The per-item basis is tax-inclusive amount actually paid after discounts under [DEFAULT-ASSUMPTION] D-2; owner may change this default; see the Default Assumptions Register. Undelivered electronically paid orders returned by the courier receive a system-computed full refund (items plus shipping) routed through admin approval/override with an audited reason. [DEFAULT-ASSUMPTION] D-2 sets tax-inclusive basis subject to accountant confirmation before launch; D-3 sets no automatic shipping withholding with an audited admin override; D-5 requires lawyer review before publication. Owner may change these defaults; see the Default Assumptions Register.
- **Refund formula documentation alignment (Revision 19; documentation only):** Removed stale wording that treated the shipping/opened-item rules or undelivered electronic refund as undecided; documented structured `return_item.return_cause` and `goods_condition`, audited formula breakdown fields on `return_request`, and an immutable paid-after-discount per-unit snapshot on `order_batch_allocation`. Added the ordered formula decision table and mapped existing TP-21/22/23/25d coverage; no new TP rows were added, the registry remains 59, and no lock-order text or checkbox status was changed.
- **Revision 19 follow-up (documentation only):** Scoped TP-23c's `collection_failed`/no-refund result to undelivered COD and documented full items-plus-shipping refund approval/override plus TP-25d reconciliation for undelivered electronic orders. Replaced stale Gate 4 wording in `security-and-deployment.md`; added `courier_undelivered` to the `return_cause` constraint and undelivered-depot decision table; recorded the sealed change-of-mind item-price-only business decision as [DEFAULT-ASSUMPTION] D-4; owner may change it; see the Default Assumptions Register. No TP rows, lock-order text, or checkbox statuses changed.
- **Revision 19 refund-mechanism correction (documentation only):** Enabled frozen approval and refund-intent creation for electronic `undelivered_depot_return` requests, and updated the completion guard to require exact completed/reconciled refunds against the frozen amount. Explicitly allowed no-payout completion only when no `refund_record` exists and the electronic payment is `voided` or `failed` before capture. Made `goods_condition` conditionally required via `chk_return_item_goods_condition`, with NULL required for `courier_undelivered`; documented the existing advisory-rooted refund lock order with `electronic_payment_attempt` as settlement row; clarified TP-23c/TP-25d coverage. Recorded sealed change-of-mind item-price-only handling as [DEFAULT-ASSUMPTION] D-4; the owner may change this default. No TP rows, lock-order design text, or checkbox statuses changed.
- **Risk register:** Adds risks `R-26` through `R-30` covering uncertain payment/order-creation outcomes, duplicate/forged/out-of-order webhooks, electronic refund ambiguity/timeouts, open refund-formula parameters, and gateway-specific assumptions before provider selection.
- **Architecture and review artifacts:** Removes the COD-only MVP decision from `architecture.md`; updates `phase-0-review-report.md` and `phase-0-review-summary.md` to Revision 19 and aligns them with the Phase 0/Phase 1 evidence boundary and the Gate 4/Gate 6 decisions.
- **Checkout workflow naming (documentation only):** Renamed `completeCodCartWorkflow` to `completeCheckoutWorkflow` in `architecture.md`; this is a naming-only documentation change and does not alter COD-specific entities, workflow behavior, or the locking design.
- **Lock-order design:** Revision 19 does not change the locking design. The Revision 18 cross-domain lock-order reconciliation remains a historical design origin retained in the current documents; runtime deadlock/concurrency behavior remains unverified and belongs to the Phase 1 Spike.
- **Revision 19 follow-up (documentation only; starting `main` was `323a8e4aa248c14bba03fe8cd1e75b244ef3feb3`):** Added return-status transition tables to workflow §1.1 and data-model §4, naming `customer_return_received_at_warehouse` for customer receipts and specifying direct creation of undelivered depot requests in `pending_inspection` with `received_at_warehouse` sourced from the authoritative `returned_to_warehouse` event. Tightened no-payout completion to require no `refund_record` of any status, selected attempt `status IN ('failed','voided') AND paid_at IS NULL`, and no captured attempt for the order; explicitly excluded `abandoned`, `void_pending`, and `outcome_unknown`. Documented that this defensive exception is unreachable in normal shipping and that gateway status mapping follows [DEFAULT-ASSUMPTION] D-1; the provider simulator is used in the Spike and the owner may change this default. Decoupled customer-return completion from `approved_restock`, aligned `chk_completed_return_has_amount` and `check_return_request_state()`, extended existing TP-23c/TP-23f/TP-21d/TP-25d coverage, and corrected the active §7.2.C lock-order phrase to name the selected method-specific settlement row. All designs remain `[PROPOSED]`; no TP rows were added, all TP statuses remain `[ ]`, no `[VALIDATED-TEST]` evidence was added, and lock-order design was not changed.

### Revision 19 follow-up — SQL syntax, return reactivation, section numbering, tables, and defaults (documentation only)

Starting `main` commit: `323a8e4aa248c14bba03fe8cd1e75b244ef3feb3`.

- Fixed `check_return_request_state()` by removing the trailing comma in the approval-count SELECT and removing the undeclared, unused `v_approved_item_count` count/INTO target. Refund eligibility remains independent of restock approval.
- Restricted `undelivered_depot_return` reactivation to `pending_inspection` with `ILLEGAL_DEPOT_RETURN_REACTIVATION_STATUS`; customer returns retain both `pending_receipt` and `pending_inspection`. Aligned the transition tables, trigger comment, and workflow contract.
- Renumbered duplicate headings: `architecture.md` later §4.3A became §4.4 and following sections became §4.5 and §4.6; `data-model.md` later §4.3 became §4.4 and following §4.4 became §4.5. Updated architecture section references in this file.
- Corrected the malformed TP-15b, TP-23f, workflow CP-3, and review-report CP-3 rows using surrounding meaning; no `[TO BE CONFIRMED]` cells were necessary. The change-log candidate row matched its header and needed no edit.
- Added Default Assumptions Register D-1 through D-6 and aligned the affected refund, payment, legal-policy, launch-gate, review, workflow, data-model, brief, and implementation-plan wording. Defaults are not owner-approved; the owner may change them.
- Relabeled the architecture transaction sketch and bare predicate as `text` fences because they are not standalone SQL statements.
- SQL was syntax-parsed only. This does not prove function behavior, trigger creation on a real database, or concurrency. No runtime tests, migrations, builds, or installs against the project were performed. The TP registry remains 59 rows and every TP row remains `[ ]`; no lock-order design was changed.

### Revision 19 follow-up — Closure wording, anchor fix, foreign exchange default D-7, and final review record (documentation only)

Starting `main` commit: `60c41a1a0b2b345b6e6bb1f0fae55bdb08922e82`.

- Fixed broken anchor link at line 367 to `#workstream-2-canonical-seven-checkpoint-crash-recovery-matrix`. Re-ran full local anchor check across all ten markdown files; 0 broken anchors remain.
- Updated closure status wording across all documents to explicitly state "recorded owner decisions and default assumptions (owner may change)", reflecting that D-1 through D-7 are default assumptions rather than approved owner decisions.
- Formulated default assumption D-7 in `risk-and-assumptions.md` for `rate_determination_policy = 'customs_clearance_date'`, affecting batch cost accounting only without blocking Phase 0; replaced `[OWNER-DECISION]` tag on `inventory_batch.rate_determination_policy` in `data-model.md` and aligned `A-06`.
- Added "Phase 0 Final Review Record" to `phase-0-review-summary.md` detailing all static checks performed, unverified runtime aspects, open launch gates (1, 2, 3, 5 and lawyer review), and a blank owner signature block.
- No application code, migrations, builds, or runtime tests were run. TP registry remains exactly 59 rows with all statuses unchecked `[ ]`. Lock-order design remains unchanged.
- Documents moved into `docs/` (commit `35327678e6fee57af2fcb7e4463509d02d59e6a7`), stray empty file `docs` removed, and repository renamed to `zamzam-store`. Content unchanged (documentation only); no checkbox changed, TP registry remains 59 rows all `[ ]`, and lock-order design unchanged.

### Revision 19 follow-up — Phase 0 design acceptance and sign-off (documentation only)

Starting `main` commit: `00d8c84ce34a10b07a5d75d61b068b5e7f1bbb00`.

- The project owner confirmed acceptance of Phase 0 design criteria. Recorded acceptance by marking the eight Phase 0 design criteria (1–8) and the nine design-review checks (A–I) as `[x]` in `implementation-plan.md` and `phase-0-review-summary.md`.
- Updated `Phase 0 Final Review Record` in `phase-0-review-summary.md` with review date 2026-10-25 (Africa/Cairo), reviewed commit `00d8c84ce34a10b07a5d75d61b068b5e7f1bbb00`, checks performed, explicit runtime-unverified boundary, open launch gates, and owner sign-off.
- Aligned review decision status in headers across canonical documents to reflect owner design acceptance while preserving the runtime evidence boundary.
- TP registry strictly preserved at exactly 59 rows with every runtime status remaining `[ ]`. Lock-order design remains unchanged. No application code, package installation, build, migration, or runtime test was executed.


### Revision 19 follow-up — Acceptance wording reconciliation (documentation only)

Starting `main` commit: `e60b26f1b9bee52ee6ba5a5b625c7ab0bff362c2`.

- Reconciled stale acceptance wording in `implementation-plan.md`, `phase-0-review-summary.md`, and `phase-0-review-report.md` with the owner-accepted design state; updated the roadmap status and the current cross-document review row.
- Clarified that the eight Phase 0 design-acceptance criteria and checks A–I are accepted for documentation only, while all 59 TP runtime statuses remain `[ ]`.
- Restored the owner sign-off line in `phase-0-review-summary.md` to the requested blank template. The owner’s design acceptance is recorded separately; no signature was invented.
- No application code, lock-order design, TP rows, TP statuses, or runtime evidence claims were changed.


### Phase 1 follow-up — tested Medusa cohort and dependency-resolution decision (2026-10-26)

- The Phase 1 Spike's tested Medusa cohort is **2.22.1** for `@medusajs/*`. This version was used during the locking-provider review (including commit `ee781b175394fe4d336eb9617f684bb01868609f`) so the adapter and its observed acquire/release semantics were reviewed against the same upstream source cohort as the Spike.
- References elsewhere in the historical design/review documents to Medusa **2.21.2** record an earlier candidate cohort. They are historical for the Phase 1 Spike; they do not change the design rules or imply that 2.21.2 is being tested by the current workflow.
- Root devDependencies pin `tsconfig-paths@4.2.0` because Medusa CLI 2.22.1 calls `register({})` without declaring that package. Root pins `ajv@8.20.0`, `ajv-formats@2.1.1`, and `picomatch@3.0.2` satisfy optional peer ranges in the Medusa admin/dashboard tree and avoid incompatible versions being hoisted to the root. npm should retain incompatible major versions as nested dependencies.
- The dependency resolution must be reproducible from a committed `package-lock.json` using `npm ci --strict-peer-deps`. No TP behavior case is run or accepted by this dependency decision; all 59 TP statuses stay unchecked.

