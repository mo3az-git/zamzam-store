import { model } from "@medusajs/framework/utils"

export const OrderBatchAllocation = model.define("order_batch_allocation", {
  id: model.id({ prefix: "alloc" }).primaryKey(),
  order_id: model.text(),
  order_version: model.bigNumber(),
  line_item_id: model.text(),
  checkout_line_key: model.text(),
  batch_id: model.text(),
  quantity_allocated: model.number(),
  paid_unit_amount_after_discounts_snapshot: model.bigNumber(),
  allocation_status: model.enum(["allocated", "fulfilled", "released"]).default("allocated"),
  allocated_at: model.dateTime(),
})
