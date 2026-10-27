import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261027000009_CreateCartBffStateAndIdempotency extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE cart_bff_state (
        cart_id varchar(255) PRIMARY KEY,
        version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
        native_fingerprint varchar(128) NOT NULL,
        pending_request_id varchar(128) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE cart_bff_idempotency (
        id varchar(255) PRIMARY KEY,
        owner_key varchar(64) NOT NULL CHECK (owner_key ~ '^[0-9a-f]{64}$'),
        request_id varchar(128) NOT NULL,
        fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
        status varchar(16) NOT NULL CHECK (status IN ('in_progress','completed','failed')),
        response jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner_key, request_id),
        CHECK ((status = 'completed' AND response IS NOT NULL) OR status <> 'completed')
      );
      CREATE INDEX idx_cart_bff_idempotency_updated ON cart_bff_idempotency(updated_at);
    `)
  }

  async down(): Promise<void> {
    this.addSql("DROP TABLE cart_bff_idempotency; DROP TABLE cart_bff_state;")
  }
}
