import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolveGuestCartOwnership } from "../modules/batch-inventory/guest-cart-ownership"
import { hasGuestCartRouteOwnership } from "./guest-cart-ownership-policy"

export async function guestCartOwnershipGuard(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    const authorized = await hasGuestCartRouteOwnership({ container: req.scope, path: req.path,
      cookieHeader: req.headers.cookie, resolveOwnership: resolveGuestCartOwnership })
    if (!authorized) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Guest cart ownership is required", "GUEST_CART_OWNERSHIP_REQUIRED")
    next()
  } catch (error) { next(error) }
}
