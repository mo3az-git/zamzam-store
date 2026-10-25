import { MedusaService } from "@medusajs/framework/utils"
import { CartCheckoutSession } from "./models/cart-checkout-session"

export class BatchInventoryModuleService extends MedusaService({
  CartCheckoutSession,
}) {}
