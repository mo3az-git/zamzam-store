import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000002_AddCartCheckoutSessionSemanticGuards extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cart_checkout_session"
        ADD CONSTRAINT "chk_ccs_status"
        CHECK ("status" IN ('in_progress', 'completed', 'aborted', 'failed'));

      ALTER TABLE "cart_checkout_session"
        ADD CONSTRAINT "chk_ccs_current_attempt_id_uuid"
        CHECK ("current_attempt_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

      ALTER TABLE "cart_checkout_session"
        ADD CONSTRAINT "chk_ccs_cart_id_len"
        CHECK (char_length("cart_id") <= 255);

      ALTER TABLE "cart_checkout_session"
        ADD CONSTRAINT "chk_ccs_epoch_positive_integer"
        CHECK ("epoch" >= 1 AND "epoch" = floor("epoch"));
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_status";
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_current_attempt_id_uuid";
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_cart_id_len";
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_epoch_positive_integer";
    `)
  }
}
