import type { MedusaContainer } from "@medusajs/framework/types"
import type { GuestCartOwnershipResult } from "../modules/batch-inventory/guest-cart-ownership"

export const GUEST_CART_SESSION_COOKIE = "zamzam_guest_cart"
export const OWNED_NATIVE_CART_ROUTE_MATCHER = /^\/store\/carts\/[^/]+(?:\/(?!complete(?:\/|$)|abort-checkout(?:\/|$)|checkout-lock(?:\/|$)).*)?$/

type OwnershipResolver = (container: MedusaContainer, secret: unknown, expectedCartId?: unknown) => Promise<GuestCartOwnershipResult>

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

export function getCartIdFromStorePath(path: unknown): string | null {
  if (typeof path !== "string") return null
  const match = /^\/store\/carts\/([^/?#]+)(?:\/|$)/.exec(path)
  if (!match) return null
  try { const id = decodeURIComponent(match[1]); return id.length > 0 && id.length <= 255 ? id : null }
  catch { return null }
}

export async function hasGuestCartRouteOwnership(input: {
  container: MedusaContainer; path: unknown; cookieHeader: unknown; resolveOwnership: OwnershipResolver
}): Promise<boolean> {
  const cartId = getCartIdFromStorePath(input.path)
  const secret = getGuestCartSessionSecret(input.cookieHeader)
  if (!cartId || !secret) return false
  try {
    const ownership = await input.resolveOwnership(input.container, secret, cartId)
    return ownership.status === "owned" && ownership.cartId === cartId
  } catch { return false }
}
