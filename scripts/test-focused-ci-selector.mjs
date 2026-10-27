import assert from "node:assert/strict"
import { selectSuites, suites } from "./select-focused-ci.mjs"
const all = Object.keys(suites)
assert.equal(JSON.stringify(selectSuites(["docs/phase1-notes.md"])), "[]")
assert.deepEqual(selectSuites(["apps/backend/src/modules/order-operations/payment-branch.mjs"]), ["payment"])
assert.deepEqual(selectSuites(["apps/backend/src/modules/batch-inventory/ledger.ts"]), ["inventory","checkout","payment"])
assert.deepEqual(selectSuites(["apps/backend/src/modules/batch-inventory/order-correlation.ts"]), ["inventory","checkout","payment"])
assert.deepEqual(selectSuites(["apps/backend/src/modules/locking-redis/provider.ts"]), ["locks","checkout"])
assert.deepEqual(selectSuites([".github/workflows/phase1-focused.yml"]), all)
assert.deepEqual(selectSuites(["package-lock.json"]), all)
assert.deepEqual(selectSuites(["unknown/unclassified-file.ts"]), all)
assert.deepEqual(selectSuites([]), all)
assert.equal(all.some(k=>suites[k].includes("TP-01")),false)
for(const [key,ids] of Object.entries(suites)) {
  assert.equal(new Set(ids).size,ids.length,"duplicate cases: "+key)
  assert.ok(ids.every(id=>id!=="TP-01"))
}
console.log("Focused CI suite selector: 11 invariant checks passed; TP-01 prohibited.")
