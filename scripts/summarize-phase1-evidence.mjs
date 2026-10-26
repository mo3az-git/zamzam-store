import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const plan = await readFile("docs/implementation-plan.md", "utf8");
const canonical = plan.split(/\r?\n/).filter((line) => /^\|\s*\*\*TP-\d+[a-z]?\*\*/.test(line));
if (canonical.length !== 59) throw new Error("Canonical TP registry must contain 59 cases.");
const sha = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
async function readJson(file) {
  try { return JSON.parse(await readFile(path.join(root, file), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const cases = [];
for (const requirement of canonical) {
  const id = requirement.match(/\*\*(TP-\d+[a-z]?)\*\*/)[1];
  const evidencePath = `artifacts/tp-evidence/${id}`;
  const readinessPath = `artifacts/tp-readiness/${id}`;
  const result = await readJson(`${evidencePath}/result.json`);
  const readiness = await readJson(`${readinessPath}/result.json`);
  const implementation = await readJson(`${readinessPath}/implementation-check.json`);
  const assertions = result ? await readJson(`${evidencePath}/assertions.json`) : null;
  const currentResult = result?.commitSha === sha;
  let status = currentResult ? result.status : readiness?.status === "blocked" ? "blocked" : "not_executed";
  const integrityIssues = [];
  if (currentResult && status === "passed") {
    if (result.sourceWorkingTreeDirty) integrityIssues.push("Source worktree was dirty; the passing run cannot qualify as exact-commit evidence.");
    if (result.processExitCode !== 0) integrityIssues.push("Nonzero/missing process exit code.");
    if (!result.rawStreamsCaptured) integrityIssues.push("Raw process streams were not captured.");
    if (!assertions?.length || assertions.some((item) => item.passed !== true)) integrityIssues.push("Missing or failing assertions.");
    for (const name of ["db-before.json", "db-after.json"]) {
      const snapshot = await readJson(`${evidencePath}/${name}`);
      if (!snapshot || Object.keys(snapshot).length === 0) integrityIssues.push("Missing runtime snapshot: " + name);
    }
    if (integrityIssues.length) status = "failed";
  }
  cases.push({
    id, canonicalRequirement: requirement,
    status,
    boundary: currentResult ? result.assessmentType : "readiness only; no behavior executed",
    testCommand: currentResult ? result.testCommand : null,
    exitCode: currentResult ? result.processExitCode : null,
    assertionCount: assertions?.length ?? null,
    failedAssertions: assertions?.filter((item) => !item.passed).map((item) => item.name) ?? null,
    evidencePath: currentResult ? evidencePath : null,
    readinessPath: readiness ? readinessPath : null,
    implementationFiles: implementation?.sourceInventory?.files ?? [],
    blocker: currentResult ? result.blocker : readiness?.blocker || "No current-commit runtime evidence.",
    independentReview: "pending",
    formallyAccepted: false,
    evidenceIntegrityIssues: integrityIssues,
    nextAction: "See the individual dependency and next action in docs/phase1-tp-case-matrix.md.",
  });
}
const summary = {
  commitSha: sha, capturedAt: new Date().toISOString(),
  gate: "NOT READY — BLOCKERS REMAIN", formallyAccepted: 0,
  counts: Object.fromEntries(["passed", "failed", "blocked", "not_executed"].map((status) => [status, cases.filter((item) => item.status === status).length])),
  note: "Passed means only the recorded runner boundary passed. TP-02c/TP-03 exercise the real prototype checkout-lock HTTP stage, not full commerce checkout; TP-03 inventory counts remain table-wide on an empty cart. TP-04b's aborted-state fixture is not a recovery-controller test. TP-21c covers cryptography, not refund/payout persistence. Independent review and formal acceptance are separate. TP-01 remains unauthorized.",
  cases,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/tp-execution-matrix.json", JSON.stringify(summary, null, 2) + "\n");
const markdown = [
  "# Phase 1 observed execution matrix", "", `Tested commit: \`${sha}\`. ${summary.gate}.`, "", summary.note, "",
  "| ID | Runtime status | Exit | Boundary | Evidence | Review / acceptance |",
  "|---|---|---|---|---|---|",
  ...cases.map((item) => `| ${item.id} | ${item.status} | ${item.exitCode ?? "—"} | ${item.boundary.replaceAll("|", "\\|")} | [files](${item.evidencePath ? `tp-evidence/${item.id}` : `tp-readiness/${item.id}`}/result.json) | Pending / unaccepted |`),
  "", "Full canonical criteria, source inventory and blockers are retained per case in tp-execution-matrix.json.", "",
].join("\n");
await writeFile("artifacts/tp-execution-matrix.md", markdown);
console.log(JSON.stringify({ commitSha: sha, gate: summary.gate, ...summary.counts, formallyAccepted: 0 }));
