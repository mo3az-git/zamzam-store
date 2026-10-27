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
    let handlerStarted = false
    try {
      await locking.execute("cart:" + cartId, async () => {
        await assertMutationAllowed(req)
        handlerStarted = true
        await handler(req, res)
      }, { timeout: 2, expire: 15 })
    } catch (error) {
      // The native locking module reports acquisition timeout as a conflict
      // without our public error code. Normalize only pre-handler timeouts;
      // errors raised by the native handler must retain Medusa's behavior.
      const lockError = error && typeof error === "object"
        ? error as { message?: unknown; type?: unknown }
        : undefined
      const message = lockError?.message
      const type = lockError?.type
      if (!handlerStarted && type === MedusaError.Types.CONFLICT && message === "Timed-out acquiring lock.") {
        throw new MedusaError(MedusaError.Types.CONFLICT, "Cart checkout lock timeout", "LOCK_TIMEOUT")
      }
      throw error
    }
  }
}
