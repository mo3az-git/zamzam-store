import { defineMiddlewares, errorHandler } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { cartMutationGuard } from "./cart-mutation-guard"

const fallbackErrorHandler = errorHandler()
const publicCartErrors: Record<string, string> = {
  CART_MUTATIONS_LOCKED: "Cart checkout currently in progress; mutations locked",
  CART_ALREADY_COMPLETED: "Cart has already been converted to an order",
  LOCK_TIMEOUT: "Cart checkout lock timeout",
}

export default defineMiddlewares({
  errorHandler: (error, req, res, next) => {
    // Medusa 2.22.1 otherwise replaces every conflict message with a generic
    // retry message. Expose only these fixed, non-sensitive guard messages.
    // Workflow SDK errors can cross serialization boundaries and lose their
    // prototype. Fixed type/code matching must also handle those errors.
    if (error && typeof error === "object" && error.type === MedusaError.Types.CONFLICT && typeof error.code === "string" && Object.prototype.hasOwnProperty.call(publicCartErrors, error.code)) {
      res.status(409).json({ type: error.type, code: error.code, message: publicCartErrors[error.code] })
      return
    }
    return fallbackErrorHandler(error, req, res, next)
  },
  routes: [{
    // Cover native cart updates and all child mutations; checkout/recovery own
    // their own locking protocols. Cart creation is deliberately excluded.
    matcher: /^\/store\/carts\/[^/]+(?:\/(?!complete(?:\/|$)|abort-checkout(?:\/|$)|checkout-lock(?:\/|$)).*)?$/,
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    middlewares: [cartMutationGuard],
  }],
})
