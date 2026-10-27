import { createHash } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createGuestCartWithOwnership, resolveGuestCartOwnership } from "./guest-cart-ownership"
import type { CartOrchestrationSnapshot, GuestCartAuthority } from "./cart-bff-orchestrator"

const ownerKeyFor = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex")

/**
 * Bind the BFF orchestration seam to Agent 1's internal ownership primitive.
 * Region selection, native cart projection and cookie transport remain injected
 * server dependencies; no caller-supplied cart ID can enter this adapter.
 */
export function createCartBffGuestOwnershipAdapter(input: {
  container: MedusaContainer
  resolveEgyptEgpRegion(): Promise<string | null>
  resolveEgyptEgpSalesChannel?(): Promise<string | null>
  readNativeCart(cartId: string, proof: unknown): Promise<CartOrchestrationSnapshot>
}) {
  return {
    async createOwnedEgpCart() {
      const regionId = await input.resolveEgyptEgpRegion()
      if (!regionId || typeof regionId !== "string") throw new Error("EGP_REGION_UNAVAILABLE")
      const salesChannelId = await input.resolveEgyptEgpSalesChannel?.()
      const created = await createGuestCartWithOwnership(input.container, { regionId, ...(salesChannelId ? { salesChannelId } : {}) })
      const proof = await resolveGuestCartOwnership(input.container, created.sessionSecret)
      if (proof.status !== "owned" || proof.cartId !== created.cartId) throw new Error("GUEST_OWNERSHIP_UNAVAILABLE")
      const snapshot = await input.readNativeCart(created.cartId, proof)
      return { cartId: created.cartId, ownerKey: ownerKeyFor(created.sessionSecret), proof,
        sessionSecret: created.sessionSecret, snapshot }
    },
    async resolveOwnedCart(sessionSecret: string): Promise<GuestCartAuthority> {
      const proof = await resolveGuestCartOwnership(input.container, sessionSecret)
      if (proof.status !== "owned") return { status: proof.status }
      return { status: "owned", cartId: proof.cartId, ownerKey: ownerKeyFor(sessionSecret), proof }
    },
  }
}
