import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveGuestCartOwnership } from "../modules/batch-inventory/guest-cart-ownership"
import { hasGuestCartRouteOwnership } from "./guest-cart-ownership-policy"

/**
 * Middleware extension for native Store cart reads and mutations. It is
 * deliberately not registered for cart creation or `/complete`: creation
 * needs a future trusted cookie issuer, while completion stays default-deny
 * in the Checkout-owned route until its approved workflow exists.
 */
export async function guestCartOwnershipGuard(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    const authorized = await hasGuestCartRouteOwnership({
      container: req.scope,
      path: req.path,
      cookieHeader: req.headers.cookie,
      resolveOwnership: resolveGuestCartOwnership,
    })
    if (!authorized) {
      // Do not distinguish a missing, stale, invalid, cross-session, or
      // unavailable proof; doing so would disclose cart/session state.
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Guest cart ownership is required", "GUEST_CART_OWNERSHIP_REQUIRED")
    }
    next()
  } catch (error) {
    next(error)
  }
}
