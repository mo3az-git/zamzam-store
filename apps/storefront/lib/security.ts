/**
 * Server-Only Origin & CSRF Defense Foundation (Phase 4.5 BFF Foundation)
 *
 * Implements strict request origin validation and CSRF defenses for future
 * authenticated cart and checkout session operations.
 *
 * Rules:
 * - Reject cross-origin state-changing requests (POST, PUT, PATCH, DELETE).
 * - Origin checked against an explicit configured allowlist; fails closed if unconfigured.
 * - Double-submit CSRF cookie/header contract validated using constant-time comparison.
 * - No publicly reachable mutation route is created by this module.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"

export const CSRF_HEADER_NAME = "x-zamzam-csrf-token" as const
export const CSRF_COOKIE_NAME = "zamzam_csrf_token" as const
export const CSRF_SECURE_COOKIE_NAME = "__Host-zamzam_csrf_token" as const
export const CSRF_TOKEN_TTL_SECONDS = 24 * 60 * 60 // 24 hours

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Normalizes an origin string (lowercased protocol and host, trimmed, no trailing slash).
 */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const url = new URL(raw.trim())
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

  // Explicit comma-separated origins
  const envList = process.env.STOREFRONT_ALLOWED_ORIGINS
  if (envList && typeof envList === "string") {
    for (const item of envList.split(",")) {
      const normalized = normalizeOrigin(item)
      if (normalized) allowed.add(normalized)
    }
  }

  // Canonical site URL if configured
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
  | { valid: false; reason: "ORIGIN_MISSING" | "ORIGIN_NOT_ALLOWED" | "ALLOWLIST_EMPTY" }

/**
 * Validates request Origin / Referer against the explicit allowlist for state-changing methods.
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

  // State-changing requests must provide Origin (or Referer as fallback)
  const rawOrigin = getHeader("origin") || getHeader("referer")
  const normalized = normalizeOrigin(rawOrigin)

  if (!normalized) {
    return { valid: false, reason: "ORIGIN_MISSING" }
  }

  if (!allowlist.includes(normalized)) {
    return { valid: false, reason: "ORIGIN_NOT_ALLOWED" }
  }

  return { valid: true, origin: normalized }
}

/**
 * Generates a crypto-secure, opaque CSRF token (32 random bytes, base64url encoded: 43 chars).
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
 * Validates a CSRF token pair (from cookie and header) in constant time to prevent timing attacks.
 */
export function validateCsrfToken(
  cookieToken: unknown,
  headerToken: unknown
): boolean {
  if (!isValidCsrfTokenFormat(cookieToken) || !isValidCsrfTokenFormat(headerToken)) {
    return false
  }

  const bufA = Buffer.from(cookieToken, "utf8")
  const bufB = Buffer.from(headerToken, "utf8")

  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Serializes the CSRF cookie Set-Cookie header string.
 */
export function serializeCsrfCookie(
  token: string,
  isSecure: boolean = process.env.NODE_ENV === "production"
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

/**
 * Extracts the CSRF token from the Cookie header.
 */
export function extractCsrfCookieToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader || typeof cookieHeader !== "string") return null

  const cookies = cookieHeader.split(";").map((c) => c.trim())
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=")
    if (separatorIndex === -1) continue

    const name = cookie.slice(0, separatorIndex).trim()
    const value = cookie.slice(separatorIndex + 1).trim()

    if (name === CSRF_SECURE_COOKIE_NAME || name === CSRF_COOKIE_NAME) {
      if (isValidCsrfTokenFormat(value)) {
        return value
      }
    }
  }

  return null
}

export type CsrfValidationResult =
  | { valid: true }
  | { valid: false; reason: "CSRF_COOKIE_MISSING" | "CSRF_HEADER_MISSING" | "CSRF_TOKEN_MISMATCH" }

/**
 * Validates CSRF headers and cookies on a request.
 * Safe methods pass automatically; state-changing methods require matching tokens.
 */
export function validateRequestCsrf(
  method: string,
  headers: Headers | Record<string, string | undefined>,
  cookieHeader?: string | null
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
  const cookieToken = extractCsrfCookieToken(resolvedCookieHeader)
  if (!cookieToken) {
    return { valid: false, reason: "CSRF_COOKIE_MISSING" }
  }

  const headerToken = getHeader(CSRF_HEADER_NAME)
  if (!headerToken) {
    return { valid: false, reason: "CSRF_HEADER_MISSING" }
  }

  if (!validateCsrfToken(cookieToken, headerToken)) {
    return { valid: false, reason: "CSRF_TOKEN_MISMATCH" }
  }

  return { valid: true }
}
