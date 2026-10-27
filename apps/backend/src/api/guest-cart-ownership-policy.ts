import type { MedusaContainer } from "@medusajs/framework/types"
import type { GuestCartOwnershipResult } from "../modules/batch-inventory/guest-cart-ownership"

/**
 * The raw random secret is created only by a trusted server-side cart issuer
 * and placed in an HttpOnly cookie. A cart id in the URL is never a credential.
 */
export const GUEST_CART_SESSION_COOKIE = "zamzam_guest_cart"

// The completion and prototype checkout routes own their independent default-
// deny/feature-gate behavior. All other native cart reads and mutations need
// the same ownership proof before their controller is reached.
export const OWNED_NATIVE_CART_ROUTE_MATCHER = /^\/store\/carts\/[^/]+(?:\/(?!complete(?:\/|$)|abort-checkout(?:\/|$)|checkout-lock(?:\/|$)).*)?$/

type OwnershipResolver = (
  container: MedusaContainer,
  sessionSecret: unknown,
  expectedCartId?: unknown,
) => Promise<GuestCartOwnershipResult>

export function getGuestCartSessionSecret(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 8192) return null
  const values: string[] = []
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 1) continue
    if (part.slice(0, separator).trim() !== GUEST_CART_SESSION_COOKIE) continue
    const raw = part.slice(separator + 1).trim()
    try {
      values.push(decodeURIComponent(raw))
    } catch {
      return null
    }
  }
  // Ambiguous duplicate cookies are denied instead of choosing an attacker-ordered value.
  return values.length === 1 ? values[0] : null
}

export function getCartIdFromStorePath(path: unknown): string | null {
  if (typeof path !== "string") return null
  const match = /^\/store\/carts\/([^/?#]+)(?:\/|$)/.exec(path)
  if (!match) return null
  try {
    const id = decodeURIComponent(match[1])
    return id.length > 0 && id.length <= 255 ? id : null
  } catch {
    return null
  }
}

export async function hasGuestCartRouteOwnership(input: {
  container: MedusaContainer
  path: unknown
  cookieHeader: unknown
  resolveOwnership: OwnershipResolver
}): Promise<boolean> {
  const cartId = getCartIdFromStorePath(input.path)
  const sessionSecret = getGuestCartSessionSecret(input.cookieHeader)
  if (!cartId || !sessionSecret) return false

  try {
    const ownership = await input.resolveOwnership(
      input.container,
      sessionSecret,
      cartId,
    )
    // Defend in depth: the resolver must prove the exact routed cart, even if
    // an alternate resolver accidentally ignores its expected-cart argument.
    return ownership.status === "owned" && ownership.cartId === cartId
  } catch {
    return false
  }
}
