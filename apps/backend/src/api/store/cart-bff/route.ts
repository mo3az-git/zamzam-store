import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { executeCartBffRequest } from "../../../modules/batch-inventory/cart-bff-orchestrator"
import { createCartBffDependencies } from "../../../modules/batch-inventory/cart-bff-runtime"
import { getGuestCartSessionSecret } from "../../guest-cart-ownership-policy"

function statusFor(blockers: readonly string[]): number {
  if (blockers.some((code) => code === "CART_VERSION_CONFLICT" || code === "CART_MUTATION_LOCKED" || code === "CART_COMPLETED" || code === "CART_IDEMPOTENCY_CONFLICT")) return 409
  if (blockers.some((code) => code === "CART_IDEMPOTENCY_UNAVAILABLE" || code === "UPSTREAM_UNAVAILABLE")) return 503
  if (blockers.includes("CART_UNAVAILABLE")) return 404
  if (blockers.includes("GUEST_DELIVERY_INVALID")) return 400
  return blockers.length ? 409 : 200
}

/**
 * Single protected storefront boundary. Cart identity is always recovered
 * from Agent A's HttpOnly guest-session proof; requests never accept cart IDs.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const result = await executeCartBffRequest({
    body: req.body,
    sessionSecret: getGuestCartSessionSecret(req.headers.cookie),
    dependencies: createCartBffDependencies(req.scope, res),
  })
  if ("valid" in result) {
    if (!result.valid) return res.status(400).json({ error: "INVALID_CART_REQUEST" })
    const response = result.value.response
    return res.status(statusFor(response.blockers)).json(response)
  }
  return res.status(statusFor(result.response.blockers)).json(result.response)
}
