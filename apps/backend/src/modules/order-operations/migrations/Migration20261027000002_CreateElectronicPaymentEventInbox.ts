import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Durable provider-neutral inbox for already-authenticated electronic events.
 * Stores normalized identity only, never raw provider payload or secrets.
 */
export class Migration20261027000002_CreateElectronicPaymentEventInbox extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "electronic_payment_event" (
        "id" varchar(255) not null primary key,
        "provider_key" varchar(100) not null,
        "provider_event_id" varchar(255) not null,
        "electronic_payment_attempt_id" varchar(255) not null,
        "checkout_attempt_id" varchar(255) not null,
        "order_id" varchar(255) not null,
        "provider_payment_id" varchar(255) not null,
        "status" varchar(40) not null check ("status" in ('authorized','paid','failed','abandoned','outcome_unknown','void_pending','voided','partially_refunded','refunded')),
        "amount_minor" numeric(14,0) not null check ("amount_minor" > 0),
        "currency_code" char(3) not null check ("currency_code" = 'EGP'),
        "occurred_at" timestamptz not null,
        "provider_revision" varchar(100) null check ("provider_revision" is null or "provider_revision" ~ '^(0|[1-9][0-9]*)$'),
        "event_digest" char(64) not null check ("event_digest" ~ '^[0-9a-f]{64}$'),
        "disposition" varchar(32) not null check ("disposition" in ('applied','stale','needs_reconciliation')),
        "created_at" timestamptz not null default now(),
        constraint "UQ_electronic_payment_event_provider_event" unique ("provider_key","provider_event_id")
      );
      create index if not exists "IDX_electronic_payment_event_attempt"
        on "electronic_payment_event" ("electronic_payment_attempt_id","created_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "electronic_payment_event";')
  }
}
