import test from "node:test"
import assert from "node:assert/strict"
import { makeInternalPayableQuote } from "../src/modules/order-operations/payment-quote-validation.ts"

const expected = { cartId: "cart_123", orderId: "order_456" }
function native(extra = {}) {
  return {
    cartId: expected.cartId, orderId: expected.orderId, currency: "egp",
    orderVersion: 1, totalMajor: "61.70", totalMinor: "6170",
    lines: [{lineId:"line_1",checkoutLineKey:"123"}], ...extra
  }
}
test("preserves exact native EGP amounts as major and minor strings", () => {
  const quote = makeInternalPayableQuote(native(), expected)
  assert.deepEqual(quote, {
    cartId: "cart_123", orderId: "order_456", currency: "EGP",
    orderVersion: 1, amountMajor: "61.70", amountMinor: "6170",
  })
  assert.equal(Object.isFrozen(quote), true)
})
test("accepts non-rounded fractional major values with precisely two decimals", () => {
  assert.equal(makeInternalPayableQuote(native({totalMajor:"1.01",totalMinor:"101"}), expected).amountMinor, "101")
})
test("rejects any cart/order identity mismatch or foreign currency", () => {
  for (const candidate of [
    native({cartId:"cart_other"}), native({orderId:"order_other"}),
    native({currency:"usd"}), native({currency:"EGP"}),
  ]) assert.throws(()=>makeInternalPayableQuote(candidate,expected),/UNVERIFIED_PAYABLE_ORDER_SNAPSHOT/)
})
test("rejects malformed, zero, inconsistent, or sub-piastre monetary values", () => {
  for (const candidate of [
    native({totalMajor:"0.00",totalMinor:"0"}),
    native({totalMajor:"61.70",totalMinor:"6171"}),
    native({totalMajor:"61.701",totalMinor:"6170"}),
    native({totalMajor:"1.234",totalMinor:"123"}),
    native({totalMajor:"061.70",totalMinor:"6170"}),
    native({totalMajor:"NaN"}), native({totalMajor:"1e4"}),
    native({totalMajor:61.7}), native({totalMinor:6170}),
    native({totalMajor:"10000000000.00",totalMinor:"1000000000000"}),
  ]) assert.throws(()=>makeInternalPayableQuote(candidate,expected),/UNVERIFIED_PAYABLE_ORDER_SNAPSHOT/)
})
test("rejects stale or missing native order version and missing line identity", () => {
  for (const candidate of [
    native({orderVersion:0}),native({orderVersion:1.2}),native({orderVersion:NaN}),
    native({lines:[]}),native({lines:null}),
  ]) assert.throws(()=>makeInternalPayableQuote(candidate,expected),/UNVERIFIED_PAYABLE_ORDER_SNAPSHOT/)
})
test("rejects untrusted expected identifiers", () => {
  for (const e of [
    {cartId:"cart_other",orderId:expected.orderId},
    {cartId:expected.cartId,orderId:"order_other"},
    {cartId:"",orderId:expected.orderId},
    {cartId:expected.cartId,orderId:""},
  ]) assert.throws(()=>makeInternalPayableQuote(native(),e),/UNVERIFIED_PAYABLE_ORDER_SNAPSHOT/)
})
