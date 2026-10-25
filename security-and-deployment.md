# Security, Privacy, and Deployment Architecture
## Project: Arabic-First E-Commerce Store for Imported Food Products (Egypt)
**Document Status:** Revision 19 — Electronic Payments and Phase 0 Design Closure (Design Revision; Runtime Unverified)  
**Date:** 2026-10-25  
**Current Review Decision:** `Phase 0 design closure is defined; cross-document review/sign-off is pending. Runtime evidence is deferred to the Phase 1 Technical Compatibility Spike.`  
*(Phase 0 closes on design/documentation and recorded owner decisions only; a restricted Phase 1 Technical Compatibility Spike may run before Phase 0 sign-off, but store feature development remains blocked until the spike evidence and launch gates are reviewed)*

---

## 1. Security Architecture & Threat Mitigation

### 1.1 Atomic Idempotency Protocol & 7-Checkpoint Crash Recovery

**Lock-order rule for recovery (introduced in Revision 18):** before any database row lock in recovery for an attempt already associated with a native order, acquire the shared transaction-scoped order advisory lock defined in `architecture.md` §7.2. Then lock `cart_checkout_session`, `cart_checkout_attempt`, sorted affected batch rows, and reservation child rows in that order. For a proven pre-order attempt, use session -> attempt -> sorted batches -> reservation rows. If order creation/correlation outcome is unknown, do not run reservation cleanup or release. Refund/disbursement/reconciliation must use the order advisory lock -> return request -> selected settlement row (`cod_collection_record` for COD or `electronic_payment_attempt` for electronic payment) -> refund -> payout attempt order and must not acquire inventory batch locks in the same transaction. This remains `[PROPOSED]` until TP concurrency tests run.

To prevent duplicate orders, double payments, or repeated stock reservations during network retries or server crashes:

1. **Atomic Lease Protocol:** Idempotency key acquisition uses an atomic `INSERT ... ON CONFLICT` statement in an independent database transaction executed **BEFORE** Redis cart locking or epoch incrementing.
2. **Canonical Hash Validation:** Reused keys with modified request payloads or paths are immediately rejected with `409 Conflict`, even if the existing record is `pending` or stale.
3. **Lease Owner Validation & Distributed Fencing:** Updates require matching `lease_owner_id` (a unique execution token `worker:${attempt_id}:${pid_uuid}`). An older or stalled worker cannot overwrite state acquired by a newer worker.
4. **Timing Coordination & Synchronized Worker Heartbeat:**
   - Distributed cart lock TTL: **120 seconds**.
   - Idempotency lease stale threshold: **120 seconds** (`last_heartbeat_at + INTERVAL '120 seconds'`).
   - Active workers execute a background heartbeat every **30 seconds**:
     - The worker first calls Redis `extendLock("cart:" + cart_id, worker_owner_id, 120)`.
     - If Redis returns `0` (lock lost, key expired, or stolen) or fails: the worker aborts (`AbortController.abort()`) and refuses to update PostgreSQL.
     - Only if Redis returns `1` does the worker execute:
       `UPDATE idempotency_key SET locked_at = NOW(), last_heartbeat_at = NOW() WHERE key = :key AND lease_owner_id = :worker_owner_id AND status = 'pending'`.
   - If Stage 1 (idempotency lease) succeeds but Stage 2 (Redis lock acquisition) times out (>5s), the worker executes a compare-and-set deletion of its pending lease:
     ```sql
     DELETE FROM idempotency_key
     WHERE key = :key AND lease_owner_id = :worker_owner_id AND status = 'pending';
     ```
     Worker returns `409 Conflict ("Checkout lock timeout")`, preventing orphaned pending leases.
5. **Deterministic 10-Branch Idempotency Expiration Semantics:**
   - **Branch 1 (Same key, same request before expiry):** Return the persisted safe response and stored status/order identity. The first transient response may have included a one-time claim code; the replay does not, because no plaintext claim code is persisted.
   - **Branch 2 (Same key, different payload before expiry):** 409 Conflict (`PAYLOAD_HASH_MISMATCH`).
   - **Branch 3 (Active pending lease, heartbeat < 120s):** 409 Conflict (`REQUEST_IN_PROGRESS`).
   - **Branch 4 (Stale pending lease, heartbeat > 120s):** Recovery worker takes over lease via CAS update.
   - **Branch 5 (Expired completed/failed key, DB row still present, `expires_at < NOW()`):** Return the persisted safe response and stored status/order identity with header `X-Idempotency-Status: replayed-expired`. Do not regenerate or return a claim code. This is semantic replay, not byte-for-byte equality with the initial transient response.
   - **Branch 6 (Expired key deleted by cron):** Query `cart_checkout_session` and the authoritative current/previous `cart_checkout_attempt`. If the session is `completed`, reject with 409 Conflict (`CART_ALREADY_COMPLETED`). A fresh key is allowed only after the prior attempt has been authoritatively marked failed/aborted, native order creation is proven failed or any created order is definitively cancelled/compensated, and reservation release committed. If the session/attempt is `in_progress`, `order_creation_started`, `pending_correlation`, or `needs_reconciliation`, or if an order/cancellation outcome is unknown, reject/defer with 409/503 and do not advance the epoch, create an order, or release reservations.
   - **Branch 7 (Completed cart submitted with fresh key after retention):** 409 Conflict (`CART_ALREADY_COMPLETED`).
   - **Branch 8 (Failed attempt followed by retry with fresh key):** Allowed only after authoritative evidence establishes that native order creation failed or that any created order was definitively cancelled/compensated, no order remains eligible for binding, and reservations were released atomically. A stale timestamp, thrown error, timeout, empty immediate query, or `needs_reconciliation` state is not proof of failure. While outcome is unknown, keep the attempt/epoch fence and reject a fresh-key checkout; do not advance the epoch or release reservations.
   - **Branch 9 (Lock acquisition failure after lease acquisition):** Worker CAS deletes pending lease before returning 409 Conflict.
   - **Branch 10 (Retention cleanup during concurrent request):** Automated cleanup cron deletes **ONLY** rows where `status IN ('completed', 'failed') AND expires_at < NOW()`. Pending and active keys are strictly excluded.
6. **Technical Retention Policy (Strict 14-Day Baseline):**
   - Keys where `status IN ('completed', 'failed')` are purged after **14 days** (`expires_at = created_at + INTERVAL '14 days'`).  
   - *Technical Policy Justification:* This 14-day duration is chosen strictly as a technical and support-window policy (covering customer retry windows, support ticket lifecycles, and database size control). It is decoupled from legal return windows.
   - **Unresolved pending keys older than 24 hours:** Never deleted by automated crons; trigger an automated administrative alert for operator investigation.
7. **Authoritative 7-Checkpoint Crash Recovery Protocol:**
   - **CP-1 (Pre-Reservation):** No CBR rows. Advance session epoch to `E+1`, create Attempt B, execute fresh FEFO reservation.
   - **CP-2 (Post-Reservation, Pre-Order):** CBR exists; no order. Attempt B advances epoch to `E+1`, releases old CBR rows via the canonical hashed `reservation_release`/`cleanup` keys, creates new reservations.
   - **CP-3 (Order creation started, outcome/association unresolved):** Attempt status was durably set to `order_creation_started` / `pending_correlation` before calling `completeCartWorkflow.runAsStep({ input: { id: cart.id } })`. Query native orders by `cart_id`; do not rely on `order.metadata.checkout_attempt_id`. Exactly one order plus exactly one compatible unresolved attempt may be bound by CAS. Zero orders with unknown/in-flight workflow outcome means wait/reconcile without a second order, epoch advance, reservation release, or cancellation. Multiple orders/attempts require `needs_reconciliation` and manual review.
   - **CP-4 (Post-Association, Pre-Conversion):** Order is definitively correlated; 0 allocations. If reservations are valid (`expires_at > NOW()`), execute guarded conversion. If expired/superseded, the recovery controller may cancel only the definitively correlated order under an authoritative cancellation policy. Release reservations only after cancellation/compensation is confirmed; if cancellation outcome is uncertain, mark `needs_reconciliation`, retain the fence, and do not start another order.
   - **CP-5 (Post-Conversion, Pre-Downstream):** Conversion committed; operational/payment-method record absent. Initialize missing `order_operational_state` (`new`) and exactly the selected payment-method record: `cod_collection_record` (`unpaid`) for COD, or the correlated `electronic_payment_attempt` for electronic payment. Zero inventory balance changes.
   - **CP-6 (Post-Downstream, Pre-Idempotency):** Downstream initialized; idempotency pending. Mark `idempotency_key` completed with response payload.
   - **CP-7 (Post-Completion Replay):** Idempotency completed. Return the persisted safe response immediately; it includes no plaintext claim code and is not byte-for-byte the initial transient response. Zero business-state/inventory mutations (observability reads/logs may still occur).

---

### 1.2 Authoritative Guest Order Access Model & Session Scoping

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Guest Customer
    participant Browser as Customer Browser
    participant Edge as Edge CDN (Cloudflare)
    participant NextServer as Next.js Server (BFF)
    participant Medusa as Medusa Backend
    participant Redis as Redis 7.2.16 target
    participant DB as PostgreSQL

    Note over Customer,DB: 1. Initial Order Placement & Claim Code Generation
    Customer->>NextServer: Complete Checkout
    NextServer->>Medusa: Execute completeCartWorkflow
    Medusa->>Medusa: Generate 256-bit secure random claim code
    Medusa->>DB: Store SHA-256(claim_code) in order_operational_state.claim_code_hash
    Medusa->>Redis: SET claim:<claim_code> "order_id:order_ref" EX 300
    Medusa-->>NextServer: Return order_ref + transient claim_code
    Note over Medusa,DB: Idempotency table caches ONLY safe metadata (NO plaintext claim code!)
    NextServer-->>Browser: Redirect to /order/confirm?claim=<claim_code>&ref=<order_ref>

    Note over Customer,DB: 2. Atomic Server-Side Token Exchange into Session Cookie
    Browser->>Edge: GET /order/confirm?claim=<claim_code>&ref=<order_ref>
    Note over Edge: Referrer-Policy: no-referrer<br/>Query string redacted from CDN/proxy logs
    Edge->>NextServer: Forward Request
    NextServer->>Medusa: POST /api/orders/claim (claim_code, order_ref)
    Medusa->>Redis: GETDEL claim:<claim_code>
    alt Key Exists (Atomic Retrieval & Deletion)
        Redis-->>Medusa: "order_id:order_ref" (Success)
        Medusa->>Redis: SET order_session:<session_id> "{order_id, order_ref}" EX 86400
        Medusa-->>NextServer: Return session_id
        NextServer-->>Browser: Set-Cookie: order_session=<session_id> (HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age=86400)<br/>HTTP 303 Redirect to /order/view?ref=<order_ref>
    else Key Missing or Already Deleted (Replay / Expired)
        Redis-->>Medusa: nil
        Medusa-->>NextServer: 401 Unauthorized / 404 Not Found
        NextServer-->>Browser: Redirect to /order/lookup (Prompt Phone OTP)
    end
    
    Note over Browser: Browser navigates to /order/view with ZERO tokens in URL!

    Note over Customer,DB: 3. Long-Term Returning Guest Lookup (Phone OTP)
    Customer->>Browser: Visits /order/lookup (days later)
    Customer->>NextServer: Enter order_ref + Egyptian phone (+201XXXXXXXXX)
    NextServer->>Medusa: Request OTP
    Medusa->>Medusa: Generate 6-digit OTP (TTL: 5 min, max 3 attempts)
    Medusa-->>Customer: Send SMS / WhatsApp with OTP
    Customer->>NextServer: Submit OTP
    NextServer->>Medusa: Verify OTP
    Medusa-->>NextServer: OTP Valid -> Return session_id
    NextServer-->>Browser: Set-Cookie: order_session=<session_id> (Path=/)<br/>Redirect to /order/view?ref=<order_ref>
```

#### Detailed Security & Privacy Controls for Guest Access

1. **Cookie Path and Scope Compatibility:**
   - The session cookie is scoped with **`Path=/`**, `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=86400`.
   - **Strict Order Boundary Enforcement:** The cookie contains an opaque 256-bit token referencing Redis session metadata (`order_session:<token> -> { order_id, order_ref, phone_hash }`). Every protected order API route strictly asserts that `session.order_id === request.order_id`. If mismatched, the server returns **`403 Forbidden`**. A valid session for Order A can never access Order B.
2. **Transient Single-Use Claim Code via Redis `GETDEL`:**
   - Generated as a 256-bit secure random string (`crypto.randomBytes(32).toString('hex')`).
   - Stored in Redis with a **5-minute TTL**: `claim:<claim_code> = "order_id:order_ref"`.
   - **Atomic Single-Use Consumption:** Consumed using **`GETDEL claim:<claim_code>`**. If two concurrent redemption requests arrive, exactly one receives the value; the other receives `nil` and is rejected.
   - **Separate transient and persistent response contracts:** The first HTTP response may contain `claim_code` once. Before saving `idempotency_key.response_body`, persist only a sanitized body such as `{ "order_ref": "...", "claim_available": false, "next_action": "phone_otp_lookup" }`, without `claim_code` or a URL containing it. Replays return the stored status/order identity and safe body; they intentionally do not reproduce the initial one-time claim code byte-for-byte.
   - **Audit Hash:** `order_operational_state.claim_code_hash` stores `SHA-256(claim_code)` solely for forensic auditing.
3. **Redis Failure Fallback Policy:**
   - If Redis is unavailable during token redemption or session validation, the API returns **`503 Service Unavailable ("Session service temporarily unavailable; please retry shortly")`** with `Retry-After: 30`. Session authentication is never bypassed.
4. **Phone OTP Safeguards for Returning Guests:**
   - OTP codes are valid for 5 minutes.
   - Rate limiting: Max 3 OTP requests per 15 minutes per phone number.
   - Brute-force protection: Max 3 verification failures. Exceeding 3 failures immediately invalidates the OTP and enforces a 15-minute cooldown. Plaintext OTPs are never logged.
5. **Data Minimization on Order Lookup:**
   Public lookup API responses return strictly:
   - Masked customer name (e.g. `أحمد م***`).
   - Operational order status, carrier tracking code, and delivery attempts.
   - Items ordered (titles, package quantities, line totals).
   - Total cash amount due upon delivery.
   - *Full street addresses, internal batch IDs, supplier documents, and purchase costs are never returned.*

---

### 1.3 Trusted Reverse-Proxy IP Resolution

- **Client IP Resolution:** Evaluates:
  1. `CF-Connecting-IP` if Cloudflare is the verified edge CDN.
  2. The leftmost IP of `X-Forwarded-For` **only** after validating that the immediate socket peer belongs to known, verified upstream proxy CIDR blocks.
- **Rate Limiting:** Unauthenticated guest checkout submissions are limited to **5 attempts per 15 minutes per verified IP**.
- **Admin Authentication:** Limited to **5 failed attempts per 15 minutes**, followed by a 15-minute account lockout.

---

### 1.4 Private Document Storage Architecture

- Public product photography is hosted on a public CDN (Cloudinary / S3).
- **Private Compliance Documents:** Commercial receipts, customs manifests, and inspection reports are stored in an **Encrypted Private S3 Bucket** (`SSE-KMS`).
- Access is restricted exclusively to authenticated administrators with `compliance:read` role permissions via **time-limited Pre-Signed URLs (15-minute TTL)** generated on demand.

---

### 1.5 Audit Log Sanitization & Sensitive Data Protection

- Recipient banking details in `refund_record.encrypted_recipient_details` are encrypted at the application level using **AES-256-GCM** before database storage.
- Keyed HMAC `recipient_fingerprint` ensures identical requests produce identical request hashes without relying on ciphertext equality.
- Recipient details are masked in `audit_log.payload_before` and `payload_after` (e.g. `EG********************1234`).
- Phone OTP codes and plaintext claim codes are strictly excluded from audit payloads.
- Passwords and API secrets are permanently stripped.

---

### 1.6 Electronic Payment Security and Webhook Processing

- **Hosted payment only:** redirect the customer to a gateway-hosted payment page or hosted checkout session. Card PAN, CVV, PIN, and cardholder authentication data must never be posted to, logged by, or stored on storefront/backend servers. Store only provider identifiers, payment state, amount/currency, timestamps, and necessary reconciliation references.
- **Gateway selection remains open:** no provider-specific SDK, status mapping, signature algorithm, or refund semantics are selected in Revision 19. Those details require the owner's gateway decision and provider documentation.
- **Webhook signature verification:** verify signatures using the provider's documented method and the exact raw request body before trusting the event. Reject invalid signatures without state mutation. Apply replay protection/deduplication using provider event ID and persist only minimum event metadata plus a payload hash.
- **Duplicate/out-of-order events:** the webhook inbox uses a unique `(provider_key, provider_event_id)` key. Exact duplicates are idempotent; event-ID/hash conflicts are quarantined. State transitions are guarded and must not regress on delayed events; reconcile against the provider's authoritative record where available.
- **Secret storage:** store webhook signing secrets in the deployment secret manager/environment injection, never in source control, frontend `NEXT_PUBLIC_*` variables, logs, database event payloads, or error messages. Restrict access to the backend webhook verifier, rotate secrets according to provider capability, and document rotation without exposing secret values.
- **Payment/order recovery:** payment success with failed or uncertain order creation must not trigger premature reservation release or a second order. Order creation with definitive payment failure/abandonment must not dispatch; cancel authoritatively and release inventory only after cancellation and payment failure/void are confirmed. Unknown outcomes retain fences/reservations and require reconciliation.
- **Refund security:** system-computed item amounts use the amount actually paid after discounts. Shipping is refunded only for merchant-caused returns; opened items are not accepted for change of mind. Every admin override requires a reason and approver identity, and the approved amount is frozen. The only remaining Gate 4 open items are tax treatment, possible shipping withholding for refused/unreachable undelivered electronic orders, and legal review/approval of the Arabic policy text. Partial gateway refunds use idempotency where supported, unknown outcomes reserve capacity, and provider statements are reconciled against local orders/refunds.

## 2. Secrets Management & Environment Configuration

Secrets must never be stored in version control. The repository maintains an `.env.example` file using obvious placeholder tokens. Realistic-looking keys are strictly prohibited in documentation and templates.

```ini
# ==============================================================================
# STOREFRONT (.env.example) - Next.js 15.5.28 (Maintenance LTS)
# ==============================================================================
NODE_ENV=development
PORT=3000
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_DEFAULT_LOCALE=ar
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ==============================================================================
# BACKEND (.env.example) - Medusa v2.21.2 candidate cohort / Node.js 24.22.1 LTS
# ==============================================================================
NODE_ENV=development
PORT=9000
DATABASE_URL=postgres://your_db_user_placeholder:your_db_password_placeholder@localhost:5432/your_db_name_placeholder?sslmode=disable
REDIS_URL=redis://localhost:6379

# Medusa Security Keys (Minimum 32 random characters for production)
JWT_SECRET=your_jwt_secret_min_32_chars_placeholder
COOKIE_SECRET=your_cookie_secret_min_32_chars_placeholder
HMAC_KEY=your_hmac_secret_min_32_chars_placeholder

# Electronic payment (backend-only secret injection; provider selection pending)
PAYMENT_PROVIDER_KEY=your_selected_gateway_identifier_placeholder
PAYMENT_WEBHOOK_SECRET=your_payment_webhook_secret_placeholder

# CORS Whitelists
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:9000
AUTH_CORS=http://localhost:9000

# Storage Provider Configuration
PUBLIC_STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name_placeholder
CLOUDINARY_API_KEY=your_cloudinary_api_key_placeholder
CLOUDINARY_API_SECRET=your_cloudinary_api_secret_placeholder

PRIVATE_STORAGE_PROVIDER=s3
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id_placeholder
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_placeholder
PRIVATE_S3_BUCKET_NAME=your_private_compliance_bucket_placeholder
```

---

## 3. Deployment Topology & Supported Runtimes

```mermaid
flowchart LR
    subgraph EdgeCDN["Edge CDN & WAF (Cloudflare)"]
        WAF["Cloudflare WAF\nTLS 1.3 Strict\nRate Limiting & Log Redaction"]
    end

    subgraph ComputeLayer["Container Compute (Node.js 24 LTS)"]
        StorePod["Next.js 15.5.28 Pod\n(RTL SSR & Client Bundles)"]
        BackendPod["Medusa v2.21.2 candidate cohort Pod\n(MikroORM Engine, Sagas, REST APIs)"]
    end

    subgraph DataLayer["Managed Infrastructure"]
        Postgres[(Managed PostgreSQL 16.15 target\nDaily Automated Snapshot + WAL PITR)]
        Redis[(Managed Redis 7.2.16 target\nWorkflows, Locking Module & Atomic GETDEL)]
    end

    subgraph MediaStorage["Storage Providers"]
        CloudinaryCDN["Cloudinary Public CDN\n(Web-Optimized Product Media)"]
        PrivateS3["Encrypted Private S3 Bucket\n(Compliance & Customs Records)"]
    end

    EdgeCDN --> StorePod
    EdgeCDN --> BackendPod
    StorePod --> BackendPod
    BackendPod --> DataLayer
    BackendPod --> MediaStorage
```

---

## 4. Backup, Disaster Recovery & Schema-Consistent Queries

### 4.1 Backup Tiers
1. **Managed Cloud Automated Snapshots:** Full disk image snapshot executed nightly at `03:00 UTC` by the cloud database provider, retained for 30 days.
2. **Point-In-Time-Recovery (PITR):** Continuous Write-Ahead Logging (WAL) archiving allowing rollback to any second within the trailing 7 days.
3. **Logical Database Dumps:** Scheduled `pg_dump -Fc` binary backups taken weekly and archived to an isolated offsite S3 bucket with Object Lock (WORM).

### 4.2 Disaster Recovery Runbook & Schema-Consistent Queries

In the event of database failure or corrupted state:
1. Provision the pinned PostgreSQL 16.15 target instance and record the immutable image/package digest.
2. Restore binary dump:
   ```bash
   pg_restore --verbose --clean --no-acl --no-owner \
     -h <target_host> -p 5432 -U <db_user> -d <target_database> \
     backup_snapshot.dump
   ```
3. Execute schema-consistent verification queries (audited against Medusa v2 Order Module schema where `order_item` holds the active version and ordered quantity):

```sql
-- 1. Verify Batch Tri-State Balance (No negative sellable stock)
SELECT id, variant_id, quantity_on_hand, quantity_reserved, quantity_quarantined
FROM inventory_batch 
WHERE quantity_on_hand < (quantity_reserved + quantity_quarantined);
-- Expected Result: 0 rows

-- 2. Verify Line Item Allocation Alignment (Scoped to active order version and line item)
SELECT 
    o.id AS order_id, 
    oli.id AS line_item_id, 
    oi.quantity AS ordered_qty, 
    COALESCE(SUM(oba.quantity_allocated), 0) AS allocated_qty
FROM "order" o
JOIN order_item oi ON oi.order_id = o.id AND oi.version = o.version
JOIN order_line_item oli ON oli.id = oi.item_id
LEFT JOIN order_batch_allocation oba 
       ON oba.order_id = o.id
      AND oba.line_item_id = oli.id 
      AND oba.allocation_status != 'released'
WHERE o.status NOT IN ('canceled', 'archived', 'draft')
GROUP BY o.id, oli.id, oi.quantity
HAVING oi.quantity != COALESCE(SUM(oba.quantity_allocated), 0);
-- Expected Result: 0 rows

-- 3. Verify Operational State Synchronization with Core Orders
SELECT o.id, oop.operational_status, oop.fulfillment_status
FROM "order" o
LEFT JOIN order_operational_state oop ON oop.order_id = o.id
WHERE oop.id IS NULL;
-- Expected Result: 0 rows

-- 4. Verify Refund Capacity Does Not Exceed the Selected Payment Method's Settled Amount
SELECT o.id,
       CASE WHEN oop.payment_method = 'cod' THEN cod.collected_amount ELSE ep.amount END AS settled_amount,
       SUM(ref.amount) AS total_refunds_claimed
FROM "order" o
JOIN order_operational_state oop ON oop.order_id = o.id
LEFT JOIN cod_collection_record cod ON cod.order_id = o.id
LEFT JOIN LATERAL (
    SELECT epa.amount
    FROM electronic_payment_attempt epa
    WHERE epa.order_id = o.id AND epa.status IN ('paid', 'partially_refunded', 'refunded')
    ORDER BY epa.updated_at DESC
    LIMIT 1
) ep ON TRUE
JOIN refund_record ref ON ref.order_id = o.id
WHERE ref.status IN ('pending_approval', 'approved', 'disbursement_initiated', 'disbursement_unknown', 'disbursement_submitted', 'completed')
GROUP BY o.id, oop.payment_method, cod.collected_amount, ep.amount
HAVING SUM(ref.amount) > CASE WHEN oop.payment_method = 'cod' THEN cod.collected_amount ELSE COALESCE(ep.amount, 0) END;
-- Expected Result: 0 rows

-- 5. Verify Inventory Movement Ledger Balance Invariants (Per Batch)
SELECT 
    b.id AS batch_id,
    b.quantity_on_hand,
    COALESCE(SUM(m.quantity_on_hand_delta), 0) AS sum_on_hand_delta,
    b.quantity_reserved,
    COALESCE(SUM(m.quantity_reserved_delta), 0) AS sum_reserved_delta,
    b.quantity_quarantined,
    COALESCE(SUM(m.quantity_quarantined_delta), 0) AS sum_quarantined_delta
FROM inventory_batch b
LEFT JOIN inventory_movement m ON m.batch_id = b.id
GROUP BY b.id, b.quantity_on_hand, b.quantity_reserved, b.quantity_quarantined
HAVING b.quantity_on_hand != COALESCE(SUM(m.quantity_on_hand_delta), 0)
    OR b.quantity_reserved != COALESCE(SUM(m.quantity_reserved_delta), 0)
    OR b.quantity_quarantined != COALESCE(SUM(m.quantity_quarantined_delta), 0);
-- Expected Result: 0 rows

-- 6. Verify Inventory Movement Snapshot Validity and Invariant Consistency
SELECT id, deduplication_key, batch_id, movement_type
FROM inventory_movement
WHERE quantity_on_hand_before < 0
   OR quantity_on_hand_after < 0
   OR quantity_reserved_before < 0
   OR quantity_reserved_after < 0
   OR quantity_quarantined_before < 0
   OR quantity_quarantined_after < 0
   OR quantity_on_hand_before < (quantity_reserved_before + quantity_quarantined_before)
   OR quantity_on_hand_after < (quantity_reserved_after + quantity_quarantined_after)
   OR quantity_on_hand_after != (quantity_on_hand_before + quantity_on_hand_delta)
   OR quantity_reserved_after != (quantity_reserved_before + quantity_reserved_delta)
   OR quantity_quarantined_after != (quantity_quarantined_before + quantity_quarantined_delta);
-- Expected Result: 0 rows
```