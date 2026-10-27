import assert from "node:assert/strict"
import { evaluateGuestCheckoutPreflight, validateGuestDeliveryInput } from "../src/modules/batch-inventory/guest-checkout-preflight.ts"

const guest = { email: "  Guest@Example.com ", first_name: " آمنة ", last_name: "علي", phone: "+20 100 123 4567",
  address_1: "شارع النيل 1", city: "القاهرة", province: "القاهرة", country_code: "EG" }
const cart = { id: "cart_server_resolved", currency_code: "egp", region_id: "reg_eg", region: { id: "reg_eg",
  currency_code: "egp", countries: [{ iso_2: "eg" }] }, shipping_address: { address_1: "شارع النيل 1", city: "القاهرة", country_code: "eg" },
  shipping_methods: [{ shipping_option_id: "so_disposable", amount: 25, raw_amount: { value: "25.00" } }],
  shipping_total: 25, raw_shipping_total: { value: "25.00" }, total: 125, raw_total: { value: "125.00" } }
const valid = validateGuestDeliveryInput(guest)
assert.equal(valid.valid, true)
assert.equal(valid.email, "guest@example.com")
assert.equal(valid.address?.country_code, "eg")
assert.equal("ignored" in (valid.address ?? {}), false)
assert.equal(validateGuestDeliveryInput({ ...guest, phone: "x" }).valid, false)
assert.equal(validateGuestDeliveryInput({ ...guest, country_code: "US" }).valid, false)
assert.equal(validateGuestDeliveryInput({ ...guest, address_1: "\u0000bad" }).valid, false)
assert.equal(validateGuestDeliveryInput(null).valid, false)

const evaluate = (changes = {}, sessionStatus = "missing") => evaluateGuestCheckoutPreflight({
  cart: changes.cart === null ? null : { ...cart, ...changes }, guest, sessionStatus,
})
let result = evaluate()
assert.equal(result.status, "blocked")
assert(result.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"))
assert(result.blockers.includes("CHECKOUT_SESSION_UNAVAILABLE"))
result = evaluate({ shipping_methods: [] }, "failed")
assert(result.blockers.includes("MISSING_SHIPPING_METHOD"))
result = evaluate({ shipping_methods: [{ shipping_option_id: "so_disposable" }] })
assert(result.blockers.includes("SHIPPING_PRICE_UNAVAILABLE"))
result = evaluate({ currency_code: "usd" })
assert(result.blockers.includes("CART_CURRENCY_NOT_EGP"))
result = evaluate({ region: { id: "reg_us", currency_code: "usd", countries: [{ iso_2: "us" }] } })
assert(result.blockers.includes("CART_REGION_NOT_EGYPT_EGP"))
result = evaluate({ total: null, raw_total: null })
assert(result.blockers.includes("PAYABLE_TOTAL_UNAVAILABLE"))
result = evaluate({ cart: null })
assert(result.blockers.includes("CART_UNAVAILABLE"))
result = evaluate({}, "in_progress")
assert(result.blockers.includes("CHECKOUT_IN_PROGRESS"))
result = evaluate({}, "completed")
assert(result.blockers.includes("CHECKOUT_ALREADY_COMPLETED"))
result = evaluate({}, "aborted")
assert(result.blockers.includes("CHECKOUT_SESSION_UNAVAILABLE"))
// Read-only by construction: evaluator accepts snapshots and has no container, IDs, or write-capable service.
assert.deepEqual(Object.keys(result).sort(), ["blockers", "currency", "readiness", "status"])
console.log("Guest checkout preflight: 20 focused assertions passed")
