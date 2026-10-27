import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  GUEST_SESSION_COOKIE_NAME,
  GUEST_SESSION_SECURE_COOKIE_NAME,
  GUEST_SESSION_TTL_SECONDS,
  isValidSessionSecret,
  getGuestSessionCookieOptions,
  serializeGuestSessionCookie,
  serializeClearGuestSessionCookie,
  extractGuestSessionSecret,
} from "../lib/session.ts"
import {
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  CSRF_SECURE_COOKIE_NAME,
  normalizeOrigin,
  isAllowedOrigin,
  validateRequestOrigin,
  generateCsrfToken,
  isValidCsrfTokenFormat,
  validateCsrfToken,
  serializeCsrfCookie,
  extractCsrfCookieToken,
  validateRequestCsrf,
} from "../lib/security.ts"
import {
  DisabledStorefrontBffClient,
  getStorefrontBffClient,
  isStorefrontBffEnabled,
} from "../lib/bff-client.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test("1. Server-only guest session contract and cookie options", () => {
  // 1.1 Secret format validation (256-bit base64url: 43 characters)
  const validSecret = "a".repeat(43)
  assert.equal(isValidSessionSecret(validSecret), true)
  assert.equal(isValidSessionSecret("vO_12-34_567890abcdefghijklmnopqrstuvwxyzAB"), true)

  // Rejection of invalid secret formats
  assert.equal(isValidSessionSecret("short"), false)
  assert.equal(isValidSessionSecret("a".repeat(42)), false)
  assert.equal(isValidSessionSecret("a".repeat(44)), false)
  assert.equal(isValidSessionSecret("a".repeat(42) + "+"), false) // '+' is not base64url
  assert.equal(isValidSessionSecret(null), false)
  assert.equal(isValidSessionSecret(undefined), false)
  assert.equal(isValidSessionSecret(12345), false)

  // 1.2 Cookie options
  const devOptions = getGuestSessionCookieOptions(false)
  assert.equal(devOptions.name, GUEST_SESSION_COOKIE_NAME)
  assert.equal(devOptions.httpOnly, true)
  assert.equal(devOptions.secure, false)
  assert.equal(devOptions.sameSite, "lax")
  assert.equal(devOptions.path, "/")
  assert.equal(devOptions.maxAge, GUEST_SESSION_TTL_SECONDS)
  assert.equal(devOptions.maxAge, 86400) // 24 hours

  const prodOptions = getGuestSessionCookieOptions(true)
  assert.equal(prodOptions.name, GUEST_SESSION_SECURE_COOKIE_NAME)
  assert.equal(prodOptions.httpOnly, true)
  assert.equal(prodOptions.secure, true)

  // 1.3 Cookie serialization
  const cookieString = serializeGuestSessionCookie(validSecret, true)
  assert.ok(cookieString.includes(`${GUEST_SESSION_SECURE_COOKIE_NAME}=${validSecret}`))
  assert.ok(cookieString.includes("Path=/"))
  assert.ok(cookieString.includes("Max-Age=86400"))
  assert.ok(cookieString.includes("HttpOnly"))
  assert.ok(cookieString.includes("SameSite=lax"))
  assert.ok(cookieString.includes("Secure"))

  // Invalidation serialization
  const clearCookie = serializeClearGuestSessionCookie(true)
  assert.ok(clearCookie.includes("Max-Age=0"))
  assert.ok(clearCookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"))

  // 1.4 Extract session secret from raw Cookie header
  const rawCookieHeader = `other=123; ${GUEST_SESSION_SECURE_COOKIE_NAME}=${validSecret}; theme=dark`
  assert.equal(extractGuestSessionSecret(rawCookieHeader), validSecret)
  assert.equal(extractGuestSessionSecret("malformed_cookie_header"), null)
  assert.equal(extractGuestSessionSecret(`${GUEST_SESSION_COOKIE_NAME}=short`), null)
})

test("2. Origin validation and strict allowlist enforcement", () => {
  const allowlist = ["https://zamzamstore.com", "http://localhost:3000"]

  // 2.1 Origin normalization
  assert.equal(normalizeOrigin("https://ZamZamStore.COM/"), "https://zamzamstore.com")
  assert.equal(normalizeOrigin("http://localhost:3000/some/path"), "http://localhost:3000")
  assert.equal(normalizeOrigin("invalid-url"), null)

  // 2.2 isAllowedOrigin
  assert.equal(isAllowedOrigin("https://zamzamstore.com", allowlist), true)
  assert.equal(isAllowedOrigin("http://localhost:3000", allowlist), true)
  assert.equal(isAllowedOrigin("https://attacker.com", allowlist), false)
  assert.equal(isAllowedOrigin("null", allowlist), false)
  assert.equal(isAllowedOrigin("", allowlist), false)

  // 2.3 State-changing methods vs read-only methods
  // Safe read-only methods pass
  const getResult = validateRequestOrigin("GET", { origin: "https://attacker.com" }, allowlist)
  assert.equal(getResult.valid, true)

  // State-changing requests from disallowed origin are rejected
  const postBadOrigin = validateRequestOrigin(
    "POST",
    { origin: "https://evil.com" },
    allowlist
  )
  assert.equal(postBadOrigin.valid, false)
  assert.equal(postBadOrigin.reason, "ORIGIN_NOT_ALLOWED")

  // State-changing requests with allowed origin pass
  const postGoodOrigin = validateRequestOrigin(
    "POST",
    { origin: "https://zamzamstore.com" },
    allowlist
  )
  assert.equal(postGoodOrigin.valid, true)

  // Referer fallback
  const postReferer = validateRequestOrigin(
    "POST",
    { referer: "https://zamzamstore.com/checkout" },
    allowlist
  )
  assert.equal(postReferer.valid, true)

  // Missing origin and referer
  const postMissing = validateRequestOrigin("POST", {}, allowlist)
  assert.equal(postMissing.valid, false)
  assert.equal(postMissing.reason, "ORIGIN_MISSING")

  // Empty allowlist fails closed
  const postEmptyAllowlist = validateRequestOrigin(
    "POST",
    { origin: "https://zamzamstore.com" },
    []
  )
  assert.equal(postEmptyAllowlist.valid, false)
  assert.equal(postEmptyAllowlist.reason, "ALLOWLIST_EMPTY")
})

test("3. CSRF token generation, constant-time validation and request defense", () => {
  // 3.1 Token generation and format
  const token = generateCsrfToken()
  assert.equal(isValidCsrfTokenFormat(token), true)
  assert.equal(token.length, 43)

  // 3.2 Token comparison
  const token2 = generateCsrfToken()
  assert.equal(validateCsrfToken(token, token), true)
  assert.equal(validateCsrfToken(token, token2), false)
  assert.equal(validateCsrfToken(token, "invalid"), false)
  assert.equal(validateCsrfToken("", token), false)

  // 3.3 Cookie serialization and extraction
  const cookieStr = serializeCsrfCookie(token, false)
  assert.ok(cookieStr.includes(`${CSRF_COOKIE_NAME}=${token}`))
  assert.equal(extractCsrfCookieToken(`${CSRF_COOKIE_NAME}=${token}`), token)

  // 3.4 Request CSRF validation
  // Safe methods pass without CSRF headers
  assert.equal(validateRequestCsrf("GET", {}).valid, true)

  // State-changing missing cookie
  const postMissingCookie = validateRequestCsrf("POST", { [CSRF_HEADER_NAME]: token })
  assert.equal(postMissingCookie.valid, false)
  assert.equal(postMissingCookie.reason, "CSRF_COOKIE_MISSING")

  // State-changing missing header
  const postMissingHeader = validateRequestCsrf(
    "POST",
    { cookie: `${CSRF_COOKIE_NAME}=${token}` }
  )
  assert.equal(postMissingHeader.valid, false)
  assert.equal(postMissingHeader.reason, "CSRF_HEADER_MISSING")

  // State-changing mismatched token
  const postMismatch = validateRequestCsrf(
    "POST",
    {
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token2,
    }
  )
  assert.equal(postMismatch.valid, false)
  assert.equal(postMismatch.reason, "CSRF_TOKEN_MISMATCH")

  // State-changing valid matching token
  const postValid = validateRequestCsrf(
    "POST",
    {
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token,
    }
  )
  assert.equal(postValid.valid, true)
})

test("4. Typed BFF client boundary and disabled fail-closed behavior", async () => {
  // Default: feature flag is not enabled
  delete process.env.FEATURE_ENABLE_STOREFRONT_BFF
  assert.equal(isStorefrontBffEnabled(), false)

  const client = getStorefrontBffClient()
  assert.ok(client instanceof DisabledStorefrontBffClient)

  // 4.1 createGuestSession fails closed
  const createRes = await client.createGuestSession({ regionId: "reg_1" })
  assert.equal(createRes.success, false)
  assert.equal(createRes.error, "TRANSPORT_NOT_AVAILABLE")
  assert.equal(createRes.status, 503)

  // 4.2 Malformed secret rejected with 400
  const resolveMalformed = await client.resolveSession("short")
  assert.equal(resolveMalformed.success, false)
  assert.equal(resolveMalformed.error, "INVALID_SECRET")
  assert.equal(resolveMalformed.status, 400)

  // 4.3 Valid secret format fails closed with 503 (transport unmounted)
  const validSecret = "a".repeat(43)
  const resolveValid = await client.resolveSession(validSecret)
  assert.equal(resolveValid.success, false)
  assert.equal(resolveValid.error, "TRANSPORT_NOT_AVAILABLE")
  assert.equal(resolveValid.status, 503)

  const cartRes = await client.retrieveAuthoritativeCart(validSecret)
  assert.equal(cartRes.success, false)
  assert.equal(cartRes.error, "TRANSPORT_NOT_AVAILABLE")

  const preflightRes = await client.getPreflightReadiness(validSecret)
  assert.equal(preflightRes.success, false)
  assert.equal(preflightRes.error, "TRANSPORT_NOT_AVAILABLE")

  const invalidateRes = await client.invalidateGuestSession(validSecret)
  assert.equal(invalidateRes.success, false)
  assert.equal(invalidateRes.error, "TRANSPORT_NOT_AVAILABLE")
})

test("5. Server-only boundary: no client components import session, security, or bff-client", () => {
  const componentsDir = path.resolve(__dirname, "../components")
  const files = fs.readdirSync(componentsDir)

  for (const file of files) {
    if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      const content = fs.readFileSync(path.join(componentsDir, file), "utf-8")
      assert.equal(
        /from\s+["'].*\/(session|security|bff-client)["']/i.test(content),
        false,
        `Component ${file} must not import server-only session/security/bff-client utilities`
      )
    }
  }
})
