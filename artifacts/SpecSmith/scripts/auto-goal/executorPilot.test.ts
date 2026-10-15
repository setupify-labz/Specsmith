// Version 1 of PILOT_HANDOFF_CONTRACT.md §1A, offline and end to end.
//
// The coordinator is the real runner (begin/advance, decide, sync, store). The executor is simulated
// job by job, but every trusted step it runs is the real code from docs/auto-goal-actions/: the
// dispatch guard's checks, the patch validator CLI, and run-check.mts, which runs the real trusted
// checks (vitest, tsc) against a small fixture project. Git is real: the "remote" is a local bare
// repository, and the publish step pushes to it with --force-with-lease. GitHub is a fake in this
// process; "Claude" is a fixed edit; "Codex" is a fixed comment. No credential, network service,
// workflow or live goal is involved.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseClaim, type Claim, type ClaimStore } from "./claim.ts";
import { describeCheck } from "./checks.ts";
import { CODEX_LOGIN, type GhIssueComment } from "./codex.ts";
import type { ExecutorGitHub, GhCommit, GhJob, GhPull, GhWorkflowRun } from "./github.ts";
import { main as cliMain, type Deps as CliDeps } from "./cli.ts";
import { createGoal, nonceFor, validateGoal, type GoalRecord } from "./record.ts";
import { advance, begin, type RunnerDeps } from "./runner.ts";
import { IssueCommentStore } from "./store.ts";
import { EXECUTOR_WORKFLOW_PATH, executorRunName } from "./sync.ts";
// @ts-expect-error: plain JavaScript module without type declarations.
import { decideWake, normalizeEvent, ticketBody, verifyTicket } from "./wake.mjs";
// @ts-expect-error: plain JavaScript module without type declarations (the executor's trusted code).
import { checkCommit, checkDispatch, readCurrent, REFUSAL, workPacket } from "../../../../docs/auto-goal-actions/dispatch-guard.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP = join(here, "..", "..");
const ACTIONS = join(APP, "..", "..", "docs", "auto-goal-actions");
const TSX = join(APP, "node_modules", ".bin", "tsx");
const ME = "setupify-labz";
const REPO = "setupify-labz/Specsmith";
const ID = "pilot-1";
const ISSUE = 400;
const BRANCH = `claude/auto-goal-${ID}`;
const T0 = new Date("2026-10-16T09:00:00Z");
const UNTRUSTED = "Untrusted_Marker_9d1c";
const MOCK_TOKEN = "PlaceHolder_Not_A_Token_44e0";
const CRITERION_FILE = "src/lib/clamp.test.ts";
const TYPECHECK = describeCheck({ kind: "typecheck" });
// What GitHub reports for an executor run: the workflow's name in `name`, the run-name in
// `display_title`, a ref suffix on `path`, and the workflow's id (see executorRunBinding.test.ts).
const WORKFLOW_ID = 162_000_111;
const WORKFLOW_NAME = "Auto Goal Actions executor (disabled design)";
const runShape = (nonce: string, e: string) => ({ name: WORKFLOW_NAME, display_title: executorRunName(ID, nonce), path: `${EXECUTOR_WORKFLOW_PATH}@main`, workflow_id: WORKFLOW_ID, event: "workflow_dispatch", head_branch: "main", head_sha: e });

// ---- The fixture project: a real defect, a real test, real checks ---------------------------------

const BUGGY = "export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi + 1);\n";
const FIXED = "export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);\n";
const TEST_BEFORE = 'import { expect, it } from "vitest";\nimport { clamp } from "./clamp.ts";\nit("keeps low values at the bound", () => { expect(clamp(-1, 0, 3)).toBe(0); });\n';
const TEST_REPRO = TEST_BEFORE + 'it("keeps high values at the bound", () => { expect(clamp(5, 0, 3)).toBe(3); });\n';

let root: string;
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitTry = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

/** A bare "origin" whose main commit (E = B) holds the fixture app. */
function makeOrigin(): { origin: string; base: string } {
  const dir = mkdtempSync(join(root, "seed-"));
  const app = join(dir, "artifacts/SpecSmith");
  mkdirSync(join(app, "src/lib"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(join(app, "package.json"), '{"name":"pilot-fixture","private":true,"type":"module","scripts":{"typecheck":"tsc -p tsconfig.json --noEmit"}}\n');
  writeFileSync(join(app, "tsconfig.json"), '{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","target":"es2022","noEmit":true,"types":[],"allowImportingTsExtensions":true},"include":["src"]}\n');
  writeFileSync(join(app, "src/lib/clamp.ts"), BUGGY);
  writeFileSync(join(app, CRITERION_FILE), TEST_BEFORE);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  const origin = mkdtempSync(join(root, "origin-")) + "/r.git";
  git(root, "clone", "-q", "--bare", dir, origin);
  return { origin, base: git(origin, "rev-parse", "main") };
}

/** A checkout of one commit, with the installed dependencies linked in (as `pnpm install` would provide). */
function checkout(origin: string, sha: string): string {
  const dir = mkdtempSync(join(root, "co-"));
  git(root, "clone", "-q", origin, dir);
  git(dir, "checkout", "-q", "--detach", sha);
  symlinkSync(join(APP, "node_modules"), join(dir, "artifacts/SpecSmith/node_modules"));
  return dir;
}

// ---- Fake GitHub: issue comments, PRs and Actions in memory; branches and commits from the bare repo ----

class FakeGitHub implements ExecutorGitHub {
  clock = T0;
  comments = new Map<number, GhIssueComment[]>();
  pulls: { number: number; ref: string; draft: boolean; state: string; merged: boolean; title: string; body: string }[] = [];
  runs: (GhWorkflowRun & { jobs: GhJob[] })[] = [];
  dispatched: { ref: string; inputs: Record<string, string> }[] = [];
  dispatchFails = false;
  writes: string[] = [];
  private id = 9000;
  constructor(readonly origin: string, readonly e: string) {}
  next() { return this.id++; }
  comment(body: string, login = ME): GhIssueComment { const id = this.next(); return { id, user: { login }, body, created_at: this.clock.toISOString(), html_url: `https://github.com/${REPO}/issues/c${id}` }; }
  async whoami() { return ME; }
  headOf(branch: string): string | null { const r = gitTry(this.origin, "rev-parse", "--verify", `refs/heads/${branch}`); return r.status === 0 ? r.stdout.trim() : null; }
  toPull(p: FakeGitHub["pulls"][number]): GhPull {
    return { number: p.number, state: p.state, draft: p.draft, merged: p.merged, html_url: `https://github.com/${REPO}/pull/${p.number}`,
      head: { sha: this.headOf(p.ref) ?? "0".repeat(40), ref: p.ref, repo: { full_name: REPO } }, base: { ref: "main", repo: { full_name: REPO } } };
  }
  async pull(_r: string, n: number) { const p = this.pulls.find((x) => x.number === n); if (!p) throw new Error("no such PR"); return this.toPull(p); }
  async checkRuns() { return []; }
  async issueComments(_r: string, n: number) { return structuredClone(this.comments.get(n) ?? []); }
  async reviews() { return []; }
  async reviewComments() { return []; }
  async createIssue(): Promise<never> { throw new Error("not used"); }
  async createComment(_r: string, n: number, body: string) { this.writes.push(`comment #${n}`); const c = this.comment(body); this.comments.set(n, [...(this.comments.get(n) ?? []), c]); return structuredClone(c); }
  async openPullsFor(_r: string, branch: string) { return this.pulls.filter((p) => p.ref === branch && p.state === "open").map((p) => this.toPull(p)); }
  async createDraftPull(): Promise<never> { throw new Error("the coordinator must never create a PR in executor mode"); }
  async dispatchExecutor(_r: string, ref: string, inputs: { goal: string; issue: string; nonce: string }) {
    this.writes.push(`dispatch ${inputs.nonce}`);
    if (this.dispatchFails) throw new Error("dispatch API unavailable");
    this.dispatched.push({ ref, inputs });
  }
  async executorRuns(_r: string, since: string) { return this.runs.filter((r) => Date.parse(r.created_at) >= Date.parse(since)).map(({ jobs: _j, ...r }) => r); }
  async executorWorkflowId() { return WORKFLOW_ID; }
  async run(_r: string, id: number) { const { jobs: _j, ...r } = this.runs.find((x) => x.id === id)!; return r; }
  async runJobs(_r: string, id: number) { return structuredClone(this.runs.find((x) => x.id === id)!.jobs); }
  async compareFiles(_r: string, base: string, head: string) { return git(this.origin, "diff", "--name-only", base, head).split("\n").filter(Boolean); }
  async commit(_r: string, sha: string): Promise<GhCommit> {
    const parents = git(this.origin, "rev-list", "--parents", "-n", "1", sha).split(" ").slice(1);
    return { sha, parents: parents.map((p) => ({ sha: p })), commit: { message: git(this.origin, "log", "-1", "--format=%B", sha) } };
  }
  async branchHead(_r: string, branch: string) { return this.headOf(branch); }
}

class FakeClaims implements ClaimStore {
  refs = new Map<string, string>();
  async list(goal: string): Promise<Claim[]> { return [...this.refs].map(([ref, msg]) => parseClaim(goal, ref, msg.split("\n")[0])).filter((c): c is Claim => c !== null); }
  async create(claim: Claim, message: string) { if (this.refs.has(claim.ref)) throw new Error("! [rejected] (already exists)"); this.refs.set(claim.ref, message); }
}

// ---- The simulated executor: the workflow's jobs, each running the real trusted code ------------------

type Claude = (phase: string, work: string) => void;
/** Mock Claude: reproduce adds a failing assertion to the acceptance test; implement fixes the source. */
const mockClaude: Claude = (phase, work) => {
  if (phase === "reproduce") writeFileSync(join(work, "artifacts/SpecSmith", CRITERION_FILE), TEST_REPRO);
  else writeFileSync(join(work, "artifacts/SpecSmith/src/lib/clamp.ts"), FIXED);
};

interface Hooks {
  claude?: Claude;
  /** Runs between the guard's pre-push read and the push (contract §1A.6 (b)). */
  inGap?: () => Promise<void> | void;
  /** Runs before the guard's pre-push read (contract §1A.6 (a)). */
  beforeGuard?: () => Promise<void> | void;
  crashAfterPush?: boolean;
  failJob?: string;
  checkConclusion?: (label: string) => string | undefined;
  headSha?: string;
  trailerRun?: string;
  /** A misbehaving executor: skips its own validator or its pre-push commit check, to test the coordinator's independent checks. */
  skipValidate?: boolean;
  skipCommitCheck?: boolean;
}

function makeExecutor(gh: FakeGitHub, origin: string, e: string) {
  const records = async () => readCurrent(await gh.issueComments(REPO, ISSUE), ID, ME);
  return async function run(nonce: string, h: Hooks = {}) {
    const runId = gh.next();
    const job = (name: string, conclusion: string): GhJob => ({ id: gh.next(), name, status: "completed", conclusion, html_url: `https://github.com/${REPO}/actions/runs/${runId}/job/${name.replaceAll(" ", "-")}` });
    const entry: GhWorkflowRun & { jobs: GhJob[] } = {
      id: runId, ...runShape(nonce, h.headSha ?? e),
      status: "in_progress", conclusion: null, html_url: `https://github.com/${REPO}/actions/runs/${runId}`, created_at: gh.clock.toISOString(), jobs: [],
    };
    gh.runs.push(entry);
    const finish = (conclusion: string, refusal?: string) => { entry.status = "completed"; entry.conclusion = conclusion; return { runId, refusal, log }; };
    const log: string[] = [];
    // read-dispatch
    const r1 = checkDispatch({ record: await records(), issue: ISSUE, nonce, githubSha: h.headSha ?? e, branchHead: gh.headOf(BRANCH) });
    if (!r1.ok || h.failJob === "read-dispatch") { entry.jobs.push(job("read-dispatch", "failure")); return finish("failure", r1.why); }
    entry.jobs.push(job("read-dispatch", "success"));
    const packet = workPacket(await records(), r1.dispatch);
    // implement: mock Claude edits a checkout of the base; the trusted validator checks the patch
    const work = checkout(origin, packet.base_sha);
    (h.claude ?? mockClaude)(packet.phase, work);
    const patchFile = join(work, "..", `${runId}.patch`);
    writeFileSync(patchFile, git(work, "diff", "--binary") + "\n");
    const validate = spawnSync(process.execPath, [join(ACTIONS, "validate-proposal.mjs"), "--phase", packet.phase, "--criterion", packet.criterion_file, patchFile], { encoding: "utf8" });
    if ((validate.status !== 0 && !h.skipValidate) || h.failJob === "implement") { entry.jobs.push(job("implement", "failure")); return finish("failure"); }
    entry.jobs.push(job("implement", "success"));
    // publish: apply on a fresh checkout of the base, commit with trailers, guard, push, re-read, PR
    const pub = checkout(origin, packet.base_sha);
    git(pub, "apply", patchFile);
    git(pub, "add", "--", "artifacts/SpecSmith/src");
    git(pub, "-c", "user.name=github-actions[bot]", "-c", "user.email=bot@example.invalid", "commit", "-qm", `Auto Goal ${ID}: ${packet.phase} (${nonce})`, "-m", `Auto-Goal-Dispatch: ${nonce}`, "-m", `Auto-Goal-Run: ${h.trailerRun ?? runId}`);
    const x = git(pub, "rev-parse", "HEAD");
    if (h.failJob === "publish") { entry.jobs.push(job("publish", "failure")); return finish("failure"); }
    await h.beforeGuard?.();
    const pre = checkDispatch({ record: await records(), issue: ISSUE, nonce, githubSha: h.headSha ?? e, branchHead: gh.headOf(BRANCH) });
    const commit = await gh.commit(REPO, x).catch(() => null);
    const pc = pre.ok && h.skipCommitCheck ? pre : pre.ok ? checkCommit({ parents: git(pub, "rev-list", "--parents", "-n", "1", x).split(" ").slice(1), message: git(pub, "log", "-1", "--format=%B", x), dispatch: pre.dispatch, runId: String(runId) }) : pre;
    void commit;
    if (!pc.ok) { log.push(`pre-push: ${pc.why}`); entry.jobs.push(job("publish", "failure")); return finish("failure", pc.why); }
    await h.inGap?.();
    const expect_ = packet.phase === "reproduce" ? "" : packet.base_sha;
    const push = gitTry(pub, "push", "-q", `--force-with-lease=refs/heads/${BRANCH}:${expect_}`, "origin", `${x}:refs/heads/${BRANCH}`);
    if (push.status !== 0) { log.push("push refused by the lease"); entry.jobs.push(job("publish", "failure")); return finish("failure", "lease"); }
    if (h.crashAfterPush) { entry.jobs.push(job("publish", "cancelled")); return finish("cancelled"); }
    const existing = gh.pulls.find((p) => p.ref === BRANCH && p.state === "open" && p.draft);
    const post = checkDispatch({ record: await records(), issue: ISSUE, nonce, githubSha: h.headSha ?? e, branchHead: undefined });
    if (!post.ok) {
      if (existing) await gh.createComment(REPO, existing.number, "Auto Goal: this commit was published after the goal stopped; it was not checked and must not be used.");
      log.push(`post-push: ${post.why}`);
      entry.jobs.push(job("publish", "failure")); return finish("failure", post.why);
    }
    if (packet.phase === "reproduce") {
      expect(existing).toBeUndefined();
      gh.pulls.push({ number: 50, ref: BRANCH, draft: true, state: "open", merged: false, title: `Auto Goal ${ID}: proposal`, body: `Opened by the disabled Auto Goal executor for dispatch ${nonce}. Goal record: #${ISSUE}.` });
    } else if (!existing) { entry.jobs.push(job("publish", "failure")); return finish("failure"); }
    entry.jobs.push(job("publish", "success"));
    // gate-checks
    const gate = checkDispatch({ record: await records(), issue: ISSUE, nonce, githubSha: h.headSha ?? e, branchHead: undefined });
    if (!gate.ok) { entry.jobs.push(job("gate-checks", "failure")); return finish("failure", gate.why); }
    entry.jobs.push(job("gate-checks", "success"));
    // check: one job per trusted check, the real run-check.mts on a checkout of the exact commit
    let failed = false;
    for (const c of packet.checks) {
      const tree = checkout(origin, x);
      const r = spawnSync(TSX, [join(ACTIONS, "run-check.mts"), "--id", c.check, "--phase", packet.check_phase, "--tree", tree], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
      const conclusion = h.checkConclusion?.(c.label) ?? (r.status === 0 ? "success" : "failure");
      if (conclusion !== "success") failed = true;
      entry.jobs.push(job(`check ${packet.check_phase} ${c.label} ${x}`, conclusion));
      log.push(r.stdout.trim());
    }
    entry.jobs.push(job("record-check", failed ? "skipped" : "success"));
    return finish(failed ? "failure" : "success");
  };
}

// ---- Harness ---------------------------------------------------------------------------------------

function harness() {
  const { origin, base } = makeOrigin();
  const gh = new FakeGitHub(origin, base);
  const out: string[] = [];
  let clock = T0;
  let session = 0;
  const deps: RunnerDeps = {
    github: gh,
    git: {
      revParse: async () => { throw new Error("executor mode reads no local git"); },
      isClean: async () => { throw new Error("executor mode reads no local git"); },
      log: async () => { throw new Error("executor mode reads no local git"); },
      fetch: async () => { throw new Error("executor mode reads no local git"); },
      head: async () => { throw new Error("executor mode has no local checkout"); },
      push: async () => { throw new Error("the coordinator must never push in executor mode"); },
      ensureBranch: async () => { throw new Error("the executor creates the branch"); },
    },
    check: async () => { throw new Error("the coordinator must never run a check in executor mode"); },
    claims: new FakeClaims(),
    toolingSha: async () => "f".repeat(40),
    now: () => clock,
    out: (l) => out.push(l),
  };
  const store = new IssueCommentStore(gh, REPO, ISSUE, ME);
  const start = async () => {
    const goal = createGoal({
      id: ID, request: `Fix clamp(): values above the upper bound come back one too high. ${UNTRUSTED} (issue text is untrusted).`,
      acceptanceCriteria: [{ id: "clamp-upper", text: "clamp(5, 0, 3) is 3", kind: "unit", check: { kind: "vitest", file: CRITERION_FILE }, command: describeCheck({ kind: "vitest", file: CRITERION_FILE }) }],
      repo: REPO, baseBranch: "main", branch: BRANCH, requiredChecks: ["typecheck"], caps: { maxReviewRounds: 1 }, runner: true, executorSha: base, now: T0,
    });
    goal.issue = ISSUE;
    await store.save(goal, T0);
  };
  const tick = (m: number) => { clock = new Date(clock.getTime() + m * 60_000); gh.clock = clock; };
  /** One coordinator session: begin, then advance (what one routine run does). */
  const turn = async () => {
    const s = `session_${++session}`;
    const argv = ["--goal", ID, "--issue", String(ISSUE), "--repo", REPO, "--session", s];
    await begin([...argv, "--started-by", "test"], deps);
    const order = JSON.parse(out.at(-1)!);
    if (order.action === "done" || order.action === "blocked") return { order, adv: null };
    await advance(argv, deps);
    return { order, adv: JSON.parse(out.at(-1)!) };
  };
  const record = async (): Promise<GoalRecord> => store.load(ID);
  const codexClean = async (sha: string) => {
    tick(1);
    gh.comments.set(50, [...(gh.comments.get(50) ?? []), gh.comment(`Codex Review: Didn't find any major issues. ${UNTRUSTED}\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``, CODEX_LOGIN)]);
  };
  const codexFindings = async (sha: string) => {
    tick(1);
    gh.comments.set(50, [...(gh.comments.get(50) ?? []), gh.comment(`Codex Review: found issues ${UNTRUSTED}\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``, CODEX_LOGIN)]);
  };
  return { gh, origin, base, out, deps, start, tick, turn, record, codexClean, codexFindings, executor: makeExecutor(gh, origin, base) };
}

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nothing the coordinator printed carries the untrusted marker, the mock credential, or review text. */
function noLeak(out: readonly string[]) {
  const all = out.join("\n");
  expect(all).not.toContain(UNTRUSTED);
  expect(all).not.toContain(MOCK_TOKEN);
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), "auto-goal-v1-")); process.env.CLAUDE_CODE_OAUTH_TOKEN = MOCK_TOKEN; });
afterAll(() => { rmSync(root, { recursive: true, force: true }); delete process.env.CLAUDE_CODE_OAUTH_TOKEN; });

// ---- The straight path ----------------------------------------------------------------------------

describe("version 1, end to end: issue → reproduce → fix → checks → Codex → complete", () => {
  it("completes one goal with real checks on the exact commits, never pushing, checking or opening a PR itself", { timeout: 120_000 }, async () => {
    const h = harness();
    await h.start();

    // V0 → V1: the first session dispatches the reproduce step once, from main.
    let t = await h.turn();
    expect(t.order.action).toBe("reproduce");
    expect(t.adv.next).toBe("wait-executor");
    expect(h.gh.dispatched).toEqual([{ ref: "main", inputs: { goal: ID, issue: String(ISSUE), nonce: `${ID}.d1` } }]);
    let rec = await h.record();
    expect(rec.dispatches).toMatchObject([{ nonce: `${ID}.d1`, phase: "reproduce", baseSha: h.base, state: "pending" }]);
    expect(rec.dispatches![0].sentAt).not.toBeNull();

    // The executor reproduces: the acceptance test now fails on the buggy code (real vitest).
    h.tick(3);
    const d1 = await h.executor(`${ID}.d1`);
    expect(d1.refusal).toBeUndefined();
    expect(h.gh.runs[0].conclusion).toBe("success");
    const T = h.gh.headOf(BRANCH)!;
    expect(git(h.origin, "rev-parse", `${T}^`)).toBe(h.base);
    expect(d1.log.at(-1)).toMatch(/^Expectation met: the check ran and failed/);

    // V2 → V3: the next session binds the run, records the before-fix proof, dispatches the fix.
    h.tick(2);
    t = await h.turn();
    expect(t.adv.next).toBe("wait-executor");
    rec = await h.record();
    expect(rec.pr).toBe(50);
    expect(rec.dispatches!.map((d) => [d.nonce, d.state, d.result])).toEqual([[`${ID}.d1`, "succeeded", T], [`${ID}.d2`, "pending", null]]);
    expect(rec.dispatches![1].baseSha).toBe(T);
    expect(rec.checks).toMatchObject([{ criterionId: "clamp-upper", phase: "before", sha: T, source: { runId: d1.runId, conclusion: "success" } }]);

    // The executor fixes it: the acceptance test and typecheck pass on the new commit (real vitest and tsc).
    h.tick(3);
    const d2 = await h.executor(`${ID}.d2`);
    expect(d2.refusal).toBeUndefined();
    const F = h.gh.headOf(BRANCH)!;
    expect(git(h.origin, "rev-parse", `${F}^`)).toBe(T);
    expect(git(h.origin, "show", `${F}:artifacts/SpecSmith/${CRITERION_FILE}`)).toBe(TEST_REPRO.trimEnd());
    expect(h.gh.runs[1].jobs.map((j) => [j.name, j.conclusion])).toEqual([
      ["read-dispatch", "success"], ["implement", "success"], ["publish", "success"], ["gate-checks", "success"],
      [`check after clamp-upper ${F}`, "success"], [`check after typecheck ${F}`, "success"], ["record-check", "success"],
    ]);

    // V4 → V5: verified on F; the session asks Codex to review F.
    h.tick(2);
    t = await h.turn();
    expect(t.adv.next).toBe("wait-review");
    const ask = h.gh.comments.get(50)!.at(-1)!;
    expect(ask.body).toMatch(new RegExp(`^@codex review\\n\\nAuto Goal \`${ID}\`, review round 1 of at most 1, for \`${F}\``));

    // Codex: clean on F. V6: complete.
    await h.codexClean(F);
    h.tick(2);
    t = await h.turn();
    expect(t.adv.outcome).toBe("complete");
    rec = await h.record();
    expect(rec.outcome).toMatchObject({ status: "complete", evidence: { head: F, pr: 50, ci: [{ name: "typecheck", conclusion: "success" }] } });
    expect(rec.checks.map((c) => [c.phase, c.criterionId, c.command === TYPECHECK, c.sha])).toEqual([
      ["before", "clamp-upper", false, T], ["after", "clamp-upper", false, F], ["after", null, true, F],
    ]);
    expect(h.gh.dispatched.map((d) => d.inputs.nonce)).toEqual([`${ID}.d1`, `${ID}.d2`]);
    expect(h.gh.pulls).toMatchObject([{ number: 50, draft: true, state: "open", merged: false }]);
    // A completed goal gets no further dispatch, push or comment.
    const writes = h.gh.writes.length;
    t = await h.turn();
    expect(t.order.action).toBe("done");
    expect(h.gh.writes.length).toBe(writes);
    noLeak(h.out);
  });
});

// ---- Visible blockers (contract §1A.3) ----------------------------------------------------------------

/** Runs the path up to a state, returning the harness. */
async function upTo(stage: "d1-sent" | "d1-done" | "d2-sent" | "d2-done") {
  const h = harness();
  await h.start();
  await h.turn();
  if (stage === "d1-sent") return h;
  h.tick(3); await h.executor(`${ID}.d1`);
  if (stage === "d1-done") return h;
  h.tick(2); await h.turn();
  if (stage === "d2-sent") return h;
  h.tick(3); await h.executor(`${ID}.d2`);
  return h;
}

/** The goal is blocked with exactly this reason, and the blocking session dispatched, pushed and commented nothing more. */
async function blockedWith(h: Awaited<ReturnType<typeof upTo>>, reason: RegExp) {
  const writes = h.gh.writes.length;
  const branch = h.gh.headOf(BRANCH);
  const t = await h.turn();
  const rec = await h.record();
  expect(rec.outcome?.status, JSON.stringify(rec.outcome)).toBe("blocked");
  expect(rec.outcome!.reason).toMatch(reason);
  expect(t.adv?.rearmAt ?? null).toBeNull();
  expect(h.gh.writes.slice(writes).filter((w) => !w.startsWith("comment #400"))).toEqual([]);
  expect(h.gh.headOf(BRANCH)).toBe(branch);
  // The blocker is the record comment's visible Outcome line.
  expect(h.gh.comments.get(ISSUE)!.at(-1)!.body).toMatch(/- Outcome: \*\*blocked\*\*: /);
  const again = await h.turn();
  expect(again.order.action).toBe("done");
  noLeak(h.out);
  return rec;
}

describe("version 1 blockers: every failure stops the goal visibly, with no automatic recovery", () => {
  it("missing executor run: none within the grace period after sending", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(16);
    await blockedWith(h, /^Executor run for pilot-1\.d1 was not seen; no automatic resend in version 1\.$/);
    expect(h.gh.dispatched.length).toBe(1);
  });

  it("missing executor run: the dispatch was saved but the send failed (sentAt never recorded)", { timeout: 60_000 }, async () => {
    const h = harness();
    await h.start();
    h.gh.dispatchFails = true;
    await expect(h.turn()).rejects.toThrow(/dispatch API unavailable/);
    let rec = await h.record();
    expect(rec.dispatches).toMatchObject([{ nonce: `${ID}.d1`, state: "pending", sentAt: null }]);
    h.gh.dispatchFails = false;
    h.tick(10);
    // The session that died still holds its run lease (existing runner behaviour): the next one stops.
    await expect(h.turn()).rejects.toThrow(/may still be working/);
    expect(h.gh.dispatched.length).toBe(0);
    h.tick(31); // past the lease and the grace period: the next session closes the dead run and blocks
    rec = await blockedWith(h, /^Executor run for pilot-1\.d1 was not seen/);
    expect(h.gh.dispatched.length).toBe(0);
  });

  it("an executor run that does not finish within the timeout", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    h.gh.runs.push({ id: 1, ...runShape(`${ID}.d1`, h.base), status: "in_progress", conclusion: null, html_url: "run1", created_at: h.gh.clock.toISOString(), jobs: [] });
    h.tick(30);
    expect((await h.turn()).adv.next).toBe("wait-executor");
    h.tick(31);
    await blockedWith(h, /^Executor run 1 for pilot-1\.d1 did not finish within 60 min\.$/);
  });

  it("duplicate executor runs for one dispatch", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    for (const id of [1, 2]) h.gh.runs.push({ id, ...runShape(`${ID}.d1`, h.base), status: "queued", conclusion: null, html_url: `run${id}`, created_at: h.gh.clock.toISOString(), jobs: [] });
    await blockedWith(h, /^Duplicate executor runs for pilot-1\.d1\.$/);
  });

  it("a run that is not the reviewed executor at E", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { headSha: "e".repeat(40) });
    await blockedWith(h, /^Executor run \d+ is not the reviewed executor at [0-9a-f]{40}: it ran main@eeeeeeeeee, not the reviewed executor/);
  });

  it("failed publish, before the push: branch absent, no PR", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { failJob: "publish" });
    await blockedWith(h, /^Publish failed for pilot-1\.d1 \(job publish: failure\); branch head absent, PR none\.$/);
  });

  it("failed publish, after the push and before the PR (the run was lost)", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { crashAfterPush: true });
    const T = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Publish failed for pilot-1\\.d1 \\(job publish: cancelled\\); branch head ${T}, PR none\\.$`));
    expect(h.gh.pulls).toEqual([]);
  });

  it("failed implement step: an out-of-scope patch is refused by the validator", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { claude: (_p, work) => writeFileSync(join(work, "artifacts/SpecSmith/src/lib/clamp.ts"), FIXED) });
    await blockedWith(h, /^Publish failed for pilot-1\.d1 \(job implement: failure\); branch head absent, PR none\.$/);
  });

  it("a published commit that does not carry this run's trailer", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    const r = await h.executor(`${ID}.d1`, { trailerRun: "999" });
    expect(r.refusal).toBe(REFUSAL.commit); // the guard already refuses to push it
    await blockedWith(h, /^Publish failed for pilot-1\.d1 \(job publish: failure\)/);
  });

  it("the coordinator independently refuses a reproduce commit that changes more than the acceptance test", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { skipValidate: true, claude: (p, work) => { mockClaude(p, work); writeFileSync(join(work, "artifacts/SpecSmith/src/lib/clamp.ts"), FIXED); } });
    const T = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Reproduce did not prove the defect on ${T}: it changed ${esc("artifacts/SpecSmith/src/lib/clamp.test.ts, artifacts/SpecSmith/src/lib/clamp.ts, not only artifacts/SpecSmith/src/lib/clamp.test.ts.")}$`));
  });

  it("the coordinator independently refuses an implement commit that edits the acceptance test", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-sent");
    h.tick(2);
    await h.executor(`${ID}.d2`, { skipValidate: true, claude: (p, work) => { mockClaude(p, work); writeFileSync(join(work, "artifacts/SpecSmith", CRITERION_FILE), TEST_BEFORE); } });
    const F = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Fix did not pass on ${F}: it changed the acceptance test ${esc("artifacts/SpecSmith/src/lib/clamp.test.ts.")}$`));
  });

  it("the coordinator independently refuses a published commit whose trailer names another run", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    const r = await h.executor(`${ID}.d1`, { skipCommitCheck: true, trailerRun: "999" });
    expect(r.refusal).toBeUndefined(); // this executor pushed it
    await blockedWith(h, /^Published commit for pilot-1\.d1 does not match the dispatch\.$/);
  });

  it("incomplete check: a check job was cancelled", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    await h.executor(`${ID}.d1`, { checkConclusion: () => "cancelled" });
    const T = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Check clamp-upper did not complete on ${T} \\(cancelled\\)\\.$`));
  });

  it("reproduce did not prove the defect: the edited test passes on the buggy code (real vitest)", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(2);
    const r = await h.executor(`${ID}.d1`, { claude: (_p, work) => writeFileSync(join(work, "artifacts/SpecSmith", CRITERION_FILE), TEST_BEFORE + 'it("still fine", () => { expect(clamp(1, 0, 3)).toBe(1); });\n') });
    expect(r.log.at(-1)).toMatch(/^Expectation not met: the check passed before the fix\.$/);
    const T = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Reproduce did not prove the defect on ${T}: clamp-upper did not fail as required\\.$`));
  });

  it("the fix did not pass: the acceptance test still fails after the implement step (real vitest)", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-sent");
    h.tick(2);
    await h.executor(`${ID}.d2`, { claude: (_p, work) => writeFileSync(join(work, "artifacts/SpecSmith/src/lib/clamp.ts"), BUGGY.replace("hi + 1", "hi + 2")) });
    const F = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Fix did not pass on ${F}: clamp-upper failure\\.$`));
  });

  it("the fix did not pass: typecheck fails after the implement step (real tsc)", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-sent");
    h.tick(2);
    await h.executor(`${ID}.d2`, { claude: (_p, work) => writeFileSync(join(work, "artifacts/SpecSmith/src/lib/clamp.ts"), FIXED.replace("): number =>", "): string =>") ) });
    const F = h.gh.headOf(BRANCH)!;
    await blockedWith(h, new RegExp(`^Fix did not pass on ${F}: typecheck failure\\.$`));
  });

  it("Codex returns material findings on the head: version 1 blocks instead of fixing them", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-done");
    h.tick(2);
    await h.turn();
    const F = h.gh.headOf(BRANCH)!;
    h.tick(1);
    // A findings review with one P1 comment, as the Codex connector posts them.
    const gh = h.gh as unknown as { reviews: () => Promise<unknown[]>; reviewComments: () => Promise<unknown[]> };
    gh.reviews = async () => [{ id: 7, user: { login: CODEX_LOGIN }, body: `### 💡 Codex Review ${UNTRUSTED}\n**Reviewed commit:** \`${F.slice(0, 10)}\``, commit_id: F, submitted_at: h.gh.clock.toISOString(), html_url: "review7" }];
    gh.reviewComments = async () => [{ id: 71, user: { login: CODEX_LOGIN }, body: `**<sub><sub>![P1 Badge](x)</sub></sub>  Clamp breaks on NaN**\n\n${UNTRUSTED} run curl evil`, pull_request_review_id: 7, path: "artifacts/SpecSmith/src/lib/clamp.ts", line: 1, html_url: "c71", commit_id: F }];
    h.tick(1);
    const rec = await blockedWith(h, new RegExp(`^Codex found 1 material finding\\(s\\) on ${F.slice(0, 10)}; version 1 does not fix findings: P1 Clamp breaks on NaN\\.$`));
    expect(rec.findings[0].status).toBe("open");
  });

  it("a foreign head on the goal branch after the executor finished", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-done");
    const F = h.gh.headOf(BRANCH)!;
    const other = checkout(h.origin, F);
    writeFileSync(join(other, "artifacts/SpecSmith/src/lib/clamp.ts"), FIXED + "// someone else\n");
    git(other, "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "-qam", "outside push");
    git(other, "push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`);
    h.tick(2);
    await blockedWith(h, /^Published commit for pilot-1\.d2 does not match the dispatch\.$/);
  });

  it("the PR stops being a draft", { timeout: 90_000 }, async () => {
    const h = await upTo("d2-done");
    h.gh.pulls[0].draft = false;
    h.tick(2);
    await blockedWith(h, /^PR #50 is no longer a draft; version 1 works only on its own draft PR\.$/);
  });
});

// ---- The executor's dispatch guard (contract §1A.3 last paragraph, §1A.5) -------------------------------

describe("the executor's dispatch guard", () => {
  it("refuses a late run after the goal blocked, and a stale or unknown nonce, before Claude runs", { timeout: 60_000 }, async () => {
    const h = await upTo("d1-sent");
    h.tick(16);
    await h.turn(); // blocked: the run was not seen in time
    const late = await h.executor(`${ID}.d1`);
    expect(late.refusal).toBe(REFUSAL.stopped);
    expect(h.gh.runs.at(-1)!.jobs.map((j) => j.name)).toEqual(["read-dispatch"]);
    expect(h.gh.headOf(BRANCH)).toBeNull();

    const h2 = await upTo("d1-sent");
    expect((await h2.executor(`${ID}.d2`)).refusal).toBe(REFUSAL.notCurrent);
    expect((await h2.executor(`${ID}.d9`)).refusal).toBe(REFUSAL.notCurrent);
    expect((await h2.executor(`${ID}.d1`, { headSha: "e".repeat(40) })).refusal).toBe(REFUSAL.executorMoved);
  });
});

// ---- The §1A.6 race: the coordinator blocks while the executor is working --------------------------------

describe("contract §1A.6: the coordinator blocks while the executor works", () => {
  /** d2 is in flight; the coordinator blocks it on the 60-minute timeout at the chosen moment. */
  async function blockDuringD2(where: "beforeGuard" | "inGap", extra: Hooks = {}) {
    const h = await upTo("d2-sent");
    h.tick(2);
    // The run exists and is in progress when the coordinator's sync sees it past the timeout.
    const T = h.gh.headOf(BRANCH)!;
    const block = async () => {
      h.tick(61); // the run is still in progress past executorTimeoutMinutes
      const t = await h.turn();
      expect(t.adv?.outcome ?? (await h.record()).outcome?.status).toBe("blocked");
    };
    const r = await h.executor(`${ID}.d2`, { ...extra, [where]: block });
    return { h, r, T };
  }

  it("(a) the block lands before the guard: nothing is pushed", { timeout: 90_000 }, async () => {
    const { h, r, T } = await blockDuringD2("beforeGuard");
    expect(r.refusal).toBe(REFUSAL.stopped);
    expect(h.gh.headOf(BRANCH)).toBe(T);
    expect((await h.record()).outcome!.reason).toMatch(/did not finish within 60 min/);
    expect((await h.turn()).order.action).toBe("done");
  });

  it("(b) the block lands inside the gap: the push lands, the PR is labelled, no checks run", { timeout: 90_000 }, async () => {
    const { h, r, T } = await blockDuringD2("inGap");
    expect(r.refusal).toBe(REFUSAL.stopped); // the post-push re-read
    const F = h.gh.headOf(BRANCH)!;
    expect(F).not.toBe(T); // the non-atomic gap: a commit after the block
    expect(git(h.origin, "rev-parse", `${F}^`)).toBe(T);
    expect(h.gh.comments.get(50)!.at(-1)!.body).toBe("Auto Goal: this commit was published after the goal stopped; it was not checked and must not be used.");
    expect(h.gh.runs.at(-1)!.jobs.map((j) => j.name)).toEqual(["read-dispatch", "implement", "publish"]);
    const rec = await h.record();
    expect(rec.outcome!.reason).toMatch(/did not finish within 60 min/); // the reason does not mention F (the stated gap)
    expect(rec.head).toBe(T);
    expect((await h.turn()).order.action).toBe("done");
  });

  it("(c) the job dies right after the push: no note, no checks, the goal stays blocked", { timeout: 90_000 }, async () => {
    const { h, T } = await blockDuringD2("inGap", { crashAfterPush: true });
    const F = h.gh.headOf(BRANCH)!;
    expect(F).not.toBe(T);
    expect((h.gh.comments.get(50) ?? []).some((c) => c.body.includes("published after the goal stopped"))).toBe(false);
    expect(h.gh.runs.at(-1)!.jobs.map((j) => [j.name, j.conclusion])).toEqual([["read-dispatch", "success"], ["implement", "success"], ["publish", "cancelled"]]);
    const rec = await h.record();
    expect(rec.outcome!.status).toBe("blocked");
    expect(rec.head).toBe(T); // the record's last head differs from the PR head: visible to a person, not flagged
    expect((await h.turn()).order.action).toBe("done");
  });
});

// ---- run-check.mts expectations, directly ------------------------------------------------------------

describe("run-check.mts", () => {
  it("before: succeeds only when the check runs and fails; after: only when it passes; a missing file never counts", { timeout: 60_000 }, async () => {
    const { origin, base } = (() => { root ??= mkdtempSync(join(tmpdir(), "auto-goal-v1-")); return makeOrigin(); })();
    const tree = checkout(origin, base);
    const runCheckTs = (id: string, phase: string) => spawnSync(TSX, [join(ACTIONS, "run-check.mts"), "--id", id, "--phase", phase, "--tree", tree], { encoding: "utf8" });
    expect(runCheckTs(`vitest:${CRITERION_FILE}`, "before").status).toBe(1); // passes on the base, so it proves nothing yet
    expect(runCheckTs(`vitest:${CRITERION_FILE}`, "after").status).toBe(0);
    writeFileSync(join(tree, "artifacts/SpecSmith", CRITERION_FILE), TEST_REPRO);
    expect(runCheckTs(`vitest:${CRITERION_FILE}`, "before").status).toBe(0);
    expect(runCheckTs(`vitest:${CRITERION_FILE}`, "after").status).toBe(1);
    const missing = runCheckTs("vitest:src/lib/missing.test.ts", "before");
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/could not run \(its file is missing\)/);
    for (const bad of ["suite; rm -rf /", "vitest:../../etc/passwd.test.ts", "browser:scripts/ui/x.mjs", ""]) expect(runCheckTs(bad, "after").status, bad).toBe(2);
    expect(runCheckTs("typecheck", "sideways").status).toBe(2);
    expect(readFileSync(join(tree, "artifacts/SpecSmith/src/lib/clamp.ts"), "utf8")).toBe(BUGGY);
  });
});

// ---- Record validation, cli start, and the wake bridge in executor mode -------------------------------


const crit = { id: "clamp-upper", text: "t", kind: "unit" as const, check: { kind: "vitest" as const, file: CRITERION_FILE }, command: describeCheck({ kind: "vitest", file: CRITERION_FILE }) };
const exec1 = (over: Partial<Parameters<typeof createGoal>[0]> = {}) => createGoal({ id: ID, request: "r", acceptanceCriteria: [crit], repo: REPO, baseBranch: "main", branch: BRANCH, requiredChecks: ["typecheck"], runner: true, executorSha: "a".repeat(40), now: T0, ...over });

describe("record validation in executor mode (version 1 scope)", () => {
  it("accepts the version 1 shape and refuses anything outside it", () => {
    expect(exec1().version).toBe(2);
    for (const [over, why] of [
      [{ acceptanceCriteria: [crit, { ...crit, id: "second" }] }, /exactly one acceptance criterion/],
      [{ acceptanceCriteria: [{ ...crit, check: { kind: "typecheck" as const }, command: describeCheck({ kind: "typecheck" }) }] }, /exactly one acceptance criterion, a vitest check/],
      [{ branch: "claude/something-else" }, /branch must be claude\/auto-goal-pilot-1/],
      [{ requiredChecks: ["Verify pull request"] }, /requires exactly typecheck/],
      [{ executorSha: "main" }, /executorSha must be a full commit sha/],
    ] as const) expect(() => exec1(over as never), String(why)).toThrow(why);
    const d = (k: number, phase: string, state: string, result: string | null = null) => ({ k, nonce: nonceFor(ID, k), phase, baseSha: "b".repeat(40), createdAt: T0.toISOString(), sentAt: null, runId: null, state, result });
    const base = exec1();
    for (const [dispatches, why] of [
      [[d(1, "implement", "pending")], /must be reproduce/],
      [[d(1, "reproduce", "failed"), d(2, "implement", "pending")], /follows one that did not succeed/],
      [[d(1, "reproduce", "succeeded", "c".repeat(40)), d(2, "implement", "succeeded", "d".repeat(40)), d(3, "implement", "pending")], /at most two dispatches/],
      [[d(1, "reproduce", "succeeded")], /succeeded without a published commit/],
      [[{ ...d(1, "reproduce", "pending"), nonce: "pilot-1.d7" }], /must be pilot-1\.d1/],
    ] as const) expect(() => validateGoal({ ...structuredClone(base), dispatches }), String(why)).toThrow(why);
    // Interactive goals are untouched: no executor fields, and version 1 records still load.
    const plain = createGoal({ id: "plain-goal", request: "r", acceptanceCriteria: [crit], repo: REPO, baseBranch: "main", branch: "claude/x", requiredChecks: ["CI"], now: T0 });
    expect(plain.executorSha).toBeUndefined();
    expect(validateGoal({ ...plain, version: 1 }).version).toBe(1);
  });
});

describe("cli start --executor-sha", () => {
  it("derives the branch, the one required check and one Codex round; refuses --branch alongside it", async () => {
    const dir = mkdtempSync(join(root, "cli-"));
    writeFileSync(join(dir, "req.txt"), "Fix clamp.\n");
    writeFileSync(join(dir, "crit.json"), JSON.stringify([crit]));
    const gh = new FakeGitHub("/nonexistent", "a".repeat(40));
    const out: string[] = [];
    const deps: CliDeps = { github: gh, git: undefined as never, repoRoot: dir, exec: async () => ({ exitCode: 1, tail: "" }), now: () => T0, out: (l) => out.push(l) };
    const args = ["start", "--goal", ID, "--issue", String(ISSUE), "--store-dir", "store", "--request-file", join(dir, "req.txt"), "--criteria-file", join(dir, "crit.json"), "--executor-sha", "a".repeat(40)];
    expect(await cliMain(args, deps)).toBe(0);
    const rec = await new IssueCommentStore(gh, REPO, ISSUE, ME).load(ID);
    expect(rec).toMatchObject({ executorSha: "a".repeat(40), branch: BRANCH, requiredChecks: ["typecheck"], dispatches: [], runs: [], caps: { maxReviewRounds: 1 } });
    await expect(cliMain([...args, "--branch", "claude/x"], deps)).rejects.toThrow(/do not pass --branch/);
  });
});

describe("wake bridge: executor runs wake the goal they belong to", () => {
  const recordComment = (record: object, id = 1) => ({ id, user: { login: ME }, created_at: T0.toISOString(), body: `<!-- specsmith-auto-goal id=${ID} rev=3 -->\n\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\`` });
  const live = { kind: "specsmith-auto-goal", version: 2, id: ID, revision: 3, issue: ISSUE, pr: 50, head: "c".repeat(40), outcome: null, runs: [], caps: {}, requiredChecks: ["typecheck"], dispatches: [{ k: 1, nonce: `${ID}.d1`, state: "bound" }] };
  const runEvent = (over: object = {}) => ({ action: "completed", workflow_run: { path: ".github/workflows/auto-goal-actions.yml@main", name: WORKFLOW_NAME, display_title: `Auto Goal ${ID} ${ID}.d1`, workflow_id: WORKFLOW_ID, event: "workflow_dispatch", head_sha: "a".repeat(40), pull_requests: [], ...over } });

  it("maps a completed executor run to its goal by its run-name (display_title), and only an Auto Goal dispatch title", () => {
    expect(normalizeEvent("workflow_run", runEvent(), ME)).toEqual({ kind: "executor", goal: ID, nonce: `${ID}.d1`, sha: null, prs: [], issue: null });
    expect(normalizeEvent("workflow_run", runEvent({ display_title: `Auto Goal ${ID} other-goal.d1` }), ME)).toHaveProperty("skip");
    expect(normalizeEvent("workflow_run", runEvent({ event: "push" }), ME)).toHaveProperty("skip");
    expect(normalizeEvent("workflow_run", runEvent({ path: ".github/workflows/verify-pr.yml", name: "Verify pull request", display_title: "A PR title", event: "pull_request", pull_requests: [{ number: 50 }] }), ME)).toMatchObject({ kind: "checks", prs: [50] });
  });

  it("wakes only while that dispatch is live and the goal is open; the ticket is bound to the record's PR and head", () => {
    const event = normalizeEvent("workflow_run", runEvent(), ME);
    const d = decideWake({ event, comments: [recordComment(live)], trustedLogin: ME, repo: REPO, now: T0.getTime() });
    expect(d).toMatchObject({ wake: true, goal: ID, issue: ISSUE, pr: 50, sha: "c".repeat(40), reason: "executor" });
    expect(decideWake({ event, comments: [recordComment({ ...live, outcome: { status: "blocked", reason: "x" } })], trustedLogin: ME, repo: REPO, now: T0.getTime() }).wake).toBe(false);
    expect(decideWake({ event, comments: [recordComment({ ...live, dispatches: [{ k: 1, nonce: `${ID}.d1`, state: "succeeded" }] })], trustedLogin: ME, repo: REPO, now: T0.getTime() }).why).toMatch(/already succeeded/);
    expect(decideWake({ event, comments: [recordComment({ ...live, dispatches: [] })], trustedLogin: ME, repo: REPO, now: T0.getTime() }).why).toMatch(/no dispatch pilot-1\.d1/);
    // The routine's guard accepts that ticket while the record is still at the same PR and head, and refuses it after the head moves.
    const ticket = { id: 77, user: { login: "github-actions[bot]" }, created_at: T0.toISOString(), issue_url: `https://api.github.com/repos/${REPO}/issues/${ISSUE}`, body: ticketBody({ ...d, state: "fired", attempts: 1 }) };
    const issue = { number: ISSUE, state: "open", labels: [{ name: "auto-goal" }] };
    expect(verifyTicket({ ticket, issue, comments: [recordComment(live)], trustedLogin: ME, now: T0.getTime() })).toMatchObject({ proceed: true, goal: ID });
    expect(verifyTicket({ ticket, issue, comments: [recordComment({ ...live, head: "d".repeat(40) })], trustedLogin: ME, now: T0.getTime() }).proceed).toBe(false);
  });
});
