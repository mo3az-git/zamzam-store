import { completeNativeCartForTp08Workflow } from "../../workflows/tp08-native-complete-cart"
import { findNativeOrdersByCart } from "./native-order-lookup"
import { runOrderCreationWithFence } from "./order-correlation"

/**
 * TP-08 native bridge — not a public endpoint.
 *
 * Only a server-side trusted coordinator that already holds the canonical
 * checkout lock may invoke this function. Caller MUST derive its authority
 * from persisted session/attempt state; never accept client-supplied owner IDs.
 *
 * This bridge provides genuine Medusa workflow invocation and a read-only
 * native order lookup. Neither "no ID returned" nor a workflow exception
 * authorizes rollback, stock release, a new epoch, or a second creation call.
 */
type BackendContainer = Parameters<typeof completeNativeCartForTp08Workflow>[0]
type CheckoutDb = Parameters<typeof runOrderCreationWithFence>[0]
type Authority = Parameters<typeof runOrderCreationWithFence>[1]
export type NativeCompletionHooks = {
  /** Fail closed unless a durable order-creation fence already exists. */
  reconciliationOnly?: boolean
  afterFenceCommit?: () => void | Promise<void>
  afterNativeReturn?: () => void | Promise<void>
  /** Deterministic disposable-service hook immediately before native invocation. */
  beforeNativeCompletion?: () => void | Promise<void>
  /** Deterministic disposable-service fault boundary after the native saga returns. */
  afterNativeCompletion?: () => void | Promise<void>
}

export async function completeNativeCartWithFence(
  container: BackendContainer,
  db: CheckoutDb,
  authority: Authority,
  hooks: NativeCompletionHooks = {}
) {
  return runOrderCreationWithFence(
    db,
    authority,
    async (cartId) => {
      await hooks.beforeNativeCompletion?.()
      const nativeResult = await completeNativeCartForTp08Workflow(container).run({
        input: { cartId },
      })
      await hooks.afterNativeCompletion?.()
      // Never trust the returned ID without verifying the native cart-order link.
      const data: unknown = nativeResult.result
      if (!data || typeof data !== "object" || !("id" in data)) {
        return null
      }
      const candidate = (data as { id?: unknown }).id
      return typeof candidate === "string" ? { orderId: candidate } : null
    },
    async (cartId) => findNativeOrdersByCart(db, cartId),
    hooks
  )
}
