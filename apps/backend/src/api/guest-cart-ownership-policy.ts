import type { MedusaContainer } from "@medusajs/framework/types"
import type { GuestCartOwnershipResult } from "../modules/batch-inventory/guest-cart-ownership"
import { getGuestCartSessionSecret } from "./guest-cart-session-transport"
export { GUEST_CART_SESSION_COOKIE, getGuestCartSessionSecret } from "./guest-cart-session-transport"

/**
 * The raw random secret is created only by a trusted server-side cart issuer
 * and placed in an HttpOnly cookie. A cart id in the URL is never a credential.
 */

// The completion and prototype checkout routes own their independent default-
// deny/feature-gate behavior. All other native cart reads and mutations need
// the same ownership proof before their controller is reached.
export const OWNED_NATIVE_CART_ROUTE_MATCHER = /^\/store\/carts\/[^/]+(?:\/(?!complete(?:\/|$)|abort-checkout(?:\/|$)|checkout-lock(?:\/|$)).*)?$/

type OwnershipResolver = (
  container: MedusaContainer,
  sessionSecret: unknown,
  expectedCartId?: unknown,
) => Promise<GuestCartOwnershipResult>

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
