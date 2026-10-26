import path from "node:path";
import {
  backendRoot,
  registerTsNode,
} from "./shared/tp-harness.mjs";

const rootRequire = registerTsNode();
const {
  abortPendingLeaseOnLockTimeout,
  executeCasLeaseAbort,
  isLockContentionError,
} = rootRequire(path.join(backendRoot, "src", "workflows", "stage2-checkout-lock-workflow.ts"));
const { MedusaError } = rootRequire("@medusajs/framework/utils");

console.log("=== Running TP-02c Lock Timeout CAS Lease Abort Unit & Invariant Test Suite ===");

let passedCount = 0;
let totalCount = 0;

function assert(description, condition, actual) {
  totalCount += 1;
  if (condition) {
    passedCount += 1;
    console.log(`[PASS] ${description}`);
  } else {
    console.error(`[FAIL] ${description} | actual: ${JSON.stringify(actual)}`);
  }
}

// Simulated in-memory database table for idempotency_key
const createMockDb = () => {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (sql.includes("DELETE FROM idempotency_key WHERE key = $1 AND lease_owner_id = $2 AND status = 'pending'")) {
        const [key, ownerId] = params;
        const initialLen = rows.length;
        const remaining = rows.filter((r) => !(r.key === key && r.lease_owner_id === ownerId && r.status === "pending"));
        const deletedCount = initialLen - remaining.length;
        rows.length = 0;
        rows.push(...remaining);
        return { rowCount: deletedCount };
      }
      throw new Error("Unhandled SQL: " + sql);
    },
  };
};

// Test 1: CAS deletes pending lease when key and ownerId match
{
  const mockDb = createMockDb();
  mockDb.rows.push({
    key: "key-1",
    lease_owner_id: "worker-b",
    status: "pending",
  });

  const res = await executeCasLeaseAbort(mockDb, "key-1", "worker-b");
  assert("deletes pending lease when key and owner match", res.deletedRows === 1 && mockDb.rows.length === 0, { res, remaining: mockDb.rows });
}

// Test 2: CAS does NOT delete when ownerId does not match (different worker)
{
  const mockDb = createMockDb();
  mockDb.rows.push({
    key: "key-1",
    lease_owner_id: "worker-c",
    status: "pending",
  });

  const res = await executeCasLeaseAbort(mockDb, "key-1", "worker-b");
  assert("refuses to delete pending lease owned by different worker (Worker C)", res.deletedRows === 0 && mockDb.rows.length === 1, { res, remaining: mockDb.rows });
}

// Test 3: CAS does NOT delete when status is 'completed'
{
  const mockDb = createMockDb();
  mockDb.rows.push({
    key: "key-1",
    lease_owner_id: "worker-b",
    status: "completed",
  });

  const res = await executeCasLeaseAbort(mockDb, "key-1", "worker-b");
  assert("refuses to delete completed lease even if key and owner match", res.deletedRows === 0 && mockDb.rows.length === 1, { res, remaining: mockDb.rows });
}

// Test 4: CAS does NOT delete when status is 'failed'
{
  const mockDb = createMockDb();
  mockDb.rows.push({
    key: "key-1",
    lease_owner_id: "worker-b",
    status: "failed",
  });

  const res = await executeCasLeaseAbort(mockDb, "key-1", "worker-b");
  assert("refuses to delete failed lease even if key and owner match", res.deletedRows === 0 && mockDb.rows.length === 1, { res, remaining: mockDb.rows });
}

// Test 5: isLockContentionError discrimination
{
  const contentionErr = new MedusaError(MedusaError.Types.CONFLICT, "Failed to acquire lock for key cart:123");
  const connectionErr = new Error("Redis connection closed");
  const genericConflict = new MedusaError(MedusaError.Types.CONFLICT, "Other conflict");

  assert("recognizes genuine lock contention error", isLockContentionError(contentionErr) === true, contentionErr);
  assert("rejects plain connection error as non-contention", isLockContentionError(connectionErr) === false, connectionErr);
  assert("rejects non-lock conflict error", isLockContentionError(genericConflict) === false, genericConflict);
}

// Test 6: A failed lease CAS must not be hidden as an ordinary lock timeout
{
  const databaseError = new Error("PostgreSQL unavailable");
  let propagatedError;
  try {
    await abortPendingLeaseOnLockTimeout(
      { idempotencyKey: "key-1", ownerId: "worker-b" },
      () => ({ raw: async () => { throw databaseError; } })
    );
  } catch (error) {
    propagatedError = error;
  }

  assert("propagates database error when lease CAS cannot run", propagatedError === databaseError, propagatedError?.message);
}

console.log("");
console.log(`TP-02c Unit Test Summary: ${passedCount}/${totalCount} passed.`);
if (passedCount !== totalCount) {
  process.exit(1);
}
