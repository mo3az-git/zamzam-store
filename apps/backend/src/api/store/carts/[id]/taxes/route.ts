import { POST as nativePOST } from "@medusajs/medusa/api/store/carts/[id]/taxes/route"
import { withCartMutationLock } from "../../../../cart-mutation-guard"
export const POST = withCartMutationLock(nativePOST)
