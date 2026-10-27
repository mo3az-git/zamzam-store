import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261027000007_CreateOrderBatchAllocation extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE order_batch_allocation (
        id varchar(255) PRIMARY KEY CHECK (id ~ '^alloc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
        order_id varchar(255) NOT NULL,
        order_version bigint NOT NULL CHECK (order_version >= 1),
        line_item_id varchar(255) NOT NULL,
        checkout_line_key uuid NOT NULL,
        batch_id varchar(255) NOT NULL REFERENCES inventory_batch(id),
        quantity_allocated integer NOT NULL CHECK (quantity_allocated > 0),
        paid_unit_amount_after_discounts_snapshot numeric(12,2) NOT NULL CHECK (paid_unit_amount_after_discounts_snapshot >= 0),
        allocation_status varchar(50) NOT NULL DEFAULT 'allocated' CHECK (allocation_status IN ('allocated','fulfilled','released')),
        allocated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_oba_order_version_line_batch UNIQUE (order_id,order_version,line_item_id,batch_id)
      );
      CREATE INDEX idx_oba_order_line ON order_batch_allocation(order_id,line_item_id);
      CREATE INDEX idx_oba_batch ON order_batch_allocation(batch_id,allocation_status);
      CREATE INDEX idx_oba_checkout_line ON order_batch_allocation(order_id,order_version,checkout_line_key);
    `)
  }

  async down(): Promise<void> {
    this.addSql("DROP TABLE order_batch_allocation;")
  }
}
