/**
 * Server-Only Origin & CSRF Defense Foundation (Phase 4.6 BFF Foundation)
 *
 * Implements strict request origin validation and hardened CSRF defenses for future
 * authenticated cart and checkout session operations.
 *
 * Hardening Rules:
 * - Reject cross-origin state-changing requests (POST, PUT, PATCH, DELETE).
 * - Origin validation strictly enforces legitimate HTTP(S) origins:
 *   rejects embedded credentials, unexpected paths, query strings, and fragments.
 * - Origin and Referer are evaluated according to their distinct semantics:
 *   malformed Origin headers are rejected immediately and never silently fall back to Referer.
 * - In secure mode, CSRF cookies strictly require the __Host- prefix.
 * - Detects and rejects duplicate or conflicting CSRF cookies.
 * - Cryptographic session-bound CSRF token derivation (HMAC-SHA256) binding the CSRF token
 *   to the trusted session secret rather than relying on an independently forgeable cookie alone.
 * - Constant-time comparison to prevent timing side-channels.
 * - Never logs secrets or CSRF tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isSecureEnvironment, isValidSessionSecret } from "./session.ts"

export const CSRF_HEADER_NAME = "x-zamzam-csrf-token" as const
export const CSRF_COOKIE_NAME = "zamzam_csrf_token" as const
export const CSRF_SECURE_COOKIE_NAME = "__Host-zamzam_csrf_token" as const
export const CSRF_TOKEN_TTL_SECONDS = 24 * 60 * 60 // 24 hours

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Validates and normalizes an origin string strictly.
 *
 * Rules:
 * - Protocol must be strictly "http:" or "https:".
 * - Must NOT contain embedded credentials (user/password).
 * - Must NOT contain unexpected paths (only empty or "/"), query strings, or fragments.
 * - Hostname must be valid and cannot contain wildcard characters or control characters.
 */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const trimmed = raw.trim()

  // Fast check: Reject origin values with userinfo (@), query (?), or fragment (#)
  if (trimmed.includes("@") || trimmed.includes("?") || trimmed.includes("#")) {
    return null
  }

  try {
    const url = new URL(trimmed)
    // Enforce HTTP(S) protocol strictly
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    // Must not contain credentials
    if (url.username || url.password) {
      return null
    }

    // Origin must not contain path segments
    if (url.pathname !== "" && url.pathname !== "/") {
      return null
    }

    // Must have a valid non-empty hostname
    if (!url.hostname || url.hostname.includes("*")) {
      return null
    }

    return `${url.protocol}//${url.host}`.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Resolves the explicit list of allowed origins from environment configuration.
 * Fails closed (empty array) if no explicit origin is configured.
 */
export function getAllowedOrigins(): string[] {
  const allowed = new Set<string>()

  const envList = process.env.STOREFRONT_ALLOWED_ORIGINS
  if (envList && typeof envList === "string") {
    for (const item of envList.split(",")) {
      const normalized = normalizeOrigin(item)
      if (normalized) allowed.add(normalized)
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (siteUrl && typeof siteUrl === "string") {
    const normalized = normalizeOrigin(siteUrl)
    if (normalized) allowed.add(normalized)
  }

  return Array.from(allowed)
}

/**
 * Checks whether an origin is present in the configured allowlist.
 */
export function isAllowedOrigin(origin: unknown, allowlist: string[] = getAllowedOrigins()): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized || allowlist.length === 0) return false
  return allowlist.includes(normalized)
}

export type OriginValidationResult =
  | { valid: true; origin: string }
  | {
      valid: false
      reason:
        | "ORIGIN_MISSING"
        | "ORIGIN_NOT_ALLOWED"
        | "ORIGIN_MALFORMED"
        | "REFERER_MALFORMED"
        | "ALLOWLIST_EMPTY"
    }

/**
 * Validates request Origin and Referer according to their distinct security semantics:
 * - If `Origin` is supplied, it is validated strictly. Malformed or disallowed Origin
 *   headers are rejected immediately and NEVER silently fall back to Referer.
 * - `Referer` is used as fallback ONLY when the browser completely omits the Origin header.
 * - Read-only safe methods pass without origin restrictions.
 */
export function validateRequestOrigin(
  method: string,
  headers: Headers | Record<string, string | undefined>,
  allowlist: string[] = getAllowedOrigins()
): OriginValidationResult {
  const upperMethod = method.toUpperCase()
  const isStateChanging = STATE_CHANGING_METHODS.has(upperMethod)

  // Fail closed if allowlist is empty for state-changing requests
  if (isStateChanging && allowlist.length === 0) {
    return { valid: false, reason: "ALLOWLIST_EMPTY" }
  }

  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name)
    }
    const record = headers as Record<string, string | undefined>
    return record[name] ?? record[name.toLowerCase()] ?? null
  }

  // Safe read-only methods are not restricted by origin checks
  if (!isStateChanging) {
    const rawOrigin = getHeader("origin") ?? getHeader("referer")
    const normalized = normalizeOrigin(rawOrigin) ?? "null"
    return { valid: true, origin: normalized }
  }

  const originHeader = getHeader("origin")
  const refererHeader = getHeader("referer")

  // Semantic 1: Origin header is present
  if (originHeader !== null) {
    if (originHeader.trim().toLowerCase() === "null") {
      return { valid: false, reason: "ORIGIN_NOT_ALLOWED" }
    }
    const normalized = normalizeOrigin(originHeader)
    if (!normalized) {
      // Must NOT silently fallback to Referer when Origin is explicitly present but malformed
      return { valid: false, reason: "ORIGIN_MALFORMED" }
    }
    if (!allowlist.includes(normalized)) {
      return { valid: false, reason: "ORIGIN_NOT_ALLOWED" }
    }
    return { valid: true, origin: normalized }
  }

  // Semantic 2: Origin header is omitted by browser; inspect Referer fallback
  if (refererHeader !== null && refererHeader.trim()) {
    try {
      const refUrl = new URL(refererHeader.trim())
      const refOrigin = normalizeOrigin(`${refUrl.protocol}//${refUrl.host}`)
      if (!refOrigin) {
        return { valid: false, reason: "REFERER_MALFORMED" }
      }
      if (!allowlist.includes(refOrigin)) {
        return { valid: false, reason: "ORIGIN_NOT_ALLOWED" }
      }
      return { valid: true, origin: refOrigin }
    } catch {
      return { valid: false, reason: "REFERER_MALFORMED" }
    }
  }

  // Neither Origin nor Referer provided
  return { valid: false, reason: "ORIGIN_MISSING" }
}

/**
 * Generates an opaque standalone CSRF token (32 random bytes, base64url encoded: 43 chars).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Validates whether a token matches the expected 43-character base64url CSRF format.
 */
export function isValidCsrfTokenFormat(token: unknown): token is string {
  if (typeof token !== "string") return false
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/**
 * Validates a CSRF token pair in constant time to prevent timing attacks.
 */
export function validateCsrfToken(cookieToken: unknown, headerToken: unknown): boolean {
  if (!isValidCsrfTokenFormat(cookieToken) || !isValidCsrfTokenFormat(headerToken)) {
    return false
  }

  const bufA = Buffer.from(cookieToken, "utf8")
  const bufB = Buffer.from(headerToken, "utf8")

  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Session-Bound CSRF Token Architecture:
 *
 * In addition to double-submit cookie validation, CSRF tokens can be cryptographically
 * bound to the opaque guest session secret using HMAC-SHA256:
 *
 *   CSRF_Token = HMAC-SHA256(sessionSecret, serverSecret)
 *
 * Security Rationale:
 * A standalone double-submit cookie alone can be vulnerable if an attacker on an insecure
 * subdomain or network path can toss a forged cookie into the client's cookie jar.
 * By binding the expected CSRF token to the HttpOnly session secret, the server verifies
 * that the submitted CSRF token belongs to that exact session, neutralizing cookie-tossing
 * and cross-session token reuse attacks.
 */
export function deriveSessionBoundCsrfToken(
  sessionSecret: string,
  serverHmacSecret: string = process.env.STOREFRONT_CSRF_SECRET || "zamzam_default_session_csrf_hmac_secret"
): string {
  if (!isValidSessionSecret(sessionSecret)) {
    throw new Error("Cannot derive CSRF token: invalid guest session secret format")
  }
  return createHmac("sha256", serverHmacSecret)
    .update(sessionSecret, "utf8")
    .digest("base64url")
}

/**
 * Validates whether a submitted header token matches the session-bound token in constant time.
 */
export function validateSessionBoundCsrfToken(
  sessionSecret: unknown,
  headerToken: unknown,
  serverHmacSecret?: string
): boolean {
  if (!isValidSessionSecret(sessionSecret) || !isValidCsrfTokenFormat(headerToken)) {
    return false
  }
  const expected = deriveSessionBoundCsrfToken(sessionSecret, serverHmacSecret)
  const bufExpected = Buffer.from(expected, "utf8")
  const bufActual = Buffer.from(headerToken, "utf8")
  if (bufExpected.length !== bufActual.length) return false
  return timingSafeEqual(bufExpected, bufActual)
}

/**
 * Serializes the CSRF cookie Set-Cookie header string.
 */
export function serializeCsrfCookie(
  token: string,
  isSecure: boolean = isSecureEnvironment()
): string {
  if (!isValidCsrfTokenFormat(token)) {
    throw new Error("Cannot serialize CSRF cookie: invalid token format")
  }

  const name = isSecure ? CSRF_SECURE_COOKIE_NAME : CSRF_COOKIE_NAME
  const parts = [
    `${name}=${token}`,
    "Path=/",
    `Max-Age=${CSRF_TOKEN_TTL_SECONDS}`,
    "SameSite=Lax",
  ]

  if (isSecure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

export type CsrfExtractionResult =
  | { status: "valid"; token: string }
  | { status: "missing" }
  | { status: "conflict" | "malformed" | "insecure_in_secure_mode"; reason: string }

/**
 * Extracts and validates the CSRF token from the Cookie header.
 * Rejects duplicate or conflicting CSRF cookies and enforces __Host- prefix in secure mode.
 */
export function extractCsrfCookieTokenWithStatus(
  cookieHeader: string | null | undefined,
  isSecure: boolean = isSecureEnvironment()
): CsrfExtractionResult {
  if (!cookieHeader || typeof cookieHeader !== "string") {
    return { status: "missing" }
  }

  const cookies = cookieHeader.split(";").map((c) => c.trim())
  const matchedTokens: string[] = []
  let hasInsecureCookie = false
  let hasMalformed = false

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=")
    if (separatorIndex === -1) continue

    const name = cookie.slice(0, separatorIndex).trim()
    const value = cookie.slice(separatorIndex + 1).trim()

    if (name === CSRF_COOKIE_NAME) {
      hasInsecureCookie = true
      if (!isSecure) {
        if (!isValidCsrfTokenFormat(value)) {
          hasMalformed = true
        } else {
          matchedTokens.push(value)
        }
      }
    } else if (name === CSRF_SECURE_COOKIE_NAME) {
      if (!isValidCsrfTokenFormat(value)) {
        hasMalformed = true
      } else {
        matchedTokens.push(value)
      }
    }
  }

  if (isSecure && hasInsecureCookie) {
    return {
      status: "insecure_in_secure_mode",
      reason: "Insecure CSRF cookie detected in secure environment; must use __Host- prefix",
    }
  }

  if (hasMalformed) {
    return { status: "malformed", reason: "Malformed CSRF cookie token format" }
  }

  if (matchedTokens.length === 0) {
    return { status: "missing" }
  }

  if (matchedTokens.length > 1) {
    return { status: "conflict", reason: "Duplicate or conflicting CSRF cookies detected" }
  }

  return { status: "valid", token: matchedTokens[0] }
}

/**
 * Backward-compatible helper returning the CSRF cookie token or null on missing/conflict.
 */
export function extractCsrfCookieToken(
  cookieHeader: string | null | undefined,
  isSecure: boolean = isSecureEnvironment()
): string | null {
  const result = extractCsrfCookieTokenWithStatus(cookieHeader, isSecure)
  return result.status === "valid" ? result.token : null
}

export type CsrfValidationResult =
  | { valid: true }
  | { valid: false; reason: "CSRF_COOKIE_MISSING" | "CSRF_HEADER_MISSING" | "CSRF_TOKEN_MISMATCH" | "CSRF_COOKIE_INVALID" }

/**
 * Validates CSRF headers and cookies on a request.
 * Safe read-only methods pass automatically; state-changing methods require matching tokens.
 */
export function validateRequestCsrf(
  method: string,
  headers: Headers | Record<string, string | undefined>,
  cookieHeader?: string | null,
  isSecure: boolean = isSecureEnvironment()
): CsrfValidationResult {
  const upperMethod = method.toUpperCase()
  if (!STATE_CHANGING_METHODS.has(upperMethod)) {
    return { valid: true }
  }

  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name)
    }
    const record = headers as Record<string, string | undefined>
    return record[name] ?? record[name.toLowerCase()] ?? null
  }

  const resolvedCookieHeader = cookieHeader ?? getHeader("cookie")
  const cookieExtraction = extractCsrfCookieTokenWithStatus(resolvedCookieHeader, isSecure)

  if (cookieExtraction.status === "missing") {
    return { valid: false, reason: "CSRF_COOKIE_MISSING" }
  }
  if (cookieExtraction.status !== "valid") {
    return { valid: false, reason: "CSRF_COOKIE_INVALID" }
  }

  const headerToken = getHeader(CSRF_HEADER_NAME)
  if (!headerToken) {
    return { valid: false, reason: "CSRF_HEADER_MISSING" }
  }

  if (!validateCsrfToken(cookieExtraction.token, headerToken)) {
    return { valid: false, reason: "CSRF_TOKEN_MISMATCH" }
  }

  return { valid: true }
}
