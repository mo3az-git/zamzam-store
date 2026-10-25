import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const manifestPaths = [
  "package.json",
  "apps/backend/package.json",
  "apps/storefront/package.json"
]
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const packagePins = new Map()
const failures = []
const results = []

for (const relativePath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"))
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(manifest[section] || {})) {
      if (!exactVersion.test(version)) continue
      const prior = packagePins.get(name)
      if (prior && prior !== version) {
        failures.push(name + " has conflicting exact direct pins: " + prior + " and " + version + ".")
      } else {
        packagePins.set(name, version)
      }
    }
  }
}

for (const [name, version] of [...packagePins.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  try {
    const output = execFileSync(
      "npm",
      ["view", name + "@" + version, "version", "peerDependencies", "engines", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }
    )
    const metadata = JSON.parse(output)
    if (metadata.version !== version) {
      failures.push(name + "@" + version + " metadata resolved to " + metadata.version + ".")
    }
    results.push({ name, requestedVersion: version, ...metadata })
    console.log("OK " + name + "@" + version)
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim() || error?.message || String(error)
    failures.push("npm view failed for " + name + "@" + version + ": " + detail)
  }
}

const artifactPath = resolve(process.cwd(), "artifacts/package-metadata.json")
mkdirSync(dirname(artifactPath), { recursive: true })
writeFileSync(artifactPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  checkedExactPinCount: results.length,
  results,
  failures
}, null, 2) + "\n")

if (failures.length) {
  console.error("FAIL: exact package metadata checks.")
  for (const failure of failures) console.error(" - " + failure)
  process.exitCode = 1
} else {
  console.log("PASS: metadata captured for " + results.length + " exact package pins.")
}
