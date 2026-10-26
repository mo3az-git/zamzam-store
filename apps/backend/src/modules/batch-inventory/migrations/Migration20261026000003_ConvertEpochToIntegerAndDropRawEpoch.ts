import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261026000003_ConvertEpochToIntegerAndDropRawEpoch extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_epoch_positive_integer";
      ALTER TABLE "cart_checkout_session" ALTER COLUMN "epoch" TYPE integer USING ("epoch"::integer);
      ALTER TABLE "cart_checkout_session" DROP COLUMN IF EXISTS "raw_epoch";
      ALTER TABLE "cart_checkout_session" ADD CONSTRAINT "chk_ccs_epoch_positive" CHECK ("epoch" >= 1);
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cart_checkout_session" DROP CONSTRAINT IF EXISTS "chk_ccs_epoch_positive";
      ALTER TABLE "cart_checkout_session" ADD COLUMN IF NOT EXISTS "raw_epoch" jsonb;
      UPDATE "cart_checkout_session" SET "raw_epoch" = jsonb_build_object('value', "epoch"::text, 'precision', 20);
      ALTER TABLE "cart_checkout_session" ALTER COLUMN "raw_epoch" SET DEFAULT '{"value":"1","precision":20}'::jsonb;
      ALTER TABLE "cart_checkout_session" ALTER COLUMN "raw_epoch" SET NOT NULL;
      ALTER TABLE "cart_checkout_session" ALTER COLUMN "epoch" TYPE numeric USING ("epoch"::numeric);
      ALTER TABLE "cart_checkout_session" ADD CONSTRAINT "chk_ccs_epoch_positive_integer" CHECK ("epoch" >= 1 AND "epoch" = floor("epoch"));
    `)
  }
}
