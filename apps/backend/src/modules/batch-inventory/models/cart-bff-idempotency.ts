import { model } from "@medusajs/framework/utils"

/** Durable owner-scoped journal; in-progress rows fail closed after crashes. */
export const CartBffIdempotency = model.define("cart_bff_idempotency", {
  id: model.id({ prefix: "cbi" }).primaryKey(),
  owner_key: model.text(),
  request_id: model.text(),
  fingerprint: model.text(),
  status: model.enum(["in_progress", "completed", "failed"]),
  response: model.json().nullable(),
})
