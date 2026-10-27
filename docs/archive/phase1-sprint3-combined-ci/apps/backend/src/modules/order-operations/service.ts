import { MedusaService } from "@medusajs/framework/utils"
import { OrderOperationalState } from "./models/order-operational-state"
import { CodCollectionRecord } from "./models/cod-collection-record"
import { ElectronicPaymentAttempt } from "./models/electronic-payment-attempt"

export class OrderOperationsModuleService extends MedusaService({
  OrderOperationalState,
  CodCollectionRecord,
  ElectronicPaymentAttempt,
}) {}
