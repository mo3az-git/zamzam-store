import { model } from "@medusajs/framework/utils"

export const CodCollectionRecord = model.define("cod_collection_record", {
  id: model.id({ prefix: "cod" }).primaryKey(),
  order_id: model.text().unique(),
  expected_amount: model.bigNumber(),
  collected_amount: model.bigNumber().default(0),
  collection_status: model.enum(["unpaid","collected_by_carrier","remitted_to_bank","partially_refunded","fully_refunded","collection_failed","cancelled"]).default("unpaid"),
  collected_at: model.dateTime().nullable(),
  remitted_at: model.dateTime().nullable(),
  courier_settlement_reference: model.text().nullable(),
  notes: model.text().nullable(),
})
