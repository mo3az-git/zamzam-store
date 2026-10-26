import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000004_CreateCartBatchReservation extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "cart_batch_reservation" (
        "id" text not null,
        "checkout_attempt_id" text not null,
        "cart_id" text not null,
        "checkout_line_key" text not null,
        "checkout_epoch" integer not null default 1,
        "cart_line_item_id" text not null,
        "variant_id" text not null,
        "batch_id" text not null,
        "quantity" integer not null,
        "unit_cost_snapshot" numeric(12, 4) not null,
        "raw_unit_cost_snapshot" jsonb null,
        "status" text not null default 'active',
        "expires_at" timestamptz not null,
        "converted_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "cart_batch_reservation_pkey" primary key ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_cbr_attempt_line_batch" ON "cart_batch_reservation" ("checkout_attempt_id", "checkout_line_key", "batch_id");
      CREATE INDEX IF NOT EXISTS "idx_cbr_cart_epoch" ON "cart_batch_reservation" ("cart_id", "checkout_epoch", "status");
      CREATE INDEX IF NOT EXISTS "idx_cbr_cleanup" ON "cart_batch_reservation" ("status", "expires_at");
      CREATE INDEX IF NOT EXISTS "IDX_cart_batch_reservation_deleted_at" ON "cart_batch_reservation" ("deleted_at") WHERE deleted_at IS NULL;

      ALTER TABLE "cart_batch_reservation"
        ADD CONSTRAINT "chk_cbr_quantity" CHECK ("quantity" > 0),
        ADD CONSTRAINT "chk_cbr_status" CHECK ("status" IN ('active', 'converted', 'released', 'expired')),
        ADD CONSTRAINT "chk_cbr_attempt_id_uuid" CHECK ("checkout_attempt_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        ADD CONSTRAINT "chk_cbr_line_key_uuid" CHECK ("checkout_line_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        ADD CONSTRAINT "chk_cbr_epoch_positive" CHECK ("checkout_epoch" >= 1),
        ADD CONSTRAINT "chk_cbr_cart_id_len" CHECK (char_length("cart_id") <= 255),
        ADD CONSTRAINT "chk_cbr_id_len" CHECK (char_length("id") <= 255);
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "cart_batch_reservation" cascade;')
  }
}
