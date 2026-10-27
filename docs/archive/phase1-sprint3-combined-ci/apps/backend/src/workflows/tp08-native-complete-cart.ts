import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

/**
 * Native Medusa v2 adapter.
 * IMPORTANT: Only invoke after markOrderCreationStarted commits successfully.
 * Do not call this workflow to "retry" an ambiguous previous invocation.
 *
 * A first invocation may return an unusable ID even after creating an order;
 * the caller MUST reconcile by authoritative cart/order association instead.
 */
export const completeNativeCartForTp08Workflow = createWorkflow(
  "zamzam-tp08-native-cart-completion",
  (input: { cartId: string }) => {
    const result = completeCartWorkflow.runAsStep({
      input: { id: input.cartId },
    })
    return new WorkflowResponse(result)
  }
)
