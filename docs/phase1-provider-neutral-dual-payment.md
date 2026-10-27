# Provider-Neutral Dual-Payment Foundation

**Scope:** Draft PR #19, internal/nonproduction payment foundation. No endpoint, selected gateway, real payment, COD activation, TP-01 execution, or canonical TP acceptance is introduced here.

## Source audit and branch comparison

- **PR #19** is the current backend source lineage. It composes positive-value native Medusa cart completion, reservation conversion, exact EGP checkout/payment guards, immutable completed-checkout response, and an internal post-completion finalizer. completeAndFinalizeSameOrder persists the selected branch only after native completion/allocation and verifies current owner/epoch, order/cart association, lease, EGP amount, native payment collection/session, allocation and movement identity.
- **PR #16** is the payable native checkout/recovery source: real completeCartWorkflow, exact native order snapshot and payable guard. It does not include the later COD/electronic payment branch models/writes.
- **PR #13** is a divergent combined prototype carrying the initial order-operations/payment bridge but predates the newer payable composition. Its bridge accepts a fresh pending lease and must not be transplanted wholesale into a post-completion path.
- **PR #23** staged the #13 models on #16 and added a read-only quote validator. It explicitly excluded transactional payment writes. It is useful as quote validation history, not a replacement for #19's finalizer.

PR #19's finalizer is the current candidate authority; do not cherry-pick across those branches without reconciling migration order, checkout status, lock order, and amount validation. The current #19 Actions run on b4114926b4c59a2c59db383a299881ceb244f522 skipped same-order payment integration because the guest-ownership-only gate was enabled. The PR description reports a prior 51/51 local run; the focused workflow added with this document reruns that existing suite on ephemeral PostgreSQL/Redis and records fresh CI evidence.

## Independent state machines

### COD collection

~~~text
order created + COD selected -> unpaid
unpaid -> collected_by_carrier -> remitted_to_bank
unpaid -> collection_failed | cancelled
collected_by_carrier -> partially_refunded | fully_refunded
remitted_to_bank -> partially_refunded | fully_refunded
~~~

- Order creation, inventory allocation, checkout completion, and payment-branch record creation do **not** mean COD was collected. cod_collection_record.collection_status must remain unpaid until an authorized, evidenced collection operation changes it.
- Courier collection and bank remittance are separate events with separate amounts/references and audit evidence.
- Return/refund states never mean the customer paid electronically. COD collection/refund operations require a future, separately authorized operational service and reconciliation policy.

### Electronic payment

~~~text
initiated -> authorized -> paid -> partially_refunded -> refunded
initiated -> paid
initiated | authorized -> failed | abandoned
initiated | authorized -> outcome_unknown
outcome_unknown -> authorized | paid | failed | void_pending
initiated | authorized | outcome_unknown -> void_pending -> voided
paid -> void_pending (refund/void pending; resolve from provider evidence)
~~~

- paid requires an authenticated provider result bound to the exact attempt, order, provider payment ID, EGP amount and currency. Native order creation and a Medusa local system-provider session are not proof of settlement.
- A timeout after a provider request is outcome_unknown; do not create a new charge attempt until a provider status lookup or reconciliation resolves the old one.
- Duplicate/replayed event identity must be idempotent. Reusing a provider event ID with different normalized content is an integrity alert. Older events cannot regress a later terminal state; contradictory money-moving events require reconciliation.
- The internal event ledger records normalized event identity in a durable inbox, serializes updates on the electronic attempt, checks exact EGP amount and attempt/provider identity, makes exact replay idempotent, rejects event-ID/content conflicts, and retains stale or ambiguous events for reconciliation. Settlement claims (`paid`) are always retained as `needs_reconciliation` while no gateway and authenticated adapter are configured. The ledger does not authenticate callbacks, call a provider, or update native Medusa payment records.

## Provider-neutral electronic adapter contract

The internal TypeScript boundary is apps/backend/src/modules/order-operations/payment-provider-contract.ts. It defines no concrete provider and is not mounted or wired to a route.

An adapter implementation must:

1. Accept only server-created intent data: stable checkout attempt/idempotency identity and exact server-derived amount in EGP minor-unit decimal text. The browser never supplies an amount or provider ID.
2. Create/retrieve an intent with provider-side idempotency. Retrying the same idempotency key must resolve to the same provider intent or an explicit conflict.
3. Verify provider authenticity (signature over documented raw request bytes, timestamp/replay window and account/environment binding) before returning a normalized event.
4. Normalize a stable provider event ID, attempt/provider payment identity, state, exact EGP amount/currency, provider sequence/time where available, and payload digest. Never forward secret headers or raw customer payload to the payment core.
5. Support an authoritative status lookup for outcome_unknown; absence of this capability must leave payment blocked/unknown.
6. Keep authorization/capture/void/refund semantics provider-specific behind the adapter. No provider is selected, so no implementation may claim charge/capture/refund/settlement capability.

The internal inbox is not a public event consumer. A future provider adapter must verify raw-body signatures, freshness, account/environment and provider identity before calling this ledger. It must resolve uncertain outcomes through an authoritative status lookup. Missing or ambiguous ordering is retained for reconciliation. Refund events remain reconciliation-only until amount-specific refund accounting exists. The ledger updates only the internal attempt status; synchronization with native Medusa payment collections and sessions remains a production requirement.

## Exact monetary identity and COD paid-state guard

PR #19 derives monetary authority from the native Medusa snapshot, uses integer minor-unit strings for comparisons, and guards cart, payment collection and session before native completion. Its finalizer rechecks native order version/currency/total and payment collection/session identity inside the protected transaction before branch persistence. The same-order test asserts a nonzero EGP fixture (61.70, 6170 piastres) and rejects amount/version/currency/collection divergence. No storefront-supplied amount is authoritative.

The COD integration assertion must remain collection_status === "unpaid"; the electronic simulator assertion remains status === "initiated" with provider_key === "phase1-simulator". Those statuses explicitly avoid claiming actual collection or electronic settlement.

## Focused disposable verification

The focused workflow applies migrations only after disposable-target validation, then runs event-ledger cases and the positive-value same-native-order COD/electronic component suite against ephemeral PostgreSQL and Redis. It does not run TP-01, change canonical acceptance markers, invoke a real provider, or expose an endpoint. The suite covers:

- Both methods use their same native Medusa order and exact EGP amount.
- COD stays unpaid; electronic remains initiated/simulated.
- Two independent processes racing to finalize electronic payment serialize to one branch.
- Exact replay creates no duplicate branch/allocation/movement.
- Wrong method/owner/cart/order/attempt/epoch/total/version, expired pending lease, and cart/payment mismatch fail closed.
- Checkout interruption and committed-allocation-before-response recovery resolve to the same order without duplicate allocation or payment record.
- Event cases cover exact replay, simulator settlement claims blocked from changing state, event-ID content conflict, amount rejection, unknown-outcome recovery held for reconciliation, stale revision retention, concurrent duplicate delivery, and provider mismatch.

**Not covered by the current suite:** authentic provider callback/signature verification, real provider status lookup, synchronization with native Medusa payment records, COD courier settlement/remittance, or real charge/refund. No provider or COD operational workflow is activated.

## Production integration blockers

1. Select an electronic gateway and approve its hosted/redirect flow, idempotency semantics, signature scheme, event ordering, status lookup, capture/refund behavior and sandbox credentials.
2. Implement a durable event inbox/consumer and provider-specific adapter; test duplicate and out-of-order events, forged/replayed signatures, uncertain outcomes and provider lookup against provider sandbox.
3. Select COD operational owner, courier evidence, collection/remittance reconciliation, failure/return/refund policy and audit retention.
4. Integrate trusted guest/cart authorization composition and storefront BFF before any public payment entrypoint.
5. Resolve shipping fees/provider and payable quote configuration (Issue #28) before asserting customer payable totals.
6. Obtain independent risk/security review, approved disposable staging evidence, legal/operational launch approval and a separate release decision.

These blockers keep both methods non-operational until separately authorized. No payment mode is activated by this foundation.


## Checkout readiness and settlement gate

The internal `PaymentReadinessSnapshot` and `PaymentBranchReadiness` types in `payment-provider-contract.ts` are descriptive contracts for Checkout orchestration. They expose internal branch readiness and explicit blockers while fixing `publicMethodEnabled` and `settlementEnabled` to the literal value `false`. They are not public configuration and do not activate a payment method.

Until a gateway is selected and an authenticated provider adapter is wired, every normalized `paid` claim is retained in the inbox with `needs_reconciliation`; it cannot change the attempt to `paid`. This applies to simulator events as well. The current ledger accepts only internal normalized-event input, and there is no HTTP callback route. A future signed-event path must prove raw-body signature, freshness, account/environment, provider and payment-attempt binding before it can call an explicitly enabled settlement authority. Unsigned or browser-supplied status must never reach that authority.

## Reconciliation and native Medusa synchronization requirements

- Keep the provider inbox as the durable source for event delivery identity and disposition; reconcile by attempt, order, provider payment ID, amount/currency, event revision/time, and native Medusa payment collection/session.
- Reconciliation must compare authoritative provider status with the immutable checkout amount and native Medusa payment identity. Unknown, stale, conflicting, and missing records remain blocked for operational review; retries use provider-side idempotency and cannot create a second charge.
- A future settlement transaction must atomically persist the verified inbox disposition and internal attempt transition, then synchronize the corresponding native Medusa payment collection/session using Medusa-supported payment records/workflows with stable idempotency. Any cross-store failure must be retryable from a durable outbox or equivalent reconciliation queue; never infer settlement from order completion or a local system-provider session.
- Define explicit mapping for authorization, capture/paid, failure, void, refund amount/identity, and partial refund. Refund transitions remain blocked until amount-specific refund records exist.
- COD remains unpaid until a separately authorized collection operation records collector/courier identity, amount, currency, timestamp, evidence/reference and idempotency key. Reconcile carrier collection, remittance and any shortfall/refund independently; checkout completion alone is not collection evidence.
- These are launch blockers, not implemented transaction paths. No provider, event endpoint, public payment method, or operational COD collection capability is enabled.
