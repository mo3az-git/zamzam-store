import { MedusaService } from "@medusajs/framework/utils"
import { CartCheckoutSession } from "./models/cart-checkout-session"
import { CartBatchReservation } from "./models/cart-batch-reservation"
import { OrderBatchAllocation } from "./models/order-batch-allocation"
import { GuestCartOwnership } from "./models/guest-cart-ownership"
import { CartBffState } from "./models/cart-bff-state"
import { CartBffIdempotency } from "./models/cart-bff-idempotency"

export class BatchInventoryModuleService extends MedusaService({
  CartCheckoutSession,
  CartBatchReservation,
  OrderBatchAllocation,
  GuestCartOwnership,
  CartBffState,
  CartBffIdempotency,
}) {}
