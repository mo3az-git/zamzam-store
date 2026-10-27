import test from "node:test"
import assert from "node:assert/strict"
import {
  checkoutRequestHash,
  safeCompletionBody,
  acquireCheckoutLease,
  finalizeCheckoutLease,
  ACQUIRE_SQL,
  COMPLETE_SQL,
} from "../src/idempotency/checkout-lease.ts"

const key = "b8f7c89a-b8db-4990-8e3d-d9d2c6e2a5bc"
const owner = "worker:tp12-prototype:67a49db8"
const requestPath = "/store/carts/cart_test/complete"
const requestBody = { payment_method: "cod", cart_id: "cart_test" }
const digest = checkoutRequestHash(requestBody)

function row(overrides = {}) {
  return {
    key, request_path: requestPath, request_hash: digest, status: "pending",
    lease_owner_id: owner, response_code: null, response_body: null, ...overrides,
  }
}

function client(...steps) {
  const calls = []
  let index = 0
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values })
      if (index >= steps.length) throw new Error("Unexpected database query")
      const step = steps[index++]
      if (step instanceof Error) throw step
      return { rows: step }
    },
  }
}

test("canonical request hash is stable under JSON key ordering", () => {
  assert.equal(
    checkoutRequestHash({ a: 1, b: { y: "yes", x: 4 } }),
    checkoutRequestHash({ b: { x: 4, y: "yes" }, a: 1 })
  )
  assert.match(checkoutRequestHash(requestBody), /^[a-f0-9]{64}$/)
})

test("hash changes with semantic payload or ordered array changes", () => {
  assert.notEqual(checkoutRequestHash({ items: [1, 2] }), checkoutRequestHash({ items: [2, 1] }))
  assert.notEqual(checkoutRequestHash({ payment_method: "cod" }), checkoutRequestHash({ payment_method: "electronic" }))
})

test("Unicode combining normalization avoids false request differences", () => {
  assert.equal(checkoutRequestHash({ name: "e\u0301" }), checkoutRequestHash({ name: "\u00e9" }))
})

test("rejects invalid request JSON rather than hashing it", () => {
  assert.throws(() => checkoutRequestHash({ price: Number.NaN }), /non-finite/)
  assert.throws(() => checkoutRequestHash([1, 2]), /body must be an object/)
  assert.throws(() => checkoutRequestHash({ a: undefined }), /JSON values only/)
  const cycle = { a: 1 }
  cycle.self = cycle
  assert.throws(() => checkoutRequestHash(cycle), /cycle/)
  assert.throws(() => checkoutRequestHash(JSON.parse('{"__proto__":{"flag":true}}')), /Forbidden/)
})

test("one-time claim codes cannot be inserted into the safe persistence shape", () => {
  assert.deepEqual(safeCompletionBody("order_abc"), {
    order_ref: "order_abc", claim_available: false, next_action: "phone_otp_lookup",
  })
  assert.throws(() => safeCompletionBody("order/url?claim=raw-secret"), /Invalid order/)
})

test("atomic insert/CAS lease has SQL guards for path, hash, status and 120s staleness", () => {
  assert.match(ACQUIRE_SQL, /ON CONFLICT \(key\) DO UPDATE/)
  assert.match(ACQUIRE_SQL, /request_hash = EXCLUDED\.request_hash/)
  assert.match(ACQUIRE_SQL, /request_path = EXCLUDED\.request_path/)
  assert.match(ACQUIRE_SQL, /status = 'pending'/)
  assert.match(ACQUIRE_SQL, /INTERVAL '120 seconds'/)
  assert.match(ACQUIRE_SQL, /deleted_at IS NULL/)
  assert.match(COMPLETE_SQL, /lease_owner_id = \$2 AND status = 'pending'/)
})

test("new or stale-owner CAS acquisition requires authority/recovery examination", async () => {
  const db = client([row()])
  assert.deepEqual(await acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), {
    kind: "owner_acquired", key, requestHash: digest, recoveryCheckRequired: true,
  })
  assert.deepEqual(db.calls[0].values, [key, requestPath, digest, owner])
  assert.equal(db.calls.length, 1)
})

test("input validation happens before any query", async () => {
  const db = client()
  await assert.rejects(acquireCheckoutLease(db, { key: "bad", ownerId: owner, requestPath, requestBody }), /UUID v4/)
  await assert.rejects(acquireCheckoutLease(db, { key, ownerId: "not-worker", requestPath, requestBody }), /worker/)
  await assert.rejects(acquireCheckoutLease(db, { key, ownerId: owner, requestPath: "/store/cart?private=yes", requestBody }), /path/)
  assert.equal(db.calls.length, 0)
})

test("wrong owner token must never be treated as successful acquisition", async () => {
  const db = client([row({ lease_owner_id: "worker:other" })])
  await assert.rejects(acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), /owner mismatch/)
})

test("payload or endpoint mismatch is rejected before completed replay", async () => {
  const db = client([], [row({
    request_hash: "a".repeat(64), status: "completed", response_code: 201,
    response_body: { order_ref: "order_abc", claim_code: "SENSITIVE" },
  })])
  assert.deepEqual(await acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), { kind: "payload_conflict" })
  const db2 = client([], [row({
    request_path: "/store/carts/other/complete",
    status: "completed", response_code: 201, response_body: { order_ref: "order_abc" },
  })])
  assert.deepEqual(await acquireCheckoutLease(db2, { key, ownerId: owner, requestPath, requestBody }), { kind: "payload_conflict" })
})

test("completed replay strips unknown sensitive fields", async () => {
  const db = client([], [row({
    status: "completed", response_code: 201,
    response_body: { order_ref: "order_abc", claim_code: "SENSITIVE", private_token: "SENSITIVE", url: "https://example/?claim=SENSITIVE" },
  })])
  assert.deepEqual(await acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), {
    kind: "replay", statusCode: 201,
    body: { order_ref: "order_abc", claim_available: false, next_action: "phone_otp_lookup" },
  })
})

test("completed replay with corrupt persisted response is an error, not a success", async () => {
  const db = client([], [row({ status: "completed", response_code: 201, response_body: { claim_code: "secret" } })])
  await assert.rejects(acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), /lacks an order reference/)
})

test("non-acquired active pending lease never authorizes checkout", async () => {
  const db = client([], [row({ status: "pending" })])
  assert.deepEqual(await acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), { kind: "request_in_progress" })
})

test("failed lease is rejected and concurrent disappearance remains unresolved", async () => {
  const db = client([], [row({ status: "failed" })])
  assert.deepEqual(await acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), { kind: "previous_attempt_failed" })
  const disappeared = client([], [])
  assert.deepEqual(await acquireCheckoutLease(disappeared, { key, ownerId: owner, requestPath, requestBody }), { kind: "concurrent_state_change" })
})

test("finalization is owner-fenced and writes only sanitized JSON", async () => {
  const db = client([row({ status: "completed", response_code: 201 })])
  assert.equal(await finalizeCheckoutLease(db, { key, ownerId: owner, orderId: "order_abc", orderRef: "ORD123", responseCode: 201 }), "completed")
  assert.deepEqual(JSON.parse(db.calls[0].values[4]), {
    order_ref: "ORD123", claim_available: false, next_action: "phone_otp_lookup",
  })
  assert.equal(db.calls[0].values[1], owner)
  assert.ok(!JSON.stringify(db.calls).includes("claim_code"))
})

test("superseded worker must fail fencing without updating the completed lease", async () => {
  const db = client([])
  assert.equal(await finalizeCheckoutLease(db, { key, ownerId: owner, orderId: "order_abc", orderRef: "ORD123", responseCode: 200 }), "lease_lost")
})

test("PostgreSQL errors are propagated (not reported as passing behavior)", async () => {
  const db = client(new Error("database offline"))
  await assert.rejects(acquireCheckoutLease(db, { key, ownerId: owner, requestPath, requestBody }), /database offline/)
})
