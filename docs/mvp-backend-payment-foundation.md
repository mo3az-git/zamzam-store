# MVP Backend Integration — Payment Metadata Foundation (Slice 01)

**Scope:** internal backend only, draft integration branch based directly on PR #16. **No public payment, checkout, or Store API route added.**

## Origin and resolution
- Reuse PR #16 (`17f1c953da08670b8aa5529c18c97c2721e2c39e`) as the baseline for the newest native payable order / FEFO inventory / reconciliation behavior. None of those components is replaced.
- Restore from PR #13 the Medusa `order_operations` **models, module registration and migration only**: `order_operational_state`, `cod_collection_record`, and `electronic_payment_attempt`.
- Deliberately **do not** transplant `payment-branch.mjs`, `verified-payment-bridge.mjs`, or the old TP-05 runner unchanged. The older bridge assumes a `pending` lease for payment persistence and a caller-provided native order reader and must be reconciled with the newest checkout's `completed` response/lease lifecycle and canonical raw EGP snapshot. It is NOT a production gateway.
- Add `readInternalPayableQuote`, which calls PR #16's `readNativePayableOrderSnapshot` and conservatively validates order-cart identity, version, EGP currency and exact major/minor-unit correspondence. This is a **snapshot, not a reservation or authorization to persist money**.
- `makeInternalPayableQuote` is a pure fail-closed validator, with focused local tests that do not execute TP-01 or any formal TP case.

## Execution boundary
No production payment, COD settlement, return/refund payout, provider simulator activation, or customer-facing checkout is enabled by this commit. Schema registration can apply migrations in disposable staging, but data is not written by a new route or hook. Keep PR in draft. PR #13 and PR #16 remain separate and unmerged.

## Work required before enabling a payment method
1. **Reconcile authority semantics:** the persisted selected method, checkout attempt, cart/session/epoch, idempotency lease owner and status, durable amount/version and order-root advisory lock sequence must be validated in the **same write transaction** as `order_operations` records. The read-only quote cannot substitute for this.
2. **Close TOCTOU:** the order amount can change between reading a snapshot and writing a payment record; revalidate under the checkout/order lock. Reject price changes and order identity drift.
3. **COD/electronic isolation:** prevent both branches for the same order, enforce idempotent retries and exact EGP minor units, and keep simulator state separate from live gateway.
4. **Provider gate:** no real electronic provider selected, activated or supplied with credentials by this branch. COD remittance remains unimplemented.
5. **Public checkout boundary:** server-owned authorization/authentication, batch-availability and lock enforcement, safe request/response contracts, errors, and documented rate limits must precede frontend wiring.
6. **Focused evidence:** migrate disposable DB, build/lint, run `node --experimental-strip-types --test apps/backend/scripts/test-mvp-payment-quote.mjs`. Then separately verify a real Medusa native order and transactional branch writes in staging after the latter are implemented.

## Policy
MVP-first: comprehensive 59 TP checks deferred to pre-release; no canonical status marker changed. **TP-01 is not authorized** and must not be run or disguised. No merges without owner instruction.
