import { model } from "@medusajs/framework/utils"

/** Monotonic server-owned version metadata for native carts. */
export const CartBffState = model.define("cart_bff_state", {
  cart_id: model.text().primaryKey(),
  version: model.bigNumber().default(1),
  native_fingerprint: model.text(),
  pending_request_id: model.text().nullable(),
})
