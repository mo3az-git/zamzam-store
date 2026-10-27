import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(path.join(root, "package.json"))
const ts = require("typescript")
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
  } }).outputText
  module._compile(output, filename)
}
const { evaluateCheckoutPreflight, createCheckoutPreflightReadiness } =
  require("./apps/backend/src/modules/batch-inventory/checkout-preflight-readiness.ts")
const { executeCartBffRequest } = require("./apps/backend/src/modules/batch-inventory/cart-bff-orchestrator.ts")
const { validateCartBffRequest, validateCartBffResponse } =
  require("./apps/backend/src/modules/batch-inventory/cart-bff-contract.ts")

const assertDisposableServices = async () => {
  if (process.env.PHASE1_DISPOSABLE_TEST_PROFILE !== "ci_ephemeral_service") {
    throw new Error("Refusing to run without the disposable CI profile")
  }
  const dbUrl = new URL(process.env.DATABASE_URL || "")
  const redisUrl = new URL(process.env.REDIS_URL || "")
  if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname) ||
      dbUrl.pathname !== "/checkout_preflight_test" ||
      !["127.0.0.1", "localhost"].includes(redisUrl.hostname)) {
    throw new Error("Refusing non-disposable checkout preflight targets")
  }
  const { Client } = require("pg")
  const RedisModule = require("ioredis")
  const Redis = RedisModule.default ?? RedisModule
  const client = new Client({ connectionString: dbUrl.toString(), connectionTimeoutMillis: 5000 })
  const redis = new Redis(redisUrl.toString(), { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null })
  await client.connect()
  try {
    assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, "checkout_preflight_test")
    await redis.connect()
    assert.equal(await redis.ping(), "PONG")
  } finally {
    await redis.quit()
    await client.end()
  }
}

await assertDisposableServices()

const ownerProof = Object.freeze({ cartId: "cart_preflight_1", status: "owned" })
const owner = { status: "owned", cartId: "cart_preflight_1", ownerKey: "owner_digest", proof: ownerProof }
const cart = {
  version: "v7",
  native: { id: "cart_preflight_1" },
  public: {
    version: "v7", currency: "egp",
    items: [{ lineItemId: "line_1", variantId: "variant_1", title: "fixture", quantity: 1,
      unitPrice: { currency: "egp", amount: "61.70" }, total: { currency: "egp", amount: "61.70" }, availability: "available" }],
    subtotal: { currency: "egp", amount: "61.70" }, shipping: { currency: "egp", amount: "10.00" },
    total: { currency: "egp", amount: "71.70" },
    delivery: { email: "guest@example.invalid", firstName: "Test", lastName: "Guest", phone: "+201001234567",
      governorateId: "cairo", city: "Cairo", address1: "Disposable address" },
  },
  lines: [{ variantId: "variant_1", minShelfLifeDays: 30 }],
  governorateId: "cairo",
}
const native = {
  cartId: "cart_preflight_1", cartVersion: "v7", countryCode: "eg", currencyCode: "egp",
  governorateId: "cairo", selectedShippingOptionId: "native_option_1",
  subtotal: "61.70", payableTotal: "71.70",
}
const inventory = { authority: "batch_inventory", items: [{ variantId: "variant_1", status: "available" }] }
const shipping = { status: "ready", governorateId: "cairo", shippingOptionId: "native_option_1",
  currencyCode: "egp", amount: "10.00", cartCurrencyCode: "egp", payableTotal: "71.70" }
const payments = {
  cod: { method: "cod", internallyAvailable: true, publicMethodEnabled: false, settlementEnabled: false, blockers: [] },
  electronic: { method: "electronic", internallyAvailable: false, publicMethodEnabled: false, settlementEnabled: false,
    blockers: ["GATEWAY_NOT_SELECTED", "AUTHENTICATED_ADAPTER_NOT_CONFIGURED"] },
}
const baseInput = {
  ownership: owner, expectedVersion: "v7", selectedMethod: "cod", replay: "new",
  cart, native, attempt: { status: "none" }, inventory, shipping, payments,
}
const deps = { isVerifiedGuestCartOwnership: (proof, id) => proof === ownerProof && id === owner.cartId }

let result = evaluateCheckoutPreflight(baseInput, deps)
assert.equal(result.status, "ready_for_review", JSON.stringify(result.blockers))
assert.equal(result.orderCompletionAllowed, false)
assert.equal(result.paymentExecutionAllowed, false)
assert.equal(result.inventoryReservationRequired, true)
assert.equal(result.payment.cod.status, "ready_for_review")
assert.equal(result.payment.electronic.status, "blocked", "COD and electronic readiness remain independent")
assert.equal(result.blockers.length, 0)
assert.equal(result.payableTotal, "71.70")

result = evaluateCheckoutPreflight({ ...baseInput, selectedMethod: "electronic" }, deps)
assert.equal(result.status, "blocked")
assert.ok(result.blockers.some((item) => item.code === "GATEWAY_NOT_SELECTED"))
assert.ok(result.blockers.every((item) => item.presentationKey.startsWith("checkout.readiness.blockers.")))

result = evaluateCheckoutPreflight({ ...baseInput, shipping: { status: "blocked", governorateId: "cairo",
  currencyCode: "egp", blockers: ["SHIPPING_RATE_UNCONFIGURED", "SHIPPING_PROVIDER_UNDECIDED"] } }, deps)
assert.ok(result.blockers.some((item) => item.code === "SHIPPING_RATE_UNCONFIGURED"))
assert.equal(result.payment.cod.status, "ready_for_review", "shipping blocker does not collapse payment branch state")

for (const [patch, expected] of [
  [{ ownership: { ...owner, proof: {} } }, "GUEST_CART_NOT_OWNED"],
  [{ expectedVersion: "v6" }, "CART_VERSION_STALE"],
  [{ native: { ...native, cartVersion: "v6" } }, "PREFLIGHT_STATE_UNAVAILABLE"],
  [{ attempt: { status: "stale", cartVersion: "v6", paymentMethod: "cod" } }, "CHECKOUT_ATTEMPT_STALE"],
  [{ attempt: { status: "active", cartVersion: "v7", paymentMethod: "cod" } }, "CHECKOUT_IN_PROGRESS"],
  [{ attempt: { status: "completed" } }, "CHECKOUT_ALREADY_COMPLETED"],
  [{ attempt: { status: "outcome_unknown" } }, "PAYMENT_OUTCOME_UNCERTAIN"],
  [{ replay: "conflict" }, "PREFLIGHT_REPLAY_CONFLICT"],
  [{ replay: "unavailable" }, "PREFLIGHT_STATE_UNAVAILABLE"],
  [{ inventory: { authority: "batch_inventory", items: [{ variantId: "variant_1", status: "unknown" }] } }, "INVENTORY_UNKNOWN"],
  [{ inventory: { authority: "batch_inventory", items: [{ variantId: "variant_1", status: "unavailable" }] } }, "INVENTORY_UNAVAILABLE"],
  [{ native: { ...native, governorateId: "giza" } }, "SHIPPING_GOVERNORATE_MISMATCH"],
  [{ native: { ...native, selectedShippingOptionId: "other_option" } }, "SHIPPING_OPTION_MISMATCH"],
  [{ native: { ...native, currencyCode: "usd" } }, "CART_CURRENCY_NOT_EGP"],
  [{ native: { ...native, payableTotal: "70.00" } }, "CART_TOTAL_MISMATCH"],
]) {
  result = evaluateCheckoutPreflight({ ...baseInput, ...patch }, deps)
  assert.ok(result.blockers.some((item) => item.code === expected), expected)
}
assert.equal(evaluateCheckoutPreflight({ ...baseInput, replay: "exact" }, deps).replayed, true)

let mutationCount = 0
let replayState = "new"
const sources = {
  isVerifiedGuestCartOwnership: deps.isVerifiedGuestCartOwnership,
  async readNativeFacts() { return native },
  async readAttempt() { return { status: "none" } },
  async readInventory() { return inventory },
  async readShipping() { return shipping },
  async readPayments() { return payments },
  async inspectReplay(input) {
    assert.equal(input.ownerKey, owner.ownerKey)
    assert.equal(input.fingerprint, JSON.stringify(["checkout_preflight", "v7", "cod"]))
    return replayState
  },
}
const readinessDependency = createCheckoutPreflightReadiness(sources)
const orchestration = {
  async resolveOwnedCart() { return owner },
  async readNativeCart() { return cart },
  async readAvailability() { throw new Error("legacy split readiness must not be called") },
  async shippingReadiness() { throw new Error("legacy split readiness must not be called") },
  async paymentReadiness() { throw new Error("legacy split readiness must not be called") },
  async checkoutReadiness() { throw new Error("legacy split readiness must not be called") },
}
const dependencies = {
  async createOwnedEgpCart() { throw new Error("not used") },
  ...orchestration,
  async mutateNativeCart() { mutationCount++; return cart },
  async executeIdempotently(_input, work) { return work() },
  issueGuestSessionCookie() {},
  checkoutReadiness: readinessDependency,
}
const response = await executeCartBffRequest({
  body: { operation: "checkout_preflight", requestId: "request_preflight_0001", expectedVersion: "v7", paymentMethod: "cod" },
  sessionSecret: "opaque-secret",
  dependencies,
})
assert.equal(response.response.checkout.status, "ready_for_review")
assert.equal(validateCartBffResponse(response.response).valid, true)
assert.equal(mutationCount, 0, "preflight performs no cart, payment, reservation, or order writes")
assert.equal(response.rejectedBeforeMutation, true)
assert.equal(response.response.checkout.blockers.length, 0)

replayState = "conflict"
const conflict = await executeCartBffRequest({
  body: { operation: "checkout_preflight", requestId: "request_preflight_0002", expectedVersion: "v7", paymentMethod: "cod" },
  sessionSecret: "opaque-secret",
  dependencies,
})
assert.ok(conflict.response.blockers.includes("PREFLIGHT_REPLAY_CONFLICT"))
assert.equal(mutationCount, 0)

assert.equal(validateCartBffRequest({ operation: "checkout_preflight", requestId: "request_preflight_0003",
  expectedVersion: "v7", paymentMethod: "cod", paymentReadiness: true, payableTotal: "0.01" }).valid, false,
  "client cannot inject readiness or payable total")
assert.equal(validateCartBffRequest({ operation: "complete", requestId: "request_preflight_0004" }).valid, false,
  "BFF contract has no public completion operation")

console.log("Checkout preflight: read-only composition, blockers, localized keys, ownership, replay and independent payments passed.")
