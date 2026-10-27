import { Module } from "@medusajs/framework/utils"
import { OrderOperationsModuleService } from "./service"

export const ORDER_OPERATIONS_MODULE = "order_operations"

export default Module(ORDER_OPERATIONS_MODULE, { service: OrderOperationsModuleService })
