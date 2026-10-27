/**
 * Server-Verified QA Preview Gate (Phase 4.3 MVP)
 *
 * Gated strictly by server environment variables:
 * - VERCEL_ENV === "preview"
 * - ZAMZAM_SYNTHETIC_PREVIEW === "true"
 *
 * Browser-controlled parameters (such as `?preview=...`) alone NEVER authorize
 * simulated purchasing or interactive checkout simulation.
 */

export function isServerQaPreview(): boolean {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.ZAMZAM_SYNTHETIC_PREVIEW === "true"
  )
}
