/**
 * Server-Only Storefront BFF Client Boundary (Phase 4.5 BFF Foundation)
 *
 * Defines the typed server-only contract for future secure guest session and cart
 * ownership operations between Next.js server actions and the backend.
 *
 * Requirements:
 * - Typed boundary for session issuance, ownership resolution, cart retrieval,
 *   preflight readiness inspection, and session invalidation.
 * - The backend ownership resolver is currently internal with NO public Store API endpoint.
 * - This client is deliberately unmounted and fails closed until transport and backend
 *   authorization are approved by the integration coordinator.
 * - Never invents operational endpoints, makes live unverified calls, or bypasses ownership.
 */

import type { SanitizedCart } from "./cart-types.ts"
import type { CheckoutReadinessState, GuestCheckoutInput } from "./checkout.ts"
import { isValidSessionSecret } from "./session.ts"

export const FEATURE_ENABLE_STOREFRONT_BFF = "FEATURE_ENABLE_STOREFRONT_BFF" as const

export type BffErrorCode =
  | "TRANSPORT_NOT_AVAILABLE"
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "CART_LOCKED"
  | "ALREADY_COMPLETED"
  | "INVALID_SECRET"
  | "BACKEND_UNAVAILABLE"

export type BffResult<T> =
  | { success: true; data: T }
  | { success: false; error: BffErrorCode; status: number; message: string }

export interface GuestSessionCreated {
  cartId: string
  sessionSecret: string
  expiresAt: string
}

export interface SessionOwnershipResolved {
  status: "owned" | "not_owned" | "expired" | "unavailable"
  cartId?: string
  sessionStatus?: "in_progress" | "completed" | "aborted" | "failed" | "missing" | "unavailable"
  blocker?: string
}

export interface CreateGuestSessionInput {
  regionId: string
  salesChannelId?: string
}

/**
 * Typed server-only contract describing the future secure BFF interaction.
 */
export interface StorefrontBffClient {
  createGuestSession(input: CreateGuestSessionInput): Promise<BffResult<GuestSessionCreated>>
  resolveSession(sessionSecret: string, expectedCartId?: string): Promise<BffResult<SessionOwnershipResolved>>
  retrieveAuthoritativeCart(sessionSecret: string): Promise<BffResult<SanitizedCart>>
  getPreflightReadiness(
    sessionSecret: string,
    guestDelivery?: Partial<GuestCheckoutInput>
  ): Promise<BffResult<CheckoutReadinessState>>
  invalidateGuestSession(sessionSecret: string): Promise<BffResult<{ invalidated: boolean }>>
}

/**
 * Checks whether the Storefront BFF transport has been authorized and mounted.
 * Disabled by default.
 */
export function isStorefrontBffEnabled(): boolean {
  return process.env[FEATURE_ENABLE_STOREFRONT_BFF] === "true"
}

/**
 * Unmounted, safe Storefront BFF Client.
 * Fails closed across all operations to prevent premature or unauthorized backend calls.
 */
export class DisabledStorefrontBffClient implements StorefrontBffClient {
  private static readonly DISABLED_RESPONSE: BffResult<never> = {
    success: false,
    error: "TRANSPORT_NOT_AVAILABLE",
    status: 503,
    message:
      "Storefront BFF transport is unmounted. Backend guest ownership resolver is internal; awaiting integration coordinator authorization.",
  }

  async createGuestSession(
    _input: CreateGuestSessionInput
  ): Promise<BffResult<GuestSessionCreated>> {
    return DisabledStorefrontBffClient.DISABLED_RESPONSE
  }

  async resolveSession(
    sessionSecret: string,
    _expectedCartId?: string
  ): Promise<BffResult<SessionOwnershipResolved>> {
    if (!isValidSessionSecret(sessionSecret)) {
      return {
        success: false,
        error: "INVALID_SECRET",
        status: 400,
        message: "Malformed guest session secret format.",
      }
    }
    return DisabledStorefrontBffClient.DISABLED_RESPONSE
  }

  async retrieveAuthoritativeCart(
    sessionSecret: string
  ): Promise<BffResult<SanitizedCart>> {
    if (!isValidSessionSecret(sessionSecret)) {
      return {
        success: false,
        error: "INVALID_SECRET",
        status: 400,
        message: "Malformed guest session secret format.",
      }
    }
    return DisabledStorefrontBffClient.DISABLED_RESPONSE
  }

  async getPreflightReadiness(
    sessionSecret: string,
    _guestDelivery?: Partial<GuestCheckoutInput>
  ): Promise<BffResult<CheckoutReadinessState>> {
    if (!isValidSessionSecret(sessionSecret)) {
      return {
        success: false,
        error: "INVALID_SECRET",
        status: 400,
        message: "Malformed guest session secret format.",
      }
    }
    return DisabledStorefrontBffClient.DISABLED_RESPONSE
  }

  async invalidateGuestSession(
    sessionSecret: string
  ): Promise<BffResult<{ invalidated: boolean }>> {
    if (!isValidSessionSecret(sessionSecret)) {
      return {
        success: false,
        error: "INVALID_SECRET",
        status: 400,
        message: "Malformed guest session secret format.",
      }
    }
    return DisabledStorefrontBffClient.DISABLED_RESPONSE
  }
}

/**
 * Returns the active Storefront BFF Client instance.
 * Strictly returns the disabled, fail-closed client until trusted integration transport is wired.
 */
export function getStorefrontBffClient(): StorefrontBffClient {
  return new DisabledStorefrontBffClient()
}
