import { POST as nativePOST } from "@medusajs/medusa/api/store/carts/[id]/route"
import { withCartMutationLock } from "../../../cart-mutation-guard"
export { GET } from "@medusajs/medusa/api/store/carts/[id]/route"
export const POST = withCartMutationLock(nativePOST)
