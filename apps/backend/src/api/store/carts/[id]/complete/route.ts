import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Fail closed until guest-session ownership and the approved checkout workflow
 * are mounted. Do not re-export Medusa's native completion handler here.
 */
export async function POST(_req: MedusaRequest, _res: MedusaResponse): Promise<never> {
  throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found")
}
