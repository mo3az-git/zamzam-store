import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isTrustedSameOriginCartMutation } from "./guest-cart-session-transport"

/** Cookie-authenticated native mutations must arrive through the same-origin
 * storefront proxy. Do not configure credentialed cross-origin CORS as a
 * fallback for requests rejected here.
 */
export function guestCartRequestSecurityGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  if (!isTrustedSameOriginCartMutation(req, process.env.ZAMZAM_STOREFRONT_ORIGIN)) {
    res.status(403).json({ code: "CART_REQUEST_REJECTED", message: "Cart request rejected" })
    return
  }
  next()
}

