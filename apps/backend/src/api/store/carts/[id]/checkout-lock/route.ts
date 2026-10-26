import { createHash, randomUUID } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { stage2CheckoutLockWorkflow } from "../../../../../workflows/stage2-checkout-lock-workflow"

/** Phase 1 HTTP seam for the real checkout lock stage; no commerce completion. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES !== "true") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found")
  }
  const key = req.headers["idempotency-key"]
  if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "A UUID v4 Idempotency-Key is required")
  }
  await req.scope.resolve(Modules.CART).retrieveCart(req.params.id)
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const ownerId = "worker:" + randomUUID()
  const requestHash = createHash("sha256").update(JSON.stringify({ cart_id: req.params.id, stage: "checkout_lock" })).digest("hex")
  const inserted = await pg.raw(`INSERT INTO idempotency_key
    (key, request_path, request_hash, lease_owner_id, expires_at)
    VALUES (?, ?, ?, ?, NOW() + INTERVAL '14 days')
    ON CONFLICT (key) DO NOTHING RETURNING key`, [key, req.path, requestHash, ownerId])
  if (inserted.rowCount !== 1) throw new MedusaError(MedusaError.Types.CONFLICT, "Idempotency key is already in use")
  // Timeout cleanup belongs to the actual workflow; no outer timeout cleanup
  // may hide a broken CAS in that workflow from the HTTP test.
  const { result } = await stage2CheckoutLockWorkflow(req.scope).run({
    input: { cartId: req.params.id, ownerId, timeout: 5, ttl: 120, idempotencyKey: key },
  })
  try {
    await pg.raw("DELETE FROM idempotency_key WHERE key=? AND lease_owner_id=? AND status='pending'", [key, ownerId])
  } finally {
    await req.scope.resolve(Modules.LOCKING).release(result.key, { ownerId })
  }
  res.status(200).json({ stage: "checkout_lock", acquired: true })
}
