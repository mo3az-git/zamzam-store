import { model } from "@medusajs/framework/utils"

export const CartBatchReservation = model.define("cart_batch_reservation", {
  id: model.id({ prefix: "cbr" }).primaryKey(),
  checkout_attempt_id: model.text(),
  cart_id: model.text(),
  checkout_line_key: model.text(),
  checkout_epoch: model.number().default(1),
  cart_line_item_id: model.text(),
  variant_id: model.text(),
  batch_id: model.text(),
  quantity: model.number(),
  unit_cost_snapshot: model.bigNumber(),
  status: model
    .enum(["active", "converted", "released", "expired"])
    .default("active"),
  expires_at: model.dateTime(),
  converted_at: model.dateTime().nullable(),
})
