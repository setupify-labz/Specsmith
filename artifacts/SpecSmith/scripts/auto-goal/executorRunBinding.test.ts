// Regression tests for binding an executor run to its dispatch (PILOT_HANDOFF_CONTRACT.md §2), with
// workflow-run objects shaped like GitHub's REST and webhook responses.
//
// GitHub's run objects keep the workflow's `name` separate from the custom `run-name`, which arrives as
// `display_title`. Observed on this repository (October 2026): workflow_dispatch runs whose `name` and
// `display_title` differ, so `name` cannot carry the dispatch nonce. GitHub's documented examples also
// show `path` with a ref suffix (".github/workflows/x.yml@main"). The coordinator must bind on
// display_title, accept the executor path with no suffix or the base branch's ref, and still verify the
// workflow, event, branch and pinned commit.

import { describe, expect, it } from "vitest";

import { describeCheck } from "./checks.ts";
import type { ExecutorGitHub, GhWorkflowRun } from "./github.ts";
import { createGoal, nonceFor, type GoalRecord } from "./record.ts";
import { syncDispatch } from "./sync.ts";
// @ts-expect-error: plain JavaScript module without type declarations.
import { normalizeEvent } from "./wake.mjs";

const REPO = "setupify-labz/Specsmith";
const ID = "pilot-1";
const NONCE = nonceFor(ID, 1);
const E = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4";
const WORKFLOW_ID = 162_000_111;
const WORKFLOW_NAME = "Auto Goal Actions executor (disabled design)";
const T0 = new Date("2026-10-16T09:00:00Z");

/** A workflow run as GET /repos/{owner}/{repo}/actions/runs returns it (the fields GitHub sends, trimmed of URLs). */
function restRun(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 38700000001, name: WORKFLOW_NAME, node_id: "WFR_kwLOExample", head_branch: "main", head_sha: E,
    path: ".github/workflows/auto-goal-actions.yml@main", display_title: `Auto Goal ${ID} ${NONCE}`,
    run_number: 1, event: "workflow_dispatch", status: "completed", conclusion: "failure", workflow_id: WORKFLOW_ID,
    check_suite_id: 1, url: `https://api.github.com/repos/${REPO}/actions/runs/38700000001`, html_url: `https://github.com/${REPO}/actions/runs/38700000001`,
    pull_requests: [], created_at: "2026-10-16T09:01:00Z", updated_at: "2026-10-16T09:20:00Z", run_attempt: 1, run_started_at: "2026-10-16T09:01:05Z",
    actor: { login: "setupify-labz" }, triggering_actor: { login: "setupify-labz" },
    ...over,
  };
}

function goal(): GoalRecord {
  const g = createGoal({
    id: ID, request: "r", repo: REPO, baseBranch: "main", branch: `claude/auto-goal-${ID}`, requiredChecks: ["typecheck"], runner: true, executorSha: E, now: T0,
    acceptanceCriteria: [{ id: "c", text: "t", kind: "unit", check: { kind: "vitest", file: "src/lib/clamp.test.ts" }, command: describeCheck({ kind: "vitest", file: "src/lib/clamp.test.ts" }) }],
  });
  g.dispatches = [{ k: 1, nonce: NONCE, phase: "reproduce", baseSha: E, createdAt: T0.toISOString(), sentAt: T0.toISOString(), runId: null, state: "pending", result: null }];
  return g;
}

/** Only what syncDispatch reads; the run's jobs show a failed implement step, so a bound run ends in a known blocker. */
function github(runs: object[]): ExecutorGitHub {
  const no = async () => { throw new Error("not used"); };
  return {
    executorRuns: async () => runs as GhWorkflowRun[],
    executorWorkflowId: async () => WORKFLOW_ID,
    runJobs: async () => [{ id: 1, name: "read-dispatch", status: "completed", conclusion: "success", html_url: "j1" }, { id: 2, name: "implement", status: "completed", conclusion: "failure", html_url: "j2" }],
    branchHead: async () => null, openPullsFor: async () => [],
    dispatchExecutor: no, run: no, compareFiles: no, commit: no, whoami: no, pull: no, checkRuns: no, issueComments: no, reviews: no, reviewComments: no, createIssue: no, createComment: no, createDraftPull: no,
  } as unknown as ExecutorGitHub;
}

async function sync(runs: object[], minutesLater = 5) {
  const g = goal();
  await syncDispatch(g, github(runs), new Date(T0.getTime() + minutesLater * 60_000));
  return g;
}

describe("binding executor runs from GitHub's REST run objects", () => {
  it("binds a real-shaped run: workflow name in `name`, the run-name in `display_title`, `@main` on the path", async () => {
    const g = await sync([restRun()]);
    expect(g.dispatches![0]).toMatchObject({ runId: 38700000001 });
    expect(g.outcome?.reason).toMatch(/^Publish failed for pilot-1\.d1 \(job implement: failure\)/);
  });

  it("binds with the path's ref suffix absent, or as the full ref of the base branch", async () => {
    for (const path of [".github/workflows/auto-goal-actions.yml", ".github/workflows/auto-goal-actions.yml@refs/heads/main"]) {
      const g = await sync([restRun({ path })]);
      expect(g.dispatches![0].runId, path).toBe(38700000001);
      expect(g.outcome?.reason, path).toMatch(/^Publish failed for pilot-1\.d1/);
    }
  });

  it("ignores runs whose display_title names another dispatch or goal, even if `name` looks like a match", async () => {
    for (const over of [
      { display_title: `Auto Goal ${ID} ${nonceFor(ID, 2)}` },
      { display_title: `Auto Goal other-goal other-goal.d1` },
      { display_title: WORKFLOW_NAME, name: `Auto Goal ${ID} ${NONCE}` }, // the nonce only in `name` is not the run-name
      { display_title: `Auto Goal ${ID} ${NONCE} ` },
    ]) {
      const g = await sync([restRun(over)], 16);
      expect(g.dispatches![0].runId, JSON.stringify(over)).toBeNull();
      expect(g.outcome?.reason, JSON.stringify(over)).toBe("Executor run for pilot-1.d1 was not seen; no automatic resend in version 1.");
    }
  });

  it("refuses a run with the right title but the wrong workflow, ref, event, branch or commit", async () => {
    for (const [over, why] of [
      [{ path: ".github/workflows/other.yml@main" }, /is not the executor workflow/],
      [{ path: ".github/workflows/auto-goal-actions.yml@claude/auto-goal-pilot-1" }, /is not the executor workflow at main/],
      [{ path: ".github/workflows/auto-goal-actions.yml@refs/heads/feature" }, /is not the executor workflow at main/],
      [{ path: ".github/workflows/auto-goal-actions.yml@main@main" }, /is not the executor workflow/],
      [{ workflow_id: WORKFLOW_ID + 1 }, /is not the executor workflow/],
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

/** A workflow_run webhook payload, as the wake workflow receives it (trimmed to the fields GitHub sends that matter here). */
function webhook(over: Partial<Record<string, unknown>> = {}) {
  return {
    action: "completed",
    workflow_run: { ...restRun(), ...over },
    workflow: { id: WORKFLOW_ID, name: WORKFLOW_NAME, path: ".github/workflows/auto-goal-actions.yml", state: "active" },
    repository: { full_name: REPO }, sender: { login: "setupify-labz" },
  };
}

describe("the wake bridge reads workflow_run payloads by display_title and normalised path", () => {
  it("maps a real-shaped completed executor run to its goal and nonce", () => {
    expect(normalizeEvent("workflow_run", webhook(), "setupify-labz")).toEqual({ kind: "executor", goal: ID, nonce: NONCE, sha: null, prs: [], issue: null });
    expect(normalizeEvent("workflow_run", webhook({ path: ".github/workflows/auto-goal-actions.yml" }), "setupify-labz")).toMatchObject({ kind: "executor", nonce: NONCE });
    expect(normalizeEvent("workflow_run", webhook({ path: ".github/workflows/auto-goal-actions.yml@refs/heads/main" }), "setupify-labz")).toMatchObject({ kind: "executor", nonce: NONCE });
  });

  it("skips wrong titles, refs, events and workflows instead of waking a goal", () => {
    for (const over of [
      { display_title: WORKFLOW_NAME },
      { display_title: "Auto Goal pilot-1 other-goal.d1" },
      { display_title: WORKFLOW_NAME, name: `Auto Goal ${ID} ${NONCE}` },
      { path: ".github/workflows/auto-goal-actions.yml@claude/auto-goal-pilot-1" },
      { event: "push" },
    ]) expect(normalizeEvent("workflow_run", webhook(over), "setupify-labz"), JSON.stringify(over)).toHaveProperty("skip");
    // Another workflow's completion keeps its existing meaning: a PR checks wake.
    expect(normalizeEvent("workflow_run", webhook({ path: ".github/workflows/verify-pr.yml@main", name: "Verify pull request", display_title: "Some PR title", event: "pull_request", pull_requests: [{ number: 50 }] }), "setupify-labz")).toMatchObject({ kind: "checks", prs: [50] });
  });
});
