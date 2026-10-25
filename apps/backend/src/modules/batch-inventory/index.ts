import { Module } from "@medusajs/framework/utils"
import { BatchInventoryModuleService } from "./service"

export const BATCH_INVENTORY_MODULE = "batch_inventory"

export default Module(BATCH_INVENTORY_MODULE, {
  service: BatchInventoryModuleService,
})
