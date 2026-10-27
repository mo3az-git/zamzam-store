import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const outcomes = Object.fromEntries(
  Object.entries(process.env)
    .filter(([name]) => name.startsWith("QA_STEP_"))
    .map(([name, outcome]) => [name.slice("QA_STEP_".length).toLowerCase(), outcome || "not-run"])
)
const values = Object.values(outcomes)
const manifest = {
  schemaVersion: 1,
  run: {
    id: process.env.QA_RUN_ID ?? null,
    attempt: process.env.QA_RUN_ATTEMPT ?? null,
    workflow: process.env.QA_WORKFLOW ?? null,
    event: process.env.QA_EVENT ?? null,
    ref: process.env.QA_REF ?? null,
    sha: process.env.QA_SHA ?? null,
    job: process.env.QA_JOB ?? null,
    runnerOs: process.env.QA_RUNNER_OS ?? null,
    nodeVersion: process.version,
  },
  disposableServices: {
    postgresImage: process.env.QA_POSTGRES_IMAGE ?? null,
    redisImage: process.env.QA_REDIS_IMAGE ?? null,
  },
  stepOutcomes: outcomes,
  outcomeCounts: {
    passed: values.filter((value) => value === "success").length,
    failed: values.filter((value) => value === "failure").length,
    skipped: values.filter((value) => value === "skipped").length,
    notRun: values.filter((value) => value === "not-run").length,
    cancelled: values.filter((value) => value === "cancelled").length,
  },
}

const outputDirectory = resolve("artifacts/qa")
await mkdir(outputDirectory, { recursive: true })
const filePath = resolve(outputDirectory, `mvp-integration-run-${process.env.QA_RUN_ID ?? "local"}.json`)
await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
console.log(`Wrote non-secret QA run manifest: ${filePath}`)
