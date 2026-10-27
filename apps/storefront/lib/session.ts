/**
 * Server-Only Guest Cart Session Contract (Phase 4.5 BFF Foundation)
 *
 * Reusable server-only utilities for handling opaque guest cart session secrets
 * issued by the trusted backend (aligned with `docs/guest-cart-ownership-handover.md`).
 *
 * Rules:
 * - Opaque 256-bit base64url secret (43 characters).
 * - HttpOnly, Secure, SameSite=Lax cookie scoped to the storefront root.
 * - 24-hour TTL (86,400 seconds).
 * - Never create a fake ownership claim or accept browser cart IDs as proof of identity.
 * - Never put secrets in JavaScript, URLs, localStorage, or logs.
 */

export const GUEST_SESSION_COOKIE_NAME = "zamzam_guest_session" as const
export const GUEST_SESSION_SECURE_COOKIE_NAME = "__Host-zamzam_guest_session" as const
export const GUEST_SESSION_TTL_SECONDS = 24 * 60 * 60 // 24 hours (86,400s)

/**
 * Validates whether an opaque session secret matches the 256-bit base64url format
 * minted by the backend's `issueForServerCreatedCart` (crypto.randomBytes(32).toString('base64url')).
 */
export function isValidSessionSecret(secret: unknown): secret is string {
  if (typeof secret !== "string") return false
  return /^[A-Za-z0-9_-]{43}$/.test(secret)
}

export interface SessionCookieOptions {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "lax" | "strict" | "none"
  path: string
  maxAge: number
}

/**
 * Determines whether the environment requires the Secure cookie attribute.
 * Enforced in production or when NEXT_PUBLIC_SITE_URL uses https://.
 */
export function isSecureEnvironment(): boolean {
  if (process.env.NODE_ENV === "production") return true
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.toLowerCase()
  return Boolean(siteUrl && siteUrl.startsWith("https://"))
}

/**
 * Builds the standard security options for the guest session cookie.
 */
export function getGuestSessionCookieOptions(isSecure: boolean = isSecureEnvironment()): SessionCookieOptions {
  // Use __Host- prefix only in secure environments because browsers reject __Host- on http://
  const name = isSecure ? GUEST_SESSION_SECURE_COOKIE_NAME : GUEST_SESSION_COOKIE_NAME
  return {
    name,
    value: "",
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_SESSION_TTL_SECONDS,
  }
}

/**
 * Serializes an Set-Cookie header string for establishing a guest session.
 * Fails closed if the secret does not match the valid token pattern.
 */
export function serializeGuestSessionCookie(
  secret: unknown,
  isSecure: boolean = isSecureEnvironment()
): string {
  if (!isValidSessionSecret(secret)) {
    throw new Error("Cannot serialize cookie: invalid guest session secret format")
  }

  const options = getGuestSessionCookieOptions(isSecure)
  const parts = [
    `${options.name}=${secret}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    `SameSite=${options.sameSite}`,
  ]

  if (options.secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

/**
 * Serializes a Set-Cookie header string for invalidating/revoking a guest session cookie.
 */
export function serializeClearGuestSessionCookie(
  isSecure: boolean = isSecureEnvironment()
): string {
  const options = getGuestSessionCookieOptions(isSecure)
  const parts = [
    `${options.name}=`,
    `Path=${options.path}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    `SameSite=${options.sameSite}`,
  ]

  if (options.secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

/**
 * Extracts and validates the opaque guest session secret from a raw Cookie header.
 * Inspects both secure (__Host-) and standard cookie names.
 */
export function extractGuestSessionSecret(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader || typeof cookieHeader !== "string") return null

  const cookies = cookieHeader.split(";").map((c) => c.trim())
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=")
    if (separatorIndex === -1) continue

    const name = cookie.slice(0, separatorIndex).trim()
    const value = cookie.slice(separatorIndex + 1).trim()

    if (name === GUEST_SESSION_SECURE_COOKIE_NAME || name === GUEST_SESSION_COOKIE_NAME) {
      if (isValidSessionSecret(value)) {
        return value
      }
    }
  }

  return null
}
