/**
 * Server-Only Storefront BFF Client Boundary (Phase 4.6 BFF Foundation)
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
 * - Never accepts a browser-supplied cart ID as ownership proof.
 */

import type { SanitizedCart } from "./cart-types.ts"
import type { CheckoutReadinessState, GuestCheckoutInput } from "./checkout.ts"
import type { Dictionary } from "./i18n.ts"
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

/* ==========================================================================
   Task 3: Trusted Read-Only Integration Functions
   ========================================================================== */

/**
 * Resolves trusted guest cart session ownership from the opaque session secret.
 * Fails closed if the secret is malformed or transport is unmounted.
 */
export async function resolveTrustedGuestSession(
  sessionSecret: unknown,
  client: StorefrontBffClient = getStorefrontBffClient()
): Promise<BffResult<SessionOwnershipResolved>> {
  if (!isValidSessionSecret(sessionSecret)) {
    return {
      success: false,
      error: "INVALID_SECRET",
      status: 400,
      message: "Malformed guest session secret format.",
    }
  }
  return client.resolveSession(sessionSecret)
}

/**
 * Obtains an authoritative Medusa cart snapshot for the trusted session.
 * Never accepts a client-provided cart ID as identity.
 */
export async function getAuthoritativeCartSnapshot(
  sessionSecret: unknown,
  client: StorefrontBffClient = getStorefrontBffClient()
): Promise<BffResult<SanitizedCart>> {
  if (!isValidSessionSecret(sessionSecret)) {
    return {
      success: false,
      error: "INVALID_SECRET",
      status: 400,
      message: "Malformed guest session secret format.",
    }
  }
  return client.retrieveAuthoritativeCart(sessionSecret)
}

/**
 * Retrieves authoritative backend checkout readiness blockers.
 */
export async function getBackendCheckoutReadiness(
  sessionSecret: unknown,
  guestDelivery?: Partial<GuestCheckoutInput>,
  client: StorefrontBffClient = getStorefrontBffClient()
): Promise<BffResult<CheckoutReadinessState>> {
  if (!isValidSessionSecret(sessionSecret)) {
    return {
      success: false,
      error: "INVALID_SECRET",
      status: 400,
      message: "Malformed guest session secret format.",
    }
  }
  return client.getPreflightReadiness(sessionSecret, guestDelivery)
}

export interface UiReadinessChecklistItem {
  label: string
  status: "met" | "pending" | "blocked"
  statusText: string
}

export interface UiReadinessViewModel {
  isBlocked: boolean
  overallStatusText: string
  blockers: string[]
  blockerMessages: string[]
  checklist: UiReadinessChecklistItem[]
}

/**
 * Safely maps the backend checkout readiness state into the existing bilingual Checkout UI view model.
 * - Does NOT recalculate Medusa prices or totals.
 * - Does NOT fabricate shipping fees or grant purchasing authorization.
 * - Maps blocker codes to localized explanatory alerts.
 */
export function mapBackendReadinessToUi(
  readinessState: CheckoutReadinessState,
  dict: Dictionary
): UiReadinessViewModel {
  const isBlocked = readinessState.status === "blocked" || readinessState.blockers.length > 0
  const overallStatusText = isBlocked
    ? dict.checkout.statusBlocked
    : dict.checkout.statusMet

  const blockerMessages = readinessState.blockers.map((code) => {
    return dict.checkout.blockers[code] ?? code
  })

  const checklist: UiReadinessChecklistItem[] = [
    {
      label: dict.checkout.ownershipLabel,
      status: "blocked",
      statusText: dict.checkout.statusBlocked,
    },
    {
      label: dict.checkout.deliveryAddressLabel,
      status: readinessState.readiness.deliveryAddress ? "met" : "pending",
      statusText: readinessState.readiness.deliveryAddress
        ? dict.checkout.statusMet
        : dict.checkout.statusPending,
    },
    {
      label: dict.checkout.shippingMethodLabel,
      status: readinessState.readiness.shippingMethod ? "met" : "pending",
      statusText: readinessState.readiness.shippingMethod
        ? dict.checkout.statusMet
        : dict.checkout.statusPending,
    },
    {
      label: dict.checkout.shippingPriceLabel,
      status: readinessState.readiness.shippingPrice ? "met" : "pending",
      statusText: readinessState.readiness.shippingPrice
        ? dict.checkout.statusMet
        : dict.checkout.statusPending,
    },
    {
      label: dict.checkout.payableTotalLabel,
      status: readinessState.readiness.payableTotal ? "met" : "pending",
      statusText: readinessState.readiness.payableTotal
        ? dict.checkout.statusMet
        : dict.checkout.statusPending,
    },
  ]

  return {
    isBlocked,
    overallStatusText,
    blockers: [...readinessState.blockers],
    blockerMessages,
    checklist,
  }
}
