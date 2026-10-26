import { Module } from "@medusajs/framework/utils"
import { SystemSecurityModuleService } from "./service"

export const SYSTEM_SECURITY_MODULE = "system_security"

export default Module(SYSTEM_SECURITY_MODULE, {
  service: SystemSecurityModuleService,
})
