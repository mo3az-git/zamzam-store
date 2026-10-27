import { execFileSync } from "node:child_process"

// Fail closed: unknown or shared changes select all focused suites.
// TP-01 is not present in any suite or in the executable TP allowlist.
export const suites = Object.freeze({
  locks: ["TP-02a","TP-02b","TP-02c","TP-03","TP-04a","TP-04b"],
  inventory: ["TP-06a","TP-06b","TP-07a","TP-07b","TP-09","TP-10","TP-24c"],
  checkout: ["TP-08-foundation","TP-08-native-integration","TP-08-recovery","TP-08-operations"],
  payment: ["TP-05","TP-05-native-order-binding"],
  security: ["TP-21c"]
})
const all = Object.keys(suites)
const docOnly = (p) => /^docs\//.test(p) && !/docs\/implementation-plan\.md$/.test(p)
export function selectSuites(files) {
  if (!Array.isArray(files) || !files.every(x=>typeof x==="string")) return all
  if (!files.length) return all
  if (files.every(docOnly)) return []
  const names = new Set()
  const add = (...values) => values.forEach(s=>names.add(s))
  for (const p of files) {
    if (p.startsWith(".github/") || p.startsWith("scripts/") ||
        p==="package.json" || p==="package-lock.json" ||
        p.startsWith("docs/implementation-plan.md") || p.startsWith("apps/backend/medusa-config")) return all
    if (p.startsWith("apps/backend/src/modules/order-operations/") ||
        p.includes("test-tp05")) add("payment")
    else if (p.includes("batch-inventory/ledger") || p.includes("test-inventory-ledger") ||
        p.includes("batch-inventory/migrations")) add("inventory","checkout","payment")
    else if (p.includes("batch-inventory/") || p.includes("tp08-native") ||
        p.includes("test-native-recovery") || p.includes("reconciliation")) add("checkout","inventory","payment")
    else if (p.includes("locking") || p.includes("cart-mutation") || p.includes("checkout-lock") ||
        p.includes("tp02") || p.includes("tp03")) add("locks","checkout")
    else if (p.includes("security") || p.includes("tp21c")) add("security")
    else if (p.startsWith("apps/storefront/")) add("locks","checkout")
    else if (docOnly(p)) { /* no runtime impact */ }
    else return all
  }
  return all.filter(name=>names.has(name))
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  let selection = all
  const requested = process.env.FOCUSED_SUITE ?? "auto"
  if (requested !== "auto") {
    if (requested !== "all" && !(requested in suites)) throw new Error("Unsupported focused CI suite")
    selection = requested==="all" ? all : [requested]
  } else {
    try {
      const base=process.env.BEFORE_SHA
      if (base && !/^0{40}$/.test(base) && /^[0-9a-f]{40}$/.test(base)) {
        const result=execFileSync("git",["diff","--name-only",base,"HEAD"],{encoding:"utf8"})
        selection=selectSuites(result.split(/\r?\n/).filter(Boolean))
      }
    } catch { selection=all }
  }
  const { appendFileSync } = await import("node:fs")
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    "suites="+JSON.stringify(selection)+"\n")
  console.log(JSON.stringify({requested,selected:selection,tp01Authorized:false}))
}
