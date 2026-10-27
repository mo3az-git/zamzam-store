import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

process.env.TS_NODE_PROJECT = fileURLToPath(new URL("../tsconfig.json", import.meta.url))
const require = createRequire(import.meta.url)
require("ts-node/register")
const { ContainerRegistrationKeys, Modules } = require("@medusajs/framework/utils")
const { evaluateGuestCheckoutPreflight, validateGuestDeliveryInput } = require("../src/modules/batch-inventory/guest-checkout-preflight.ts")
const { invalidateGuestCartOwnership, isVerifiedGuestCartOwnership, resolveGuestCartOwnership } = require("../src/modules/batch-inventory/guest-cart-ownership.ts")

const guest = { email: "  Guest@Example.com ", first_name: " آمنة ", last_name: "علي", phone: "+20 100 123 4567",
  address_1: "شارع النيل 1", city: "القاهرة", province: "القاهرة", country_code: "EG" }
const cart = { id: "cart_server_resolved", currency_code: "egp", region_id: "reg_eg", region: { id: "reg_eg",
  currency_code: "egp", countries: [{ iso_2: "eg" }] }, shipping_address: { address_1: "شارع النيل 1", city: "القاهرة", country_code: "eg" },
  shipping_methods: [{ shipping_option_id: "so_disposable", amount: 25, raw_amount: { value: "25.00" } }],
  shipping_total: 25, raw_shipping_total: { value: "25.00" }, total: 125, raw_total: { value: "125.00" } }
const records = new Map()
let sessionStatus = null
let currentCart = cart
let redisFailure = false
let redisLocked = false
let dbFailure = false
const sql = { async raw(statement, values = []) {
  if (dbFailure) throw new Error("sensitive postgres connection detail")
  if (statement.includes("INSERT INTO guest_cart_ownership")) {
    const [hash, cartId, expiresAt] = values
    if ([...records.values()].some((r) => r.cart_id === cartId)) throw new Error("unique violation detail")
    records.set(hash, { cart_id: cartId, expires_at: new Date(expiresAt), invalidated_at: null })
    return { rows: [], rowCount: 1 }
  }
  if (statement.includes("SELECT cart_id,expires_at,invalidated_at")) return { rows: records.has(values[0]) ? [records.get(values[0])] : [] }
  if (statement.includes("SELECT status FROM cart_checkout_session")) return { rows: sessionStatus ? [{ status: sessionStatus }] : [] }
  if (statement.includes("UPDATE guest_cart_ownership")) {
    const record = records.get(values[0])
    if (record && !record.invalidated_at) { record.invalidated_at = new Date(); return { rows: [{ session_hash: values[0] }], rowCount: 1 } }
    return { rows: [], rowCount: 0 }
  }
  throw new Error("unexpected database operation")
} }
const container = { resolve(key) {
  if (key === ContainerRegistrationKeys.PG_CONNECTION) return sql
  if (key === Modules.CART) return { async retrieveCart(id) {
    if (id !== currentCart.id) throw new Error("not found")
    return currentCart
  } }
  if (key === Modules.LOCKING) return { defaultProviderId: "test", providerService_: { retrieveProviderRegistration() {
    return { keyNamePrefix: "lock:", redisClient: { async get() {
      if (redisFailure) throw new Error("sensitive redis connection detail")
      return redisLocked ? "active-worker" : null
    } } }
  } } }
  throw new Error("unexpected container key")
} }

const valid = validateGuestDeliveryInput(guest)
assert.equal(valid.valid, true)
assert.equal(valid.email, "guest@example.com")
assert.equal(valid.address?.country_code, "eg")
assert.equal(validateGuestDeliveryInput({ ...guest, phone: "x" }).valid, false)
assert.equal(validateGuestDeliveryInput({ ...guest, country_code: "US" }).valid, false)
assert.equal(validateGuestDeliveryInput({ ...guest, address_1: "\u0000bad" }).valid, false)
assert.equal(validateGuestDeliveryInput(null).valid, false)

const sessionSecret = randomBytes(32).toString("base64url")
const tokenHash = createHash("sha256").update(sessionSecret, "utf8").digest("hex")
records.set(tokenHash, { cart_id: cart.id, expires_at: new Date(Date.now() + 60_000), invalidated_at: null })
const issued = { sessionSecret }
assert.equal(issued.sessionSecret.length, 43)
assert.equal([...records.keys()][0] === issued.sessionSecret, false) // only a digest is persisted
let ownership = await resolveGuestCartOwnership(container, issued.sessionSecret)
assert.equal(ownership.status, "owned")
assert.equal(ownership.cartId, cart.id)
assert.equal(isVerifiedGuestCartOwnership(ownership, cart.id), true)
assert.equal(isVerifiedGuestCartOwnership({ status: "owned", cartId: cart.id, sessionStatus: "missing" }, cart.id), false)
assert.equal((await resolveGuestCartOwnership(container, "invalid-token")).status, "not_owned")
assert.equal((await resolveGuestCartOwnership(container, "A".repeat(43))).status, "not_owned")
assert.equal((await resolveGuestCartOwnership(container, issued.sessionSecret, "cart_attacker_supplied")).status, "not_owned")

// Only resolver-issued in-memory proof can satisfy ownership, and other blockers remain authoritative.
const evaluate = (changes = {}, proof = ownership) => evaluateGuestCheckoutPreflight({
  cart: changes.cart === null ? null : { ...cart, ...changes }, guest, ownership: proof,
})
let result = evaluate()
assert.equal(result.status, "ready_for_review")
assert.deepEqual(result.blockers, [])
assert(!result.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"))
assert.equal(evaluate({}, { status: "owned", cartId: cart.id, sessionStatus: "missing" }).status, "blocked")
assert(evaluate({}, { status: "owned", cartId: cart.id, sessionStatus: "missing" }).blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"))
assert(evaluate({ shipping_methods: [] }).blockers.includes("MISSING_SHIPPING_METHOD"))
assert(evaluate({ currency_code: "usd" }).blockers.includes("CART_CURRENCY_NOT_EGP"))
assert(evaluate({ region: { id: "reg_us", currency_code: "usd", countries: [{ iso_2: "us" }] } }).blockers.includes("CART_REGION_NOT_EGYPT_EGP"))
assert(evaluate({ total: null, raw_total: null }).blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"))
sessionStatus = "in_progress"
ownership = await resolveGuestCartOwnership(container, issued.sessionSecret)
assert(ownership.status === "owned" && ownership.sessionStatus === "in_progress")
assert(evaluate({}, ownership).blockers.includes("CHECKOUT_IN_PROGRESS"))
sessionStatus = "completed"
const completedOwnership = await resolveGuestCartOwnership(container, issued.sessionSecret)
assert.equal(completedOwnership.status, "not_owned")
assert(records.get([...records.keys()][0]).invalidated_at)
assert.equal((await resolveGuestCartOwnership(container, issued.sessionSecret)).status, "not_owned")
result = evaluate({}, completedOwnership)
assert(result.blockers.includes("CHECKOUT_ALREADY_COMPLETED"))

// Expiration, invalidation, active lock, and backend errors fail closed.
sessionStatus = null
currentCart = { ...cart, id: "cart_native_completed", completed_at: new Date() }
const nativeCompletedSecret = randomBytes(32).toString("base64url")
const nativeCompletedHash = createHash("sha256").update(nativeCompletedSecret, "utf8").digest("hex")
records.set(nativeCompletedHash, { cart_id: currentCart.id, expires_at: new Date(Date.now() + 60_000), invalidated_at: null })
assert.equal((await resolveGuestCartOwnership(container, nativeCompletedSecret)).status, "not_owned")
assert(records.get(nativeCompletedHash).invalidated_at)
const secondCart = { ...cart, id: "cart_second" }
currentCart = secondCart
const second = { sessionSecret: randomBytes(32).toString("base64url") }
const secondHash = createHash("sha256").update(second.sessionSecret, "utf8").digest("hex")
records.set(secondHash, { cart_id: secondCart.id, expires_at: new Date(Date.now() + 60_000), invalidated_at: null })
const secondRecord = [...records.entries()].find(([, row]) => row.cart_id === secondCart.id)
secondRecord[1].expires_at = new Date(Date.now() - 1)
assert.equal((await resolveGuestCartOwnership(container, second.sessionSecret)).status, "expired")
// Redis is unavailable or holds a mutation lock: neither condition grants access.
const thirdCart = { ...cart, id: "cart_third" }
currentCart = thirdCart
const third = { sessionSecret: randomBytes(32).toString("base64url") }
const thirdHash = createHash("sha256").update(third.sessionSecret, "utf8").digest("hex")
records.set(thirdHash, { cart_id: thirdCart.id, expires_at: new Date(Date.now() + 60_000), invalidated_at: null })
assert.equal(await invalidateGuestCartOwnership(container, third.sessionSecret), true)
assert.equal((await resolveGuestCartOwnership(container, third.sessionSecret)).status, "not_owned")
const fourthCart = { ...cart, id: "cart_fourth" }
currentCart = fourthCart
const fourth = { sessionSecret: randomBytes(32).toString("base64url") }
const fourthHash = createHash("sha256").update(fourth.sessionSecret, "utf8").digest("hex")
records.set(fourthHash, { cart_id: fourthCart.id, expires_at: new Date(Date.now() + 60_000), invalidated_at: null })
redisLocked = true
assert.equal((await resolveGuestCartOwnership(container, fourth.sessionSecret)).status, "unavailable")
redisLocked = false
redisFailure = true
assert.equal((await resolveGuestCartOwnership(container, fourth.sessionSecret)).status, "unavailable")
redisFailure = false
dbFailure = true
const unavailable = await resolveGuestCartOwnership(container, fourth.sessionSecret)
assert.equal(unavailable.status, "unavailable")
assert(evaluate({}, unavailable).blockers.includes("CHECKOUT_SESSION_UNAVAILABLE"))
dbFailure = false

console.log("Guest cart ownership: focused resolver and preflight assertions passed")
