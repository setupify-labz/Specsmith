// Binding an executor run to its dispatch (PILOT_HANDOFF_CONTRACT.md §2), tested against a real
// workflow_dispatch run and against constructed runs.
//
// Observed (isolation-repo smoke test, 2026-10-15; evidence in fixtures/isolation-smoke-38806500325/): for a
// workflow_dispatch run with a custom run-name, GitHub's REST run object and workflow_run webhook payload
// both set `name` AND `display_title` to the run-name, and `path` had no ref suffix. The workflow's own name
// appears only in the separate workflow object.
//
// The binding code matches the run-name on `display_title` (the field GitHub documents for it) and checks
// the workflow id, the path, the event, the base branch, the pinned commit and the nonce. The code before
// 9eaf33a matched on `name` and required an unsuffixed path; on the observed data those agree, so it
// would also have bound the real run. What it lacked is checked separately below: the workflow id, and
// the ref suffix GitHub documents on `path` but which was not observed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeCheck } from "./checks.ts";
import type { ExecutorGitHub, GhWorkflowRun } from "./github.ts";
import { createGoal, nonceFor, type GoalRecord } from "./record.ts";
import { bindExecutorRun, syncDispatch } from "./sync.ts";
// @ts-expect-error: plain JavaScript module without type declarations.
import { normalizeEvent } from "./wake.mjs";

const FIXTURE = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "isolation-smoke-38806500325");
const fixture = (file: string) => JSON.parse(readFileSync(join(FIXTURE, file), "utf8"));
const REAL_RUN = fixture("rest-run.json");
const REAL_WORKFLOW = fixture("rest-workflow.json");
const REAL_WEBHOOK = fixture("workflow-run-webhook-fields.json");

/** A goal whose executor commit, base branch and live dispatch are those of `run`. */
function goalFor(id: string, nonce: string, executorSha: string, repo: string, createdAt: string): GoalRecord {
  const at = new Date(Date.parse(createdAt) - 60_000);
  const g = createGoal({
    id, request: "r", repo, baseBranch: "main", branch: `claude/auto-goal-${id}`, requiredChecks: ["typecheck"], runner: true, executorSha, now: at,
    acceptanceCriteria: [{ id: "c", text: "t", kind: "unit", check: { kind: "vitest", file: "src/lib/clamp.test.ts" }, command: describeCheck({ kind: "vitest", file: "src/lib/clamp.test.ts" }) }],
  });
  g.dispatches = [{ k: 1, nonce, phase: "reproduce", baseSha: executorSha, createdAt: at.toISOString(), sentAt: at.toISOString(), runId: null, state: "pending", result: null }];
  return g;
}

/** Only what syncDispatch reads. The jobs show a failed implement step, so a bound run ends in a known blocker. */
function github(runs: object[], workflowId: number): ExecutorGitHub {
  const no = async () => { throw new Error("not used"); };
  return {
    executorRuns: async () => runs as GhWorkflowRun[],
    executorWorkflowId: async () => workflowId,
    runJobs: async () => [{ id: 1, name: "read-dispatch", status: "completed", conclusion: "success", html_url: "j1" }, { id: 2, name: "implement", status: "completed", conclusion: "failure", html_url: "j2" }],
    branchHead: async () => null, openPullsFor: async () => [],
    dispatchExecutor: no, run: no, compareFiles: no, commit: no, whoami: no, pull: no, checkRuns: no, issueComments: no, reviews: no, reviewComments: no, createIssue: no, createComment: no, createDraftPull: no,
  } as unknown as ExecutorGitHub;
}

// ---- The real run ------------------------------------------------------------------------------------

describe("the observed smoke-test run (real REST and webhook data)", () => {
  const goal = (nonce = "smoke-1.d1", sha = REAL_RUN.head_sha) => goalFor("smoke-1", nonce, sha, REAL_RUN.repository.full_name, REAL_RUN.created_at);

  it("has the shape the tests below assume: name and display_title both the run-name, no path suffix", () => {
    expect(REAL_RUN).toMatchObject({ name: "Auto Goal smoke-1 smoke-1.d1", display_title: "Auto Goal smoke-1 smoke-1.d1", path: ".github/workflows/auto-goal-actions.yml", workflow_id: REAL_WORKFLOW.id, event: "workflow_dispatch", head_branch: "main" });
    expect(REAL_WEBHOOK.workflow_run).toMatchObject({ id: REAL_RUN.id, name: REAL_RUN.name, display_title: REAL_RUN.display_title, path: REAL_RUN.path, workflow_id: REAL_RUN.workflow_id, head_sha: REAL_RUN.head_sha });
    expect(REAL_WORKFLOW.name).toBe("Auto Goal run-name smoke test");
  });

  it("binds to the dispatch it was for, and refuses another nonce or another executor commit", async () => {
    expect(bindExecutorRun(REAL_RUN, goal(), "smoke-1.d1", REAL_WORKFLOW.id)).toBeNull();
    expect(bindExecutorRun(REAL_RUN, goal("smoke-1.d2"), "smoke-1.d2", REAL_WORKFLOW.id)).toBe("is titled for another dispatch");
    expect(bindExecutorRun(REAL_RUN, goal("smoke-1.d1", "0".repeat(40)), "smoke-1.d1", REAL_WORKFLOW.id)).toMatch(/^ran main@1f41a56787, not the reviewed executor/);
    const g = goal();
    await syncDispatch(g, github([REAL_RUN], REAL_WORKFLOW.id), new Date(Date.parse(REAL_RUN.updated_at) + 60_000));
    expect(g.dispatches![0].runId).toBe(REAL_RUN.id);
  });

  it("the wake bridge maps the real workflow_run payload to the goal and nonce", () => {
    expect(normalizeEvent("workflow_run", REAL_WEBHOOK, "setupify-labz")).toEqual({ kind: "executor", goal: "smoke-1", nonce: "smoke-1.d1", sha: null, prs: [], issue: null });
  });
});

// ---- Constructed runs in the observed shape -------------------------------------------------------------

const REPO = "setupify-labz/Specsmith";
const ID = "pilot-1";
const NONCE = nonceFor(ID, 1);
const TITLE = `Auto Goal ${ID} ${NONCE}`;
const E = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4";
const WORKFLOW_ID = 162_000_111;

/** A REST run in the observed shape (name = display_title = run-name, no path suffix), with this goal's values. */
function restRun(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...REAL_RUN, id: 38700000001, name: TITLE, display_title: TITLE, path: ".github/workflows/auto-goal-actions.yml", workflow_id: WORKFLOW_ID,
    event: "workflow_dispatch", head_branch: "main", head_sha: E, status: "completed", conclusion: "failure",
    html_url: `https://github.com/${REPO}/actions/runs/38700000001`, pull_requests: [], created_at: "2026-10-16T09:01:00Z", updated_at: "2026-10-16T09:20:00Z",
    ...over,
  };
}

async function sync(runs: object[], minutesLater = 5) {
  const g = goalFor(ID, NONCE, E, REPO, "2026-10-16T09:01:00Z");
  await syncDispatch(g, github(runs, WORKFLOW_ID), new Date(Date.parse("2026-10-16T09:00:00Z") + minutesLater * 60_000));
  return g;
}

describe("binding constructed runs in the observed shape", () => {
  it("binds a run with this goal's title, workflow id, path, event, branch and commit", async () => {
    const g = await sync([restRun()]);
    expect(g.dispatches![0].runId).toBe(38700000001);
    expect(g.outcome?.reason).toMatch(/^Publish failed for pilot-1\.d1 \(job implement: failure\)/);
  });

  it("ignores runs titled for another dispatch or goal", async () => {
    for (const title of [`Auto Goal ${ID} ${nonceFor(ID, 2)}`, "Auto Goal other-goal other-goal.d1", `${TITLE} `, "Auto Goal run-name smoke test"]) {
      const g = await sync([restRun({ name: title, display_title: title })], 16);
      expect(g.dispatches![0].runId, title).toBeNull();
      expect(g.outcome?.reason, title).toBe("Executor run for pilot-1.d1 was not seen; no automatic resend in version 1.");
    }
  });

  it("refuses a run with the right title but the wrong workflow id, workflow file, event, branch or commit", async () => {
    for (const [over, why] of [
      [{ workflow_id: WORKFLOW_ID + 1 }, /is not the executor workflow\.$/],
      [{ path: ".github/workflows/other.yml" }, /is not the executor workflow\.$/],
      [{ event: "push" }, /was started by push, not workflow_dispatch/],
      [{ head_branch: "claude/auto-goal-pilot-1" }, /ran claude\/auto-goal-pilot-1@/],
      [{ head_sha: "0".repeat(40) }, /ran main@0000000000, not the reviewed executor/],
    ] as const) {
      const g = await sync([restRun(over)]);
      expect(g.outcome?.reason, JSON.stringify(over)).toMatch(/^Executor run 38700000001 is not the reviewed executor at e3b0c44298fc1c149afbf4c8996fb92427ae41e4: it /);
      expect(g.outcome?.reason, JSON.stringify(over)).toMatch(why);
      expect(g.dispatches![0].state).toBe("failed");
    }
  });
});

// ---- Documented by GitHub but not observed ---------------------------------------------------------------

describe("documented but unobserved: a ref suffix on path", () => {
  it("accepts the executor path with the base branch as a suffix, short or full", async () => {
    for (const path of [".github/workflows/auto-goal-actions.yml@main", ".github/workflows/auto-goal-actions.yml@refs/heads/main"]) {
      const g = await sync([restRun({ path })]);
      expect(g.dispatches![0].runId, path).toBe(38700000001);
      expect(g.outcome?.reason, path).toMatch(/^Publish failed for pilot-1\.d1/);
    }
  });

  it("refuses any other ref, and a malformed suffix", async () => {
    for (const [path, why] of [
      [".github/workflows/auto-goal-actions.yml@claude/auto-goal-pilot-1", /is not the executor workflow at main\.$/],
      [".github/workflows/auto-goal-actions.yml@refs/heads/feature", /is not the executor workflow at main\.$/],
      [".github/workflows/auto-goal-actions.yml@main@main", /is not the executor workflow\.$/],
      [".github/workflows/auto-goal-actions.yml@", /is not the executor workflow\.$/],
      [".github/workflows/other.yml@main", /is not the executor workflow\.$/],
    ] as const) {
      const g = await sync([restRun({ path })]);
      expect(g.outcome?.reason, path).toMatch(why);
    }
  });
});

describe("defensive, unobserved: name and display_title differ", () => {
  it("the run-name is read from display_title; a nonce only in name does not bind", async () => {
    // Not seen for a run with a custom run-name (both fields held it), but GitHub documents
    // display_title as the run-name field, so that is the one the binding trusts.
    expect((await sync([restRun({ name: "Auto Goal run-name smoke test" })])).dispatches![0].runId).toBe(38700000001);
    const g = await sync([restRun({ name: TITLE, display_title: "Auto Goal run-name smoke test" })], 16);
    expect(g.dispatches![0].runId).toBeNull();
  });
});

// ---- The wake bridge ---------------------------------------------------------------------------------------

/** A workflow_run webhook payload in the observed shape (REAL_WEBHOOK), with this goal's values. */
function webhook(over: Partial<Record<string, unknown>> = {}) {
  return { ...REAL_WEBHOOK, workflow_run: { ...REAL_WEBHOOK.workflow_run, name: TITLE, display_title: TITLE, workflow_id: WORKFLOW_ID, head_sha: E, ...over }, repository: { full_name: REPO, default_branch: "main" } };
}

describe("the wake bridge reads workflow_run payloads by display_title and path", () => {
  it("maps an executor run in the observed shape, and with the documented suffixes", () => {
    for (const path of [".github/workflows/auto-goal-actions.yml", ".github/workflows/auto-goal-actions.yml@main", ".github/workflows/auto-goal-actions.yml@refs/heads/main"]) {
      expect(normalizeEvent("workflow_run", webhook({ path }), "setupify-labz"), path).toEqual({ kind: "executor", goal: ID, nonce: NONCE, sha: null, prs: [], issue: null });
    }
  });

  it("skips wrong titles, other refs and other events instead of waking a goal", () => {
    for (const over of [
      { name: "Auto Goal run-name smoke test", display_title: "Auto Goal run-name smoke test" },
      { name: "Auto Goal pilot-1 other-goal.d1", display_title: "Auto Goal pilot-1 other-goal.d1" },
      { path: ".github/workflows/auto-goal-actions.yml@claude/auto-goal-pilot-1" },
      { event: "push" },
    ]) expect(normalizeEvent("workflow_run", webhook(over), "setupify-labz"), JSON.stringify(over)).toHaveProperty("skip");
    // Another workflow's completion keeps its existing meaning: a PR checks wake.
    expect(normalizeEvent("workflow_run", webhook({ path: ".github/workflows/verify-pr.yml", name: "Verify pull request", display_title: "A PR title", event: "pull_request", pull_requests: [{ number: 50 }] }), "setupify-labz")).toMatchObject({ kind: "checks", prs: [50] });
  });
});
