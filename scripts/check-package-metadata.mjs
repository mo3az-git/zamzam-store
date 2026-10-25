import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const manifestPaths = [
  "package.json",
  "apps/backend/package.json",
  "apps/storefront/package.json"
]
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const pinsByName = new Map()
const failures = []
const results = []

for (const relativePath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"))
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(manifest[section] || {})) {
      if (typeof version !== "string" || !exactVersion.test(version)) continue
      if (!pinsByName.has(name)) pinsByName.set(name, new Map())
      const byVersion = pinsByName.get(name)
      if (!byVersion.has(version)) byVersion.set(version, [])
      byVersion.get(version).push(relativePath)
    }
  }
}

for (const [name, byVersion] of pinsByName.entries()) {
  if (byVersion.size > 1) {
    failures.push(name + " has conflicting exact direct pins: " +
      [...byVersion.entries()].map(([version, manifests]) => version + " in " + manifests.join(", ")).join("; ") + ".")
  }
}

for (const [name, byVersion] of [...pinsByName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  for (const [version, manifestPaths] of [...byVersion.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      const output = execFileSync(
        "npm",
        ["view", name + "@" + version, "version", "peerDependencies", "engines", "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }
      )
      const parsed = JSON.parse(output)
      // npm may return only the version string if optional metadata fields are absent.
      let metadata
      if (typeof parsed === "string") {
        metadata = { version: parsed }
      } else if (Array.isArray(parsed)) {
        const [resolvedVersion, peerDependencies, engines] = parsed
        metadata = {
          version: resolvedVersion,
          ...(peerDependencies && typeof peerDependencies === "object" ? { peerDependencies } : {}),
          ...(engines && typeof engines === "object" ? { engines } : {})
        }
      } else if (parsed && typeof parsed === "object") {
        metadata = parsed
      } else {
        throw new Error("npm view returned an unexpected JSON shape.")
      }

      if (metadata.version !== version) {
        failures.push(name + "@" + version + " metadata resolved to " + String(metadata.version) + ".")
      }
      results.push({ name, requestedVersion: version, manifestPaths, ...metadata })
      console.log("OK " + name + "@" + version + " (" + manifestPaths.join(", ") + ")")
    } catch (error) {
      const detail = error?.stderr?.toString?.().trim() || error?.message || String(error)
      failures.push("npm view failed for " + name + "@" + version + ": " + detail)
    }
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
  console.log("PASS: metadata captured for " + results.length + " exact direct-pin entries.")
}
