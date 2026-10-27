import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const workflow = read(".github/workflows/mvp-consolidated.yml")
const compose = read("compose.qa.yaml")

function imageRef(source, service) {
  const match = source.match(new RegExp(`^\\s*${service}:\\s*\\r?\\n\\s*image:\\s*(\\S+)`, "m"))
  assert.ok(match, `Missing image reference for ${service}`)
  return match[1]
}

const expected = {
  postgres: /^postgres:16\.15@sha256:[a-f0-9]{64}$/,
  redis: /^redis:7\.2\\.16@sha256:[a-f0-9]{64}$/,
}

for (const [service, pattern] of Object.entries(expected)) {
  const workflowImage = imageRef(workflow, service)
  const localImage = imageRef(compose, service)
  assert.match(workflowImage, pattern, `CI ${service} image must use an immutable digest`)
  assert.equal(workflowImage, localImage, `CI and local QA ${service} images must match`)
}

console.log(JSON.stringify({
  result: "pass",
  services: Object.fromEntries(Object.keys(expected).map((name) => [name, imageRef(workflow, name)])),
}))
