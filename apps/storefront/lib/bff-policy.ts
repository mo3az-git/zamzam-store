/**
 * Server-Only Internal BFF Request Policy (Phase 4.7 Hardening)
 *
 * Composable request policy evaluator combining:
 * 1. BFF transport approval and feature-gating verification.
 * 2. Origin and Referer validation for state-changing operations.
 * 3. Guest session cookie inspection: rejection of conflicting, malformed, or insecure cookies.
 * 4. HttpOnly guest session secret resolution (state-changing without session denied by default).
 * 5. Double-submit CSRF cookie/header proof for state-changing operations.
 * 6. Cryptographic session-bound HMAC verification (HMAC-SHA256) binding the CSRF token to
 *    the active guest session secret and server secret.
 * 7. Edge perimeter authorization.
 *
 * CRITICAL SECURITY INVARIANT:
 * A policy outcome of `allowed` verifies only that the storefront perimeter checks
 * (Origin allowlist, CSRF proof, valid cookie format, session-bound HMAC) succeeded.
 * A valid cookie and CSRF token are NOT proof that the cart is owned by this guest.
 * Actual cart ownership MUST be verified by the backend resolver (`resolveGuestCartOwnership`)
 * before any cart mutation, inventory reservation, or checkout operation.
 *
 * This policy is internal, server-only, and unmounted.
 */

import { isStorefrontBffEnabled } from "./bff-client.ts"
import { isServerQaPreview } from "./qa-preview.ts"
import {
  extractGuestSessionSecretWithStatus,
  isSecureEnvironment,
  type SessionExtractionResult,
} from "./session.ts"
import {
  getAllowedOrigins,
  validateRequestCsrf,
  validateRequestOrigin,
  type CsrfValidationResult,
  type OriginValidationResult,
} from "./security.ts"

export type BffPolicyOutcome =
  | "allowed"
  | "origin_rejected"
  | "csrf_rejected"
  | "session_missing"
  | "session_invalid"
  | "transport_disabled"

export interface BffInternalTestConfig {
  /**
   * Authorizes transport bypass strictly in isolated unit testing.
   * Completely ignored and forbidden if NODE_ENV === 'production', VERCEL_ENV is set,
   * or synthetic QA mode is active.
   */
  allowTransportBypassForTesting?: boolean
}

export interface BffRequestPolicyInput {
  method: string
  headers: Headers | Record<string, string | undefined>
  cookieHeader?: string | null
  requireSession?: boolean
  allowlist?: string[]
  isSecure?: boolean
  serverCsrfSecret?: string
  /**
   * Internal test configuration.
   * Safely isolated: completely inert and rejected in production or preview environments.
   */
  internalTestConfig?: BffInternalTestConfig
  /**
   * Legacy test flag; safely isolated.
   * Completely inert and rejected in production, preview, and synthetic QA environments.
   */
  bypassTransportCheck?: boolean
}

export interface BffPolicyResult {
  outcome: BffPolicyOutcome
  allowed: boolean
  sessionSecret?: string
  origin?: string
  reason?: string
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Checks whether an internal test configuration is authorized to bypass transport gating.
 * Fails closed in production, preview, or synthetic QA environments.
 */
function isAuthorizedTestTransport(input: BffRequestPolicyInput): boolean {
  const wantsBypass = Boolean(
    input.internalTestConfig?.allowTransportBypassForTesting || input.bypassTransportCheck
  )
  if (!wantsBypass) return false

  // Strictly block bypass in production environments
  if (process.env.NODE_ENV === "production") {
    return false
  }

  // Strictly block bypass in Vercel preview or production environments
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    return false
  }

  // Strictly block bypass in synthetic QA mode
  if (process.env.ZAMZAM_SYNTHETIC_PREVIEW === "true" || isServerQaPreview()) {
    return false
  }

  return true
}

/**
 * Evaluates the full storefront edge security policy on an incoming BFF request.
 * Enforces the strict composition order specified in Phase 4.7.
 * Fails closed on any perimeter violation.
 */
export function evaluateBffRequestPolicy(input: BffRequestPolicyInput): BffPolicyResult {
  const isSecure = input.isSecure ?? isSecureEnvironment()
  const allowlist = input.allowlist ?? getAllowedOrigins()
  const upperMethod = input.method.toUpperCase()
  const isStateChanging = STATE_CHANGING_METHODS.has(upperMethod)

  // Step 1: Transport & Feature Flag Gate
  const transportApproved = isStorefrontBffEnabled() || isAuthorizedTestTransport(input)
  if (!transportApproved) {
    return {
      outcome: "transport_disabled",
      allowed: false,
      reason: "Storefront BFF transport is unmounted and disabled by default",
    }
  }

  // Step 2: Request Origin Policy
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

  // Resolve cookie header from input or headers
  const getHeader = (name: string): string | null => {
    if (typeof (input.headers as Headers).get === "function") {
      return (input.headers as Headers).get(name)
    }
    const record = input.headers as Record<string, string | undefined>
    return record[name] ?? record[name.toLowerCase()] ?? null
  }
  const resolvedCookieHeader = input.cookieHeader ?? getHeader("cookie")

  // Step 3 & 4: Inspect guest session cookie, reject invalid/conflicting cookies, and obtain session secret
  const sessionResult: SessionExtractionResult = extractGuestSessionSecretWithStatus(
    resolvedCookieHeader,
    isSecure
  )

  if (sessionResult.status !== "valid") {
    // Missing session cookie handling
    if (sessionResult.status === "missing") {
      const sessionRequired = isStateChanging || input.requireSession !== false
      if (sessionRequired) {
        return {
          outcome: "session_missing",
          allowed: false,
          origin: validatedOrigin,
          reason: isStateChanging
            ? "State-changing operations require an active guest session; pre-session mutations denied by default"
            : "Guest cart session cookie is missing",
        }
      }

      // Read-only operation without session requirement
      return {
        outcome: "allowed",
        allowed: true,
        origin: validatedOrigin,
      }
    }

    // Step 3: Reject conflicting, malformed, or insecure guest cookies
    return {
      outcome: "session_invalid",
      allowed: false,
      origin: validatedOrigin,
      reason: `Session cookie rejected: ${sessionResult.reason}`,
    }
  }

  // Verified guest session secret present
  const verifiedSessionSecret = sessionResult.secret

  // Steps 5 & 6: Validate double-submit CSRF proof AND cryptographic session binding for state-changing operations
  if (isStateChanging) {
    const csrfResult: CsrfValidationResult = validateRequestCsrf(
      input.method,
      input.headers,
      resolvedCookieHeader,
      isSecure,
      verifiedSessionSecret,
      input.serverCsrfSecret
    )

    if (!csrfResult.valid) {
      return {
        outcome: "csrf_rejected",
        allowed: false,
        origin: validatedOrigin,
        reason: `CSRF validation failed: ${csrfResult.reason}`,
      }
    }
  }

  // Step 7: Return an allowed perimeter result only after every required check passes
  return {
    outcome: "allowed",
    allowed: true,
    sessionSecret: verifiedSessionSecret,
    origin: validatedOrigin,
  }
}
