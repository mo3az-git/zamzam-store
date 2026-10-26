import { MedusaService } from "@medusajs/framework/utils"
import { IdempotencyKey } from "./models/idempotency-key"
import { prepareRefundIdentity, RefundIdentityInput } from "./refund-identity"

export class SystemSecurityModuleService extends MedusaService({
  IdempotencyKey,
}) {
  prepareRefundIdentity(input: RefundIdentityInput) {
    return prepareRefundIdentity(input)
  }
}
