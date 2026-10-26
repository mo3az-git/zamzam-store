import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

/** No timestamp, including an old heartbeat, grants mutation authority. */
export async function cartMutationGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const cartId = decodeURIComponent(req.path.split("/")[3] || "")
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const locking = req.scope.resolve(Modules.LOCKING)
  const checkSession = async () => {
    const { rows } = await pg.raw(
      "SELECT status FROM cart_checkout_session WHERE cart_id = ? AND deleted_at IS NULL", [cartId]
    )
    if (rows[0]?.status === "in_progress") {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Cart checkout currently in progress; mutations locked", "CART_MUTATIONS_LOCKED")
    }
    if (rows[0]?.status === "completed") {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Cart has already been converted to an order", "CART_ALREADY_COMPLETED")
    }
  }

  try {
    // Fail fast when checkout already owns the cart. Recheck after acquiring
    // the lock to close the race between this read and a checkout starting.
    await checkSession()
    await locking.execute("cart:" + cartId, async () => {
      await checkSession()
      // Express next() returns void. Keep the critical section alive until
      // the actual downstream response closes, not just until next returns.
      await new Promise<void>((resolve, reject) => {
        const detach = () => {
          res.off("finish", done)
          res.off("close", done)
          res.off("error", failed)
        }
        const done = () => {
          detach()
          resolve()
        }
        const failed = (error: Error) => {
          detach()
          reject(error)
        }
        res.once("finish", done)
        res.once("close", done)
        res.once("error", failed)
        next()
      })
    }, { timeout: 2, expire: 15 })
  } catch (error) {
    if (res.headersSent) {
      req.scope.resolve(ContainerRegistrationKeys.LOGGER).error("Cart mutation lock lifecycle failed", error as Error)
      res.destroy(error as Error)
    } else {
      next(error)
    }
  }
}
