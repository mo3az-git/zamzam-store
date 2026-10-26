import { runDisposableValidatorSelfChecks } from "./verify-disposable-target.mjs";

console.log("=== Running Disposable Target Validator Test Suite ===");

const suiteResult = runDisposableValidatorSelfChecks();

for (const r of suiteResult.results) {
  if (r.passed) {
    console.log(`[PASS] ${r.name} -> ${r.detail}`);
  } else {
    console.error(`[FAIL] ${r.name} -> ${r.detail}`);
  }
}

console.log(`\nDisposable Target Validator Test Summary: ${suiteResult.passed}/${suiteResult.total} passed.`);

if (!suiteResult.allPassed) {
  process.exit(1);
} else {
  process.exit(0);
}
