// The wake bridge as processes: the workflow's steps and the routine's guard run as real
// `node wake.mjs …` children against the test-only harness in ./wakeHarness (a fake GitHub API and
// a fake routine /fire endpoint sharing one state file in a fresh temp directory). Nothing leaves
// the machine and no real token exists.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const WAKE = join(here, "wake.mjs");
const FETCH = join(here, "wakeHarness", "fetch.mjs");
const BIN = join(here, "wakeHarness", "bin");
const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_HARNESS/fire";
const TOKEN = "harness-routine-token-not-real";
const REPO = "setupify-labz/Specsmith", ME = "setupify-labz";
const SHA = { alpha: "a".repeat(40), beta: "b".repeat(40) };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

let dir: string, statePath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wake-harness-")); statePath = join(dir, "state.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function record(id: string, issue: number, pr: number, head: string) {
  return {
    kind: "specsmith-auto-goal", version: 1, id, revision: 5, issue, pr, head, requiredChecks: [], outcome: null,
    runs: [{ n: 1, sessionId: `s-${id}`, startedBy: "routine", startedAt: ago(30), endedAt: ago(25), result: "ok", head, next: null }],
  };
}
const recordComment = (id: number, r: ReturnType<typeof record>) => ({
  id, user: { login: ME }, created_at: ago(25), updated_at: ago(25), issue_url: `https://api.github.com/repos/${REPO}/issues/${r.issue}`,
  body: `<!-- specsmith-auto-goal id=${r.id} rev=${r.revision} -->\n**Auto Goal record**\n\n\`\`\`json\n${JSON.stringify(r)}\n\`\`\``,
});
const pull = (number: number, goal: string, issue: number, head: string) => ({
  number, state: "open", merged: false, draft: true, title: `Auto Goal ${goal}: a small site bug`,
  body: `Opened by the unattended Auto Goal runner.\n\nGoal record: #${issue}. The request is recorded there.`,
  head: { sha: head, ref: `claude/auto-goal-${goal}`, repo: { full_name: REPO } }, base: { ref: "main", repo: { full_name: REPO } },
});

/** Two active goals: alpha (older issue) and beta, each waiting on Codex for its own PR. */
function world(over: Record<string, unknown> = {}) {
  const alpha = record("alpha", 300, 310, SHA.alpha), beta = record("beta", 301, 311, SHA.beta);
  const issue = (number: number) => ({ number, state: "open", labels: [{ name: "auto-goal" }], created_at: ago(120 - number + 300) });
  writeFileSync(statePath, JSON.stringify({
    repo: REPO, nextId: 9000, fireFailures: 0, fireLost: 0, fireCalls: [], deliveries: [], fires: [],
    issues: [issue(300), issue(301)],
    comments: { 300: [recordComment(1, alpha)], 301: [recordComment(2, beta)] },
    pulls: { 310: pull(310, "alpha", 300, SHA.alpha), 311: pull(311, "beta", 301, SHA.beta) },
    checkRuns: {}, statuses: {},
    ...over,
  }));
}
const state = () => JSON.parse(readFileSync(statePath, "utf8"));
const patch = (fn: (s: any) => void) => { const s = state(); fn(s); writeFileSync(statePath, JSON.stringify(s)); };

function run(args: string[], event?: { name: string; payload: unknown }) {
  const eventPath = join(dir, "event.json");
  if (event) writeFileSync(eventPath, JSON.stringify(event.payload));
  const res = spawnSync(process.execPath, ["--import", FETCH, WAKE, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${BIN}${delimiter}${process.env.PATH}`, WAKE_HARNESS_STATE: statePath,
      GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: "ghs_harness", GITHUB_EVENT_NAME: event?.name ?? "", GITHUB_EVENT_PATH: eventPath,
      AUTO_GOAL_REPO: REPO, AUTO_GOAL_TRUSTED_LOGIN: ME, AUTO_GOAL_ROUTINE_FIRE_URL: FIRE_URL, AUTO_GOAL_ROUTINE_TOKEN: TOKEN,
      AUTO_GOAL_FIRE_BACKOFF_MS: "0", AUTO_GOAL_RETRY_DELAY_MS: "0",
    },
  });
  const out = `${res.stdout}${res.stderr}`;
  expect(out).not.toContain(TOKEN);
  return { code: res.status, out };
}
const codexVerdictOn = (pr: number) => ({
  name: "issue_comment",
  payload: { action: "created", issue: { number: pr, pull_request: {} }, comment: { user: { login: "chatgpt-codex-connector[bot]" }, body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `bbbbbbbbbb`" } },
});

/** What the fixed routine prompt does with a fire payload: take only a ticket id, nothing else. */
function routineGuard(text: string) {
  const ticket = /^wake ticket=(\d+)$/.exec(text);
  const res = run(["guard", ...(ticket ? ["--ticket", ticket[1]] : [])]);
  const line = res.out.trim().split("\n").filter((l) => l.startsWith("{")).at(-1) ?? "{}";
  return { ...res, verdict: JSON.parse(line) };
}

describe("a wake runs the goal it was for", () => {
  it("a wake for goal B never runs goal A, even when A is the older active goal", () => {
    world();
    expect(run(["event"], codexVerdictOn(311)).code).toBe(0);
    const [text] = state().fires;
    expect(text).toBeDefined();
    const { verdict } = routineGuard(text);
    expect(verdict).toMatchObject({ proceed: true, goal: "beta", issue: 301 });
  });
  it("refuses when the run cannot name a verified wake", () => {
    world();
    expect(routineGuard("").verdict).toMatchObject({ proceed: false });
    expect(routineGuard("wake ticket=424242").verdict).toMatchObject({ proceed: false });
  });
  it("refuses a ticket that was not written by the wake workflow", () => {
    world();
    patch((s) => s.comments[301].push({ id: 777, user: { login: "mallory" }, created_at: ago(1), updated_at: ago(1), issue_url: `https://api.github.com/repos/${REPO}/issues/301`,
      body: `<!-- specsmith-auto-goal-wake goal=beta issue=301 pr=311 sha=${SHA.beta} reason=codex state=fired attempts=1 -->` }));
    expect(routineGuard("wake ticket=777").verdict).toMatchObject({ proceed: false });
  });
  it("refuses a ticket a run has already consumed, or one for a commit the goal has left", () => {
    world();
    run(["event"], codexVerdictOn(311));
    const [text] = state().fires;
    patch((s) => { const r = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(s.comments[301][0].body)![1]); r.runs.push({ n: 2, sessionId: "s2", startedBy: "routine", startedAt: new Date(Date.now() + 1000).toISOString(), endedAt: null, result: null, head: SHA.beta, next: null }); r.revision = 6; s.comments[301].push({ ...s.comments[301][0], id: 3, body: s.comments[301][0].body.replace(/rev=5/, "rev=6").replace(/```json\n[\s\S]*?\n```/, "```json\n" + JSON.stringify(r) + "\n```") }); });
    expect(routineGuard(text).verdict).toMatchObject({ proceed: false });
  });
});

describe("a failed routine call is retried without another event", () => {
  it("re-fires from the workflow's retry step after the event step's attempts all fail", () => {
    world({ fireFailures: 2 });
    const first = run(["event"], codexVerdictOn(311));
    expect(first.code).not.toBe(0);           // the job fails visibly, which starts the retry job
    expect(state().fires).toEqual([]);
    expect(run(["retry"]).code).toBe(0);
    expect(state().fires).toHaveLength(1);
    expect(routineGuard(state().fires[0]).verdict).toMatchObject({ proceed: true, goal: "beta" });
  });
  it("a redelivered event after a failed call fires again instead of being taken for a duplicate", () => {
    world({ fireFailures: 2 });
    run(["event"], codexVerdictOn(311));
    expect(run(["event"], codexVerdictOn(311)).code).toBe(0);
    expect(state().fires).toHaveLength(1);
  });
  it("keeps duplicate protection for a call that succeeded", () => {
    world();
    run(["event"], codexVerdictOn(311));
    run(["event"], codexVerdictOn(311));
    run(["retry"]);
    expect(state().fires).toHaveLength(1);
  });
  it("gives up after a bounded number of attempts and leaves the ticket marked failed", () => {
    world({ fireFailures: 99 });
    run(["event"], codexVerdictOn(311));
    expect(run(["retry"]).code).not.toBe(0);  // the retry job fails visibly too
    expect(run(["retry"]).out).toContain("nothing to retry");   // and nothing calls again after the cap
    const s = state();
    expect(s.fires).toEqual([]);
    expect(s.fireCalls).toHaveLength(4);
    expect(s.comments[301].at(-1).body).toMatch(/state=failed attempts=4/);
  });
});
