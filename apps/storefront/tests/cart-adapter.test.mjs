import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  createCart,
  addLineItemToCart,
  isCartEnabled,
  isValidCartId,
  isValidVariantId,
  isValidQuantity,
  sanitizeMedusaCart,
  FEATURE_FLAG_ENV_KEY,
} from "../lib/cart.ts"
import { resetStoreCache } from "../lib/medusa.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper to launch a controlled mock Medusa server
function createMockMedusaServer(handler) {
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      req.rawBody = body
      try {
        req.jsonBody = body ? JSON.parse(body) : null
      } catch {
        req.jsonBody = null
      }
      handler(req, res)
    })
  })
  return server
}

test("9. Confirming cart mutations remain disabled by default", async () => {
  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  try {
    delete process.env[FEATURE_FLAG_ENV_KEY]
    assert.equal(isCartEnabled(), false)

    const createRes = await createCart()
    assert.equal(createRes.success, false)
    assert.equal(createRes.error, "disabled")

    const addRes = await addLineItemToCart("cart_123", "var_123", 1)
    assert.equal(addRes.success, false)
    assert.equal(addRes.error, "disabled")
  } finally {
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
  }
})

test("3. Missing configuration or publishable key fails closed without network calls", async () => {
  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  try {
    process.env[FEATURE_FLAG_ENV_KEY] = "true"

    // Missing backend URL
    delete process.env.MEDUSA_BACKEND_URL
    delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_123"

    const noUrlCreate = await createCart()
    assert.equal(noUrlCreate.success, false)
    assert.equal(noUrlCreate.error, "missing_config")

    const noUrlAdd = await addLineItemToCart("cart_1", "var_1", 1)
    assert.equal(noUrlAdd.success, false)
    assert.equal(noUrlAdd.error, "missing_config")

    // Missing publishable key
    process.env.MEDUSA_BACKEND_URL = "http://127.0.0.1:9999"
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

    const noKeyCreate = await createCart()
    assert.equal(noKeyCreate.success, false)
    assert.equal(noKeyCreate.error, "missing_publishable_key")

    const noKeyAdd = await addLineItemToCart("cart_1", "var_1", 1)
    assert.equal(noKeyAdd.success, false)
    assert.equal(noKeyAdd.error, "missing_publishable_key")
  } finally {
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  }
})

test("4. Valid and invalid variant IDs and quantities validation", async () => {
  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  try {
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = "http://127.0.0.1:9999"
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test"

    // Validator unit tests
    assert.equal(isValidCartId("cart_abc123"), true)
    assert.equal(isValidCartId(""), false)
    assert.equal(isValidCartId("   "), false)
    assert.equal(isValidCartId(null), false)
    assert.equal(isValidCartId(undefined), false)
    assert.equal(isValidCartId("a".repeat(256)), false)

    assert.equal(isValidVariantId("var_abc123"), true)
    assert.equal(isValidVariantId(""), false)
    assert.equal(isValidVariantId("   "), false)
    assert.equal(isValidVariantId(null), false)
    assert.equal(isValidVariantId(undefined), false)
    assert.equal(isValidVariantId("v".repeat(256)), false)

    assert.equal(isValidQuantity(1), true)
    assert.equal(isValidQuantity(5), true)
    assert.equal(isValidQuantity(100), true)
    assert.equal(isValidQuantity(0), false)
    assert.equal(isValidQuantity(-1), false)
    assert.equal(isValidQuantity(1.5), false)
    assert.equal(isValidQuantity(101), false)
    assert.equal(isValidQuantity("1"), false)
    assert.equal(isValidQuantity(null), false)
    assert.equal(isValidQuantity(Number.NaN), false)

    // addLineItemToCart rejects invalid inputs before network
    const badCart = await addLineItemToCart("", "var_1", 1)
    assert.equal(badCart.success, false)
    assert.equal(badCart.error, "invalid_cart_id")

    const badVar = await addLineItemToCart("cart_1", "", 1)
    assert.equal(badVar.success, false)
    assert.equal(badVar.error, "invalid_variant_id")

    const badQty = await addLineItemToCart("cart_1", "var_1", 0)
    assert.equal(badQty.success, false)
    assert.equal(badQty.error, "invalid_quantity")
  } finally {
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  }
})

test("1. Successful cart creation with the correct EGP region", async () => {
  const recordedRequests = []
  const server = createMockMedusaServer((req, res) => {
    recordedRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.jsonBody,
    })

    if (req.method === "GET" && req.url.startsWith("/store/regions")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ regions: [{ id: "reg_egp_authoritative", currency_code: "egp" }] }))
      return
    }

    if (req.method === "POST" && req.url === "/store/carts") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          cart: {
            id: "cart_live_123",
            region_id: "reg_egp_authoritative",
            currency_code: "egp",
            total: 0,
            subtotal: 0,
            items: [],
          },
        })
      )
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port

  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  const prevRegion = process.env.MEDUSA_REGION_ID

  try {
    delete process.env.MEDUSA_REGION_ID
    resetStoreCache()
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = `http://127.0.0.1:${port}`
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_authoritative"

    const result = await createCart()

    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.id, "cart_live_123")
      assert.equal(result.data.region_id, "reg_egp_authoritative")
      assert.equal(result.data.currency_code, "egp")
      assert.equal(result.data.total, 0)
    }

    // Verify requests made to Medusa Store API
    const regionReq = recordedRequests.find((r) => r.method === "GET" && r.url.includes("/store/regions"))
    assert.ok(regionReq, "Must request /store/regions to discover EGP region")
    assert.equal(regionReq.headers["x-publishable-api-key"], "pk_test_authoritative")

    const cartReq = recordedRequests.find((r) => r.method === "POST" && r.url === "/store/carts")
    assert.ok(cartReq, "Must POST /store/carts")
    assert.equal(cartReq.headers["x-publishable-api-key"], "pk_test_authoritative")
    assert.equal(cartReq.body.region_id, "reg_egp_authoritative")
  } finally {
    server.close()
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    if (prevRegion !== undefined) process.env.MEDUSA_REGION_ID = prevRegion
    else delete process.env.MEDUSA_REGION_ID
    resetStoreCache()
  }
})

test("2. Missing EGP region — no cart POST performed", async () => {
  const recordedRequests = []
  const server = createMockMedusaServer((req, res) => {
    recordedRequests.push({ method: req.method, url: req.url })

    if (req.method === "GET" && req.url.startsWith("/store/regions")) {
      // Store has USD or EUR only, no EGP region
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ regions: [{ id: "reg_usd_only", currency_code: "usd" }] }))
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port

  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  const prevRegion = process.env.MEDUSA_REGION_ID

  try {
    delete process.env.MEDUSA_REGION_ID
    resetStoreCache()
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = `http://127.0.0.1:${port}`
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_fail_closed"

    const result = await createCart()

    assert.equal(result.success, false)
    assert.equal(result.error, "no_egp_region")

    // Assert that NO POST to /store/carts was executed
    const postRequests = recordedRequests.filter((r) => r.method === "POST")
    assert.equal(postRequests.length, 0, "Must NEVER create a cart when no EGP region exists")
  } finally {
    server.close()
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    if (prevRegion !== undefined) process.env.MEDUSA_REGION_ID = prevRegion
    else delete process.env.MEDUSA_REGION_ID
    resetStoreCache()
  }
})

test("5. Correct native Add Line Item requests", async () => {
  const recordedRequests = []
  const server = createMockMedusaServer((req, res) => {
    recordedRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.jsonBody,
    })

    if (req.method === "POST" && req.url === "/store/carts/cart_456/line-items") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          cart: {
            id: "cart_456",
            region_id: "reg_egp_1",
            currency_code: "egp",
            total: 18500,
            subtotal: 18500,
            items: [
              {
                id: "item_789",
                title: "ماء زمزم 5 لتر",
                variant_id: "var_zamzam_5l",
                quantity: 3,
                unit_price: 6170,
                total: 18510,
              },
            ],
          },
        })
      )
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port

  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  try {
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = `http://127.0.0.1:${port}`
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_items"

    const result = await addLineItemToCart("cart_456", "var_zamzam_5l", 3)

    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data.id, "cart_456")
      assert.equal(result.data.items.length, 1)
      assert.equal(result.data.items[0].variant_id, "var_zamzam_5l")
      assert.equal(result.data.items[0].quantity, 3)
    }

    assert.equal(recordedRequests.length, 1)
    const req = recordedRequests[0]
    assert.equal(req.method, "POST")
    assert.equal(req.url, "/store/carts/cart_456/line-items")
    assert.equal(req.headers["x-publishable-api-key"], "pk_test_items")
    assert.equal(req.headers["content-type"], "application/json")
    // Client supplies only variant_id and quantity; never currency or unit_price
    assert.deepEqual(req.body, { variant_id: "var_zamzam_5l", quantity: 3 })
  } finally {
    server.close()
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  }
})

test("6. Cart mutation conflicts and locked-cart behavior preserved", async () => {
  let conflictMode = "locked" // "locked" | "completed" | "generic"
  const server = createMockMedusaServer((req, res) => {
    res.writeHead(409, { "Content-Type": "application/json" })
    if (conflictMode === "locked") {
      res.end(
        JSON.stringify({
          type: "conflict",
          code: "CART_MUTATIONS_LOCKED",
          message: "Cart checkout currently in progress; mutations locked",
        })
      )
    } else if (conflictMode === "completed") {
      res.end(
        JSON.stringify({
          type: "conflict",
          code: "CART_ALREADY_COMPLETED",
          message: "Cart has already been converted to an order",
        })
      )
    } else {
      res.end(
        JSON.stringify({
          type: "conflict",
          code: "GENERIC_CONFLICT",
          message: "Conflict occurred",
        })
      )
    }
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port

  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  try {
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = `http://127.0.0.1:${port}`
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_conflict"

    // 1. Locked cart
    conflictMode = "locked"
    const lockedRes = await addLineItemToCart("cart_locked_1", "var_1", 1)
    assert.equal(lockedRes.success, false)
    assert.equal(lockedRes.error, "cart_locked")
    assert.equal(lockedRes.status, 409)
    assert.equal(lockedRes.code, "CART_MUTATIONS_LOCKED")

    // 2. Already completed cart
    conflictMode = "completed"
    const completedRes = await addLineItemToCart("cart_done_1", "var_1", 1)
    assert.equal(completedRes.success, false)
    assert.equal(completedRes.error, "cart_completed")
    assert.equal(completedRes.status, 409)
    assert.equal(completedRes.code, "CART_ALREADY_COMPLETED")

    // 3. Generic conflict
    conflictMode = "generic"
    const genericRes = await addLineItemToCart("cart_gen_1", "var_1", 1)
    assert.equal(genericRes.success, false)
    assert.equal(genericRes.error, "conflict")
    assert.equal(genericRes.status, 409)
  } finally {
    server.close()
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  }
})

test("7. Network timeouts and ambiguous responses — no automatic POST retry", async () => {
  let callCount = 0
  const server = createMockMedusaServer((req, res) => {
    callCount++
    // Immediately destroy socket to simulate ambiguous network drop
    req.socket.destroy()
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port

  const prevFlag = process.env[FEATURE_FLAG_ENV_KEY]
  const prevUrl = process.env.MEDUSA_BACKEND_URL
  const prevKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  try {
    process.env[FEATURE_FLAG_ENV_KEY] = "true"
    process.env.MEDUSA_BACKEND_URL = `http://127.0.0.1:${port}`
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_test_drop"

    const result = await addLineItemToCart("cart_drop_1", "var_1", 1)

    assert.equal(result.success, false)
    assert.ok(result.error === "upstream_error" || result.error === "network_timeout")
    // Crucial: Must NOT retry the POST automatically
    assert.equal(callCount, 1, "Must not retry ambiguous mutation POST")
  } finally {
    server.close()
    if (prevFlag !== undefined) process.env[FEATURE_FLAG_ENV_KEY] = prevFlag
    else delete process.env[FEATURE_FLAG_ENV_KEY]
    if (prevUrl !== undefined) process.env.MEDUSA_BACKEND_URL = prevUrl
    else delete process.env.MEDUSA_BACKEND_URL
    if (prevKey !== undefined) process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = prevKey
    else delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  }
})

test("8. Prices and totals are never calculated or overwritten by the frontend", () => {
  const authoritativePayload = {
    id: "cart_authoritative_1",
    region_id: "reg_egp_authoritative",
    currency_code: "egp",
    total: 99999,
    subtotal: 90000,
    tax_total: 9999,
    items: [
      {
        id: "item_auth_1",
        title: "صنف فاخر",
        variant_id: "var_auth_1",
        quantity: 2,
        unit_price: 45000,
        total: 90000,
      },
    ],
  }

  const sanitized = sanitizeMedusaCart(authoritativePayload)
  assert.ok(sanitized)
  assert.equal(sanitized.total, 99999)
  assert.equal(sanitized.subtotal, 90000)
  assert.equal(sanitized.tax_total, 9999)
  assert.equal(sanitized.items[0].unit_price, 45000)
  assert.equal(sanitized.items[0].total, 90000)

  // Empty or malformed items are safely sanitized without inventing numbers
  assert.equal(sanitizeMedusaCart(null), null)
  assert.equal(sanitizeMedusaCart({}), null)
  assert.equal(sanitizeMedusaCart({ id: "cart_1" }), null)
})

test("10. Server-only boundary: no client components import lib/cart", () => {
  const componentsDir = path.resolve(__dirname, "../components")
  const files = fs.readdirSync(componentsDir)

  for (const file of files) {
    if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      const content = fs.readFileSync(path.join(componentsDir, file), "utf-8")
      assert.equal(
        /from\s+["'].*\/cart["']/i.test(content),
        false,
        `Component ${file} must not import cart adapter`
      )
    }
  }
})
