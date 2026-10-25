import { model } from "@medusajs/framework/utils"

export const CartCheckoutSession = model.define("cart_checkout_session", {
  cart_id: model.text().primaryKey(),
  current_attempt_id: model.text(),
  epoch: model.bigNumber().default(1),
  status: model
    .enum(["in_progress", "completed", "aborted", "failed"])
    .default("in_progress"),
})
