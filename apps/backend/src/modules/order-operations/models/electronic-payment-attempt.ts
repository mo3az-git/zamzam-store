import { model } from "@medusajs/framework/utils"

export const ElectronicPaymentAttempt = model.define("electronic_payment_attempt", {
  id: model.id({ prefix: "epa" }).primaryKey(),
  order_id: model.text().nullable(),
  cart_id: model.text(),
  checkout_attempt_id: model.text().unique(),
  provider_key: model.text(),
  provider_payment_id: model.text().unique().nullable(),
  amount: model.bigNumber(),
  currency_code: model.text(),
  status: model.enum(["initiated","authorized","paid","failed","abandoned","partially_refunded","refunded","outcome_unknown","void_pending","voided"]).default("initiated"),
  idempotency_key: model.text().unique(),
  provider_reference: model.text().nullable(),
  last_provider_event_at: model.dateTime().nullable(),
  paid_at: model.dateTime().nullable(),
})
