import { model } from "@medusajs/framework/utils"

export const GuestCartOwnership = model.define("guest_cart_ownership", {
  session_hash: model.text().primaryKey(),
  cart_id: model.text().unique(),
  expires_at: model.dateTime(),
  invalidated_at: model.dateTime().nullable(),
})
