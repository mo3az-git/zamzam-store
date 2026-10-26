import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000001_CreateCartCheckoutSession extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "cart_checkout_session" (
        "cart_id" text not null,
        "current_attempt_id" text not null,
        "epoch" numeric not null default 1,
        "status" text check ("status" in ('in_progress', 'completed', 'aborted', 'failed')) not null default 'in_progress',
        "raw_epoch" jsonb not null default '{"value":"1","precision":20}',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "cart_checkout_session_pkey" primary key ("cart_id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_cart_checkout_session_deleted_at" ON "cart_checkout_session" ("deleted_at") WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "cart_checkout_session" cascade;')
  }
}
