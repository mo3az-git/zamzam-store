import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000005_CreateIdempotencyKey extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "idempotency_key" (
        "key" text not null,
        "request_path" text not null,
        "request_hash" varchar(64) not null,
        "status" text not null default 'pending',
        "lease_owner_id" text not null,
        "workflow_execution_id" text null,
        "order_id" text null,
        "response_code" integer null,
        "response_body" jsonb null,
        "locked_at" timestamptz not null default now(),
        "last_heartbeat_at" timestamptz not null default now(),
        "expires_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "idempotency_key_pkey" primary key ("key"),
        constraint "chk_idempotency_key_status"
          check ("status" in ('pending', 'completed', 'failed')),
        constraint "chk_idempotency_key_uuid"
          check ("key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        constraint "chk_idempotency_request_hash_sha256"
          check ("request_hash" ~* '^[0-9a-f]{64}$'),
        constraint "chk_idempotency_key_len" check (char_length("key") <= 255),
        constraint "chk_idempotency_request_path_len" check (char_length("request_path") <= 255),
        constraint "chk_idempotency_lease_owner_len" check (char_length("lease_owner_id") <= 255)
      );

      create index if not exists "idx_idempotency_key_expiry"
        on "idempotency_key" ("expires_at") where "deleted_at" is null;
      create index if not exists "IDX_idempotency_key_deleted_at"
        on "idempotency_key" ("deleted_at") where "deleted_at" is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "idempotency_key" cascade;')
  }
}
