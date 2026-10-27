import { MedusaError } from "@medusajs/framework/utils"

/**
 * Fail closed until guest-session ownership and the approved checkout workflow
 * are mounted. Do not re-export Medusa's native completion handler here.
 */
export async function POST(): Promise<never> {
  throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found")
}
