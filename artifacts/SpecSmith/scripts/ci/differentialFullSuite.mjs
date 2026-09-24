#!/usr/bin/env node
// Differential full-suite verdict: head versus its target base.
//
// Runs the WHOLE vitest suite — untargeted, nothing excluded, skipped or
// retried — at the branch head (the current directory) and at the base
// commit (a separate, already-installed checkout), and compares the exact
// identities of the failing tests.
//
//   PASS  only when every head failure also fails on the base, with the same
//         identity (file > describe chain > test name), and both runs
//         produced a readable report.
//   FAIL  on any failure the base does not have (a regression, or a new test
//         that fails), on a missing/unreadable report from either side, or on
//         a head run with no tests.
//
// There is no exemption list and no fixed failure count: the inherited set is whatever
// the base actually fails, measured in the same job, and it is printed in
// full so it cannot pass silently.
//
// Usage (from artifacts/SpecSmith):
//   node scripts/ci/differentialFullSuite.mjs --base-dir <repo-root-at-base> --out <dir>
// Writes <out>/full-suite-head.json, full-suite-base.json,
// full-suite-differential.json, full-suite-differential.md and
// full-suite-exit-code.txt (0 = no new failures).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const baseDir = arg("--base-dir");
const outDir = resolve(arg("--out") ?? ".");
if (!baseDir) {
  console.error("--base-dir <repo root checked out at the base commit> is required.");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const headRoot = process.cwd();
const baseRoot = resolve(baseDir, "artifacts/SpecSmith");

function gitHead(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

/** Runs the untargeted suite in `root`; returns the parsed JSON report or null. */
function runSuite(label, root) {
  const report = join(outDir, `full-suite-${label}.json`);
  console.log(`\n=== ${label}: vitest run (whole suite) in ${root} @ ${gitHead(root)} ===`);
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile=${report}`],
    { cwd: root, stdio: "inherit", timeout: 30 * 60_000 },
  );
  console.log(`${label} vitest exit: ${result.status ?? result.signal}`);
  if (!existsSync(report)) return null;
  try {
    return JSON.parse(readFileSync(report, "utf8"));
  } catch {
    return null;
  }
}

/** The set of failure identities in a report. File-level load failures count. */
function failureIds(report, root) {
  const ids = new Set();
  for (const file of report.testResults ?? []) {
    const name = relative(root, file.name);
    const failedTests = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    for (const test of failedTests) {
      ids.add([name, ...(test.ancestorTitles ?? []), test.title].join(" > "));
    }
    if (file.status === "failed" && failedTests.length === 0) ids.add(`${name} > <file failed to load or run>`);
  }
  return ids;
}

const head = runSuite("head", headRoot);
const base = runSuite("base", baseRoot);

const problems = [];
if (!head) problems.push("the head run produced no readable JSON report");
if (!base) problems.push("the base run produced no readable JSON report, so no failure can be shown to be inherited");
if (head && !(head.numTotalTests > 0)) problems.push("the head run reported zero tests");

const headFailures = head ? failureIds(head, headRoot) : new Set();
const baseFailures = base ? failureIds(base, baseRoot) : new Set();
const introduced = [...headFailures].filter((id) => !baseFailures.has(id)).sort();
const inherited = [...headFailures].filter((id) => baseFailures.has(id)).sort();
const fixedOnHead = [...baseFailures].filter((id) => !headFailures.has(id)).sort();
const pass = problems.length === 0 && introduced.length === 0;

const summary = {
  verdict: pass ? "pass" : "fail",
  headSha: gitHead(headRoot),
  baseSha: gitHead(baseRoot),
  head: head ? { total: head.numTotalTests, passed: head.numPassedTests, failed: head.numFailedTests, failedSuites: head.numFailedTestSuites } : null,
  base: base ? { total: base.numTotalTests, passed: base.numPassedTests, failed: base.numFailedTests, failedSuites: base.numFailedTestSuites } : null,
  problems,
  introduced,
  inherited,
  fixedOnHead,
};
writeFileSync(join(outDir, "full-suite-differential.json"), `${JSON.stringify(summary, null, 2)}\n`);

const list = (items) => (items.length ? items.map((id) => `- \`${id}\``).join("\n") : "- (none)");
const markdown = [
  `## Full suite: head versus base — ${pass ? "PASS (no new failures)" : "FAIL"}`,
  "",
  `head \`${summary.headSha}\`: ${summary.head ? `${summary.head.passed}/${summary.head.total} passed, ${summary.head.failed} failed` : "no report"}`,
  `base \`${summary.baseSha}\`: ${summary.base ? `${summary.base.passed}/${summary.base.total} passed, ${summary.base.failed} failed` : "no report"}`,
  "",
  ...(problems.length ? ["### Problems", ...problems.map((p) => `- ${p}`), ""] : []),
  `### Introduced by head (${introduced.length}) — any entry fails the job`,
  list(introduced),
  "",
  `### Inherited: failing identically on base and head (${inherited.length})`,
  list(inherited),
  "",
  `### Failing on base, passing on head (${fixedOnHead.length})`,
  list(fixedOnHead),
  "",
].join("\n");
writeFileSync(join(outDir, "full-suite-differential.md"), markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
console.log(`\n${markdown}`);

writeFileSync(join(outDir, "full-suite-exit-code.txt"), `${pass ? 0 : 1}\n`);
process.exit(pass ? 0 : 1);
