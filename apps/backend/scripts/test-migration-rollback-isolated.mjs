import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "../..");

const require = createRequire(import.meta.url);
const { Client: PgClient } = require("pg");

const rootRequire = createRequire(path.join(repositoryRoot, "package.json"));
rootRequire("ts-node").register({
  project: path.join(backendRoot, "tsconfig.json"),
  transpileOnly: true,
});

const { Migration20261026000001_CreateCartCheckoutSession } = rootRequire(
  path.join(backendRoot, "src", "modules", "batch-inventory", "migrations", "Migration20261026000001_CreateCartCheckoutSession.ts")
);
const { Migration20261026000002_AddCartCheckoutSessionSemanticGuards } = rootRequire(
  path.join(backendRoot, "src", "modules", "batch-inventory", "migrations", "Migration20261026000002_AddCartCheckoutSessionSemanticGuards.ts")
);
const { Migration20261026000003_ConvertEpochToIntegerAndDropRawEpoch } = rootRequire(
  path.join(backendRoot, "src", "modules", "batch-inventory", "migrations", "Migration20261026000003_ConvertEpochToIntegerAndDropRawEpoch.ts")
);

const logLines = [];
const errLines = [];
function log(msg) {
  console.log(msg);
  logLines.push(msg);
}
function logErr(msg) {
  console.error(msg);
  errLines.push(msg);
}

const databaseUrl = process.env.DATABASE_URL;
const isolatedDbName = "zamzam_rollback_isolated";

async function executeMigrationQueries(pgClient, migrationInstance, direction) {
  migrationInstance.reset();
  if (direction === "up") {
    await migrationInstance.up();
  } else if (direction === "down") {
    await migrationInstance.down();
  } else {
    throw new Error("Invalid migration direction: " + direction);
  }

  const queries = migrationInstance.getQueries();
  for (const query of queries) {
    await pgClient.query(query);
  }
  return queries;
}

async function run() {
  log("=== Starting Migration 3 Isolated Rollback & Lifecycle Verification ===");
  log("Time: " + new Date().toISOString());

  const artifactsDir = path.join(repositoryRoot, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  if (!databaseUrl) {
    log("DATABASE_URL not set. Disposable PostgreSQL service required. Reporting blocked status.");
    const summary = {
      test: "Migration 3 Isolated Rollback Lifecycle",
      status: "blocked",
      reason: "DATABASE_URL not configured. Disposable PostgreSQL service required.",
      timestamp: new Date().toISOString(),
    };
    await writeFile(path.join(artifactsDir, "migration-rollback-isolated.json"), JSON.stringify(summary, null, 2) + "\n");
    process.exit(0);
  }

  const parsedUrl = new URL(databaseUrl);
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";

  log("Connecting to PostgreSQL admin endpoint: " + adminUrl.toString().replace(/:[^:@]+@/, ":***@"));
  let adminClient = new PgClient({ connectionString: adminUrl.toString() });
  try {
    await adminClient.connect();
  } catch (err) {
    log("Direct /postgres admin connection failed, trying default connectionUrl database...");
    adminClient = new PgClient({ connectionString: databaseUrl });
    await adminClient.connect();
  }

  log("Recreating completely isolated disposable database: " + isolatedDbName + "...");
  await adminClient.query(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE);`);
  await adminClient.query(`CREATE DATABASE ${isolatedDbName};`);
  log("Isolated database created successfully.");

  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = "/" + isolatedDbName;

  const testClient = new PgClient({ connectionString: isolatedUrl.toString() });
  await testClient.connect();
  log("Connected to isolated test database: " + isolatedDbName);

  const assertions = [];
  function assert(name, expected, actual, condition, detail) {
    const passed = Boolean(condition);
    assertions.push({ name, expected, actual, passed, detail });
    log((passed ? "PASS" : "FAIL") + " [" + name + "]: expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
    if (!passed) {
      throw new Error(`Assertion failed: ${name}. Detail: ${detail}`);
    }
  }

  try {
    const mockDriver = {};
    const mockEm = {};

    // ------------------------------------------------------------------------
    // Step 1: Apply Migration 1, 2, 3 UP
    // ------------------------------------------------------------------------
    log("\n--- Step 1: Applying Migrations 1, 2, and 3 UP on isolated database ---");
    const mig1 = new Migration20261026000001_CreateCartCheckoutSession(mockDriver, mockEm);
    const q1 = await executeMigrationQueries(testClient, mig1, "up");
    log("Migration 1 UP executed (" + q1.length + " queries).");

    const mig2 = new Migration20261026000002_AddCartCheckoutSessionSemanticGuards(mockDriver, mockEm);
    const q2 = await executeMigrationQueries(testClient, mig2, "up");
    log("Migration 2 UP executed (" + q2.length + " queries).");

    const mig3 = new Migration20261026000003_ConvertEpochToIntegerAndDropRawEpoch(mockDriver, mockEm);
    const q3 = await executeMigrationQueries(testClient, mig3, "up");
    log("Migration 3 UP executed (" + q3.length + " queries).");

    // ------------------------------------------------------------------------
    // Step 2: Verify epoch is INTEGER and raw_epoch is absent after UP
    // ------------------------------------------------------------------------
    log("\n--- Step 2: Verifying initial Migration 3 UP physical schema ---");
    const colsUpRes = await testClient.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cart_checkout_session' ORDER BY ordinal_position;"
    );
    const colsUp = Object.fromEntries(colsUpRes.rows.map((r) => [r.column_name, r.data_type]));
    log("Columns in cart_checkout_session after Migration 3 UP: " + JSON.stringify(colsUp));

    assert(
      "up_epoch_column_is_integer",
      "integer",
      colsUp["epoch"],
      colsUp["epoch"] === "integer",
      "Migration 3 UP converts epoch to integer"
    );
    assert(
      "up_raw_epoch_column_absent",
      undefined,
      colsUp["raw_epoch"],
      !("raw_epoch" in colsUp),
      "Migration 3 UP drops raw_epoch column"
    );

    // ------------------------------------------------------------------------
    // Step 3: Insert test rows with epoch = 1 and epoch = 42
    // ------------------------------------------------------------------------
    log("\n--- Step 3: Inserting test rows (epoch=1 and epoch=42) ---");
    await testClient.query(`
      INSERT INTO "cart_checkout_session" ("cart_id", "current_attempt_id", "epoch", "status")
      VALUES
        ('cart_test_epoch_1', '11111111-1111-4111-8111-111111111111', 1, 'in_progress'),
        ('cart_test_epoch_42', '42424242-4242-4242-8242-424242424242', 42, 'in_progress');
    `);
    const insertedRowsRes = await testClient.query(
      `SELECT cart_id, current_attempt_id, epoch, status FROM cart_checkout_session ORDER BY epoch ASC;`
    );
    log("Inserted test rows: " + JSON.stringify(insertedRowsRes.rows));

    assert(
      "inserted_test_rows_count",
      2,
      insertedRowsRes.rows.length,
      insertedRowsRes.rows.length === 2,
      "Two test rows inserted before rollback"
    );

    // ------------------------------------------------------------------------
    // Step 4: Execute Migration 3 DOWN
    // ------------------------------------------------------------------------
    log("\n--- Step 4: Executing Migration 3 DOWN ---");
    const qDown = await executeMigrationQueries(testClient, mig3, "down");
    log("Migration 3 DOWN executed successfully. SQL executed:\n" + qDown.join("\n"));

    // ------------------------------------------------------------------------
    // Step 5: Verify epoch preserved and raw_epoch dynamically reconstructed
    // ------------------------------------------------------------------------
    log("\n--- Step 5: Verifying schema and data preservation after DOWN ---");
    const colsDownRes = await testClient.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cart_checkout_session' ORDER BY ordinal_position;"
    );
    const colsDown = Object.fromEntries(colsDownRes.rows.map((r) => [r.column_name, r]));
    log("Columns in cart_checkout_session after Migration 3 DOWN: " + JSON.stringify(Object.keys(colsDown)));

    assert(
      "down_epoch_column_is_numeric",
      "numeric",
      colsDown["epoch"]?.data_type,
      colsDown["epoch"]?.data_type === "numeric",
      "Migration 3 DOWN restores epoch type to numeric"
    );
    assert(
      "down_raw_epoch_column_exists_jsonb",
      "jsonb",
      colsDown["raw_epoch"]?.data_type,
      colsDown["raw_epoch"]?.data_type === "jsonb",
      "Migration 3 DOWN restores raw_epoch as jsonb"
    );
    assert(
      "down_raw_epoch_is_not_null",
      "NO",
      colsDown["raw_epoch"]?.is_nullable,
      colsDown["raw_epoch"]?.is_nullable === "NO",
      "Migration 3 DOWN restores NOT NULL on raw_epoch"
    );

    const rowsDownRes = await testClient.query(
      `SELECT cart_id, current_attempt_id, epoch, raw_epoch, status FROM cart_checkout_session ORDER BY epoch ASC;`
    );
    log("Rows after Migration 3 DOWN: " + JSON.stringify(rowsDownRes.rows));

    const row1 = rowsDownRes.rows.find((r) => r.cart_id === "cart_test_epoch_1");
    const row42 = rowsDownRes.rows.find((r) => r.cart_id === "cart_test_epoch_42");

    assert(
      "down_row1_epoch_preserved",
      "1",
      String(row1?.epoch),
      String(row1?.epoch) === "1",
      "Row 1 epoch value 1 preserved after rollback"
    );
    assert(
      "down_row1_raw_epoch_reconstructed",
      { value: "1", precision: 20 },
      row1?.raw_epoch,
      JSON.stringify(row1?.raw_epoch) === JSON.stringify({ value: "1", precision: 20 }),
      "Row 1 raw_epoch dynamically reconstructed as {\"value\":\"1\",\"precision\":20}"
    );

    assert(
      "down_row42_epoch_preserved",
      "42",
      String(row42?.epoch),
      String(row42?.epoch) === "42",
      "Row 42 epoch value 42 preserved after rollback"
    );
    assert(
      "down_row42_raw_epoch_reconstructed",
      { value: "42", precision: 20 },
      row42?.raw_epoch,
      JSON.stringify(row42?.raw_epoch) === JSON.stringify({ value: "42", precision: 20 }),
      "Row 42 raw_epoch dynamically reconstructed as {\"value\":\"42\",\"precision\":20} (not fixed default 1)"
    );

    // ------------------------------------------------------------------------
    // Step 6: Verify old numeric/integer check constraint restored
    // ------------------------------------------------------------------------
    log("\n--- Step 6: Verifying restored check constraint chk_ccs_epoch_positive_integer ---");
    const constraintRes = await testClient.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'cart_checkout_session'::regclass AND conname = 'chk_ccs_epoch_positive_integer';
    `);
    log("Constraint definition after DOWN: " + JSON.stringify(constraintRes.rows));

    assert(
      "down_constraint_chk_ccs_epoch_positive_integer_present",
      true,
      constraintRes.rows.length === 1,
      constraintRes.rows.length === 1,
      "Constraint chk_ccs_epoch_positive_integer present after DOWN"
    );

    // Verify constraint prevents non-integers on numeric epoch
    let fractionalInsertBlocked = false;
    try {
      await testClient.query(`
        INSERT INTO "cart_checkout_session" ("cart_id", "current_attempt_id", "epoch", "status")
        VALUES ('cart_fractional', '99999999-9999-4999-8999-999999999999', 1.5, 'in_progress');
      `);
    } catch (err) {
      fractionalInsertBlocked = true;
      log("Verified: fractional epoch (1.5) was rejected by chk_ccs_epoch_positive_integer: " + err.message);
    }
    assert(
      "down_fractional_epoch_rejected_by_restored_constraint",
      true,
      fractionalInsertBlocked,
      fractionalInsertBlocked === true,
      "Fractional epoch (1.5) rejected by restored check constraint"
    );

    // ------------------------------------------------------------------------
    // Step 7: Re-execute Migration 3 UP
    // ------------------------------------------------------------------------
    log("\n--- Step 7: Re-executing Migration 3 UP ---");
    const qReUp = await executeMigrationQueries(testClient, mig3, "up");
    log("Migration 3 re-applied UP (" + qReUp.length + " queries).");

    // ------------------------------------------------------------------------
    // Step 8: Verify schema returns to integer and raw_epoch dropped
    // ------------------------------------------------------------------------
    log("\n--- Step 8: Verifying physical schema and rows after re-applying UP ---");
    const colsReUpRes = await testClient.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cart_checkout_session' ORDER BY ordinal_position;"
    );
    const colsReUp = Object.fromEntries(colsReUpRes.rows.map((r) => [r.column_name, r.data_type]));
    log("Columns in cart_checkout_session after re-applying Migration 3 UP: " + JSON.stringify(colsReUp));

    assert(
      "reup_epoch_column_is_integer",
      "integer",
      colsReUp["epoch"],
      colsReUp["epoch"] === "integer",
      "Epoch column returns to integer after re-applying UP"
    );
    assert(
      "reup_raw_epoch_column_absent",
      undefined,
      colsReUp["raw_epoch"],
      !("raw_epoch" in colsReUp),
      "Raw_epoch column dropped after re-applying UP"
    );

    const rowsReUpRes = await testClient.query(
      `SELECT cart_id, current_attempt_id, epoch, status FROM cart_checkout_session ORDER BY epoch ASC;`
    );
    log("Rows after re-applying Migration 3 UP: " + JSON.stringify(rowsReUpRes.rows));

    const reUpRow1 = rowsReUpRes.rows.find((r) => r.cart_id === "cart_test_epoch_1");
    const reUpRow42 = rowsReUpRes.rows.find((r) => r.cart_id === "cart_test_epoch_42");

    assert(
      "reup_row1_epoch_value",
      1,
      reUpRow1?.epoch,
      reUpRow1?.epoch === 1,
      "Row 1 epoch is integer 1 after re-applying UP"
    );
    assert(
      "reup_row42_epoch_value",
      42,
      reUpRow42?.epoch,
      reUpRow42?.epoch === 42,
      "Row 42 epoch is integer 42 after re-applying UP"
    );

    const reUpConstraintRes = await testClient.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'cart_checkout_session'::regclass AND conname = 'chk_ccs_epoch_positive';
    `);
    assert(
      "reup_constraint_chk_ccs_epoch_positive_present",
      true,
      reUpConstraintRes.rows.length === 1,
      reUpConstraintRes.rows.length === 1,
      "Positive epoch check constraint chk_ccs_epoch_positive restored"
    );

    log("\nAll Migration 3 rollback and re-apply assertions PASSED successfully.");

    const evidence = {
      test: "Migration 3 Isolated Rollback & Re-Up Lifecycle",
      status: "passed",
      mechanism: "MikroORM Migration class instances executed against isolated disposable PostgreSQL database",
      runnerNote: "Medusa CLI 'db:rollback --modules <module>' operates at batch granularity (reverts entire initial batch of all 3 migrations). Isolated lifecycle verification of single migration 3 down() and subsequent up() executed the compiled migration class methods directly against an isolated disposable database.",
      isolatedDatabase: isolatedDbName,
      assertions,
      sampleRowsAfterDown: rowsDownRes.rows,
      sampleRowsAfterReUp: rowsReUpRes.rows,
      timestamp: new Date().toISOString(),
    };

    await writeFile(
      path.join(artifactsDir, "migration-rollback-isolated.json"),
      JSON.stringify(evidence, null, 2) + "\n"
    );
    log("Wrote evidence to artifacts/migration-rollback-isolated.json");
  } finally {
    try {
      await testClient.end();
    } catch {}
    try {
      log("Dropping isolated test database: " + isolatedDbName + "...");
      await adminClient.query(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE);`);
      await adminClient.end();
      log("Isolated test database dropped cleanly.");
    } catch {}
  }

  process.exit(0);
}

run().catch((err) => {
  logErr("UNCAUGHT EXCEPTION during migration rollback test: " + (err.stack || String(err)));
  process.exit(1);
});
