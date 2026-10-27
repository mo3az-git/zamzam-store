import { createHash } from "node:crypto"

/**
 * Phase 1 prototype: atomic PostgreSQL idempotency lease and response fencing.
 *
 * This utility never creates an order, reserves inventory, advances an epoch,
 * or claims a full checkout TP pass. A fresh or taken-over lease is only an
 * authorization token to inspect the authoritative attempt/recovery state.
 *
 * Source: docs/order-and-inventory-workflows.md §4.1 and
 * docs/security-and-deployment.md §1.
 */
export type LeaseRow = {
  key: string
  request_path: string
  request_hash: string
  status: "pending" | "completed" | "failed"
  lease_owner_id: string
  response_code: number | null
  response_body: unknown
}

export interface PgLeaseClient {
  query(text: string, values: unknown[]): Promise<{
    rows: LeaseRow[]
    rowCount?: number | null
  }>
}

export type AcquireLeaseInput = {
  key: string
  requestPath: string
  requestBody: unknown
  ownerId: string
}

export type SafeCompletedResponse = {
  order_ref: string
  claim_available: false
  next_action: "phone_otp_lookup"
}

export type LeaseDecision =
  | { kind: "owner_acquired"; key: string; requestHash: string; recoveryCheckRequired: true }
  | { kind: "replay"; statusCode: number; body: SafeCompletedResponse }
  | { kind: "payload_conflict" }
  | { kind: "request_in_progress" }
  | { kind: "previous_attempt_failed" }
  | { kind: "concurrent_state_change" }

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash256 = /^[0-9a-f]{64}$/i
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"])

function canonical(value: unknown, depth: number, ancestors: Set<object>): string {
  if (depth > 32) throw new TypeError("Checkout body nesting exceeds the supported limit")
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"))
  if (typeof value === "boolean") return String(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Checkout body contains a non-finite number")
    return JSON.stringify(value)
  }
  if (typeof value !== "object") throw new TypeError("Checkout body must contain JSON values only")
  if (ancestors.has(value)) throw new TypeError("Checkout body contains a cycle")
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      return "[" + value.map((entry) => canonical(entry, depth + 1, ancestors)).join(",") + "]"
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("Checkout body must be a plain JSON object")
    }
    const record = value as Record<string, unknown>
    return "{" + Object.keys(record).sort().map((key) => {
      if (forbiddenKeys.has(key)) throw new TypeError("Forbidden checkout body property")
      return JSON.stringify(key.normalize("NFC")) + ":" + canonical(record[key], depth + 1, ancestors)
    }).join(",") + "}"
  } finally {
    ancestors.delete(value)
  }
}

/** Stable across object-property order; array ordering and semantic values matter. */
export function checkoutRequestHash(requestBody: unknown): string {
  if (requestBody === null || Array.isArray(requestBody) || typeof requestBody !== "object") {
    throw new TypeError("Checkout request body must be an object")
  }
  const normalized = canonical(requestBody, 0, new Set<object>())
  return createHash("sha256").update(normalized, "utf8").digest("hex")
}

function validateLeaseInput(input: AcquireLeaseInput): void {
  if (!uuidV4.test(input.key)) throw new TypeError("Idempotency-Key must be a UUID v4")
  if (!input.requestPath.startsWith("/") || input.requestPath.length > 255 || input.requestPath.includes("?")) {
    throw new TypeError("Invalid checkout request path")
  }
  if (!input.ownerId.startsWith("worker:") || input.ownerId.length > 255) {
    throw new TypeError("Invalid worker lease owner token")
  }
}

/**
 * Only explicitly approved fields may be persisted or replayed.
 * Never forward an arbitrary initial response body to idempotency storage.
 */
export function safeCompletionBody(orderRef: string): SafeCompletedResponse {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(orderRef)) {
    throw new TypeError("Invalid order reference")
  }
  return { order_ref: orderRef, claim_available: false, next_action: "phone_otp_lookup" }
}

export const ACQUIRE_SQL = `
INSERT INTO idempotency_key
  (key, request_path, request_hash, status, lease_owner_id, locked_at, last_heartbeat_at, expires_at)
VALUES ($1, $2, $3, 'pending', $4, NOW(), NOW(), NOW() + INTERVAL '14 days')
ON CONFLICT (key) DO UPDATE SET
  lease_owner_id = EXCLUDED.lease_owner_id,
  locked_at = NOW(),
  last_heartbeat_at = NOW(),
  updated_at = NOW()
WHERE idempotency_key.status = 'pending'
  AND idempotency_key.request_hash = EXCLUDED.request_hash
  AND idempotency_key.request_path = EXCLUDED.request_path
  AND idempotency_key.deleted_at IS NULL
  AND idempotency_key.last_heartbeat_at < NOW() - INTERVAL '120 seconds'
RETURNING key, request_path, request_hash, status, lease_owner_id, response_code, response_body
`

const READ_EXISTING_SQL = `
SELECT key, request_path, request_hash, status, lease_owner_id, response_code, response_body
FROM idempotency_key
WHERE key = $1 AND deleted_at IS NULL
`

/**
 * The caller MUST run this on a transactionally reliable PG connection and
 * only proceed after checking cart/attempt ownership and recovery checkpoints.
 * In particular, "owner_acquired" is NOT a completed checkout or inventory authorization.
 */
export async function acquireCheckoutLease(
  db: PgLeaseClient,
  input: AcquireLeaseInput
): Promise<LeaseDecision> {
  validateLeaseInput(input)
  const requestHash = checkoutRequestHash(input.requestBody)
  const acquired = await db.query(ACQUIRE_SQL, [
    input.key, input.requestPath, requestHash, input.ownerId,
  ])

  if (acquired.rows.length === 1) {
    if (acquired.rows[0].lease_owner_id !== input.ownerId) {
      throw new Error("PostgreSQL lease owner mismatch after acquisition")
    }
    return { kind: "owner_acquired", key: input.key, requestHash, recoveryCheckRequired: true }
  }

  const result = await db.query(READ_EXISTING_SQL, [input.key])
  const existing = result.rows[0]
  if (!existing) return { kind: "concurrent_state_change" }

  // Always check request equivalence BEFORE status or staleness decisions.
  if (existing.request_hash !== requestHash || existing.request_path !== input.requestPath) {
    return { kind: "payload_conflict" }
  }
  if (existing.status === "completed") {
    const body = existing.response_body
    if (!body || typeof body !== "object" || !("order_ref" in body) ||
      typeof body.order_ref !== "string") {
      throw new Error("Stored checkout replay response lacks an order reference")
    }
    if (existing.response_code !== 200 && existing.response_code !== 201) {
      throw new Error("Stored checkout replay HTTP status is invalid")
    }
    return { kind: "replay", statusCode: existing.response_code, body: safeCompletionBody(body.order_ref) }
  }
  if (existing.status === "failed") return { kind: "previous_attempt_failed" }
  if (existing.status === "pending") return { kind: "request_in_progress" }
  throw new Error("Unknown idempotency lease status")
}

export const COMPLETE_SQL = `
UPDATE idempotency_key
SET status = 'completed', order_id = $3, response_code = $4,
    response_body = $5::jsonb, updated_at = NOW()
WHERE key = $1 AND lease_owner_id = $2 AND status = 'pending' AND deleted_at IS NULL
RETURNING key, request_path, request_hash, status, lease_owner_id, response_code, response_body
`

/**
 * Must only be called AFTER authoritative cart/order/inventory workflow success.
 * This function cannot create or prove that upstream success.
 */
export async function finalizeCheckoutLease(db: PgLeaseClient, input: {
  key: string
  ownerId: string
  orderId: string
  orderRef: string
  responseCode: 200 | 201
}): Promise<"completed" | "lease_lost"> {
  if (!uuidV4.test(input.key)) throw new TypeError("Invalid idempotency key")
  if (!input.ownerId.startsWith("worker:") || input.ownerId.length > 255) throw new TypeError("Invalid owner token")
  if (!input.orderId || input.orderId.length > 255) throw new TypeError("Invalid order ID")
  const safeBody = JSON.stringify(safeCompletionBody(input.orderRef))
  const result = await db.query(COMPLETE_SQL, [
    input.key, input.ownerId, input.orderId, input.responseCode, safeBody,
  ])
  if (result.rows.length > 1) throw new Error("Idempotency finalize changed more than one row")
  return result.rows.length === 1 ? "completed" : "lease_lost"
}
