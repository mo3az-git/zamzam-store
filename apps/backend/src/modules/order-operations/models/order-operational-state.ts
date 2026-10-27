import { model } from "@medusajs/framework/utils"

export const OrderOperationalState = model.define("order_operational_state", {
  id: model.id({ prefix: "oop" }).primaryKey(),
  order_id: model.text().unique(),
  payment_method: model.enum(["electronic", "cod"]),
  claim_code_hash: model.text(),
  operational_status: model.enum(["new","confirmed","in_preparation","shipped","delivered","completed","cancelled","undelivered_returned","return_in_progress","partially_returned","fully_returned"]).default("new"),
  fulfillment_status: model.enum(["unfulfilled","preparing","shipped","delivered","failed_attempt","returned_to_warehouse"]).default("unfulfilled"),
  last_status_change_at: model.dateTime(),
  notes: model.text().nullable(),
})
