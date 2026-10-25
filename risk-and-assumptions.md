# Risk, Assumptions, and Compliance Register
## Project: Arabic-First E-Commerce Store for Imported Food Products (Egypt)
**Document Status:** Revision 19 — Electronic Payments and Phase 0 Design Closure (Design Revision; Runtime Unverified)  
**Date:** 2026-10-25  
**Current Review Decision:** `Phase 0 design closure is defined; cross-document review/sign-off is pending. Runtime evidence is deferred to the Phase 1 Technical Compatibility Spike.`  
*(Phase 0 closes on design/documentation and recorded owner decisions only; a restricted Phase 1 Technical Compatibility Spike may run before Phase 0 sign-off, but store feature development remains blocked until the spike evidence and launch gates are reviewed)*

---

## 1. Technical Claims and Validation Taxonomy

In compliance with Engineering Rules 2, 7, and 9 (Claim Discipline), all technical capabilities, architectural mechanisms, and assumptions in this project are classified under five distinct validation tiers:

| Tag | Definition | Current Status |
|---|---|---|
| **`[VERIFIED-DOCS]`** | Confirmed directly against current official framework documentation for the selected version lines. | Medusa v2 Workflows & Locking Module concepts; Medusa v2 major-unit pricing model (`number`); Medusa Remote Links (`defineLink`); Node.js 24/22 LTS schedule; built-in payment provider ID pattern `pp_system_default`. |
| **`[SOURCE-VERIFIED]`** | Inspected in actual published package tarballs on the public npm registry. | Historical source inspections were made against `@medusajs/core-flows@2.22.1`, `@medusajs/order@2.22.1`, and `@medusajs/locking-redis@2.22.1`. These historical inspections do **not** establish API/source behavior for the current Revision 19 candidate `2.21.2` cohort; re-inspect the actual installed packages before implementation. |
| **`[VALIDATED-TEST]`** | Proven via an executed test command or verified prototype in this environment with reproducible terminal output. | *None in Phase 0 (will be populated during Phase 1 technical prototype execution and Phase 3 automated test executions).* |
| **`[PROPOSED]`** | Proposed architectural design; sound in theory and aligned with framework principles, but not yet executed in this repository. | Persistent PostgreSQL idempotency lease with 7-checkpoint recovery; immutable attempt tracking (`cart_checkout_attempt`); real checkout epoch fencing; canonical Cairo timezone FEFO query; pre-dispatch revalidation gate; atomic `GETDEL` claim exchange (`Path=/`); 4-stage Preventive Dual-Control Refund Protocol with complete actor separation; custom calculated fulfillment provider in major EGP units; cross-row return quantity & reactivation triggers. |
| **`[OWNER-DECISION]`** | Requires explicit business, commercial, operational, or legal owner approval. | Gate 4 and Gate 6 decisions are recorded with open parameters; Gates 1, 2, 3, and 5 are launch-only evidence/approval gates. |

---

## 2. Business Assumptions Register

| ID | Assumption Description | Category | Validation Tier | Impact / Contingency |
|---|---|---|---|---|
| **A-01** | The store initially sells only packaged Zamzam water and packaged dates. No local repackaging or bottling will occur. | Operations | `[OWNER-DECISION]` | Covered by Launch Gate 1. If bulk packaging is required later, batch tracking must extend to parent-child transformation batches. |
| **A-02** | Goods are physically stored in an initial local warehouse in Egypt prior to listing on the storefront. | Inventory | `[OWNER-DECISION]` | Delivery timeframes per governorate depend on courier service level agreements. |
| **A-03** | MVP supports electronic payment and Cash on Delivery (COD) side by side. | Payments | `[OWNER-DECISION]` | **Decision recorded — final:** both methods are offered side by side. Specific electronic payment gateway remains `Owner input required`; do not assume a provider. |
| **A-04** | Shipping fees are flat rates mapped per Egyptian governorate zone in `shipping_delivery_zone`. | Logistics | `[OWNER-DECISION]` | Covered by Launch Gate 3. Stored in `shipping_delivery_zone`; owner supplies authoritative rate matrix in major EGP units. |
| **A-05** | Guest checkout requires Full Name, Egyptian Mobile Number, Governorate, and Street Address. Public access secured via one-time claim codes and phone OTP. | Checkout | `[PROPOSED]` | Normalizes phone to `+201XXXXXXXXX`. Single-use atomic `GETDEL` claim codes prevent URL leakage; OTP provides secure recurring access. Technical idempotency retention is a 14-day operational support policy. |
| **A-06** | Supplier sourcing invoices may be denominated in foreign currency (SAR/USD) and are converted to EGP at the intake date exchange rate. | Accounting | `[PROPOSED]` / `[OWNER-DECISION]` | Stored in `inventory_batch` (`purchase_currency`, `purchase_price_raw`, `exchange_rate_to_egp`, `unit_cost_purchase`). Exchange rate must be strictly positive with no silent default rate of 1. Rate determination policy (`customs_clearance_date`) requires owner sign-off. |

### Default Assumptions Register (owner may change)

These defaults unblock Phase 0 documentation consistency; they are not legal/accounting advice and may be changed by the owner. Launch-only evidence gates remain open until evidence is recorded.

| ID | Default assumption | Scope / required follow-up |
|---|---|---|
| **D-1** | **Payment gateway:** Phase 0 remains provider-agnostic; no vendor is selected. The Phase 1 Spike uses a provider simulator. | Before launch, select against recorded criteria: hosted payment page/redirect, signed webhooks, idempotency support, partial-refund API, void support, fees, settlement time, and account requirements. |
| **D-2** | **Tax:** Customer-facing prices are tax-inclusive. Refunds use the tax-inclusive amount actually paid after discounts. The MVP does not calculate tax separately. | Accountant must confirm the treatment before launch. This is a default assumption, not a tax determination. |
| **D-3** | **Refused/unreachable undelivered electronic orders:** No automatic shipping withholding. The system proposes a full items-plus-shipping refund. An admin may set the shipping component to zero only through the existing override, with mandatory reason and approver audit. | No schema change. Qualified legal review may require changing this default before launch. |
| **D-4** | **Sealed change-of-mind returns:** Accept sealed items for item price only, without shipping; reject opened change-of-mind returns. | Business default confirmed for design; remains subject to applicable Egyptian consumer-protection rules and qualified legal review. |
| **D-5** | **Arabic legal policies:** Arabic Terms of Service, Privacy Policy, and return/refund policy are launch gates and must be reviewed by a qualified lawyer before publication. | This does not block Phase 0 documentation closure. Egyptian consumer-protection rules may constrain opened-item and shipping rules. |
| **D-6** | **Launch-only evidence gates:** Gates 1, 2, 3, and 5 block launch only. | Gate 1 requires real-world evidence for Zamzam source/labels and date batches; assume nothing about provenance. Gate 3 rates used in the Spike must be labelled non-production test rates. Gate 5 restore drill must be documented and executed before launch. |

---

## 3. Comprehensive Risk Register and Mitigation

| Risk ID | Risk Description | Severity | Likelihood | Validation Tier | Architectural Mitigation |
|---|---|---|---|---|---|
| **R-01** | **Risk of Selling Expired Food Stock:** Distributing water or dates past their expiration date. | **Critical** | Low | `[PROPOSED]` | **Canonical Database-Level FEFO Query:** Excludes batches whose remaining shelf life $\le$ `min_shelf_life_days` directly in SQL relative to `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`. |
| **R-02** | **Risk of Stock Expiring After Reservation:** Allocated batches crossing expiration thresholds while awaiting dispatch. | **High** | Low | `[PROPOSED]` | **Pre-Dispatch Revalidation Gate:** `fulfillBatchOrderWorkflow` revalidates batch calendar expiration prior to dispatch. If expired in-situ, dispatch is blocked (`dispatch_blocked = true`), and `reallocateOrCancelBatchStep` executes atomic FEFO reallocation or line cancellation. |
| **R-03** | **Cart Locking, TTL Expiry & Stale Worker Races:** Lock expiring during stalled checkout, allowing a zombie worker to commit after another worker takes over. | **High** | Medium | `[SOURCE-VERIFIED]` / `[PROPOSED]` | **Lock Renewal, Immutable Attempts & Fencing:** Redis cart lock TTL is 120s with 30s heartbeat calling `extendLock`. If Redis lock lost, worker aborts. Fencing enforced via `cart_checkout_session` and immutable `cart_checkout_attempt`. Stale workers update 0 rows and roll back. They may cancel only after an authoritative order binding and policy check; if the native workflow outcome is unknown they set `needs_reconciliation` and do not cancel, release, or recreate an order. |
| **R-04** | **Saga Compensation Step Failure:** Network interruption during batch release after an order creation failure. | **High** | Low | `[VERIFIED-DOCS]` | **Workflow Execution Watchdog:** Medusa v2 logs failed workflow compensations in `medusa_workflow_execution`. A background watchdog monitors failed compensations and alerts administrators. |
| **R-05** | **Unrecorded Courier Cash Collections:** Courier collects cash from customer but delays bank remittance. | **High** | Medium | `[PROPOSED]` | **Three-Way State Separation:** Decoupling `fulfillment_status = 'delivered'` from `cod_collection_record.collection_status = 'remitted_to_bank'`. COD orders cannot transition to `completed` until courier bank remittance is reconciled; electronic-payment orders require authoritative electronic `paid` state. |
| **R-06** | **Missing Commercial Purchase Invoices:** Inability to produce standard tax invoices for some imported lots. | **High** | High | `[OWNER-DECISION]` | **Compliance Ledger Policy:** Covered by Launch Gate 1. System provides `private_document` storage for available affidavits, receipts, and customs manifests. The system will **never** fabricate false invoices or provenance claims. |
| **R-07** | **Late-Arriving Landed Costs:** Freight or customs invoices arriving after batches have been sold. | **Medium** | High | `[PROPOSED]` | **Dual-Effect Cost Adjustment:** Adjustments revalue remaining on-hand units while tracking a `retroactive_sold_units_variance` for period COGS reporting, preserving original order price snapshots. |
| **R-08** | **Delivery Failures Treated as Simple Cancellations:** Goods returned by courier restocked without food safety checks, or confused with customer returns. | **High** | Medium | `[PROPOSED]` | **Separation of Delivery Failure vs Customer Return:** Undelivered COD parcels transition to `undelivered_returned` / `returned_to_warehouse` with `cod_collection_record.collection_status = 'collection_failed'` (strictly terminal); no cash refund is due if no cash was collected. For an electronically paid parcel returned undelivered, the system computes a full refund (items plus shipping) and routes it through admin approval/override with an audited reason. Whether shipping may be withheld if the customer refused delivery or was unreachable remains `Owner input required`. Goods enter `quantity_quarantined` and require supervisor inspection before any restock decision. |
| **R-09** | **Stale Idempotency Key Reclaimed with Modified Payload:** Re-executing a stale key with different cart data. | **High** | Low | `[PROPOSED]` | **Atomic Lease with Hash Validation:** The `INSERT ... ON CONFLICT` statement requires exact matching `request_hash` and `request_path`, rejecting modified payloads immediately with 409 Conflict. |
| **R-10** | **Guest Order Token Leakage via URLs & Referrer:** Plaintext lookup tokens exposed in browser history, logs, or external Referer headers. | **High** | Medium | `[PROPOSED]` | **Atomic Token Exchange Protocol:** Order confirmation URL provides a short-lived claim code exchanged via server-side `POST /api/orders/claim` using atomic Redis `GETDEL`. Issues opaque session cookie (`Path=/`). Token entry routes enforce `Referrer-Policy: no-referrer`. Long-term lookup uses SMS/WhatsApp OTP. Plaintext secrets are never stored in the database response cache. |
| **R-11** | **Shipping Rate Discrepancies & Currency Precision:** Misinterpreting Medusa v2 currency units (multiplying by 100) or client tampering. | **Critical** | Medium | `[VERIFIED-DOCS]` / `[PROPOSED]` | **Authoritative Major-Unit Rate Validation:** Medusa v2 handles prices in major currency units. Provider `egypt-zone-fulfillment` returns exact decimal EGP amount (50 EGP = 50.00). Injected into native cart totals. Stale rates re-checked at checkout. |
| **R-12** | **Quarantine / Expiration Job Deadlocks on Reserved Inventory:** Background expiration job attempting to quarantine batches currently reserved by in-flight carts. | **Medium** | Low | `[PROPOSED]` | **Safe Quarantine Rule:** The daily expiration alert job quarantines **only** unreserved stock (`on_hand - reserved - quarantined`). Reserved stock that expires in-situ is caught safely by the pre-dispatch revalidation gate. |
| **R-13** | **Premature Refund Disbursement Prior to Cash Remittance:** Processing customer returns and payouts before courier remits cash. | **High** | Low | `[PROPOSED]` | **Refund Guard:** For COD, `processOrderRefundWorkflow` verifies `cod_collection_record.collection_status IN ('remitted_to_bank', 'partially_refunded')`; for electronic payment, it verifies the authoritative `electronic_payment_attempt.status IN ('paid', 'partially_refunded')`. In both cases, cumulative reserved refunds never exceed the settled amount for the selected payment method. |
| **R-14** | **Concurrent Refund Payouts & Lack of Preventive Controls:** Multiple concurrent refund submissions causing duplicate payouts or unapproved cash disbursements. | **High** | Medium | `[PROPOSED]` | **Preventive Dual Control & Actor Separation:** 4-stage lifecycle (`pending_approval` -> `approved` -> `disbursement_submitted` -> `completed`) with strict separation of duties (`requested_by`, `approved_by`, `disbursed_by`, `reconciled_by`). Unique `external_reference` required for disbursement. Replays verified under row lock using stable HMAC `recipient_fingerprint`. |
| **R-15** | **Reservation Cleanup & Conversion Lock Inversion Deadlocks:** Cleanup and checkout conversion locking batch and reservation rows in conflicting order, causing deadlocks. | **Medium** | Low | `[PROPOSED]` | **Revision 18 (historical) Cross-Domain Lock Hierarchy, Revalidated Snapshots & Explicit State-Divergence Errors:** Existing-order custom workflows first acquire the shared transaction-scoped advisory lock keyed by `order_id`; if checkout session/attempt rows are also needed, they follow before inventory rows. Proven pre-order cart-only flows lock session then attempt. All workflows that mutate batch balances then lock all affected `inventory_batch` rows in ascending ID order before reservation/allocation child rows. Cleanup revalidates active status under lock, decrements via canonical `candidate.quantity`, and records `inventory_movement` with `canonical hashed `reservation_release`/`cleanup` key generated by the shared helper` using locked balance snapshots. Conversion uses exclusively the locked, validated reservation set. |
| **R-16** | **Concurrent Over-Return Across Multiple Return Requests:** Concurrent requests returning more items than originally purchased on a line item or batch. | **High** | Medium | `[PROPOSED]` | **Cross-Row Return Quantity & Reactivation Triggers:** Enforced via PostgreSQL trigger (`trg_check_return_quantity` on `return_item`) that row-locks parent `return_request` FOR SHARE and `order_item` FOR UPDATE. Reactivation trigger (`trg_check_return_request_reactivation` on `return_request`) aggregates current request items by `(line_item_id, batch_id)` and prevents bypass to terminal completed state. |
| **R-17** | **Inventory Movement Ledger Divergence & History Tampering:** Schema mismatches, single-delta representations, unconstrained snapshots, or historical mutation of ledger records. | **High** | Low | `[PROPOSED]` | **3-Delta Canonical Ledger Contract, Bounded Hashed Keys, Immutability Trigger & Inception Policy:** Reconciled canonical `inventory_movement` schema defining independent integer deltas (`quantity_on_hand_delta`, `quantity_reserved_delta`, `quantity_quarantined_delta`), row-locked snapshots constrained to non-negative balances satisfying tri-balance invariants, and strict check constraints. Trigger `trg_inventory_movement_immutable` rejects all `UPDATE` and `DELETE` queries. Batches initialize at 0 and record initial stock via `receipt` movement within batch creation transaction, keyed by unique `inventory_batch.receipt_operation_id`, ensuring ledger sum invariants hold from inception. Replays evaluate batch, variant, movement type, all three deltas, references, reason, and actor under the batch lock; mismatches abort with 409 Conflict. The bounded `inv:v1` SHA-256 key contract is defined in `data-model.md` §5.6. All behavior remains `[PROPOSED]` until TP execution. |

---

### Phase 0 Acceptance Criterion 8 — Owner Decisions and Launch-Gate Classification

**Design/documentation acceptance wording:** “Gate 4 refund decisions are recorded as final, with tax treatment, possible shipping withholding for refused/unreachable undelivered electronic orders, and Arabic policy legal review/approval still marked `Owner input required`; Gate 6 gateway selection remains open. Gates 1, 2, 3, and 5 are `blocks launch only` and do not block Phase 0 design closure.” This is a documentation status, not evidence that launch gates have been completed.

## 4. Product-Owner Launch Gates and Final Owner Decisions

Phase 0 design closure does not depend on completion of Gates 1, 2, 3, or 5. Those gates **block launch only**. Gate 4 and Gate 6 decisions are recorded as decided, with open parameters explicitly listed below. Production sales remain disabled until launch-only gates are satisfied and required payment/refund parameters are finalized.

### Gate 1 — Zamzam Water Authenticity and Labeling Verification
**Status:** `blocks launch only` — external evidence required.
- [ ] Owner confirms in writing source, packaging, labeling, distribution and applicable regulatory compliance.
- [ ] Until evidence is provided, descriptions remain neutral and avoid unverified origin, health, or marketing claims.

### Gate 2 — Date Packaging and Production Date Inspection
**Status:** `blocks launch only` — external evidence required.
- [ ] Physical expiration dates and lot numbers stamped on packages match inventory batch records.
- [ ] Record the inspection outcome and resolve any mismatches before listing affected stock.

### Gate 3 — Egyptian Governorate Delivery Rate Matrix
**Status:** `blocks launch only` — business data required.
- [ ] Owner supplies and approves final flat delivery rates per governorate in major EGP units for `shipping_delivery_zone`.

### Gate 4 — Refund Formula and Commercial Return Policy
**Status:** `decided, with remaining open parameters`.
**Final owner decisions (business decisions, not legal conclusions):**
1. **Shipping:** Shipping is refunded when the return is caused by the merchant (wrong item, damaged, or expired). Shipping is not refunded when the customer simply changes their mind.
2. **Opened items and goods condition:** Because the products are packaged food and water, opened-item returns for a change of mind are not accepted. Opened or sealed items with a defect, damage on receipt, or an expired date are accepted with a full refund of the item price plus shipping under rule 1. The formula's goods-condition categories are `sealed`, `opened`, `damaged_on_receipt`, and `expired`.
3. **Per-item price basis:** Use the amount actually paid for each item after discounts.
4. **Undelivered electronic orders:** When an electronically paid order is returned undelivered by the courier, the system computes a full refund (items plus shipping) and routes it through the normal admin approval/override flow, with an audited reason for any override.
5. **Confirmed — sealed change-of-mind return:** A sealed (unopened) item returned for change of mind is accepted for item price only, without shipping. This is a confirmed business decision, not a legal conclusion, and remains subject to the lawyer review already listed below.
**Owner input required — remaining open items:**
- **Tax treatment:** How tax included in the amount paid is treated; accountant input is required.
- **Refused/unreachable undelivered electronic orders:** Whether shipping may be withheld when the customer refused delivery or could not be reached.
- **Arabic policy text:** Approval of the Arabic Terms of Service, Privacy Policy, and return/refund policy text; legal review is required before launch.

Consumer-protection rules for online sales in Egypt may constrain the opened-item and shipping rules above; the policy text must not be published until it has been reviewed by a qualified lawyer.

### Gate 5 — Database Disaster Recovery Verification Drill
**Status:** `blocks launch only` — operational test required.
- [ ] Successfully restore a staging backup.
- [ ] Run and retain schema-consistency and inventory-ledger invariant query evidence against the restored database.

### Gate 6 — Payment Methods for the MVP
**Status:** `decided, with open parameters`.
**Final decision recorded:** Electronic payment and Cash on Delivery (COD) are offered side by side in the MVP. COD has its own collection/remittance state machine; electronic payment has a separate provider/payment state machine.
**Owner input required — exact question:** “Which electronic payment gateway should be selected for the MVP?” No gateway is selected in this revision; gateway-specific capabilities, webhook semantics, refund API, fees, and settlement/reconciliation contract remain unverified.

### Launch-gate checklist (Gates 1, 2, 3, 5)
- [ ] Gate 1: Source/label/regulatory evidence accepted.
- [ ] Gate 2: Physical date and lot-label reconciliation signed off.
- [ ] Gate 3: Governorate shipping-rate matrix approved.
- [ ] Gate 5: Staging restore drill and query evidence accepted.

## 5. Inventory Ledger Task Status (Documentation Only)

`TASK 1.1 DOCUMENTATION CONTRACT RECONCILED; RUNTIME CONCURRENCY VALIDATION PENDING` is the current status. Revision 18 (historical design revision) defined a shared order-scoped advisory root lock for existing-order custom workflows, preserves the session/attempt-before-batch rule for proven pre-order flows, requires sorted batch locks before child inventory rows, and separates physical stock transactions from refund/disbursement transactions. This is a proposed contract only: no PostgreSQL concurrency scenario or application integration test has been executed in this workspace. Do not call this runtime-closed or `[VALIDATED-TEST]`. Phase 0 closure is a documentation/design decision; the lock protocol remains runtime-unverified and its evidence belongs to the Phase 1 Spike.


## 6. Historical Revision 16 Workstream Risks (Current statuses updated in Revision 19)

| ID | Risk | Severity | Mitigation documented in Revision 16 | Validation / Owner status |
|---|---|---|---|---|
| **R-20** | Medusa cart completion may create an order even if nested workflow output is absent/ambiguous; unsafe recovery could create a duplicate order or release stock while an order exists. | **Critical** | Persist `order_creation_started` and `pending_correlation` before `completeCartWorkflow.runAsStep({ input: { id: cart.id } })`; recover via native `cart_id`; do not recreate/cancel/release while outcome unknown; stop on ambiguity. | `[PROPOSED]`; TP-08a/b and TP-13c `[ ]`. Exact behavior must be tested on the pinned package cohort. |
| **R-21** | A payout may succeed externally while the response/DB update is lost, creating a duplicate payout risk on retry. | **Critical** | Durable `refund_disbursement_attempt`, `disbursement_unknown`, capacity reservation, no automatic resend, evidence-based reconciliation by a distinct actor. | `[PROPOSED]`; TP-21/22 `[ ]`. Business owner must approve manual payout reconciliation procedure. |
| **R-22** | Order edits or version changes after batch allocation can make return quantities compare against the wrong order-item version. | **High** | Capture immutable `order_version` in allocation and return request; prohibit edits to allocated batch-managed order lines until a reallocation design exists. | `[PROPOSED]`; TP-23a-f `[ ]`. |
| **R-23** | Medusa package publication is staggered; using unrelated `2.22.x` tags may create an untested dependency graph. | **High** | Use exact `2.21.2` direct-package candidate cohort and treat it as provisional until npm metadata, peer resolution, lockfile, install, and builds pass. | `[PROPOSED]`; no lockfile/install/build evidence provided. |
| **R-24** | Initial one-time claim response differs from idempotency replay by design; clients expecting byte-identical JSON may mishandle retries. | **High** | Persist only a sanitized body; replay returns safe order identity and directs the guest to OTP lookup without reproducing the claim code. | `[PROPOSED]`; TP-12a `[ ]`; frontend contract still requires implementation/test. |
| **R-25** | Refund calculation still has open accounting and delivery-policy inputs: tax treatment and possible shipping withholding for refused/unreachable undelivered electronic orders. | **High** | The merchant-fault/change-of-mind shipping rule, opened-item policy, discounted paid item-price basis, and full items-plus-shipping refund routing for undelivered electronic orders are recorded. Tax and refused/unreachable delivery shipping treatment remain open; override reason/approver are audited and the approved amount is frozen. | `[OWNER-DECISION]`; Gate 4 decided with remaining open parameters; TP-21/22/23/25d `[ ]`. |
| **R-26** | Electronic payment succeeds but order creation fails or order correlation remains uncertain; unsafe compensation can cause double charge or premature stock release. | **Critical** | Payment attempt ledger, stable idempotency, keep reservation/fence while outcome is uncertain, and void/refund only after definitive outcome. | `[PROPOSED]`; TP-25c `[ ]`; gateway capabilities require owner selection. |
| **R-27** | Duplicate, forged, or out-of-order payment webhooks may duplicate or regress payment state. | **Critical** | Verify signatures, deduplicate by provider event ID/idempotency key, persist event processing state, and enforce monotonic/guarded transitions with reconciliation for stale events. | `[PROPOSED]`; TP-25b `[ ]`; exact signature contract depends on gateway. |
| **R-28** | Partial electronic refunds or gateway timeouts can lead to double refunds or local/provider ledger divergence. | **High** | Frozen approved amount, auditable override, reserved refund capacity, unknown-outcome state, no blind retry, and periodic provider-to-order reconciliation. | `[PROPOSED]`; TP-25d `[ ]`; gateway refund behavior unverified. |
| **R-29** | Refund total still depends on the open tax treatment and possible shipping withholding for refused/unreachable undelivered electronic orders. | **High** | Apply the recorded shipping, opened-item, discounted item-price, and undelivered-electronic-order decisions; do not guess the remaining tax or refused/unreachable delivery policy. Freeze the computed/overridden approved amount and audit overrides. | `[OWNER-DECISION]`; Gate 4 decided with remaining open parameters. |
| **R-30** | Gateway-specific integration assumptions may be wrong before a provider is selected. | **High** | Keep integration provider-neutral and select hosted/redirect checkout; verify provider signature, event identity, idempotency, refund, and reconciliation semantics during the Spike after owner selection. | `[OWNER-DECISION]`; Gate 6 decided with open gateway choice. |

## Revision 19 — Electronic Payment and Phase 0 Design Closure Risks

**Risk status: OPEN until runtime evidence exists.** The documented application lock hierarchy separates return-request/item creation and status transitions from physical return-stock transactions. The `return_item` UPDATE trigger no longer locks native order/order-item rows after a batch lock. This reduces the specified application-workflow inversion on paper, but does not prove that the real Medusa workflow, ORM transaction boundaries, PostgreSQL triggers, and all operational writers obey the protocol. Required evidence: migrations applied to a disposable PostgreSQL instance; TP-23a through TP-23f, TP-07b, TP-09/10/11 and relevant conversion/cleanup concurrency cases executed with interleaving logs; every failed transaction shown to roll back in full. Until then, retain `[PROPOSED]` and do not describe the protocol as deadlock-free.