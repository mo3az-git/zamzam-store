import test from "node:test"
import assert from "node:assert/strict"
import { parseCartBffResponse, requestCartBff } from "../lib/cart-bff.ts"

const cart = {
  version: "v1", currency: "egp", items: [],
  subtotal: { currency: "egp", amount: "0.00" },
  shipping: null, total: { currency: "egp", amount: "0.00" }, delivery: null,
}

test("accepts only the shared Agent 2 response contract", () => {
  const good = { ok: true, operation: "read", cart, blockers: [], checkout: null }
  assert.deepEqual(parseCartBffResponse(good, "read"), good)
  assert.equal(parseCartBffResponse({ ...good, operation: "add_item" }, "read"), null)
  assert.equal(parseCartBffResponse({ ...good, cart: { ...cart, currency: "usd" } }, "read"), null)
  assert.equal(parseCartBffResponse({ ...good, blockers: ["FREE_SHIPPING"] }, "read"), null)
})

test("sends guest intent same-origin without cart ID or caller price and never retries", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  let captured
  globalThis.fetch = async (url, init) => {
    calls += 1
    captured = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ ok: true, operation: "read", cart, blockers: [], checkout: null }), { status: 200 })
  }
  try {
    const result = await requestCartBff({ operation: "read", requestId: "0123456789abcdef" })
    assert.equal(result.success, true)
    assert.equal(captured.url, "/api/cart")
    assert.equal(captured.init.credentials, "same-origin")
    assert.equal(captured.init.cache, "no-store")
    assert.deepEqual(Object.keys(captured.body).sort(), ["operation", "requestId"])
    assert.equal("cartId" in captured.body, false)
    assert.equal("price" in captured.body, false)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("unmounted, malformed, and non-success responses fail closed", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response("missing", { status: 404 })
    assert.deepEqual(await requestCartBff({ operation: "read", requestId: "0123456789abcdef" }), { success: false, error: "unavailable" })
    globalThis.fetch = async () => new Response("{}", { status: 200 })
    assert.deepEqual(await requestCartBff({ operation: "read", requestId: "0123456789abcdef" }), { success: false, error: "invalid_response" })
    globalThis.fetch = async () => { throw new Error("offline") }
    assert.deepEqual(await requestCartBff({ operation: "read", requestId: "0123456789abcdef" }), { success: false, error: "unavailable" })
  } finally {
    globalThis.fetch = originalFetch
  }
})

