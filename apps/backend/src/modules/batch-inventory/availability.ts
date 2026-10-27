/**
 * Phase 3 — server-side, read-only batch/FEFO availability projection.
 *
 * This module is deliberately NOT mounted on a Store API route. Only a
 * publishable-key / sales-channel-scoped caller may expose these statuses
 * after it validates that each requested variant is visible to that channel.
 * It is not a stock reservation or checkout authorization.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

export type AvailabilityStatus = "available" | "unavailable" | "unknown"
export type AvailabilityRequest = Readonly<{
  variantId: string
  /** Trusted, already-aggregated demand for this variant; positive integer units. */
  requestedQuantity: number
  /** Explicit per-variant minimum remaining shelf life; unknown => fail closed. */
  minShelfLifeDays: number | null
}>
export type AvailabilityItem = Readonly<{ variantId: string; status: AvailabilityStatus }>
export type AvailabilityResponse = Readonly<{
  authority: "batch_inventory"
  items: readonly AvailabilityItem[]
}>
type Row = { variant_id?: unknown; eligible_units?: unknown }
export interface AvailabilitySql {
  raw(query: string, values: unknown[]): Promise<{ rows: Row[] }>
}

const validId = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 255 && /^[A-Za-z0-9_-]+$/.test(s)
const validDays = (d: number | null): d is number =>
  Number.isSafeInteger(d) && d !== null && d >= 0 && d <= 365
const validRequestedQuantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000

/**
 * Produces a presentational status only. A positive read is provisional:
 * reservations can change immediately after this snapshot.
 *
 * Mandatory location scope: verified custom inventory_location IDs for the
 * publishable-key permitted sales channel. The function intentionally does not
 * infer mappings to Medusa stock locations. Callers may not provide browser IDs.
 *
 * Mandatory inputs: backend-verified variant ID and its actual shelf-life
 * policy. A missing policy is "unknown", NEVER defaulted to zero days.
 *
 * Inputs are bounded, deduplicated and parameterized. SQL uses the same Cairo
 * date boundary, supplier/location active checks and strict expiry exclusion
 * as the FEFO reservation predicate in ledger.ts.
 */
export async function readBatchAvailability(
  db: AvailabilitySql,
  requests: readonly AvailabilityRequest[],
  /** Mandatory custom inventory_location IDs from a separately verified Store sales-channel location mapping. */
  authorizedLocationIds: readonly string[]
): Promise<AvailabilityResponse> {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 100) {
    throw new TypeError("Expected 1..100 availability requests")
  }
  const seen = new Set<string>()
  for (const request of requests) {
    if (!request || !validId(request.variantId) || seen.has(request.variantId) ||
      !validRequestedQuantity(request.requestedQuantity) ||
      !(request.minShelfLifeDays === null || validDays(request.minShelfLifeDays))) {
      throw new TypeError("Invalid or duplicate availability request")
    }
    seen.add(request.variantId)
  }

  const qualified = requests.filter((request): request is
    AvailabilityRequest & { minShelfLifeDays: number } => validDays(request.minShelfLifeDays))
  const unknown = (): AvailabilityResponse => ({
    authority: "batch_inventory",
    items: requests.map((request) => ({ variantId: request.variantId, status: "unknown" })),
  })
  // A publishable-key scope alone is insufficient: physical inventory locations
  // must be explicitly mapped to this Store sales channel. Missing, duplicate or
  // invalid location scope means UNKNOWN, never an unfiltered stock lookup.
  if (!Array.isArray(authorizedLocationIds) ||
      authorizedLocationIds.length < 1 || authorizedLocationIds.length > 100 ||
      new Set(authorizedLocationIds).size !== authorizedLocationIds.length ||
      authorizedLocationIds.some((id) => !validId(id))) return unknown()
  if (!qualified.length) return unknown()

  const placeholders = qualified.map(() => "(?::text, ?::integer)").join(",")
  // Never return quantities, lot identities, expiry dates or supplier details.
  // The query reads a snapshot. It DOES NOT lock or claim batch stock.
  const sql = `WITH requested (variant_id, shelf_days) AS (VALUES ${placeholders})
    SELECT requested.variant_id,
      COALESCE(SUM(CASE
        WHEN batch.status = 'available'
         AND supplier.is_active IS TRUE
         AND location.is_active IS TRUE
         AND location.id = ANY(?::text[])
         AND batch.expiration_date >
          ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date
             + (requested.shelf_days * INTERVAL '1 day'))
        THEN GREATEST(batch.quantity_on_hand - batch.quantity_reserved -
                      batch.quantity_quarantined, 0)
        ELSE 0
      END), 0)::text AS eligible_units
    FROM requested
    LEFT JOIN inventory_batch batch ON batch.variant_id = requested.variant_id
    LEFT JOIN supplier ON supplier.id = batch.supplier_id
    LEFT JOIN inventory_location location ON location.id = batch.location_id
    GROUP BY requested.variant_id`
  const params = [...qualified.flatMap((request) => [request.variantId, request.minShelfLifeDays]), authorizedLocationIds]
  try {
    const result = await db.raw(sql, params)
    if (!result || !Array.isArray(result.rows)) return unknown()
    const quantities = new Map<string, bigint>()
    for (const row of result.rows) {
      if (!row || typeof row.variant_id !== "string" ||
        !seen.has(row.variant_id) || quantities.has(row.variant_id) ||
        typeof row.eligible_units !== "string" || !/^\d+$/.test(row.eligible_units)) {
        return unknown()
      }
      quantities.set(row.variant_id, BigInt(row.eligible_units))
    }
    return {
      authority: "batch_inventory",
      items: requests.map((request) => ({
        variantId: request.variantId,
        status: !validDays(request.minShelfLifeDays) || !quantities.has(request.variantId)
          ? "unknown"
          : quantities.get(request.variantId)! >= BigInt(request.requestedQuantity) ? "available" : "unavailable",
      })),
    }
  } catch {
    // Missing migration or transient DB problem must not claim "out of stock".
    return unknown()
  }
}

/**
 * Internal backend entry point for trusted coordinators. The caller must derive
 * authorized inventory locations and visible variants server-side; never pass
 * browser-supplied IDs. This read is advisory: reservation must still be
 * enforced atomically by InventoryLedger.
 */
export async function readAuthoritativeBatchAvailability(
  container: MedusaContainer,
  requests: readonly AvailabilityRequest[],
  authorizedLocationIds: readonly string[]
): Promise<AvailabilityResponse> {
  let db: AvailabilitySql
  try {
    db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as AvailabilitySql
  } catch {
    // Route configuration failures through the same fail-closed unknown result
    // as query outages while retaining request validation in the core reader.
    db = { raw: async () => { throw new Error("Inventory database is unavailable") } }
  }
  return readBatchAvailability(db, requests, authorizedLocationIds)
}
