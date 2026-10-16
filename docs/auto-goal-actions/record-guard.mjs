// Trusted validation of the goal record before the executor uses it (Codex P1 on #189).
//
// The guard used to take the highest revision by the trusted login as raw JSON. A corrupted or
// prompt-injected revision could then set `branch: main` and a live dispatch whose base is main's head,
// and the publish job would push the proposal straight to main. A later revision could also move
// `baseBranch` and `executorSha` together, so the runner would dispatch, and accept a run of, an
// unreviewed workflow commit; both are now pinned to the first revision, and the base must be main.
//
// This module applies the same rules the coordinator's store applies (store.ts IssueCommentStore and
// record.ts validateGoal) to every revision, in plain JavaScript, because the executor runs it with plain
// `node` and record.ts cannot be loaded that way. recordGuard.test.ts (vitest) checks that both
// validators accept and refuse the same records.
//
// It never prints or returns record text: callers get the record, or one fixed reason.

const MARKER = /^<!-- specsmith-auto-goal id=([a-z0-9-]+)(?: rev=(\d+))? -->/;
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const RECORD_KIND = "specsmith-auto-goal";
const RECORD_VERSION = 2;
const EXECUTOR_REQUIRED_CHECKS = ["typecheck"];
const EXECUTOR_BASE_BRANCH = "main";
/** store.ts PINNED_FIELDS: fixed at the first trusted revision. */
export const PINNED_FIELDS = Object.freeze(["request", "acceptanceCriteria", "repo", "branch", "baseBranch", "executorSha"]);
const APP = "artifacts/SpecSmith";
const VITEST_FILE = /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.tsx?$/;
const BROWSER_SCRIPT = /^scripts\/ui\/[A-Za-z0-9_-]+\.mjs$/;

/** Every reason the guard can give for refusing a record. Fixed text only. */
export const RECORD_PROBLEM = Object.freeze({
  none: "no record for the goal by the trusted login",
  unreadable: "a record comment by the trusted login cannot be read",
  invalid: "a revision of the goal record is not a valid goal record",
  revision: "a record comment's marker names a different revision than it holds",
  identity: "a record comment holds a different goal than its marker names",
  pinned: "a later revision changes the request, criteria, repo, branch, base branch or executor commit fixed at the first revision",
  notExecutor: "the goal record is not an executor-mode record",
  forked: "the record has diverging saves",
});

/** check.ts describeCheck, for the four trusted check kinds; null for anything else. */
function describeCheck(spec) {
  const s = spec ?? {};
  const keys = Object.keys(s).sort().join(",");
  const step = (argv) => `(cd ${APP} && ${argv.join(" ")})`;
  switch (s.kind) {
    case "vitest": return keys === "file,kind" && typeof s.file === "string" && VITEST_FILE.test(s.file) && !s.file.includes("..") ? step(["pnpm", "exec", "vitest", "run", s.file]) : null;
    case "browser": return keys === "kind,script" && typeof s.script === "string" && BROWSER_SCRIPT.test(s.script) ? `${step(["pnpm", "run", "build"])} && ${step(["node", s.script])}` : null;
    case "typecheck": return keys === "kind" ? step(["pnpm", "run", "typecheck"]) : null;
    case "suite": return keys === "kind" ? step(["pnpm", "test"]) : null;
    default: return null;
  }
}

/**
 * record.ts validateGoal, rule for rule: the reason a record is invalid, or null when it is valid.
 * Any exception while reading a malformed record also makes it invalid.
 */
export function goalProblem(g) {
  try {
    if (!g || typeof g !== "object" || g.kind !== RECORD_KIND || (g.version !== RECORD_VERSION && g.version !== 1)) return "kind or version";
    if (typeof g.id !== "string" || !ID.test(g.id)) return "id";
    if (typeof g.request !== "string" || g.request.trim() === "") return "request";
    if (!Array.isArray(g.acceptanceCriteria) || g.acceptanceCriteria.length === 0) return "acceptance criteria";
    const ids = new Set();
    for (const c of g.acceptanceCriteria) {
      if (!c || typeof c.id !== "string" || typeof c.text !== "string" || typeof c.command !== "string" || c.command.trim() === "") return "criterion fields";
      if (!["unit", "browser", "build"].includes(c.kind)) return "criterion kind";
      if (ids.has(c.id)) return "repeated criterion";
      if (c.check !== undefined) {
        const described = describeCheck(c.check);
        if (described === null) return "untrusted check";
        if (c.command !== described) return "check command text";
      }
      ids.add(c.id);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(g.repo)) return "repo";
    if (!Array.isArray(g.requiredChecks) || g.requiredChecks.length === 0) return "required checks";
    const caps = g.caps;
    if (!caps || caps.paidSpendUsd !== 0) return "paid spend";
    for (const k of ["maxReviewRounds", "maxFixAttempts", "reviewTimeoutMinutes", "maxHours"]) if (!Number.isInteger(caps[k]) || caps[k] < 1) return `caps.${k}`;
    for (const k of ["maxRuns", "maxRunMinutes", "ciTimeoutMinutes", "dispatchGraceMinutes", "executorTimeoutMinutes"]) if (caps[k] !== undefined && (!Number.isInteger(caps[k]) || caps[k] < 1)) return `caps.${k}`;
    if (g.runs !== undefined && caps.maxRuns !== undefined && g.runs.length > caps.maxRuns) return "runs over cap";
    if (!g.policy || Object.values(g.policy).some((v) => v !== false)) return "policy";
    if (!Number.isInteger(g.revision) || g.revision < 0) return "revision";
    if (g.head !== null && !SHA.test(g.head)) return "head";
    for (const c of g.checks) {
      if (!SHA.test(c.sha)) return "check sha";
      if (c.source === undefined ? !Number.isInteger(c.exitCode) : (c.exitCode !== undefined && !Number.isInteger(c.exitCode))) return "check exit code";
      if (c.source !== undefined && (!Number.isInteger(c.source.runId) || !Number.isInteger(c.source.jobId) || typeof c.source.conclusion !== "string")) return "check source";
      if (c.criterionId !== null && !ids.has(c.criterionId)) return "check criterion";
    }
    for (const f of g.findings) {
      if (f.status === "fixed" && (!f.fixedIn || !SHA.test(f.fixedIn))) return "finding fixedIn";
      if (f.status === "dismissed" && (!f.reason || f.reason.trim() === "")) return "finding reason";
    }
    if (!Array.isArray(g.fixCommits) || g.fixAttempts !== new Set(g.fixCommits).size || g.fixAttempts !== g.fixCommits.length) return "fix attempts";
    if (g.reviewRounds.length > caps.maxReviewRounds) return "review rounds";
    if (g.outcome && !["complete", "blocked"].includes(g.outcome.status)) return "outcome";
    if (g.executorSha !== undefined || g.dispatches !== undefined) return executorProblem(g);
    return null;
  } catch {
    return "unreadable shape";
  }
}

/** record.ts validateExecutorMode. */
function executorProblem(g) {
  if (g.version !== RECORD_VERSION) return "executor version";
  if (typeof g.executorSha !== "string" || !SHA.test(g.executorSha)) return "executorSha";
  if (g.branch !== `claude/auto-goal-${g.id}`) return "executor branch";
  if (g.baseBranch !== EXECUTOR_BASE_BRANCH) return "executor base branch";
  if (g.acceptanceCriteria.length !== 1 || g.acceptanceCriteria[0].check?.kind !== "vitest") return "executor criterion";
  if (g.requiredChecks.length !== EXECUTOR_REQUIRED_CHECKS.length || g.requiredChecks.some((c, i) => c !== EXECUTOR_REQUIRED_CHECKS[i])) return "executor required checks";
  const ds = g.dispatches;
  if (!Array.isArray(ds)) return "dispatches list";
  if (ds.length > 2) return "dispatch count";
  for (const [i, d] of ds.entries()) {
    if (d.k !== i + 1 || d.nonce !== `${g.id}.d${i + 1}`) return "dispatch nonce";
    if (d.phase !== (i === 0 ? "reproduce" : "implement")) return "dispatch phase";
    if (!SHA.test(d.baseSha)) return "dispatch base";
    if (!["pending", "bound", "succeeded", "failed"].includes(d.state)) return "dispatch state";
    if (d.result !== null && !SHA.test(d.result)) return "dispatch result";
    if (d.state === "succeeded" && d.result === null) return "dispatch success without result";
    if (d.runId !== null && !Number.isInteger(d.runId)) return "dispatch run id";
    if (i > 0 && ds[i - 1].state !== "succeeded") return "dispatch order";
  }
  if (ds.filter((d) => d.state === "pending" || d.state === "bound").length > 1) return "live dispatches";
  return null;
}

/**
 * Every revision of goal `goalId` by `trustedLogin`, each checked the way the store checks it, then the
 * current one. Returns `{ record }` or `{ problem }` (a RECORD_PROBLEM value). Refuses unless:
 * - every marked comment by the trusted login has a readable JSON block holding that goal;
 * - every revision passes goalProblem (validateGoal) and its marker revision, if given, matches;
 * - every revision keeps the PINNED_FIELDS of the earliest one: request, criteria, repo, branch, base
 *   branch and executor commit (store.ts pinning);
 * - the current revision is in executor mode, with exactly one top revision (or a resolved fork).
 */
export function validatedRecord(comments, goalId, trustedLogin) {
  const entries = [];
  for (const c of comments ?? []) {
    if (c?.user?.login !== trustedLogin) continue;
    const marker = MARKER.exec(String(c.body ?? ""));
    if (!marker || marker[1] !== goalId) continue;
    const json = /```json\n([\s\S]*?)\n```/.exec(String(c.body));
    if (!json) return { problem: RECORD_PROBLEM.unreadable };
    let g;
    try { g = JSON.parse(json[1]); } catch { return { problem: RECORD_PROBLEM.unreadable }; }
    if (goalProblem(g) !== null) return { problem: RECORD_PROBLEM.invalid };
    if (g.id !== goalId) return { problem: RECORD_PROBLEM.identity };
    if (marker[2] !== undefined && Number(marker[2]) !== g.revision) return { problem: RECORD_PROBLEM.revision };
    entries.push(g);
  }
  if (!entries.length) return { problem: RECORD_PROBLEM.none };
  const pin = (g) => JSON.stringify(PINNED_FIELDS.map((k) => g[k] ?? null));
  const first = entries.find((g) => g.revision === Math.min(...entries.map((x) => x.revision)));
  if (entries.some((g) => pin(g) !== pin(first))) return { problem: RECORD_PROBLEM.pinned };
  const top = Math.max(...entries.map((g) => g.revision));
  const atTop = entries.filter((g) => g.revision === top);
  const current = atTop.at(-1);
  const resolved = new Set(current.resolvedForks ?? []);
  const revs = entries.map((g) => g.revision);
  if (revs.some((r, i) => revs.indexOf(r) !== i && !resolved.has(r))) return { problem: RECORD_PROBLEM.forked };
  if (typeof current.executorSha !== "string") return { problem: RECORD_PROBLEM.notExecutor };
  return { record: current };
}
