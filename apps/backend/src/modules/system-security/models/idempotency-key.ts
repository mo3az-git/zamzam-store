import { model } from "@medusajs/framework/utils"

export const IdempotencyKey = model.define("idempotency_key", {
  key: model.text().primaryKey(),
  request_path: model.text(),
  request_hash: model.text(),
  status: model.enum(["pending", "completed", "failed"]).default("pending"),
  lease_owner_id: model.text(),
  workflow_execution_id: model.text().nullable(),
  order_id: model.text().nullable(),
  response_code: model.number().nullable(),
  response_body: model.json().nullable(),
  locked_at: model.dateTime(),
  last_heartbeat_at: model.dateTime(),
  expires_at: model.dateTime(),
})
