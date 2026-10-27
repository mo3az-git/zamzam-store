/**
 * Server-Side Medusa Cart Adapter (Phase 4 Foundation)
 *
 * This module provides a strictly scoped, server-side interface for native
 * Medusa Store Cart API operations.
 *
 * Guardrails:
 * - Disabled by default via feature flag `FEATURE_ENABLE_MEDUSA_CART`.
 * - Server-side only: never imported into client-side UI components.
 * - Always enforces the resolved EGP region: fails closed if no EGP region exists.
 * - Never accepts client-supplied backend URLs, currency overrides, or item prices.
 * - Does not retry ambiguous POST failures to avoid duplicate cart/item creation.
 * - Preserves Medusa authoritative pricing and backend cart-mutation lock / conflict codes.
 */

import { resolveEgpRegionId, storeBase, storeKey } from "./medusa.ts"
import {
  type SanitizedCart,
  type SanitizedLineItem,
  SYNTHETIC_CART_PREVIEW_FIXTURE,
} from "./cart-types.ts"

export {
  type SanitizedCart,
  type SanitizedLineItem,
  SYNTHETIC_CART_PREVIEW_FIXTURE,
}

export const FEATURE_FLAG_ENV_KEY = "FEATURE_ENABLE_MEDUSA_CART" as const
const REQUEST_TIMEOUT_MS = 8000
const MAX_ITEM_QUANTITY = 100

export type CartErrorCode =
  | "disabled"
  | "missing_config"
  | "missing_publishable_key"
  | "no_egp_region"
  | "invalid_cart_id"
  | "invalid_variant_id"
  | "invalid_quantity"
  | "cart_locked"
  | "cart_completed"
  | "lock_timeout"
  | "conflict"
  | "network_timeout"
  | "upstream_error"

export type CartResult<T> =
  | { success: true; data: T }
  | {
      success: false
      error: CartErrorCode
      message: string
      status?: number
      code?: string
    }

/**
 * Checks whether Medusa cart mutations are explicitly enabled by environment configuration.
 * Always defaults to false.
 */
export function isCartEnabled(): boolean {
  // A QA preview cannot mutate actual Medusa carts regardless of the feature flag.
  if (process.env.VERCEL_ENV === "preview" && process.env.ZAMZAM_SYNTHETIC_PREVIEW === "true")
    return false
  return process.env[FEATURE_FLAG_ENV_KEY] === "true"
}

/**
 * Validates a cart ID string.
 */
export function isValidCartId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.trim().length <= 255
}

/**
 * Validates a variant ID string.
 */
export function isValidVariantId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.trim().length <= 255
}

/**
 * Validates a cart item quantity: must be an integer between 1 and MAX_ITEM_QUANTITY.
 */
export function isValidQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= MAX_ITEM_QUANTITY
  )
}

/**
 * Extracts and sanitizes authoritative cart fields from Medusa's native response.
 * Never calculates, overrides, or fabricates prices or totals.
 */
export function sanitizeMedusaCart(cart: unknown): SanitizedCart | null {
  if (!cart || typeof cart !== "object") return null
  const raw = cart as Record<string, unknown>
  if (typeof raw.id !== "string" || typeof raw.region_id !== "string") return null

  const items: SanitizedLineItem[] = []
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (item && typeof item === "object") {
        const line = item as Record<string, unknown>
        if (typeof line.id === "string") {
          items.push({
            id: line.id,
            title: typeof line.title === "string" ? line.title : null,
            variant_id: typeof line.variant_id === "string" ? line.variant_id : "",
            quantity: typeof line.quantity === "number" ? line.quantity : 1,
            unit_price: typeof line.unit_price === "number" ? line.unit_price : null,
            total: typeof line.total === "number" ? line.total : null,
          })
        }
      }
    }
  }

  return {
    id: raw.id,
    region_id: raw.region_id,
    currency_code: typeof raw.currency_code === "string" ? raw.currency_code : "",
    total: typeof raw.total === "number" ? raw.total : null,
    subtotal: typeof raw.subtotal === "number" ? raw.subtotal : null,
    tax_total: typeof raw.tax_total === "number" ? raw.tax_total : null,
    items,
  }
}

interface UpstreamErrorBody {
  message?: string
  code?: string
  type?: string
}

async function parseErrorBody(response: Response): Promise<UpstreamErrorBody | null> {
  try {
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text) as UpstreamErrorBody
  } catch {
    return null
  }
}

/**
 * Creates a new Medusa cart bound to the resolved EGP region.
 *
 * Fails closed if:
 * - Feature flag is disabled.
 * - Missing backend configuration or publishable key.
 * - No active EGP pricing region can be resolved (does not POST).
 */
export async function createCart(): Promise<CartResult<SanitizedCart>> {
  if (!isCartEnabled()) {
    return {
      success: false,
      error: "disabled",
      message: "Medusa cart operations are disabled by default.",
    }
  }

  const base = storeBase()
  if (!base) {
    return {
      success: false,
      error: "missing_config",
      message: "Medusa backend URL is not configured or invalid.",
    }
  }

  const key = storeKey()
  if (!key) {
    return {
      success: false,
      error: "missing_publishable_key",
      message: "Medusa publishable API key is not configured.",
    }
  }

  // Authoritative EGP region resolution: never create a cart in an arbitrary currency
  const regionId = await resolveEgpRegionId()
  if (!regionId) {
    return {
      success: false,
      error: "no_egp_region",
      message: "No active EGP pricing region could be resolved. Refusing to create cart.",
    }
  }

  const endpoint = `${base}/store/carts`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-publishable-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ region_id: regionId }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message))
    return {
      success: false,
      error: isTimeout ? "network_timeout" : "upstream_error",
      message: isTimeout
        ? "Cart creation request timed out. Ambiguous POST was not retried."
        : (err as Error)?.message || "Network error contacting Medusa backend.",
    }
  }

  if (response.status === 409) {
    const errBody = await parseErrorBody(response)
    const code = errBody?.code
    if (code === "CART_MUTATIONS_LOCKED") {
      return {
        success: false,
        error: "cart_locked",
        code,
        status: 409,
        message: errBody?.message || "Cart checkout currently in progress; mutations locked.",
      }
    }
    if (code === "CART_ALREADY_COMPLETED") {
      return {
        success: false,
        error: "cart_completed",
        code,
        status: 409,
        message: errBody?.message || "Cart has already been converted to an order.",
      }
    }
    if (code === "LOCK_TIMEOUT") {
      return {
        success: false,
        error: "lock_timeout",
        code,
        status: 409,
        message: errBody?.message || "Cart checkout lock timeout.",
      }
    }
    return {
      success: false,
      error: "conflict",
      code,
      status: 409,
      message: errBody?.message || "Cart mutation conflict.",
    }
  }

  if (!response.ok) {
    const errBody = await parseErrorBody(response)
    return {
      success: false,
      error: "upstream_error",
      status: response.status,
      code: errBody?.code,
      message: errBody?.message || `Medusa returned HTTP status ${response.status}.`,
    }
  }

  try {
    const data = (await response.json()) as { cart?: unknown }
    const sanitized = sanitizeMedusaCart(data.cart)
    if (!sanitized) {
      return {
        success: false,
        error: "upstream_error",
        message: "Medusa response did not contain a valid cart payload.",
      }
    }
    return { success: true, data: sanitized }
  } catch {
    return {
      success: false,
      error: "upstream_error",
      message: "Failed to parse Medusa cart JSON response.",
    }
  }
}

/**
 * Adds an identified variant and validated quantity to an existing Medusa cart.
 *
 * Fails closed if:
 * - Feature flag is disabled.
 * - Missing or invalid cart ID, variant ID, or quantity.
 * - Missing backend configuration or publishable key.
 *
 * Preserves backend conflict (409) and cart-mutation-lock responses verbatim.
 * Does not retry on network timeout.
 */
export async function addLineItemToCart(
  cartId: unknown,
  variantId: unknown,
  quantity: unknown
): Promise<CartResult<SanitizedCart>> {
  if (!isCartEnabled()) {
    return {
      success: false,
      error: "disabled",
      message: "Medusa cart operations are disabled by default.",
    }
  }

  if (!isValidCartId(cartId)) {
    return {
      success: false,
      error: "invalid_cart_id",
      message: "Cart ID must be a non-empty string of up to 255 characters.",
    }
  }

  if (!isValidVariantId(variantId)) {
    return {
      success: false,
      error: "invalid_variant_id",
      message: "Variant ID must be a non-empty string of up to 255 characters.",
    }
  }

  if (!isValidQuantity(quantity)) {
    return {
      success: false,
      error: "invalid_quantity",
      message: `Quantity must be a positive integer between 1 and ${MAX_ITEM_QUANTITY}.`,
    }
  }

  const base = storeBase()
  if (!base) {
    return {
      success: false,
      error: "missing_config",
      message: "Medusa backend URL is not configured or invalid.",
    }
  }

  const key = storeKey()
  if (!key) {
    return {
      success: false,
      error: "missing_publishable_key",
      message: "Medusa publishable API key is not configured.",
    }
  }

  const endpoint = `${base}/store/carts/${encodeURIComponent(cartId.trim())}/line-items`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-publishable-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Authoritative pricing: no unit_price or currency is passed from the client
      body: JSON.stringify({
        variant_id: variantId.trim(),
        quantity: Math.trunc(quantity),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message))
    return {
      success: false,
      error: isTimeout ? "network_timeout" : "upstream_error",
      message: isTimeout
        ? "Line item addition timed out. Ambiguous POST was not retried."
        : (err as Error)?.message || "Network error contacting Medusa backend.",
    }
  }

  if (response.status === 409) {
    const errBody = await parseErrorBody(response)
    const code = errBody?.code
    if (code === "CART_MUTATIONS_LOCKED") {
      return {
        success: false,
        error: "cart_locked",
        code,
        status: 409,
        message: errBody?.message || "Cart checkout currently in progress; mutations locked.",
      }
    }
    if (code === "CART_ALREADY_COMPLETED") {
      return {
        success: false,
        error: "cart_completed",
        code,
        status: 409,
        message: errBody?.message || "Cart has already been converted to an order.",
      }
    }
    if (code === "LOCK_TIMEOUT") {
      return {
        success: false,
        error: "lock_timeout",
        code,
        status: 409,
        message: errBody?.message || "Cart checkout lock timeout.",
      }
    }
    return {
      success: false,
      error: "conflict",
      code,
      status: 409,
      message: errBody?.message || "Cart mutation conflict.",
    }
  }

  if (!response.ok) {
    const errBody = await parseErrorBody(response)
    return {
      success: false,
      error: "upstream_error",
      status: response.status,
      code: errBody?.code,
      message: errBody?.message || `Medusa returned HTTP status ${response.status}.`,
    }
  }

  try {
    const data = (await response.json()) as { cart?: unknown }
    const sanitized = sanitizeMedusaCart(data.cart)
    if (!sanitized) {
      return {
        success: false,
        error: "upstream_error",
        message: "Medusa response did not contain a valid cart payload.",
      }
    }
    return { success: true, data: sanitized }
  } catch {
    return {
      success: false,
      error: "upstream_error",
      message: "Failed to parse Medusa cart JSON response.",
    }
  }
}

/**
 * Retrieves an existing Medusa cart by ID.
 *
 * Fails closed if:
 * - Feature flag is disabled.
 * - Missing or invalid cart ID.
 * - Missing backend configuration or publishable key.
 */
export async function retrieveCart(cartId: unknown): Promise<CartResult<SanitizedCart>> {
  if (!isCartEnabled()) {
    return {
      success: false,
      error: "disabled",
      message: "Medusa cart operations are disabled by default.",
    }
  }

  if (!isValidCartId(cartId)) {
    return {
      success: false,
      error: "invalid_cart_id",
      message: "Cart ID must be a non-empty string of up to 255 characters.",
    }
  }

  const base = storeBase()
  if (!base) {
    return {
      success: false,
      error: "missing_config",
      message: "Medusa backend URL is not configured or invalid.",
    }
  }

  const key = storeKey()
  if (!key) {
    return {
      success: false,
      error: "missing_publishable_key",
      message: "Medusa publishable API key is not configured.",
    }
  }

  const endpoint = `${base}/store/carts/${encodeURIComponent(cartId.trim())}`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "x-publishable-api-key": key,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message))
    return {
      success: false,
      error: isTimeout ? "network_timeout" : "upstream_error",
      message: isTimeout
        ? "Cart retrieval timed out."
        : (err as Error)?.message || "Network error contacting Medusa backend.",
    }
  }

  if (!response.ok) {
    const errBody = await parseErrorBody(response)
    return {
      success: false,
      error: "upstream_error",
      status: response.status,
      code: errBody?.code,
      message: errBody?.message || `Medusa returned HTTP status ${response.status}.`,
    }
  }

  try {
    const data = (await response.json()) as { cart?: unknown }
    const sanitized = sanitizeMedusaCart(data.cart)
    if (!sanitized) {
      return {
        success: false,
        error: "upstream_error",
        message: "Medusa response did not contain a valid cart payload.",
      }
    }
    return { success: true, data: sanitized }
  } catch {
    return {
      success: false,
      error: "upstream_error",
      message: "Failed to parse Medusa cart JSON response.",
    }
  }
}
