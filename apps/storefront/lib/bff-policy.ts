/**
 * Server-Only Internal BFF Request Policy (Phase 4.6 BFF Foundation)
 *
 * Composable request policy evaluator combining:
 * - Method and Origin policy verification.
 * - CSRF token verification on state-changing operations.
 * - Secure guest session cookie extraction and format validation.
 * - Feature-flag and unmounted transport gating.
 *
 * CRITICAL SECURITY INVARIANT:
 * A policy outcome of `allowed` verifies only that the storefront perimeter checks
 * (Origin allowlist, CSRF proof, valid cookie format) succeeded.
 * A valid cookie and CSRF token are NOT proof that the cart is owned by this guest.
 * Actual cart ownership MUST be verified by the backend resolver (`resolveGuestCartOwnership`)
 * before any cart mutation, inventory reservation, or checkout operation.
 *
 * This policy is internal, server-only, and unmounted.
 */

import { isStorefrontBffEnabled } from "./bff-client.ts"
import { isSecureEnvironment, extractGuestSessionSecretWithStatus } from "./session.ts"
import {
  getAllowedOrigins,
  validateRequestCsrf,
  validateRequestOrigin,
  type OriginValidationResult,
  type CsrfValidationResult,
} from "./security.ts"

export type BffPolicyOutcome =
  | "allowed"
  | "origin_rejected"
  | "csrf_rejected"
  | "session_missing"
  | "session_invalid"
  | "transport_disabled"

export interface BffRequestPolicyInput {
  method: string
  headers: Headers | Record<string, string | undefined>
  cookieHeader?: string | null
  requireSession?: boolean
  allowlist?: string[]
  isSecure?: boolean
  bypassTransportCheck?: boolean // for internal integration testing only
}

export interface BffPolicyResult {
  outcome: BffPolicyOutcome
  allowed: boolean
  sessionSecret?: string
  origin?: string
  reason?: string
}

/**
 * Evaluates the full storefront edge security policy on an incoming BFF request.
 * Fails closed on any perimeter violation.
 */
export function evaluateBffRequestPolicy(input: BffRequestPolicyInput): BffPolicyResult {
  const isSecure = input.isSecure ?? isSecureEnvironment()
  const allowlist = input.allowlist ?? getAllowedOrigins()

  // 1. Transport & Feature Flag Gate
  if (!input.bypassTransportCheck && !isStorefrontBffEnabled()) {
    return {
      outcome: "transport_disabled",
      allowed: false,
      reason: "Storefront BFF transport is unmounted and disabled by default",
    }
  }

  // 2. Request Origin Policy
  const originResult: OriginValidationResult = validateRequestOrigin(
    input.method,
    input.headers,
    allowlist
  )
  if (!originResult.valid) {
    return {
      outcome: "origin_rejected",
      allowed: false,
      reason: `Origin validation failed: ${originResult.reason}`,
    }
  }

  const validatedOrigin = originResult.origin

  // 3. CSRF Validation for State-Changing Methods (POST, PUT, PATCH, DELETE)
  const csrfResult: CsrfValidationResult = validateRequestCsrf(
    input.method,
    input.headers,
    input.cookieHeader,
    isSecure
  )
  if (!csrfResult.valid) {
    return {
      outcome: "csrf_rejected",
      allowed: false,
      origin: validatedOrigin,
      reason: `CSRF validation failed: ${csrfResult.reason}`,
    }
  }

  // 4. Guest Session Cookie Extraction & Validation
  if (input.requireSession !== false) {
    const sessionResult = extractGuestSessionSecretWithStatus(input.cookieHeader, isSecure)

    if (sessionResult.status === "missing") {
      return {
        outcome: "session_missing",
        allowed: false,
        origin: validatedOrigin,
        reason: "Guest cart session cookie is missing",
      }
    }

    if (sessionResult.status !== "valid") {
      return {
        outcome: "session_invalid",
        allowed: false,
        origin: validatedOrigin,
        reason: `Session cookie rejected: ${sessionResult.reason}`,
      }
    }

    return {
      outcome: "allowed",
      allowed: true,
      sessionSecret: sessionResult.secret,
      origin: validatedOrigin,
    }
  }

  // If session is not explicitly required (e.g. public pre-session ping)
  return {
    outcome: "allowed",
    allowed: true,
    origin: validatedOrigin,
  }
}
