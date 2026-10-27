import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

const configuredOrigins = () => (process.env.STORE_CORS ?? "").split(",").map((value) => value.trim()).filter(Boolean)

/** Cookie-authenticated BFF writes require an exact configured Origin and a non-simple CSRF header. */
export function cartBffOriginGuard(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const origin = req.headers.origin
  const csrf = req.headers["x-zamzam-cart-csrf"]
  const contentType = req.headers["content-type"]
  const fetchSite = req.headers["sec-fetch-site"]
  const validOrigin = typeof origin === "string" && configuredOrigins().some((configured) => {
    try { return new URL(configured).origin === origin && new URL(origin).origin === origin }
    catch { return false }
  })
  if (!validOrigin || csrf !== "1" || typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json") || fetchSite === "cross-site") {
    next(new MedusaError(MedusaError.Types.NOT_FOUND, "Not found"))
    return
  }
  next()
}
