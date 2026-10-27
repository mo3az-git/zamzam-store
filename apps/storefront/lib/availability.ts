/**
 * Product Availability Presentation Types & Helpers (Phase 3)
 *
 * Strictly follows the contract proposed in `contracts/mvp-interface-v1.schema.json`:
 * status is one of "available" | "unavailable" | "unknown".
 *
 * Guarantees:
 * - Defaults to "unknown" on missing, null, or invalid status.
 * - Does not invent stock counts or make guaranteed availability promises.
 * - Ready to consume the future authorized batch inventory endpoint.
 */

export const AVAILABILITY_STATUSES = ["available", "unavailable", "unknown"] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export function isValidAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && (AVAILABILITY_STATUSES as readonly string[]).includes(value)
}

/**
 * Normalizes any raw status into an authoritative contract status.
 * Missing, malformed, or unrecognized inputs strictly fail-safe to "unknown".
 */
export function normalizeAvailabilityStatus(status: unknown): AvailabilityStatus {
  if (typeof status === "string") {
    const trimmed = status.trim().toLowerCase()
    if (trimmed === "available") return "available"
    if (trimmed === "unavailable") return "unavailable"
    if (trimmed === "unknown") return "unknown"
  }
  return "unknown"
}

/**
 * Interface matching `availabilityItem` from `contracts/mvp-interface-v1.schema.json`.
 */
export interface AvailabilityItem {
  variantId: string
  status: AvailabilityStatus
}

/**
 * Interface matching `availabilityResponse` from `contracts/mvp-interface-v1.schema.json`.
 */
export interface AvailabilityResponse {
  authority: "batch_inventory"
  items: AvailabilityItem[]
}
