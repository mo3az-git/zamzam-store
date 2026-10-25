import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const registryPath = resolve(process.cwd(), "docs/implementation-plan.md")
const source = readFileSync(registryPath, "utf8")
const rows = source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^\|\s*\*\*TP-\d+[a-z]?\*\*/.test(line))
const idPattern = /^\|\s*\*\*(TP-\d+[a-z]?)\*\*/
const failures = []
const ids = []
const backtick = String.fromCharCode(96)

for (const row of rows) {
  const id = row.match(idPattern)?.[1]
  if (!id) {
    failures.push("Could not parse TP ID from row: " + row.slice(0, 100))
    continue
  }
  ids.push(id)
  const cells = row.split("|").map((cell) => cell.trim())
  const status = cells[cells.length - 2]
  if (status !== backtick + "[ ]" + backtick) {
    failures.push(id + " does not have the expected unchecked runtime status.")
  }
}

if (rows.length !== 59) {
  failures.push("Expected exactly 59 TP table rows; found " + rows.length + ".")
}
if (new Set(ids).size !== ids.length) {
  failures.push("Duplicate TP IDs were found.")
}

if (failures.length) {
  console.error("FAIL: TP registry integrity check.")
  for (const failure of failures) console.error(" - " + failure)
  process.exitCode = 1
} else {
  console.log("PASS: 59 unique TP registry rows are present, and every runtime status remains unchecked.")
  console.log("This checks registry markup only; it does not execute any TP behavior test.")
}
