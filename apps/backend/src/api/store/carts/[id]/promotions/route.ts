import { POST as nativePOST, DELETE as nativeDELETE } from "@medusajs/medusa/api/store/carts/[id]/promotions/route"
import { withCartMutationLock } from "../../../../cart-mutation-guard"
export const POST = withCartMutationLock(nativePOST)
export const DELETE = withCartMutationLock(nativeDELETE)
