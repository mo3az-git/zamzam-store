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
  extractGuestSessionSecretWithStatus,
} from "../lib/session.ts"
import {
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  CSRF_SECURE_COOKIE_NAME,
  MIN_CSRF_SECRET_LENGTH,
  isValidCsrfSecret,
  getServerCsrfSecret,
  normalizeOrigin,
  isAllowedOrigin,
  validateRequestOrigin,
  generateCsrfToken,
  isValidCsrfTokenFormat,
  validateCsrfToken,
  serializeCsrfCookie,
  extractCsrfCookieToken,
  extractCsrfCookieTokenWithStatus,
  validateRequestCsrf,
  deriveSessionBoundCsrfToken,
  validateSessionBoundCsrfToken,
} from "../lib/security.ts"
import {
  DisabledStorefrontBffClient,
  getStorefrontBffClient,
  isStorefrontBffEnabled,
  isBffTransportMounted,
  resolveTrustedGuestSession,
  getAuthoritativeCartSnapshot,
  getBackendCheckoutReadiness,
  mapBackendReadinessToUi,
} from "../lib/bff-client.ts"
import { evaluateBffRequestPolicy } from "../lib/bff-policy.ts"
import { SYNTHETIC_QA_READINESS_FIXTURE } from "../lib/checkout.ts"
import { getDictionary } from "../lib/i18n.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_SERVER_CSRF_SECRET = "test_server_csrf_secret_entropy_minimum_32_bytes_safe!"

test("1. Hardened guest session contract: conflict, malformation and __Host- isolation", () => {
  const validSecret1 = "a".repeat(43)
  const validSecret2 = "b".repeat(43)

  // 1.1 Format validation
  assert.equal(isValidSessionSecret(validSecret1), true)
  assert.equal(isValidSessionSecret("short"), false)
  assert.equal(isValidSessionSecret("a".repeat(44)), false)
  assert.equal(isValidSessionSecret(null), false)

  // 1.2 Valid single cookie extraction
  const secureHeader = `${GUEST_SESSION_SECURE_COOKIE_NAME}=${validSecret1}`
  const secureRes = extractGuestSessionSecretWithStatus(secureHeader, true)
  assert.equal(secureRes.status, "valid")
  if (secureRes.status === "valid") assert.equal(secureRes.secret, validSecret1)
  assert.equal(extractGuestSessionSecret(secureHeader, true), validSecret1)

  // 1.3 Insecure fallback cookie strictly rejected in secure mode
  const insecureHeader = `${GUEST_SESSION_COOKIE_NAME}=${validSecret1}`
  const insecureInSecureRes = extractGuestSessionSecretWithStatus(insecureHeader, true)
  assert.equal(insecureInSecureRes.status, "insecure_in_secure_mode")
  assert.equal(extractGuestSessionSecret(insecureHeader, true), null)

  // Allowed in development mode (isSecure = false)
  const devRes = extractGuestSessionSecretWithStatus(insecureHeader, false)
  assert.equal(devRes.status, "valid")

  // 1.4 Duplicate/conflicting cookies rejected (fail closed)
  const dupHeader = `${GUEST_SESSION_SECURE_COOKIE_NAME}=${validSecret1}; ${GUEST_SESSION_SECURE_COOKIE_NAME}=${validSecret2}`
  assert.equal(extractGuestSessionSecretWithStatus(dupHeader, true).status, "conflict")
  assert.equal(extractGuestSessionSecret(dupHeader, true), null)

  // 1.5 Malformed value rejected
  const malformedHeader = `${GUEST_SESSION_SECURE_COOKIE_NAME}=invalid_len`
  assert.equal(extractGuestSessionSecretWithStatus(malformedHeader, true).status, "malformed")
  assert.equal(extractGuestSessionSecret(malformedHeader, true), null)

  // 1.6 Missing cookie header
  assert.equal(extractGuestSessionSecretWithStatus(null, true).status, "missing")
  assert.equal(extractGuestSessionSecret("", true), null)
})

test("2. Strict Origin parsing and distinct Origin vs Referer semantics", () => {
  const allowlist = ["https://zamzamstore.com", "http://localhost:3000"]

  // 2.1 Strict Origin Normalization
  assert.equal(normalizeOrigin("https://zamzamstore.com"), "https://zamzamstore.com")
  assert.equal(normalizeOrigin("https://zamzamstore.com/"), "https://zamzamstore.com")
  assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000")

  // Rejection of embedded credentials
  assert.equal(normalizeOrigin("https://user:pass@zamzamstore.com"), null)
  // Rejection of path segments
  assert.equal(normalizeOrigin("https://zamzamstore.com/checkout"), null)
  // Rejection of query strings or fragments
  assert.equal(normalizeOrigin("https://zamzamstore.com?query=1"), null)
  assert.equal(normalizeOrigin("https://zamzamstore.com#fragment"), null)
  // Rejection of non-http(s) schemes
  assert.equal(normalizeOrigin("javascript:alert(1)"), null)
  assert.equal(normalizeOrigin("data:text/html,evil"), null)
  assert.equal(normalizeOrigin("file:///C:/passwords.txt"), null)
  assert.equal(normalizeOrigin("null"), null)

  // 2.2 Semantic check: Malformed Origin must NOT fall back to Referer
  const malformedOriginWithValidReferer = validateRequestOrigin(
    "POST",
    {
      origin: "https://user:pass@evil.com",
      referer: "https://zamzamstore.com/checkout",
    },
    allowlist
  )
  assert.equal(malformedOriginWithValidReferer.valid, false)
  assert.equal(malformedOriginWithValidReferer.reason, "ORIGIN_MALFORMED")

  // Origin: "null" rejected
  const nullOriginRes = validateRequestOrigin("POST", { origin: "null" }, allowlist)
  assert.equal(nullOriginRes.valid, false)
  assert.equal(nullOriginRes.reason, "ORIGIN_NOT_ALLOWED")

  // Legitimate Origin matches allowlist
  const validOriginRes = validateRequestOrigin("POST", { origin: "https://zamzamstore.com" }, allowlist)
  assert.equal(validOriginRes.valid, true)

  // Referer fallback ONLY when Origin header is completely absent
  const refererOnlyRes = validateRequestOrigin(
    "POST",
    { referer: "https://zamzamstore.com/products/tea" },
    allowlist
  )
  assert.equal(refererOnlyRes.valid, true)
  if (refererOnlyRes.valid) assert.equal(refererOnlyRes.origin, "https://zamzamstore.com")

  // Missing both Origin and Referer
  const missingBothRes = validateRequestOrigin("POST", {}, allowlist)
  assert.equal(missingBothRes.valid, false)
  assert.equal(missingBothRes.reason, "ORIGIN_MISSING")
})

test("3. CSRF defense: token extraction, duplicate cookie rejection and session-bound tokens", () => {
  const token1 = generateCsrfToken()
  const token2 = generateCsrfToken()

  // 3.1 Standalone token validation
  assert.equal(validateCsrfToken(token1, token1), true)
  assert.equal(validateCsrfToken(token1, token2), false)

  // 3.2 Duplicate or conflicting CSRF cookies rejected
  const dupCsrfHeader = `${CSRF_SECURE_COOKIE_NAME}=${token1}; ${CSRF_SECURE_COOKIE_NAME}=${token2}`
  assert.equal(extractCsrfCookieTokenWithStatus(dupCsrfHeader, true).status, "conflict")
  assert.equal(extractCsrfCookieToken(dupCsrfHeader, true), null)

  // Insecure CSRF cookie rejected in secure mode
  const insecureCsrfHeader = `${CSRF_COOKIE_NAME}=${token1}`
  assert.equal(extractCsrfCookieTokenWithStatus(insecureCsrfHeader, true).status, "insecure_in_secure_mode")

  // 3.3 Priority 1: Server HMAC secret strength validation & removal of static fallback
  assert.equal(MIN_CSRF_SECRET_LENGTH, 32)
  assert.equal(isValidCsrfSecret(null), false)
  assert.equal(isValidCsrfSecret(""), false)
  assert.equal(isValidCsrfSecret("   "), false)
  assert.equal(isValidCsrfSecret("short_secret_under_32_bytes"), false)
  assert.equal(isValidCsrfSecret(TEST_SERVER_CSRF_SECRET), true)

  // Missing/weak secret fails closed
  const sessionSecret1 = "c".repeat(43)
  const sessionSecret2 = "d".repeat(43)

  delete process.env.STOREFRONT_CSRF_SECRET
  assert.throws(
    () => deriveSessionBoundCsrfToken(sessionSecret1),
    /missing or insufficiently strong server CSRF secret/
  )
  assert.equal(validateSessionBoundCsrfToken(sessionSecret1, token1), false)

  // Weak secret explicitly passed fails closed
  assert.throws(
    () => deriveSessionBoundCsrfToken(sessionSecret1, "weak_secret"),
    /missing or insufficiently strong server CSRF secret/
  )
  assert.equal(validateSessionBoundCsrfToken(sessionSecret1, token1, "weak_secret"), false)

  // Valid secret derives session-specific token
  const boundToken1 = deriveSessionBoundCsrfToken(sessionSecret1, TEST_SERVER_CSRF_SECRET)
  const boundToken2 = deriveSessionBoundCsrfToken(sessionSecret2, TEST_SERVER_CSRF_SECRET)
  assert.equal(isValidCsrfTokenFormat(boundToken1), true)
  assert.equal(isValidCsrfTokenFormat(boundToken2), true)
  assert.notEqual(boundToken1, boundToken2) // Session-specific

  // Valid token validates against matching session secret
  assert.equal(validateSessionBoundCsrfToken(sessionSecret1, boundToken1, TEST_SERVER_CSRF_SECRET), true)

  // Cross-session rejection: boundToken1 cannot validate against sessionSecret2
  assert.equal(validateSessionBoundCsrfToken(sessionSecret2, boundToken1, TEST_SERVER_CSRF_SECRET), false)

  // Independently forged token is rejected
  assert.equal(validateSessionBoundCsrfToken(sessionSecret1, token1, TEST_SERVER_CSRF_SECRET), false)
})

test("4. Composed internal BFF request policy evaluation and accidental enablement elimination", () => {
  const allowlist = ["https://zamzamstore.com"]
  const sessionSecret1 = "e".repeat(43)
  const sessionSecret2 = "f".repeat(43)
  const boundCsrfToken1 = deriveSessionBoundCsrfToken(sessionSecret1, TEST_SERVER_CSRF_SECRET)
  const secureCookieHeader1 = `${GUEST_SESSION_SECURE_COOKIE_NAME}=${sessionSecret1}; ${CSRF_SECURE_COOKIE_NAME}=${boundCsrfToken1}`

  // 4.1 Transport disabled by default (unmounted client)
  delete process.env.FEATURE_ENABLE_STOREFRONT_BFF
  assert.equal(isBffTransportMounted(), false)
  assert.equal(isStorefrontBffEnabled(), false)

  const defaultPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
  })
  assert.equal(defaultPolicy.outcome, "transport_disabled")
  assert.equal(defaultPolicy.allowed, false)

  // 4.2 Priority 3: Synthetic QA mode cannot enable live backend transport
  process.env.VERCEL_ENV = "preview"
  process.env.ZAMZAM_SYNTHETIC_PREVIEW = "true"
  process.env.FEATURE_ENABLE_STOREFRONT_BFF = "true"
  assert.equal(isStorefrontBffEnabled(), false)

  const qaPreviewPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: { allowTransportBypassForTesting: true },
  })
  assert.equal(qaPreviewPolicy.outcome, "transport_disabled")
  assert.equal(qaPreviewPolicy.allowed, false)

  delete process.env.VERCEL_ENV
  delete process.env.ZAMZAM_SYNTHETIC_PREVIEW
  delete process.env.FEATURE_ENABLE_STOREFRONT_BFF

  // 4.3 Priority 3: Normal production call with unmounted transport remains blocked
  process.env.NODE_ENV = "production"
  process.env.FEATURE_ENABLE_STOREFRONT_BFF = "true"
  assert.equal(isStorefrontBffEnabled(), false) // Transport is unmounted

  const productionPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: { allowTransportBypassForTesting: true }, // Forbidden in production
  })
  assert.equal(productionPolicy.outcome, "transport_disabled")
  assert.equal(productionPolicy.allowed, false)

  delete process.env.NODE_ENV
  delete process.env.FEATURE_ENABLE_STOREFRONT_BFF

  // 4.4 Priority 2: Full composition order under authorized internal test configuration
  const testConfig = { allowTransportBypassForTesting: true }

  // 4.4.1 Step 2: Origin rejected
  const badOriginPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://hacker.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(badOriginPolicy.outcome, "origin_rejected")

  // 4.4.2 Step 3: Session cookie invalid / conflicting
  const conflictingSessionPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: `${secureCookieHeader1}; ${GUEST_SESSION_SECURE_COOKIE_NAME}=${sessionSecret2}`,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(conflictingSessionPolicy.outcome, "session_invalid")

  // 4.4.3 Step 4: Session missing on state-changing operation (denied by default)
  const missingSessionPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: `${CSRF_SECURE_COOKIE_NAME}=${boundCsrfToken1}`,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(missingSessionPolicy.outcome, "session_missing")

  // 4.4.4 Step 5: CSRF cookie or header missing on state-changing operation
  const missingCsrfPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com" },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(missingCsrfPolicy.outcome, "csrf_rejected")

  // 4.4.5 Step 5 & 6: Matching but independently forged CSRF token is rejected (not session-bound)
  const forgedToken = generateCsrfToken()
  const forgedPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: forgedToken },
    cookieHeader: `${GUEST_SESSION_SECURE_COOKIE_NAME}=${sessionSecret1}; ${CSRF_SECURE_COOKIE_NAME}=${forgedToken}`,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(forgedPolicy.outcome, "csrf_rejected")

  // 4.4.6 Step 6: Same CSRF token with different session secret is rejected (cross-session reuse attempt)
  const crossSessionPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: `${GUEST_SESSION_SECURE_COOKIE_NAME}=${sessionSecret2}; ${CSRF_SECURE_COOKIE_NAME}=${boundCsrfToken1}`,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(crossSessionPolicy.outcome, "csrf_rejected")

  // 4.4.7 Step 6: Missing or weak server CSRF secret fails closed
  const missingSecretPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: "too_short_secret",
    internalTestConfig: testConfig,
  })
  assert.equal(missingSecretPolicy.outcome, "csrf_rejected")

  // 4.4.8 Step 7: Fully valid request perimeter passes
  const allowedPolicy = evaluateBffRequestPolicy({
    method: "POST",
    headers: { origin: "https://zamzamstore.com", [CSRF_HEADER_NAME]: boundCsrfToken1 },
    cookieHeader: secureCookieHeader1,
    allowlist,
    isSecure: true,
    serverCsrfSecret: TEST_SERVER_CSRF_SECRET,
    internalTestConfig: testConfig,
  })
  assert.equal(allowedPolicy.outcome, "allowed")
  assert.equal(allowedPolicy.allowed, true)
  assert.equal(allowedPolicy.sessionSecret, sessionSecret1)
  assert.equal(allowedPolicy.origin, "https://zamzamstore.com")
})

test("5. Trusted read-only boundary functions and UI mapping", async () => {
  const sessionSecret = "g".repeat(43)

  // 5.1 Rejection of malformed secrets
  const malformedRes = await resolveTrustedGuestSession("too_short")
  assert.equal(malformedRes.success, false)
  assert.equal(malformedRes.error, "INVALID_SECRET")

  // 5.2 Unmounted transport returns 503 TRANSPORT_NOT_AVAILABLE
  const resolved = await resolveTrustedGuestSession(sessionSecret)
  assert.equal(resolved.success, false)
  assert.equal(resolved.error, "TRANSPORT_NOT_AVAILABLE")
  assert.equal(resolved.status, 503)

  const cartRes = await getAuthoritativeCartSnapshot(sessionSecret)
  assert.equal(cartRes.success, false)
  assert.equal(cartRes.error, "TRANSPORT_NOT_AVAILABLE")

  const readinessRes = await getBackendCheckoutReadiness(sessionSecret)
  assert.equal(readinessRes.success, false)
  assert.equal(readinessRes.error, "TRANSPORT_NOT_AVAILABLE")

  // 5.3 UI readiness mapping
  const dict = getDictionary("ar")
  const viewModel = mapBackendReadinessToUi(SYNTHETIC_QA_READINESS_FIXTURE, dict)
  assert.equal(viewModel.isBlocked, true)
  assert.ok(viewModel.blockers.includes("CHECKOUT_OWNERSHIP_UNAVAILABLE"))
  assert.ok(viewModel.blockerMessages.length > 0)
  assert.equal(viewModel.checklist.length, 5)
  assert.equal(viewModel.checklist[0].status, "blocked")
})

test("6. Server-only boundary: no client components import server-only modules", () => {
  const componentsDir = path.resolve(__dirname, "../components")
  const files = fs.readdirSync(componentsDir)

  for (const file of files) {
    if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      const content = fs.readFileSync(path.join(componentsDir, file), "utf-8")
      assert.equal(
        /from\s+["'].*\/(session|security|bff-client|bff-policy)["']/i.test(content),
        false,
        `Component ${file} must not import server-only session/security/bff modules`
      )
    }
  }
})
