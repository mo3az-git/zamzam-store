import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000000_CreateCartCheckoutSession extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cart_checkout_session" (
        "cart_id" VARCHAR(255) NOT NULL,
        "current_attempt_id" UUID NOT NULL,
        "epoch" BIGINT NOT NULL DEFAULT 1,
        "status" VARCHAR(32) NOT NULL DEFAULT 'in_progress',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "cart_checkout_session_pkey" PRIMARY KEY ("cart_id"),
        CONSTRAINT "chk_ccs_status" CHECK ("status" IN ('in_progress', 'completed', 'aborted', 'failed'))
      );
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "cart_checkout_session" CASCADE;')
  }
}
