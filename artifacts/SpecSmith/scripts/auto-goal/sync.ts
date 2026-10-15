// Brings the record up to date with what GitHub and git report: the PR's head commit, the CI
// conclusions on that exact commit, and every Codex verdict since each review request. Codex's
// findings become open findings in the record, which decide.ts sends back to the implementation
// step; nobody has to copy them across by hand.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describeCheck } from "./checks.ts";
import { codexVerdicts, verdictFor } from "./codex.ts";
import { isExecutorGitHub, pullMismatch, type ExecutorGitHub, type GhJob, type GhWorkflowRun, type GitHub } from "./github.ts";
import {
  addEvent, DEFAULT_DISPATCH_GRACE_MINUTES, DEFAULT_EXECUTOR_TIMEOUT_MINUTES, GoalError, isExecutorMode, liveDispatch,
  type CheckRun, type Dispatch, type GoalRecord,
} from "./record.ts";

const run = promisify(execFile);

export interface Git {
  /** Full sha of a ref. */
  revParse(ref: string): Promise<string>;
  /** True when the working tree and index match HEAD and nothing untracked (and not git-ignored) exists. */
  isClean(): Promise<boolean>;
  /** Commits reachable from `head` but not `base`, oldest first. */
  log(base: string, head: string): Promise<{ sha: string; subject: string; at: string }[]>;
  fetch(branch: string): Promise<void>;
}

export function localGit(cwd: string): Git {
  const git = async (...args: string[]) => (await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
  return {
    revParse: async (ref) => (await git("rev-parse", "--verify", `${ref}^{commit}`)).trim(),
    // Untracked files count (a check could read them), ignored files (node_modules, dist, .auto-goal) do not.
    isClean: async () => (await git("status", "--porcelain", "--untracked-files=normal")).trim() === "",
    log: async (base, head) => (await git("log", "--reverse", "--format=%H%x09%cI%x09%s", `${base}..${head}`)).split("\n").filter(Boolean).map((line) => {
      const [sha, at, ...subject] = line.split("\t");
      return { sha, at, subject: subject.join("\t") };
    }),
    fetch: async (branch) => { await git("fetch", "--quiet", "origin", branch); },
  };
}

/** Updates head, commits, CI and review state from the live sources. Mutates and returns `goal`. */
export async function syncGoal(goal: GoalRecord, github: GitHub, git: Git, now = new Date()): Promise<GoalRecord> {
  if (goal.outcome) return goal;
  if (isExecutorMode(goal)) return syncExecutorGoal(goal, github, now);

  // The head: the PR's head once a PR exists (that is what CI and Codex see), else the local branch.
  let head: string;
  if (goal.pr !== null) {
    const pull = await github.pull(goal.repo, goal.pr);
    const mismatch = pullMismatch(pull, goal);
    if (mismatch) throw new GoalError("invalid", `PR #${goal.pr} ${mismatch}.`);
    if (pull.merged) { addEvent(goal, "pr-merged", `PR #${goal.pr} was merged by someone outside this goal; the orchestrator never merges.`, now); }
    else if (pull.state === "closed") {
      goal.outcome = { status: "blocked", at: now.toISOString(), reason: `PR #${goal.pr} was closed outside the goal.`, evidence: { pr: pull.html_url } };
      addEvent(goal, "blocked", goal.outcome.reason, now);
      return goal;
    }
    head = pull.head.sha;
    await git.fetch(goal.branch).catch(() => undefined);
  } else {
    head = await git.revParse(goal.branch);
  }
  if (head !== goal.head) {
    addEvent(goal, "head", `Head is now ${head.slice(0, 10)}${goal.head ? ` (was ${goal.head.slice(0, 10)})` : ""}.`, now);
    goal.head = head;
  }
  const base = await git.revParse(`origin/${goal.baseBranch}`).catch(() => git.revParse(goal.baseBranch));
  goal.commits = await git.log(base, head);

  if (goal.pr === null) return goal;

  // CI on the exact head.
  const runs = await github.checkRuns(goal.repo, head);
  goal.ci = { sha: head, observedAt: now.toISOString(), runs: runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url })) };

  await syncCodex(goal, github, now);
  return goal;
}

/** Codex: unchanged behaviour, shared by both modes. */
async function syncCodex(goal: GoalRecord, github: GitHub, now: Date): Promise<void> {
  if (goal.pr === null) return;
  // Codex: every verdict posted for a round's commit after its request counts. Two sessions can
  // both ask for the same round (GitHub cannot serialise their comments), so a round may receive
  // more than one review: its findings are the union, and a clean verdict never hides a later
  // review's findings on the same commit.
  const live = goal.reviewRounds.filter((r) => r.verdict !== "unavailable");
  if (live.length) {
    const [comments, reviews, reviewComments] = await Promise.all([
      github.issueComments(goal.repo, goal.pr), github.reviews(goal.repo, goal.pr), github.reviewComments(goal.repo, goal.pr),
    ]);
    const verdicts = codexVerdicts(comments, reviews, reviewComments);
    const self = await github.whoami();
    for (const round of live) {
      const since = Date.parse(round.requestedAt);
      const mine = verdicts.filter((v) => Date.parse(v.at) >= since && (v.kind === "unavailable" || round.requestedSha.startsWith(v.reviewedPrefix)));
      // Every request posted for this round must be answered before the round can count: a second
      // session's duplicate request may still be running when the first answer arrives.
      const tag = `review round ${round.n} of at most ${goal.caps.maxReviewRounds}, for \`${round.requestedSha}\``;
      const asked = comments.filter((c) => c.user.login === self && c.body.startsWith("@codex review") && c.body.includes(tag)).length;
      const answered = mine.filter((v) => v.kind !== "unavailable").length;
      round.outstanding = Math.max(0, asked - answered);
      if (round.verdict === "pending") {
        const v = verdictFor(verdicts, round.requestedSha, round.requestedAt);
        if (!v) continue;
        round.completedAt = v.at;
        if (v.kind === "unavailable") {
          round.verdict = "unavailable";
          round.evidence = `${v.text} (${v.url})`;
          addEvent(goal, "review-unavailable", `Round ${round.n}: Codex replied without reviewing: ${v.text.slice(0, 200)}`, now);
          continue;
        }
        round.reviewedSha = round.requestedSha;
        round.evidence = v.url;
        round.verdict = v.kind;
        addEvent(goal, v.kind === "clean" ? "review-clean" : "review-findings", `Round ${round.n}: ${v.kind === "clean" ? `Codex found no major issues on ${round.requestedSha.slice(0, 10)}` : `${v.findings.length} finding(s): ${v.findings.map((f) => `${f.priority} ${f.title}`).join("; ") || "none listed"}`}.`, now);
      }
      for (const v of mine) {
        if (v.kind !== "findings") continue;
        const fresh = v.findings.filter((f) => !goal.findings.some((g) => g.id === f.id));
        if (!fresh.length) continue;
        for (const f of fresh) goal.findings.push({ ...f, round: round.n, status: "open", fixedIn: null, reason: null });
        if (round.verdict === "clean") { round.verdict = "findings"; round.evidence = v.url; }
        addEvent(goal, "review-findings", `Round ${round.n}: ${fresh.length} more finding(s) from ${v.url}: ${fresh.map((f) => `${f.priority} ${f.title}`).join("; ")}.`, now);
      }
    }
  }
}

// ---- Executor mode, version 1 (PILOT_HANDOFF_CONTRACT.md §1A) ---------------------------------------

export const EXECUTOR_WORKFLOW_FILE = "auto-goal-actions.yml";
export const EXECUTOR_WORKFLOW_PATH = `.github/workflows/${EXECUTOR_WORKFLOW_FILE}`;
export const executorRunName = (goalId: string, nonce: string) => `Auto Goal ${goalId} ${nonce}`;
const TYPECHECK = describeCheck({ kind: "typecheck" });

/**
 * A run's `path`, split from its optional ref suffix: ".github/workflows/x.yml@main" gives
 * { file: ".github/workflows/x.yml", ref: "main" }; no "@" gives ref null. More than one "@" is not a path.
 */
export function workflowPath(path: string): { file: string; ref: string | null } | null {
  const parts = path.split("@");
  if (parts.length > 2 || parts.some((p) => p === "")) return null;
  return { file: parts[0], ref: parts[1] ?? null };
}

/** The dispatch a run was for: its custom run-name, which GitHub reports as `display_title` (never `name`, the workflow's name). */
export const isRunFor = (run: GhWorkflowRun, goalId: string, nonce: string) => run.display_title === executorRunName(goalId, nonce);

/**
 * Contract §2: a run counts as the executor's only if it is the executor workflow (by id, and by path
 * with no ref suffix or the base branch's), dispatched, on the base branch at the pinned commit E, and
 * titled for this nonce.
 */
export function bindExecutorRun(run: GhWorkflowRun, goal: GoalRecord, nonce: string, workflowId: number): string | null {
  const path = workflowPath(String(run.path ?? ""));
  if (run.workflow_id !== workflowId || !path || path.file !== EXECUTOR_WORKFLOW_PATH) return "is not the executor workflow";
  if (path.ref !== null && path.ref !== goal.baseBranch && path.ref !== `refs/heads/${goal.baseBranch}`) return `is not the executor workflow at ${goal.baseBranch}`;
  if (run.event !== "workflow_dispatch") return `was started by ${run.event}, not workflow_dispatch`;
  if (run.head_branch !== goal.baseBranch || run.head_sha !== goal.executorSha) return `ran ${run.head_branch}@${run.head_sha.slice(0, 10)}, not the reviewed executor at ${goal.executorSha!.slice(0, 10)}`;
  if (!isRunFor(run, goal.id, nonce)) return "is titled for another dispatch";
  return null;
}

/** The trailers the executor writes on every commit it publishes (contract §2). */
export function trailers(message: string): { dispatch: string | null; run: string | null } {
  const one = (key: string) => { const all = [...message.matchAll(new RegExp(`^${key}: (\\S+)$`, "gm"))]; return all.length === 1 ? all[0][1] : null; };
  return { dispatch: one("Auto-Goal-Dispatch"), run: one("Auto-Goal-Run") };
}

const checkJobName = (phase: "before" | "after", id: string, sha: string) => `check ${phase} ${id} ${sha}`;

async function syncExecutorGoal(goal: GoalRecord, github: GitHub, now: Date): Promise<GoalRecord> {
  if (!isExecutorGitHub(github)) throw new GoalError("invalid", "This goal runs in executor mode, but the GitHub client cannot read Actions runs.");
  await syncDispatch(goal, github, now);
  if (goal.outcome) return goal;
  if (goal.pr === null) return goal;
  const pull = await github.pull(goal.repo, goal.pr);
  const mismatch = pullMismatch(pull, goal);
  if (mismatch) return block(goal, now, `PR #${goal.pr} ${mismatch}.`, { pr: pull.html_url });
  if (pull.merged) return block(goal, now, `PR #${goal.pr} was merged outside the goal; nothing here merges.`, { pr: pull.html_url });
  if (pull.state !== "open") return block(goal, now, `PR #${goal.pr} was closed outside the goal.`, { pr: pull.html_url });
  if (!pull.draft) return block(goal, now, `PR #${goal.pr} is no longer a draft; version 1 works only on its own draft PR.`, { pr: pull.html_url });
  // With no dispatch in flight, the head must be the last commit the executor published.
  const published = (goal.dispatches ?? []).filter((d) => d.state === "succeeded").at(-1)?.result ?? null;
  if (!liveDispatch(goal) && pull.head.sha !== published) return block(goal, now, `Foreign head ${pull.head.sha} on ${goal.branch}.`, { pr: pull.html_url, expected: published });
  if (pull.head.sha !== goal.head) { addEvent(goal, "head", `Head is now ${pull.head.sha.slice(0, 10)}${goal.head ? ` (was ${goal.head.slice(0, 10)})` : ""}.`, now); goal.head = pull.head.sha; }
  await syncCodex(goal, github, now);
  return goal;
}

function block(goal: GoalRecord, now: Date, reason: string, evidence: Record<string, unknown>): GoalRecord {
  goal.outcome = { status: "blocked", at: now.toISOString(), reason, evidence };
  addEvent(goal, "blocked", reason, now);
  return goal;
}

/**
 * The §1A.3 rows detected by sync: the live dispatch's run is found, bound, waited for, or turned into
 * a blocker; a successful run's published commit and check jobs are verified and recorded. Version 1
 * never resends, cancels or retries.
 */
export async function syncDispatch(goal: GoalRecord, github: ExecutorGitHub, now: Date): Promise<void> {
  const d = liveDispatch(goal);
  if (!d) return;
  const fail = (reason: string, evidence: Record<string, unknown>) => { d.state = "failed"; block(goal, now, reason, { dispatch: d.nonce, ...evidence }); };
  const minutes = (since: string) => (now.getTime() - Date.parse(since)) / 60_000;
  const since = new Date(Date.parse(d.createdAt) - 60_000).toISOString();
  const named = (await github.executorRuns(goal.repo, since)).filter((r) => isRunFor(r, goal.id, d.nonce));
  const workflowId = named.length ? await github.executorWorkflowId(goal.repo) : 0;
  for (const r of named) {
    const why = bindExecutorRun(r, goal, d.nonce, workflowId);
    if (why) return fail(`Executor run ${r.id} is not the reviewed executor at ${goal.executorSha}: it ${why}.`, { run: r.html_url });
  }
  if (named.length > 1) return fail(`Duplicate executor runs for ${d.nonce}.`, { runs: named.map((r) => r.html_url) });
  const grace = goal.caps.dispatchGraceMinutes ?? DEFAULT_DISPATCH_GRACE_MINUTES;
  if (named.length === 0) {
    if (minutes(d.sentAt ?? d.createdAt) > grace) fail(`Executor run for ${d.nonce} was not seen; no automatic resend in version 1.`, { sentAt: d.sentAt });
    return;
  }
  const run = named[0];
  if (d.runId === null) { d.runId = run.id; d.state = "bound"; addEvent(goal, "executor-bound", `${d.nonce} is executor run ${run.id}.`, now); }
  if (run.status !== "completed") {
    const limit = goal.caps.executorTimeoutMinutes ?? DEFAULT_EXECUTOR_TIMEOUT_MINUTES;
    if (minutes(run.created_at) > limit) fail(`Executor run ${run.id} for ${d.nonce} did not finish within ${limit} min.`, { run: run.html_url });
    return;
  }
  const jobs = await github.runJobs(goal.repo, run.id);
  const job = (name: string) => jobs.find((j) => j.name === name);
  const ok = (j: GhJob | undefined) => j?.status === "completed" && j.conclusion === "success";
  for (const name of ["read-dispatch", "implement", "publish"]) {
    if (!ok(job(name))) {
      const j = job(name);
      const branchHead = await github.branchHead(goal.repo, goal.branch);
      const pulls = await github.openPullsFor(goal.repo, goal.branch);
      return fail(name === "read-dispatch"
        ? `The executor refused ${d.nonce} (read-dispatch: ${j?.conclusion ?? "missing"}).`
        : `Publish failed for ${d.nonce} (job ${name}: ${j?.conclusion ?? "missing"}); branch head ${branchHead ?? "absent"}, PR ${pulls[0] ? `#${pulls[0].number}` : "none"}.`,
      { job: j?.html_url ?? run.html_url, branchHead });
    }
  }
  // The published commit: the branch head, built on the dispatch base, carrying this dispatch's trailers.
  const x = await github.branchHead(goal.repo, goal.branch);
  const commit = x ? await github.commit(goal.repo, x) : null;
  const t = commit ? trailers(commit.commit.message) : null;
  if (!x || !commit || commit.parents.length !== 1 || commit.parents[0].sha !== d.baseSha || t!.dispatch !== d.nonce || t!.run !== String(run.id)) {
    return fail(`Published commit for ${d.nonce} does not match the dispatch.`, { commit: x, run: run.html_url });
  }
  if (goal.pr === null) {
    const pulls = (await github.openPullsFor(goal.repo, goal.branch)).filter((p) => pullMismatch(p, goal) === null && p.draft && p.head.sha === x);
    if (pulls.length !== 1) return fail(`Published commit for ${d.nonce} does not match the dispatch: ${pulls.length} matching draft PR(s) for ${goal.branch}.`, { commit: x });
    goal.pr = pulls[0].number;
    addEvent(goal, "pr", `The executor opened draft ${pulls[0].html_url}.`, now);
  }
  // Scope of the change (contract §3): reproduce touches only the criterion's file; implement never touches it.
  const criterion = goal.acceptanceCriteria[0];
  const file = `artifacts/SpecSmith/${(criterion.check as { file: string }).file}`;
  const changed = await github.compareFiles(goal.repo, d.baseSha, x);
  if (d.phase === "reproduce" && (changed.length !== 1 || changed[0] !== file)) return fail(`Reproduce did not prove the defect on ${x}: it changed ${changed.join(", ") || "nothing"}, not only ${file}.`, { commit: x });
  if (d.phase === "implement" && changed.includes(file)) return fail(`Fix did not pass on ${x}: it changed the acceptance test ${file}.`, { commit: x });
  // The check jobs, by their exact names; success means the phase's expectation was met.
  const phase = d.phase === "reproduce" ? "before" : "after";
  const expected: { id: string | null; label: string; command: string }[] = [{ id: criterion.id, label: criterion.id, command: criterion.command }];
  if (d.phase === "implement") expected.push({ id: null, label: "typecheck", command: TYPECHECK });
  const results: CheckRun[] = [];
  for (const e of expected) {
    const j = job(checkJobName(phase, e.label, x));
    if (!j || j.status !== "completed" || !["success", "failure"].includes(j.conclusion ?? "")) return fail(`Check ${e.label} did not complete on ${x} (${j?.conclusion ?? "missing"}).`, { run: run.html_url });
    if (j.conclusion !== "success") {
      return fail(d.phase === "reproduce" ? `Reproduce did not prove the defect on ${x}: ${e.label} did not fail as required.` : `Fix did not pass on ${x}: ${e.label} failure.`, { job: j.html_url });
    }
    results.push({ criterionId: e.id, phase, command: e.command, sha: x, summary: `executor job "${j.name}"`, at: now.toISOString(), source: { runId: run.id, jobId: j.id, conclusion: j.conclusion, url: j.html_url } });
  }
  for (const r of results) if (!goal.checks.some((c) => c.source?.jobId === r.source!.jobId)) goal.checks.push(r);
  if (d.phase === "implement") {
    const tc = results.find((r) => r.command === TYPECHECK)!;
    goal.ci = { sha: x, observedAt: now.toISOString(), runs: [{ name: "typecheck", status: "completed", conclusion: tc.source!.conclusion, url: tc.source!.url }] };
  }
  d.state = "succeeded"; d.result = x;
  if (goal.head !== x) { addEvent(goal, "head", `Head is now ${x.slice(0, 10)}${goal.head ? ` (was ${goal.head.slice(0, 10)})` : ""}.`, now); goal.head = x; }
  addEvent(goal, "executor-done", `${d.nonce} (${d.phase}) published ${x.slice(0, 10)}; ${phase}-fix checks met: ${expected.map((e) => e.label).join(", ")}.`, now);
}

export type { Dispatch };
