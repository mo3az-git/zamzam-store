import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(path.join(repositoryRoot, "package.json"))
const typescript = require("typescript")
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = typescript.transpileModule(source, { compilerOptions: {
    module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2021,
  } }).outputText
  module._compile(output, filename)
}
const { executeCartBffRequest } = require("./apps/backend/src/modules/batch-inventory/cart-bff-orchestrator.ts")
const { validateCartBffRequest, validateCartBffResponse } = require("./apps/backend/src/modules/batch-inventory/cart-bff-contract.ts")

const delivery = { email: "guest@example.invalid", firstName: "Test", lastName: "Guest", phone: "+201001234567",
  governorateId: "cairo", city: "Cairo", address1: "Disposable address" }
const owner = { status: "owned", cartId: "cart_disposable_1", ownerKey: "owner_digest_1", proof: Object.freeze({ internal: true }) }
let version = "v1"
let secretCookie = null
let mutations = 0
let idempotentCalls = 0
let blockersFromShipping = ["SHIPPING_RATE_UNCONFIGURED", "SHIPPING_PROVIDER_UNDECIDED"]
let inventory = "unknown"
let paymentReady = false
let shippingPrice = null
let mutationError = null
let idempotencyError = null

const snapshot = () => ({ version, native: { currency_code: "egp" }, public: {
  version, currency: "egp", items: [{ lineItemId: "item_disposable_1", variantId: "variant_disposable_1", title: "fixture",
    quantity: 1, unitPrice: { currency: "egp", amount: "61.70" }, total: { currency: "egp", amount: "61.70" }, availability: inventory }],
  subtotal: { currency: "egp", amount: "61.70" }, shipping: shippingPrice, total: { currency: "egp", amount: shippingPrice ? "71.70" : "61.70" }, delivery },
  lines: [{ variantId: "variant_disposable_1", minShelfLifeDays: 30 }], governorateId: "cairo" })

const dependencies = {
  async createOwnedEgpCart() { return { cartId: owner.cartId, ownerKey: owner.ownerKey, proof: owner.proof,
    sessionSecret: "synthetic_session_secret_never_json", snapshot: snapshot() } },
  async resolveOwnedCart(secret) { assert.equal(secret, "synthetic_session_secret_never_json"); return owner },
  async readNativeCart(cartId, proof) { assert.equal(cartId, owner.cartId); assert.equal(proof, owner.proof); return snapshot() },
  async mutateNativeCart({ expectedVersion }) {
    assert.equal(expectedVersion, version)
    if (mutationError) throw Object.assign(new Error("private provider details"), { code: mutationError })
    mutations++; version = `v${mutations + 1}`; return snapshot()
  },
  async executeIdempotently(_input, work) {
    idempotentCalls++
    if (idempotencyError) throw Object.assign(new Error("private journal details"), { code: idempotencyError })
    return work()
  },
  issueGuestSessionCookie(secret) { secretCookie = secret },
  async readAvailability(lines) { assert.equal(lines.length, 1); return [{ variantId: lines[0].variantId, status: inventory }] },
  async shippingReadiness() { return blockersFromShipping },
  async paymentReadiness(method) { assert.ok(["cod", "electronic"].includes(method)); return paymentReady },
  async checkoutReadiness(current) { return current.public.shipping
    ? { status: "ready_for_review", blockers: [] }
    : { status: "blocked", blockers: ["SHIPPING_QUOTE_UNAVAILABLE"] } },
}

const run = (body, sessionSecret = "synthetic_session_secret_never_json") => executeCartBffRequest({ body, sessionSecret, dependencies })
const requestId = "request_disposable_0001"

assert.equal(validateCartBffRequest({ operation: "create", requestId, cartId: "cart_attacker" }).valid, false,
  "cart identity cannot come from caller input")
assert.equal(validateCartBffRequest({ operation: "complete", requestId }).valid, false,
  "no completion operation exists")
assert.equal(validateCartBffRequest({ operation: "add_item", requestId, expectedVersion: "v1", variantId: "variant_1",
  quantity: 1, unitPrice: 0.01 }).valid, false, "client price is rejected")
assert.equal(validateCartBffRequest({ operation: "set_delivery", requestId, expectedVersion: "v1", delivery: { ...delivery, country_code: "us" } }).valid, false,
  "unknown address fields are rejected")

const created = await run({ operation: "create", requestId }, null)
assert.equal(created.response.ok, true)
assert.equal(secretCookie, "synthetic_session_secret_never_json")
assert.equal(JSON.stringify(created.response).includes(secretCookie), false, "session secret never enters response JSON")
assert.equal(JSON.stringify(created.response).includes(owner.cartId), false, "native cart ID never enters response JSON")
assert.equal(created.response.cart.total.amount, "61.70", "server EGP total is returned unchanged")

let changed = await run({ operation: "add_item", requestId: "request_disposable_0002", expectedVersion: version, variantId: "variant_disposable_1", quantity: 2 })
assert.equal(changed.response.ok, true)
assert.equal(mutations, 1)
assert.equal(idempotentCalls, 1, "owner-scoped mutation journal wraps native write")
assert.equal((await run({ operation: "remove_item", requestId: "request_disposable_0003", expectedVersion: "stale", lineItemId: "item_disposable_1" })).response.blockers[0], "CART_VERSION_CONFLICT")
assert.equal(mutations, 1, "stale version is rejected before mutation")

changed = await run({ operation: "update_item", requestId: "request_disposable_0004", expectedVersion: version, lineItemId: "item_disposable_1", quantity: 3 })
assert.equal(changed.response.ok, true)
changed = await run({ operation: "remove_item", requestId: "request_disposable_0005", expectedVersion: version, lineItemId: "item_disposable_1" })
assert.equal(changed.response.ok, true)
assert.equal(mutations, 3, "add, update and remove all use the adapter's existing mutation-lock boundary")
mutationError = "CART_MUTATIONS_LOCKED"
changed = await run({ operation: "add_item", requestId: "request_disposable_0008", expectedVersion: version, variantId: "variant_disposable_1", quantity: 1 })
assert.equal(changed.response.blockers[0], "CART_MUTATION_LOCKED", "active lock fails closed")
assert.equal(JSON.stringify(changed.response).includes("private provider details"), false, "native error details are redacted")
mutationError = null
idempotencyError = "CART_IDEMPOTENCY_UNAVAILABLE"
changed = await run({ operation: "remove_item", requestId: "request_disposable_0009", expectedVersion: version, lineItemId: "item_disposable_1" })
assert.equal(changed.response.blockers[0], "CART_IDEMPOTENCY_UNAVAILABLE", "missing durable journal fails closed")
assert.equal(mutations, 3, "no mutation runs without idempotency authority")
idempotencyError = null

let preflight = await run({ operation: "checkout_preflight", requestId: "request_disposable_0006", expectedVersion: version, paymentMethod: "cod" })
assert.equal(preflight.response.checkout.status, "blocked")
assert.ok(preflight.response.blockers.includes("INVENTORY_UNKNOWN"))
assert.ok(preflight.response.blockers.includes("SHIPPING_RATE_UNCONFIGURED"))
assert.ok(preflight.response.blockers.includes("PAYMENT_METHOD_UNAVAILABLE"))
assert.equal(preflight.rejectedBeforeMutation, true)
assert.equal(mutations, 3)

inventory = "available"
blockersFromShipping = []
paymentReady = true
shippingPrice = { currency: "egp", amount: "10.00" }
preflight = await run({ operation: "checkout_preflight", requestId: "request_disposable_0007", expectedVersion: version, paymentMethod: "electronic" })
assert.equal(preflight.response.checkout.status, "ready_for_review")
assert.equal(preflight.response.ok, true, "readiness is not authorization to place an order")
assert.equal(mutations, 3)

const badResponse = validateCartBffResponse({ ...created.response, sessionSecret: "leak" })
assert.equal(badResponse.valid, false, "response validation rejects secret-shaped unexpected fields")
const badCartResponse = validateCartBffResponse({ ...created.response, cart: { ...created.response.cart, cartId: owner.cartId } })
assert.equal(badCartResponse.valid, false, "response validation rejects cart identity fields")

console.log("Cart BFF contract/orchestrator: synthetic validation and lifecycle checks passed; no order completion path exists.")

