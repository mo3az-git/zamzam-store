import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261027000002_ImmutableCheckoutCompletion extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE OR REPLACE FUNCTION protect_completed_checkout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status='completed' AND OLD.request_path LIKE '/store/carts/%/complete' THEN
          IF TG_OP='DELETE' THEN
            -- An orphaned synthetic completed lease with no order, response,
            -- or attempt is not a checkout completion identity.
            IF OLD.order_id IS NULL AND OLD.response_body IS NULL AND NOT EXISTS
              (SELECT 1 FROM cart_checkout_attempt WHERE idempotency_key=OLD.key) THEN RETURN OLD; END IF;
            RAISE EXCEPTION 'COMPLETED_CHECKOUT_IDENTITY_IMMUTABLE';
          END IF;
          IF NEW.key IS DISTINCT FROM OLD.key OR NEW.status IS DISTINCT FROM OLD.status OR
             NEW.request_path IS DISTINCT FROM OLD.request_path OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
             NEW.lease_owner_id IS DISTINCT FROM OLD.lease_owner_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR
             NEW.response_code IS DISTINCT FROM OLD.response_code OR NEW.response_body IS DISTINCT FROM OLD.response_body OR
             NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
            RAISE EXCEPTION 'COMPLETED_CHECKOUT_IDENTITY_IMMUTABLE';
          END IF;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_completed_checkout_identity
        BEFORE UPDATE OR DELETE ON idempotency_key
        FOR EACH ROW EXECUTE FUNCTION protect_completed_checkout_identity();
    `)
  }
  async down(): Promise<void> {
    this.addSql(`DROP TRIGGER IF EXISTS trg_completed_checkout_identity ON idempotency_key;
      DROP FUNCTION IF EXISTS protect_completed_checkout_identity();`)
  }
}
