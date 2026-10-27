import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261027000008_CreateGuestCartOwnership extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE guest_cart_ownership (
        session_hash varchar(255) PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
        cart_id varchar(255) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        invalidated_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_guest_cart_ownership_expiry ON guest_cart_ownership(expires_at);
    `)
  }

  async down(): Promise<void> {
    this.addSql("DROP TABLE guest_cart_ownership;")
  }
}
