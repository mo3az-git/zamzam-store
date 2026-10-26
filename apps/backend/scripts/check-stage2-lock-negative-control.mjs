import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  backendRoot,
  registerTsNode,
} from "./shared/tp-harness.mjs";

const rootRequire = registerTsNode();
const { MedusaError, Modules, createMedusaContainer } = rootRequire("@medusajs/framework/utils");
const { asValue } = rootRequire("@medusajs/framework/awilix");
const { stage2CheckoutLockWorkflow, isLockContentionError } = rootRequire(
  path.join(backendRoot, "src", "workflows", "stage2-checkout-lock-workflow.ts")
);

console.log("=== Supplementary Check (NOT TP-03 Evidence): Stage 2 Lock Negative Control ===");
console.log("Purpose: Prove non-contention failures reject immediately as-is and are NOT reported as LOCK_TIMEOUT.");

const checks = [];

// Check 1: Unit verification of isLockContentionError discriminator
const contentionErr = new MedusaError(
  MedusaError.Types.CONFLICT,
  'Failed to acquire lock for key "cart:123"'
);
const connectionErr = new Error("Redis connection refused: ECONNREFUSED");
const typeErr = new TypeError("Invalid parameter type");
const otherConflictErr = new MedusaError(
  MedusaError.Types.CONFLICT,
  "Order state conflict"
);

const isContentionRecognized = isLockContentionError(contentionErr) === true;
const isConnectionRejected = isLockContentionError(connectionErr) === false;
const isTypeErrRejected = isLockContentionError(typeErr) === false;
const isOtherConflictRejected = isLockContentionError(otherConflictErr) === false;

checks.push({
  name: "discriminator_recognizes_contention_error",
  passed: isContentionRecognized && isConnectionRejected && isTypeErrRejected && isOtherConflictRejected,
  detail: "isLockContentionError identifies only Medusa CONFLICT with 'Failed to acquire lock for key '",
});

// Check 2: Workflow execution with simulated network failure (plain Error)
const networkError = new Error("Redis connection closed unexpectedly");
const containerNetwork = createMedusaContainer();
containerNetwork.register({
  [Modules.LOCKING]: asValue({
    acquire: async () => {
      throw networkError;
    },
    release: async () => {},
  }),
});

const start1 = performance.now();
let caughtNetworkError = null;
try {
  const wf = stage2CheckoutLockWorkflow(containerNetwork);
  await wf.run({
    input: {
      cartId: "cart_neg_control_1",
      ownerId: "worker_test_1",
      timeout: 5,
    },
  });
} catch (err) {
  caughtNetworkError = err;
}
const duration1 = (performance.now() - start1) / 1000;

const isMessagePreserved = caughtNetworkError?.message === networkError.message;
const isNamePreserved = caughtNetworkError?.name === "Error";
const isNotLockTimeout =
  caughtNetworkError?.code !== "LOCK_TIMEOUT" &&
  caughtNetworkError?.type !== "conflict" &&
  caughtNetworkError?.message !== "Cart checkout lock timeout";
const rejectedImmediately = duration1 < 1.0;

checks.push({
  name: "non_contention_plain_error_rethrown_as_is_without_timeout",
  passed: isMessagePreserved && isNamePreserved && isNotLockTimeout && rejectedImmediately,
  detail: `Rethrew original Error in ${duration1.toFixed(3)}s without waiting for 5s timeout; message='${caughtNetworkError?.message}'`,
});

// Check 3: Workflow execution with TypeError
const typeError = new TypeError("Provider option 'ownerId' is invalid");
const containerType = createMedusaContainer();
containerType.register({
  [Modules.LOCKING]: asValue({
    acquire: async () => {
      throw typeError;
    },
    release: async () => {},
  }),
});

const start2 = performance.now();
let caughtTypeError = null;
try {
  const wf = stage2CheckoutLockWorkflow(containerType);
  await wf.run({
    input: {
      cartId: "cart_neg_control_2",
      ownerId: "worker_test_2",
      timeout: 5,
    },
  });
} catch (err) {
  caughtTypeError = err;
}
const duration2 = (performance.now() - start2) / 1000;

const isTypeMessagePreserved = caughtTypeError?.message === typeError.message;
const isTypeNamePreserved = caughtTypeError?.name === "TypeError";
const isNotLockTimeout2 =
  caughtTypeError?.code !== "LOCK_TIMEOUT" &&
  caughtTypeError?.type !== "conflict" &&
  caughtTypeError?.message !== "Cart checkout lock timeout";
const rejectedImmediately2 = duration2 < 1.0;

checks.push({
  name: "non_contention_type_error_rethrown_as_is_without_timeout",
  passed: isTypeMessagePreserved && isTypeNamePreserved && isNotLockTimeout2 && rejectedImmediately2,
  detail: `Rethrew original TypeError in ${duration2.toFixed(3)}s without waiting for 5s timeout`,
});

let allPassed = true;
for (const c of checks) {
  const status = c.passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${c.name}: ${c.detail}`);
  if (!c.passed) allPassed = false;
}

if (!allPassed) {
  console.error("FAIL: Negative control check failed.");
  process.exit(1);
}

console.log("SUCCESS: All negative control checks passed (3/3). Non-contention errors are never turned into LOCK_TIMEOUT.");
process.exit(0);
