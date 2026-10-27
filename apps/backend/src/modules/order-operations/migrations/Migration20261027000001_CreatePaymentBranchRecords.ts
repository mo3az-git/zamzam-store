import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Provider-neutral Phase 1 payment branch prototype. No real provider or
 * payment authorization is invoked by creating these durable records.
 * order_id remains a cross-module string reference per Phase 0 data model.
 */
export class Migration20261027000001_CreatePaymentBranchRecords extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "order_operational_state" (
        "id" varchar(255) not null primary key,
        "order_id" varchar(255) not null unique,
        "payment_method" varchar(32) not null check ("payment_method" in ('electronic','cod')),
        "claim_code_hash" varchar(64) not null check ("claim_code_hash" ~ '^[0-9a-f]{64}$'),
        "operational_status" varchar(50) not null default 'new'
          check ("operational_status" in ('new','confirmed','in_preparation','shipped','delivered','completed','cancelled','undelivered_returned','return_in_progress','partially_returned','fully_returned')),
        "fulfillment_status" varchar(50) not null default 'unfulfilled'
          check ("fulfillment_status" in ('unfulfilled','preparing','shipped','delivered','failed_attempt','returned_to_warehouse')),
        "last_status_change_at" timestamptz not null default now(),
        "notes" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null
      );
      create index if not exists "IDX_order_operational_state_deleted_at" on "order_operational_state" ("deleted_at") where deleted_at is null;

      create table if not exists "cod_collection_record" (
        "id" varchar(255) not null primary key,
        "order_id" varchar(255) not null unique,
        "expected_amount" numeric(12,2) not null check ("expected_amount" > 0),
        "collected_amount" numeric(12,2) not null default 0 check ("collected_amount" >= 0),
        "collection_status" varchar(50) not null default 'unpaid'
          check ("collection_status" in ('unpaid','collected_by_carrier','remitted_to_bank','partially_refunded','fully_refunded','collection_failed','cancelled')),
        "collected_at" timestamptz null,
        "remitted_at" timestamptz null,
        "courier_settlement_reference" varchar(100) null,
        "notes" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null
      );
      create index if not exists "IDX_cod_collection_record_deleted_at" on "cod_collection_record" ("deleted_at") where deleted_at is null;

      create table if not exists "electronic_payment_attempt" (
        "id" varchar(255) not null primary key,
        "order_id" varchar(255) null,
        "cart_id" varchar(255) not null,
        "checkout_attempt_id" varchar(255) not null unique,
        "provider_key" varchar(100) not null,
        "provider_payment_id" varchar(255) null unique,
        "amount" numeric(12,2) not null check ("amount" > 0),
        "currency_code" char(3) not null default 'EGP',
        "status" varchar(40) not null default 'initiated'
          check ("status" in ('initiated','authorized','paid','failed','abandoned','partially_refunded','refunded','outcome_unknown','void_pending','voided')),
        "idempotency_key" varchar(255) not null unique,
        "provider_reference" varchar(255) null,
        "last_provider_event_at" timestamptz null,
        "paid_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null
      );
      create index if not exists "idx_epa_order_id" on "electronic_payment_attempt" ("order_id");
      create index if not exists "IDX_electronic_payment_attempt_deleted_at" on "electronic_payment_attempt" ("deleted_at") where deleted_at is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "electronic_payment_attempt";')
    this.addSql('drop table if exists "cod_collection_record";')
    this.addSql('drop table if exists "order_operational_state";')
  }
}
