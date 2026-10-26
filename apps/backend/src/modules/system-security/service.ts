import { MedusaService } from "@medusajs/framework/utils"
import { IdempotencyKey } from "./models/idempotency-key"

export class SystemSecurityModuleService extends MedusaService({
  IdempotencyKey,
}) {}
