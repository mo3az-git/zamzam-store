import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000006_CreateInventoryLedger extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE supplier (
        id varchar(255) PRIMARY KEY, name varchar(255) NOT NULL,
        contact_email varchar(255), contact_phone varchar(50), country_code varchar(2) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE inventory_location (
        id varchar(255) PRIMARY KEY, name varchar(255) NOT NULL, address_line1 varchar(255) NOT NULL,
        governorate_code varchar(50) NOT NULL, is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE inventory_batch (
        id varchar(255) PRIMARY KEY, variant_id varchar(255) NOT NULL,
        location_id varchar(255) NOT NULL REFERENCES inventory_location(id),
        supplier_id varchar(255) NOT NULL REFERENCES supplier(id),
        batch_number varchar(100) NOT NULL, supplier_invoice_reference varchar(255) NOT NULL,
        receipt_operation_id uuid NOT NULL UNIQUE, production_date date, expiration_date date NOT NULL,
        status varchar(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available','quarantined','expired','exhausted')),
        quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
        quantity_reserved integer NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
        quantity_quarantined integer NOT NULL DEFAULT 0 CHECK (quantity_quarantined >= 0),
        purchase_currency varchar(3) NOT NULL DEFAULT 'EGP',
        purchase_price_raw numeric(12,4) NOT NULL CHECK (purchase_price_raw > 0),
        exchange_rate_to_egp numeric(12,4) NOT NULL,
        rate_determination_policy varchar(64) NOT NULL DEFAULT 'customs_clearance_date',
        unit_cost_purchase numeric(12,4) NOT NULL CHECK (unit_cost_purchase > 0),
        unit_cost_allocated numeric(12,4) NOT NULL DEFAULT 0,
        unit_cost_final numeric(12,4) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_batch_tri_balance CHECK (quantity_on_hand >= quantity_reserved + quantity_quarantined),
        CONSTRAINT chk_batch_exchange_rate CHECK ((purchase_currency='EGP' AND exchange_rate_to_egp=1) OR (purchase_currency<>'EGP' AND exchange_rate_to_egp>0)),
        CONSTRAINT chk_batch_unit_cost_final CHECK (unit_cost_final=unit_cost_purchase+unit_cost_allocated)
      );
      CREATE INDEX idx_batch_fefo ON inventory_batch(variant_id,status,expiration_date,id);
      CREATE INDEX idx_batch_exp_mon ON inventory_batch(status,expiration_date);

      CREATE TABLE cart_checkout_attempt (
        checkout_attempt_id uuid PRIMARY KEY,
        cart_id varchar(255) NOT NULL REFERENCES cart_checkout_session(cart_id),
        epoch bigint NOT NULL CHECK (epoch >= 1), idempotency_key varchar(255) NOT NULL,
        payment_method varchar(32) NOT NULL CHECK (payment_method IN ('electronic','cod')),
        lease_owner_id varchar(255) NOT NULL,
        attempt_status varchar(50) NOT NULL DEFAULT 'initiated' CHECK (attempt_status IN ('initiated','reserved','order_creation_started','order_created','allocated','completed','needs_reconciliation','aborted','failed')),
        order_id varchar(255) UNIQUE,
        order_correlation_status varchar(50) NOT NULL DEFAULT 'none' CHECK (order_correlation_status IN ('none','pending_correlation','correlated','needs_reconciliation','cancelled')),
        failure_reason text, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        CONSTRAINT uq_attempt_cart_epoch UNIQUE (cart_id,epoch)
      );
      CREATE INDEX idx_cca_status ON cart_checkout_attempt(cart_id,attempt_status);
      CREATE INDEX idx_cca_order ON cart_checkout_attempt(order_id);

      ALTER TABLE cart_batch_reservation ADD CONSTRAINT fk_cbr_batch FOREIGN KEY (batch_id) REFERENCES inventory_batch(id);
    `)
    const balances = ["on_hand", "reserved", "quarantined"]
    const movementTypes = ["receipt", "reservation", "reservation_release", "allocation_conversion", "fulfillment", "return_quarantine", "return_restock", "damage_writeoff", "expiry_quarantine", "manual_correction"]
    const references = ["receipt", "cart_reservation", "cleanup", "saga_cancel", "order_allocation", "fulfillment", "return_quarantine", "return_restock", "damage_writeoff", "expiry_quarantine", "manual_correction"]
    const quoted = (values: string[]) => values.map((value) => "'" + value + "'").join(",")
    const deltas = balances.map((name) => `quantity_${name}_delta integer NOT NULL DEFAULT 0`).join(",")
    const snapshots = balances.flatMap((name) => ["before", "after"].map((when) => `quantity_${name}_${when} integer NOT NULL`)).join(",")
    this.addSql(`
      CREATE TABLE inventory_movement (
        id varchar(40) PRIMARY KEY CHECK (id ~ '^mov_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
        deduplication_key varchar(128) NOT NULL UNIQUE,
        batch_id varchar(255) NOT NULL REFERENCES inventory_batch(id), variant_id varchar(255) NOT NULL,
        movement_type varchar(50) NOT NULL CHECK (movement_type IN (${quoted(movementTypes)})),
        ${deltas}, ${snapshots},
        reference_type varchar(50) NOT NULL CHECK (reference_type IN (${quoted(references)})),
        reference_id varchar(255) NOT NULL, reason text, actor_id varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_movement_key_format CHECK (deduplication_key ~ ('^inv:v1:' || movement_type || ':[0-9a-f]{64}$')),
        CONSTRAINT chk_movement_delta_nonzero CHECK (movement_type='allocation_conversion' OR quantity_on_hand_delta<>0 OR quantity_reserved_delta<>0 OR quantity_quarantined_delta<>0),
        CONSTRAINT chk_movement_snapshots_arithmetic CHECK (${balances.map((name) => `quantity_${name}_after=quantity_${name}_before+quantity_${name}_delta`).join(" AND ")}),
        CONSTRAINT chk_movement_snapshots_nonnegative CHECK (${balances.flatMap((name) => ["before", "after"].map((when) => `quantity_${name}_${when}>=0`)).join(" AND ")}),
        CONSTRAINT chk_movement_snapshots_tri_balance CHECK (quantity_on_hand_before>=quantity_reserved_before+quantity_quarantined_before AND quantity_on_hand_after>=quantity_reserved_after+quantity_quarantined_after),
        CONSTRAINT chk_movement_reason CHECK (movement_type NOT IN ('manual_correction','damage_writeoff') OR (reason IS NOT NULL AND length(trim(reason))>0)),
        CONSTRAINT chk_movement_delta_semantics CHECK (
          (movement_type='receipt' AND quantity_on_hand_delta>0 AND quantity_reserved_delta=0 AND quantity_quarantined_delta=0) OR
          (movement_type='reservation' AND quantity_on_hand_delta=0 AND quantity_reserved_delta>0 AND quantity_quarantined_delta=0) OR
          (movement_type='reservation_release' AND quantity_on_hand_delta=0 AND quantity_reserved_delta<0 AND quantity_quarantined_delta=0) OR
          (movement_type='allocation_conversion' AND quantity_on_hand_delta=0 AND quantity_reserved_delta=0 AND quantity_quarantined_delta=0) OR
          (movement_type='fulfillment' AND quantity_on_hand_delta<0 AND quantity_on_hand_delta=quantity_reserved_delta AND quantity_quarantined_delta=0) OR
          (movement_type='return_quarantine' AND quantity_on_hand_delta>0 AND quantity_on_hand_delta=quantity_quarantined_delta AND quantity_reserved_delta=0) OR
          (movement_type='return_restock' AND quantity_on_hand_delta=0 AND quantity_reserved_delta=0 AND quantity_quarantined_delta<0) OR
          (movement_type='damage_writeoff' AND quantity_on_hand_delta<0 AND quantity_on_hand_delta=quantity_quarantined_delta AND quantity_reserved_delta=0) OR
          (movement_type='expiry_quarantine' AND quantity_on_hand_delta=0 AND quantity_reserved_delta=0 AND quantity_quarantined_delta>0) OR
          movement_type='manual_correction'
        )
      );
      CREATE INDEX idx_movement_batch ON inventory_movement(batch_id,created_at);
      CREATE INDEX idx_movement_ref ON inventory_movement(reference_type,reference_id);
      CREATE FUNCTION trg_enforce_inventory_movement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION USING MESSAGE='INVENTORY_MOVEMENT_IMMUTABLE: UPDATE and DELETE are prohibited', ERRCODE='P0001';
      END; $$;
      CREATE TRIGGER trg_inventory_movement_immutable BEFORE UPDATE OR DELETE ON inventory_movement
        FOR EACH ROW EXECUTE FUNCTION trg_enforce_inventory_movement_immutable();

      CREATE FUNCTION guard_checkout_attempt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.checkout_attempt_id,NEW.cart_id,NEW.epoch,NEW.idempotency_key,NEW.payment_method,NEW.created_at)
           IS DISTINCT FROM (OLD.checkout_attempt_id,OLD.cart_id,OLD.epoch,OLD.idempotency_key,OLD.payment_method,OLD.created_at)
           OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id) THEN
          RAISE EXCEPTION 'CHECKOUT_ATTEMPT_IDENTITY_IMMUTABLE';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER trg_checkout_attempt_identity BEFORE UPDATE ON cart_checkout_attempt
        FOR EACH ROW EXECUTE FUNCTION guard_checkout_attempt_identity();
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE cart_batch_reservation DROP CONSTRAINT fk_cbr_batch;
      DROP TABLE inventory_movement;
      DROP FUNCTION trg_enforce_inventory_movement_immutable();
      DROP TABLE inventory_batch;
      DROP TABLE inventory_location;
      DROP TABLE supplier;
      DROP TABLE cart_checkout_attempt;
      DROP FUNCTION guard_checkout_attempt_identity();
    `)
  }
}
