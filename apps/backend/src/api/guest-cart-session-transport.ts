import type { MedusaContainer } from "@medusajs/framework/types"
import type { GuestCartOwnershipResult } from "../modules/batch-inventory/guest-cart-ownership"

export const GUEST_CART_SESSION_COOKIE = "zamzam_guest_cart"
export const GUEST_CART_SESSION_COOKIE_PATH = "/api/cart"
const SESSION_TTL_SECONDS = 24 * 60 * 60
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function getGuestCartSessionSecret(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 8192) return null
  const values: string[] = []
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 1 || part.slice(0, separator).trim() !== GUEST_CART_SESSION_COOKIE) continue
    try { values.push(decodeURIComponent(part.slice(separator + 1).trim())) }
    catch { return null }
  }
  return values.length === 1 ? values[0] : null
}

export type GuestCartTransportRequest = {
  method?: unknown
  headers: Record<string, unknown>
}
export type GuestCartTransportResponse = {
  getHeader(name: string): string | number | string[] | undefined
  setHeader(name: string, value: string | string[]): unknown
}
export class GuestCartTransportError extends Error {
  readonly code: "CART_REQUEST_REJECTED" | "CART_SESSION_UNAVAILABLE"
  constructor(code: "CART_REQUEST_REJECTED" | "CART_SESSION_UNAVAILABLE") {
    super(code)
    this.code = code
    this.name = "GuestCartTransportError"
  }
}

function singleHeader(request: GuestCartTransportRequest, name: string): string | null {
  const value = request.headers[name]
  return typeof value === "string" ? value : null
}

function canonicalOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== value ||
        parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Exact Origin + Fetch Metadata + JSON content type is the CSRF gate.
 * No wildcard/credentialed CORS fallback is permitted for this cookie route.
 */
export function isTrustedSameOriginCartMutation(
  request: GuestCartTransportRequest,
  storefrontOrigin: unknown = process.env.ZAMZAM_STOREFRONT_ORIGIN,
): boolean {
  const method = typeof request.method === "string" ? request.method.toUpperCase() : ""
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false
  const expected = canonicalOrigin(storefrontOrigin)
  const origin = canonicalOrigin(singleHeader(request, "origin"))
  const fetchSite = singleHeader(request, "sec-fetch-site")?.toLowerCase()
  const contentType = singleHeader(request, "content-type")?.split(";", 1)[0].trim().toLowerCase()
  return Boolean(expected && origin === expected && fetchSite === "same-origin" && contentType === "application/json")
}

function appendCookie(response: GuestCartTransportResponse, cookie: string): void {
  const current = response.getHeader("Set-Cookie")
  const existing = Array.isArray(current) ? current : typeof current === "string" ? [current] : []
  const retained = existing.filter((value) => !new RegExp(`^${GUEST_CART_SESSION_COOKIE}=`).test(value))
  response.setHeader("Set-Cookie", [...retained, cookie])
  response.setHeader("Cache-Control", "no-store")
}

export function serializeGuestCartSessionCookie(secret: unknown, expiresAt: unknown, now = Date.now()): string {
  if (typeof secret !== "string" || !SECRET_PATTERN.test(secret) || typeof expiresAt !== "string") {
    throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
  }
  const expiration = Date.parse(expiresAt)
  const maxAge = Math.floor((expiration - now) / 1000)
  if (!Number.isFinite(expiration) || maxAge < 1 || maxAge > SESSION_TTL_SECONDS) {
    throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
  }
  return `${GUEST_CART_SESSION_COOKIE}=${encodeURIComponent(secret)}; Path=${GUEST_CART_SESSION_COOKIE_PATH}; Max-Age=${maxAge}; Expires=${new Date(expiration).toUTCString()}; HttpOnly; Secure; SameSite=Lax`
}

export function setGuestCartSessionCookie(
  response: GuestCartTransportResponse,
  secret: unknown,
  expiresAt: unknown,
  now = Date.now(),
): void {
  appendCookie(response, serializeGuestCartSessionCookie(secret, expiresAt, now))
}

export function clearGuestCartSessionCookie(response: GuestCartTransportResponse): void {
  appendCookie(response, `${GUEST_CART_SESSION_COOKIE}=; Path=${GUEST_CART_SESSION_COOKIE_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`)
}

export type IssuedGuestCartSession = Readonly<{
  cartId: string
  expiresAt: string | null
  proof: Extract<GuestCartOwnershipResult, { status: "owned" }>
  reused: boolean
}>
type GuestCartSessionIssuerDependencies = {
  createOwnedCart(container: MedusaContainer, regionId: string, salesChannelId?: string): Promise<{ cartId: string; sessionSecret: string; expiresAt: string }>
  resolveOwnership(container: MedusaContainer, secret: string): Promise<GuestCartOwnershipResult>
  revokeOwnership(container: MedusaContainer, secret: string): Promise<boolean>
}
const issuerDependencies: GuestCartSessionIssuerDependencies = {
  createOwnedCart: async (container, regionId, salesChannelId) => {
    const { createGuestCartWithOwnership } = await import("../modules/batch-inventory/guest-cart-ownership.js")
    return createGuestCartWithOwnership(container, { regionId, ...(salesChannelId ? { salesChannelId } : {}) })
  },
  resolveOwnership: async (container, secret) => {
    const { resolveGuestCartOwnership } = await import("../modules/batch-inventory/guest-cart-ownership.js")
    return resolveGuestCartOwnership(container, secret)
  },
  revokeOwnership: async (container, secret) => {
    const { invalidateGuestCartOwnership } = await import("../modules/batch-inventory/guest-cart-ownership.js")
    return invalidateGuestCartOwnership(container, secret)
  },
}

/**
 * Trusted server-side issuer for a same-origin BFF create operation. Region
 * selection is supplied by the server caller, never by request JSON. The raw
 * secret is written only to the HttpOnly cookie and is absent from the return.
 */
export async function issueGuestCartSession(input: {
  container: MedusaContainer
  regionId: string
  salesChannelId?: string
  request: GuestCartTransportRequest
  response: GuestCartTransportResponse
  storefrontOrigin?: string
}, dependencies: GuestCartSessionIssuerDependencies = issuerDependencies): Promise<IssuedGuestCartSession> {
  const method = typeof input.request.method === "string" ? input.request.method.toUpperCase() : ""
  if (method !== "POST" || !isTrustedSameOriginCartMutation(input.request, input.storefrontOrigin)) {
    throw new GuestCartTransportError("CART_REQUEST_REJECTED")
  }

  const cookieHeader = singleHeader(input.request, "cookie")
  const hasSessionCookie = typeof cookieHeader === "string" && cookieHeader.split(";").some((part) =>
    part.slice(0, part.indexOf("=")).trim() === GUEST_CART_SESSION_COOKIE)
  if (hasSessionCookie) {
    const sessionSecret = getGuestCartSessionSecret(cookieHeader)
    if (!sessionSecret) {
      try { clearGuestCartSessionCookie(input.response) } catch { /* no secret or persistence detail is exposed */ }
      throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
    }
    const existing = await dependencies.resolveOwnership(input.container, sessionSecret)
    if (existing.status === "owned") {
      return { cartId: existing.cartId, expiresAt: null, proof: existing, reused: true }
    }
    try { clearGuestCartSessionCookie(input.response) } catch { /* fail closed */ }
    throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
  }

  let sessionSecret: string | undefined
  try {
    const created = await dependencies.createOwnedCart(input.container, input.regionId, input.salesChannelId)
    sessionSecret = created.sessionSecret
    const proof = await dependencies.resolveOwnership(input.container, sessionSecret)
    if (proof.status !== "owned" || proof.cartId !== created.cartId) throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
    setGuestCartSessionCookie(input.response, sessionSecret, created.expiresAt)
    return { cartId: created.cartId, expiresAt: created.expiresAt, proof, reused: false }
  } catch {
    if (sessionSecret && SECRET_PATTERN.test(sessionSecret)) {
      await dependencies.revokeOwnership(input.container, sessionSecret).catch(() => false)
    }
    try { clearGuestCartSessionCookie(input.response) } catch { /* preserve generic failure */ }
    throw new GuestCartTransportError("CART_SESSION_UNAVAILABLE")
  }
}

/** Revoke persistent ownership before clearing the browser cookie. */
export async function revokeGuestCartSession(input: {
  container: MedusaContainer
  request: GuestCartTransportRequest
  response: GuestCartTransportResponse
  storefrontOrigin?: string
}): Promise<boolean> {
  if (!isTrustedSameOriginCartMutation(input.request, input.storefrontOrigin)) return false
  const secret = getGuestCartSessionSecret(singleHeader(input.request, "cookie"))
  if (!secret) return false
  const { invalidateGuestCartOwnership } = await import("../modules/batch-inventory/guest-cart-ownership.js")
  const revoked = await invalidateGuestCartOwnership(input.container, secret)
  if (revoked) clearGuestCartSessionCookie(input.response)
  return revoked
}


