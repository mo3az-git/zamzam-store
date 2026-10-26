import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

type CartRequest = Pick<MedusaRequest, "scope" | "path">

/** No timestamp, including an old heartbeat, grants mutation authority. */
async function assertMutationAllowed(req: CartRequest) {
  const cartId = decodeURIComponent(req.path.split("/")[3] || "")
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { rows } = await pg.raw(
    "SELECT status FROM cart_checkout_session WHERE cart_id = ? AND deleted_at IS NULL", [cartId]
  )
  if (rows[0]?.status === "in_progress") {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Cart checkout currently in progress; mutations locked", "CART_MUTATIONS_LOCKED")
  }
  if (rows[0]?.status === "completed") {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Cart has already been converted to an order", "CART_ALREADY_COMPLETED")
  }
  return cartId
}

/** Fast rejection before native validators/handlers; the route owns the lock. */
export async function cartMutationGuard(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    await assertMutationAllowed(req)
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Delegate to the actual native controller and await its complete promise.
 * A client disconnect does not prove that server-side mutations have stopped.
 */
export function withCartMutationLock<Req extends CartRequest, Res>(
  handler: (req: Req, res: Res) => Promise<void>
) {
  return async (req: Req, res: Res) => {
    const cartId = await assertMutationAllowed(req)
    const locking = req.scope.resolve(Modules.LOCKING)
    await locking.execute("cart:" + cartId, async () => {
      await assertMutationAllowed(req)
      await handler(req, res)
    }, { timeout: 2, expire: 15 })
  }
}
