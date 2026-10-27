import test from "node:test"
import assert from "node:assert/strict"
import {
  GUEST_CART_SESSION_COOKIE,
  OWNED_NATIVE_CART_ROUTE_MATCHER,
  getCartIdFromStorePath,
  getGuestCartSessionSecret,
  hasGuestCartRouteOwnership,
} from "../src/api/guest-cart-ownership-policy.ts"

const cartA = "cart_guest_a"
const cartB = "cart_guest_b"
const secretA = "A".repeat(43)
const secretB = "B".repeat(43)
const cookie = (value) => `${GUEST_CART_SESSION_COOKIE}=${encodeURIComponent(value)}; theme=dark`

test("only an unambiguous guest ownership cookie is accepted", () => {
  assert.equal(getGuestCartSessionSecret(cookie(secretA)), secretA)
  assert.equal(getGuestCartSessionSecret(undefined), null)
  assert.equal(getGuestCartSessionSecret(`${GUEST_CART_SESSION_COOKIE}=${secretA}; ${GUEST_CART_SESSION_COOKIE}=${secretB}`), null)
  assert.equal(getGuestCartSessionSecret(`${GUEST_CART_SESSION_COOKIE}=%ZZ`), null)
})

test("only concrete native Store cart paths produce a cart identity", () => {
  assert.equal(getCartIdFromStorePath(`/store/carts/${cartA}`), cartA)
  assert.equal(getCartIdFromStorePath(`/store/carts/${cartA}/line-items`), cartA)
  assert.equal(getCartIdFromStorePath("/store/carts"), null)
  assert.equal(getCartIdFromStorePath("/store/products/cart_guest_a"), null)
  assert.equal(getCartIdFromStorePath("/store/carts/%ZZ"), null)
})

test("native cart read and mutation routes require ownership while completion stays default-deny", () => {
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test(`/store/carts/${cartA}`), true)
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test(`/store/carts/${cartA}/line-items`), true)
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test(`/store/carts/${cartA}/shipping-methods`), true)
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test(`/store/carts/${cartA}/complete`), false)
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test(`/store/carts/${cartA}/checkout-lock`), false)
  assert.equal(OWNED_NATIVE_CART_ROUTE_MATCHER.test("/store/carts"), false)
})

test("a correct cookie authorizes only its exact routed cart", async () => {
  const observed = []
  const resolveOwnership = async (_container, secret, expectedCartId) => {
    observed.push({ secret, expectedCartId })
    return secret === secretA && expectedCartId === cartA
      ? { status: "owned", cartId: cartA, sessionStatus: "missing" }
      : { status: "not_owned" }
  }
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartA}`, cookieHeader: cookie(secretA), resolveOwnership }), true)
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartB}`, cookieHeader: cookie(secretA), resolveOwnership }), false)
  assert.deepEqual(observed, [
    { secret: secretA, expectedCartId: cartA },
    { secret: secretA, expectedCartId: cartB },
  ])
})

test("missing, expired, unavailable, and fabricated ownership proofs fail closed", async () => {
  let resolverCalls = 0
  const deny = async () => { resolverCalls += 1; return { status: "expired" } }
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartA}`, cookieHeader: undefined, resolveOwnership: deny }), false)
  assert.equal(resolverCalls, 0, "missing proof must not query ownership storage")
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartA}`, cookieHeader: cookie(secretA), resolveOwnership: deny }), false)
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartA}`, cookieHeader: cookie(secretA), resolveOwnership: async () => ({ status: "unavailable" }) }), false)
  // Even a faulty injected resolver cannot grant a mismatched cart id.
  assert.equal(await hasGuestCartRouteOwnership({ container: {}, path: `/store/carts/${cartA}`, cookieHeader: cookie(secretA), resolveOwnership: async () => ({ status: "owned", cartId: cartB, sessionStatus: "missing" }) }), false)
})
