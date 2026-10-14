// The ambiguous routine call, end to end as processes. The workflow's call reaches Anthropic and
// starts a session, but the response is lost, so the workflow thinks it failed and calls again.
// The routine API gives no idempotency key, so each call can start a session: delivery is
// at-least-once, never exactly-once. This file shows what the duplicate sessions do when they all
// reach the same goal, through the real wake.mjs (event, retry, guard) and the real runner.ts
// (begin, advance), against the test-only harness (fake GitHub + routine endpoint) and a local bare
// git repository standing in for origin. Everything lives in a fresh temp directory.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeCheck, type CheckSpec } from "./checks.ts";
import { createGoal, validateGoal } from "./record.ts";
import { renderRecordComment } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const WAKE = join(here, "wake.mjs");
const RUNNER = join(here, "runner.ts");
const TSX = join(here, "..", "..", "node_modules", ".bin", "tsx");
const FETCH = join(here, "wakeHarness", "fetch.mjs");
const BIN = join(here, "wakeHarness", "bin");
const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_HARNESS/fire";
const TOKEN = "harness-routine-token-not-real";
const REPO = "setupify-labz/Specsmith", ME = "setupify-labz", ISSUE = 301, BRANCH = "claude/auto-goal-beta";
const UNIT: CheckSpec = { kind: "vitest", file: "src/components/partSelectorExpanded.test.tsx" };

let dir: string, statePath: string, origin: string, base: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv() }).trim();
const gitEnv = () => ({ ...process.env, GIT_AUTHOR_NAME: "harness", GIT_AUTHOR_EMAIL: "harness@example.invalid", GIT_COMMITTER_NAME: "harness", GIT_COMMITTER_EMAIL: "harness@example.invalid", GIT_CONFIG_NOSYSTEM: "1" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wake-dup-"));
  statePath = join(dir, "state.json");
  origin = join(dir, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(dir, "seed");
  execFileSync("git", ["clone", "-q", origin, seed], { env: gitEnv() });
  mkdirSync(join(seed, "artifacts", "SpecSmith"), { recursive: true });
  writeFileSync(join(seed, "artifacts", "SpecSmith", "README.md"), "base\n");
  git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", "base"); git(seed, "push", "-q", "origin", "HEAD:main");
  base = git(seed, "rev-parse", "HEAD");

  const goal = createGoal({
    id: "beta", request: "A small site bug.", repo: REPO, baseBranch: "main", branch: BRANCH, requiredChecks: ["Tests, typecheck and production build"], runner: true,
    acceptanceCriteria: [{ id: "unit", text: "the toggle says whether it is open", kind: "unit", check: UNIT, command: describeCheck(UNIT) }],
    caps: { maxRuns: 10, maxRunMinutes: 25 },
  });
  const rev1 = validateGoal({ ...goal, issue: ISSUE, revision: 1, parentComment: null });
  const created = new Date(Date.now() - 10 * 60_000).toISOString();
  writeFileSync(statePath, JSON.stringify({
    repo: REPO, nextId: 9000, fireFailures: 0, fireLost: 0, fireCalls: [], deliveries: [], fires: [],
    issues: [{ number: ISSUE, state: "open", labels: [{ name: "auto-goal" }], created_at: created }],
    comments: { [ISSUE]: [{ id: 1, user: { login: ME }, body: renderRecordComment(rev1), created_at: created, updated_at: created, html_url: "r1", issue_url: `https://api.github.com/repos/${REPO}/issues/${ISSUE}` }] },
    pulls: {}, checkRuns: {}, statuses: {},
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const state = () => JSON.parse(readFileSync(statePath, "utf8"));
const patch = (fn: (s: any) => void) => { const s = state(); fn(s); writeFileSync(statePath, JSON.stringify(s)); };
const env = (extra: Record<string, string> = {}) => ({
  ...gitEnv(), PATH: `${BIN}${delimiter}${process.env.PATH}`, WAKE_HARNESS_STATE: statePath, WAKE_HARNESS_LOGIN: ME,
  GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: "ghs_harness", AUTO_GOAL_REPO: REPO, AUTO_GOAL_TRUSTED_LOGIN: ME,
  AUTO_GOAL_ROUTINE_FIRE_URL: FIRE_URL, AUTO_GOAL_ROUTINE_TOKEN: TOKEN, AUTO_GOAL_FIRE_BACKOFF_MS: "0", AUTO_GOAL_RETRY_DELAY_MS: "0", ...extra,
});

function proc(cmd: string, args: string[], extra: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { env: env(extra) });
    let out = "";
    child.stdout.on("data", (b) => { out += b; }); child.stderr.on("data", (b) => { out += b; });
    child.on("close", (code) => { expect(out).not.toContain(TOKEN); done({ code, out }); });
  });
}
const wake = (args: string[], extra: Record<string, string> = {}) => proc(process.execPath, ["--import", FETCH, WAKE, ...args], extra);

/** One routine session, doing exactly what ROUTINE_PROMPT.md tells it to. */
function session(name: string, text: string) {
  const work = join(dir, name);
  execFileSync("git", ["clone", "-q", origin, work], { env: gitEnv() });
  const goalArgs = ["--goal", "beta", "--issue", String(ISSUE), "--repo", REPO, "--worktree", work, "--session", name];
  return {
    name,
    async guard() {
      const ticket = /^wake ticket=(\d+)$/.exec(text);
      const r = await proc(process.execPath, [WAKE, "guard", ...(ticket ? ["--ticket", ticket[1]] : [])]);
      return { ...r, verdict: JSON.parse(r.out.trim().split("\n").filter((l) => l.startsWith("{")).at(-1) ?? "{}") };
    },
    begin: (extra: Record<string, string> = {}) => proc(TSX, [RUNNER, "begin", ...goalArgs, "--started-by", "routine (API trigger)"], extra),
    commit() { writeFileSync(join(work, `${name}.txt`), `${name}\n`); git(work, "add", "-A"); git(work, "commit", "-q", "-m", `work by ${name}`); },
    advance: () => proc(TSX, [RUNNER, "advance", ...goalArgs]),
  };
}

const remoteLog = () => {
  const heads = git(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads");
  return heads.split("\n").includes(BRANCH) ? git(origin, "log", "--format=%s", `${base}..${BRANCH}`).split("\n").filter(Boolean) : [];
};
/** A goal branch an earlier step already created, so begin takes the fetch path and the race is on the record alone. */
const branchExists = () => git(origin, "branch", BRANCH, base);
const records = () => state().comments[ISSUE].filter((c: any) => c.user.login === ME).map((c: any) => JSON.parse(/```json\n([\s\S]*?)\n```/.exec(c.body)![1]));
const latest = () => records().at(-1);

/**
 * The goal is submitted; the routine call reaches Anthropic twice but both responses are lost, so the
 * event step fails; the retry job calls a third time and that answer arrives. Three sessions now
 * hold the same ticket.
 */
async function ambiguousWake() {
  patch((s) => { s.fireLost = 2; });
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify({ action: "labeled", label: { name: "auto-goal" }, sender: { login: ME }, issue: { number: ISSUE } }));
  const first = await wake(["event"], { GITHUB_EVENT_NAME: "issues", GITHUB_EVENT_PATH: eventPath });
  expect(first.code).toBe(1);
  expect((await wake(["retry"])).code).toBe(0);
  const s = state();
  expect(s.deliveries).toHaveLength(3);
  expect(new Set(s.deliveries).size).toBe(1);   // all three carry the same ticket
  expect(s.comments[ISSUE].at(-1).body).toMatch(/state=fired attempts=3/);
  return ["s1", "s2", "s3"].map((n) => session(n, s.deliveries[0]));
}

describe("an ambiguous routine call starts duplicate sessions for one ticket", { timeout: 60_000 }, () => {
  it("staggered sessions: the first opens the run; the guard turns the later ones away", async () => {
    const [s1, s2, s3] = await ambiguousWake();
    expect((await s1.guard()).verdict).toMatchObject({ proceed: true, goal: "beta" });
    expect((await s1.begin()).code).toBe(0);
    for (const s of [s2, s3]) expect((await s.guard()).verdict).toMatchObject({ proceed: false, why: expect.stringContaining("already taken by run 1") });
    s1.commit();
    expect((await s1.advance()).code).toBe(0);
    expect(remoteLog()).toEqual(["work by s1"]);
    expect(latest().runs.map((r: any) => r.sessionId)).toEqual(["s1"]);
  });

  it("all guards pass before any run opens: the first begin wins, later begins change nothing, only the winner pushes", async () => {
    const sessions = await ambiguousWake();
    for (const s of sessions) expect((await s.guard()).verdict).toMatchObject({ proceed: true, goal: "beta" });
    const [s1, s2, s3] = sessions;
    expect((await s1.begin()).code).toBe(0);
    const afterWinner = records().length;
    for (const s of [s2, s3]) {
      const r = await s.begin();
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("Run 1 by session s1");
    }
    expect(records()).toHaveLength(afterWinner);   // the duplicates saved nothing
    expect(latest().runs).toEqual([expect.objectContaining({ n: 1, sessionId: "s1", endedAt: null })]);   // and never called the live run abandoned
    // Even a duplicate that ignored its refusal cannot push: advance belongs to the run's own session.
    s2.commit();
    const rogue = await s2.advance();
    expect(rogue.code).not.toBe(0);
    expect(rogue.out).toContain("belongs to session s1");
    s1.commit();
    expect((await s1.advance()).code).toBe(0);
    expect(remoteLog()).toEqual(["work by s1"]);
  });

  it("two begins read the same revision at once: both saves are kept as a fork, both sessions stop, nothing is pushed, and later wakes refuse", async () => {
    branchExists();
    const [s1, s2] = await ambiguousWake();
    for (const s of [s1, s2]) expect((await s.guard()).verdict).toMatchObject({ proceed: true });
    const hold = join(dir, "hold");
    const racing = [s1.begin({ WAKE_HARNESS_HOLD: hold }), s2.begin({ WAKE_HARNESS_HOLD: hold })];
    await waitFor(() => readdirSync(dir).filter((f) => f.startsWith("hold.waiting.")).length === 2);
    writeFileSync(`${hold}.release`, "");
    const results = await Promise.all(racing);
    for (const r of results) { expect(r.code).not.toBe(0); expect(r.out).toMatch(/Another session saved goal beta at the same time/); }
    const revs = records().map((r: any) => r.revision);
    expect(revs.filter((n: number) => n === 2)).toHaveLength(2);   // both claims are on the issue, neither dropped
    for (const s of [s1, s2]) { s.commit(); const r = await s.advance(); expect(r.code).not.toBe(0); expect(r.out).toContain("diverging saves"); }
    expect(remoteLog()).toEqual([]);
    // The goal waits for a person: the guard and the wake bridge both refuse a forked record.
    expect((await s1.guard()).verdict).toMatchObject({ proceed: false, why: expect.stringContaining("diverging saves") });
  });

  it("one begin saves before the other posts: the late one stops, the early one is stopped at advance, nothing is pushed", async () => {
    branchExists();
    const [s1, s2] = await ambiguousWake();
    for (const s of [s1, s2]) expect((await s.guard()).verdict).toMatchObject({ proceed: true });
    const hold = join(dir, "hold");
    const late = s2.begin({ WAKE_HARNESS_HOLD: hold });   // s2 has read revision 1 and is about to post
    await waitFor(() => readdirSync(dir).some((f) => f.startsWith("hold.waiting.")));
    expect((await s1.begin()).code).toBe(0);              // s1 reads revision 1, posts 2, sees no rival yet
    writeFileSync(`${hold}.release`, "");
    const r2 = await late;
    expect(r2.code).not.toBe(0);
    expect(r2.out).toMatch(/Another session saved goal beta at the same time/);
    s1.commit();
    const r1 = await s1.advance();
    expect(r1.code).not.toBe(0);
    expect(r1.out).toContain("diverging saves");
    expect(remoteLog()).toEqual([]);
  });
});

describe("the same sequence with no forced ordering", { timeout: 90_000 }, () => {
  it("three sessions racing from scratch: at most one pushes, and only one that owns the run on an unforked record", async () => {
    const sessions = await ambiguousWake();
    for (const s of sessions) expect((await s.guard()).verdict).toMatchObject({ proceed: true });
    const begun = await Promise.all(sessions.map((s) => s.begin()));
    // Whatever order the processes ran in, every loser stopped with a stated reason, never a crash.
    for (const r of begun) if (r.code !== 0) expect(r.out).toMatch(/^(REFUSED|CONFLICT): /m);
    for (const s of sessions) s.commit();
    const advanced = await Promise.all(sessions.map((s) => s.advance()));
    const pushed = remoteLog();
    expect(pushed.length).toBeLessThanOrEqual(1);
    const winners = sessions.filter((_, i) => advanced[i].code === 0).map((s) => s.name);
    expect(winners.length).toBeLessThanOrEqual(1);
    if (winners.length) {
      expect(pushed).toEqual([`work by ${winners[0]}`]);
      expect(latest().runs.map((r: any) => r.sessionId)).toEqual([winners[0]]);
    }
    // No record ever calls a live run abandoned.
    for (const r of records()) for (const run of r.runs ?? []) expect(String(run.result ?? "")).not.toContain("Abandoned");
  });
});

async function waitFor(ok: () => boolean, ms = 20_000) {
  const until = Date.now() + ms;
  while (!ok()) { if (Date.now() > until) throw new Error("timed out waiting for the harness"); await new Promise((r) => setTimeout(r, 25)); }
}
