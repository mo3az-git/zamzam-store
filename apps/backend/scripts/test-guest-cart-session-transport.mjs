import test from "node:test"
import assert from "node:assert/strict"
const {
  GUEST_CART_SESSION_COOKIE_PATH,
  GuestCartTransportError,
  clearGuestCartSessionCookie,
  isTrustedSameOriginCartMutation,
  issueGuestCartSession,
  serializeGuestCartSessionCookie,
  setGuestCartSessionCookie,
} = await import("../src/api/guest-cart-session-transport.ts")

const origin = "https://storefront.example.invalid"
const secret = Buffer.alloc(32, 7).toString("base64url")
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const request = (overrides = {}) => ({ method: "POST", headers: {
  origin,
  "sec-fetch-site": "same-origin",
  "content-type": "application/json; charset=utf-8",
  ...overrides,
} })
function response(initial = []) {
  const headers = new Map([["Set-Cookie", initial]])
  return {
    headers,
    getHeader(name) { return headers.get(name) },
    setHeader(name, value) { headers.set(name, value) },
  }
}

test("cookie-authenticated mutations require exact same-origin browser metadata", () => {
  assert.equal(isTrustedSameOriginCartMutation(request(), origin), true)
  for (const bad of [
    request({ origin: "https://attacker.example.invalid" }),
    request({ origin: "null" }),
    request({ origin: [origin] }),
    request({ "sec-fetch-site": "same-site" }),
    request({ "sec-fetch-site": "cross-site" }),
    request({ "content-type": "text/plain" }),
    request({ "content-type": ["application/json"] }),
    { ...request(), method: "GET" },
  ]) assert.equal(isTrustedSameOriginCartMutation(bad, origin), false)
  assert.equal(isTrustedSameOriginCartMutation(request(), undefined), false, "missing server origin configuration fails closed")
  assert.equal(isTrustedSameOriginCartMutation(request(), "https://storefront.example.invalid/other"), false)
})

test("ownership cookie is scoped, secure, HttpOnly, SameSite, expiring, and replaceable", () => {
  const now = Date.now()
  const value = serializeGuestCartSessionCookie(secret, new Date(now + 60_000).toISOString(), now)
  assert.match(value, /^zamzam_guest_cart=/)
  assert.match(value, /Path=\/api\/cart/)
  assert.match(value, /Max-Age=60/)
  assert.match(value, /HttpOnly/)
  assert.match(value, /Secure/)
  assert.match(value, /SameSite=Lax/)
  assert.doesNotMatch(value, /Domain=/i)
  assert.equal(GUEST_CART_SESSION_COOKIE_PATH, "/api/cart")
  assert.throws(() => serializeGuestCartSessionCookie("too-short", expiresAt), GuestCartTransportError)
  assert.throws(() => serializeGuestCartSessionCookie(secret, new Date(now - 1).toISOString(), now), GuestCartTransportError)

  const res = response(["theme=light; Path=/", `zamzam_guest_cart=${secret}; Path=/`])
  setGuestCartSessionCookie(res, secret, new Date(now + 60_000).toISOString(), now)
  const cookies = res.getHeader("Set-Cookie")
  assert.equal(cookies.filter((item) => item.startsWith("zamzam_guest_cart=")).length, 1)
  assert.ok(cookies.some((item) => item.startsWith("theme=light")))
  assert.equal(res.getHeader("Cache-Control"), "no-store")
  clearGuestCartSessionCookie(res)
  assert.ok(res.getHeader("Set-Cookie").some((item) => /zamzam_guest_cart=;.*Max-Age=0/.test(item)))
})

test("issuer creates once, puts proof only in the cookie, and reuses an existing valid session", async () => {
  let creates = 0
  let resolves = 0
  const res = response()
  const dependencies = {
    async createOwnedCart() { creates += 1; return { cartId: "cart_server_only", sessionSecret: secret, expiresAt } },
    async resolveOwnership(_container, value) {
      resolves += 1
      return value === secret ? { status: "owned", cartId: "cart_server_only", sessionStatus: "missing" } : { status: "not_owned" }
    },
    async revokeOwnership() { return true },
  }
  const issued = await issueGuestCartSession({ container: {}, regionId: "reg_server_selected", request: request(), response: res, storefrontOrigin: origin }, dependencies)
  assert.equal(issued.cartId, "cart_server_only")
  assert.equal(issued.reused, false)
  assert.equal(JSON.stringify(issued).includes(secret), false)
  const cookie = res.getHeader("Set-Cookie").find((item) => item.startsWith("zamzam_guest_cart="))
  assert.match(cookie, /HttpOnly/)
  assert.equal(creates, 1)

  const retryResponse = response()
  const retried = await issueGuestCartSession({ container: {}, regionId: "ignored", request: request({ cookie: `zamzam_guest_cart=${secret}` }), response: retryResponse, storefrontOrigin: origin }, dependencies)
  assert.equal(retried.cartId, issued.cartId)
  assert.equal(retried.reused, true)
  assert.equal(creates, 1, "retry with the issued cookie reuses the same cart")
  assert.deepEqual(retryResponse.getHeader("Set-Cookie"), [], "retry does not rotate or duplicate the cookie")
  assert.equal(resolves, 2)
})

test("bad origin, duplicate cookies, stale proof, and cookie-write failure never issue a usable session", async () => {
  let creates = 0
  let revocations = 0
  const dependencies = {
    async createOwnedCart() { creates += 1; return { cartId: `cart_${creates}`, sessionSecret: secret, expiresAt } },
    async resolveOwnership(_container, value) { return value === secret ? { status: "owned", cartId: `cart_${creates}`, sessionStatus: "missing" } : { status: "expired" } },
    async revokeOwnership() { revocations += 1; return true },
  }
  const badResponse = response()
  await assert.rejects(issueGuestCartSession({ container: {}, regionId: "reg", request: request({ origin: "https://attacker.example.invalid" }), response: badResponse, storefrontOrigin: origin }, dependencies), GuestCartTransportError)
  assert.equal(creates, 0)

  const duplicate = response()
  await assert.rejects(issueGuestCartSession({ container: {}, regionId: "reg", request: request({ cookie: `zamzam_guest_cart=${secret}; zamzam_guest_cart=${secret}` }), response: duplicate, storefrontOrigin: origin }, dependencies), GuestCartTransportError)
  assert.equal(creates, 0)

  const stale = response()
  const staleDependencies = { ...dependencies, async resolveOwnership() { return { status: "expired" } } }
  await assert.rejects(issueGuestCartSession({ container: {}, regionId: "reg", request: request({ cookie: `zamzam_guest_cart=${secret}` }), response: stale, storefrontOrigin: origin }, staleDependencies), GuestCartTransportError)
  assert.equal(creates, 0, "expired cookies cannot be used to recover or silently replace a cart")

  const brokenResponse = { ...response(), setHeader(name, value) { if (name === "Set-Cookie") throw new Error(secret); return response().setHeader(name, value) } }
  await assert.rejects(issueGuestCartSession({ container: {}, regionId: "reg", request: request(), response: brokenResponse, storefrontOrigin: origin }, dependencies), GuestCartTransportError)
  assert.equal(revocations, 1, "failed cookie issuance revokes the persisted proof")
})

