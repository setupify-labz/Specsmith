// Brings the record up to date with what GitHub and git report: the PR's head commit, the CI
// conclusions on that exact commit, and every Codex verdict since each review request. Codex's
// findings become open findings in the record, which decide.ts sends back to the implementation
// step; nobody has to copy them across by hand.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { codexVerdicts, verdictFor } from "./codex.ts";
import type { GitHub } from "./github.ts";
import { addEvent, GoalError, type GoalRecord } from "./record.ts";

const run = promisify(execFile);

export interface Git {
  /** Full sha of a ref. */
  revParse(ref: string): Promise<string>;
  /** True when the working tree and index match HEAD (untracked files ignored). */
  isClean(): Promise<boolean>;
  /** Commits reachable from `head` but not `base`, oldest first. */
  log(base: string, head: string): Promise<{ sha: string; subject: string; at: string }[]>;
  fetch(branch: string): Promise<void>;
}

export function localGit(cwd: string): Git {
  const git = async (...args: string[]) => (await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
  return {
    revParse: async (ref) => (await git("rev-parse", "--verify", `${ref}^{commit}`)).trim(),
    isClean: async () => (await git("status", "--porcelain", "--untracked-files=no")).trim() === "",
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

  // The head: the PR's head once a PR exists (that is what CI and Codex see), else the local branch.
  let head: string;
  if (goal.pr !== null) {
    const pull = await github.pull(goal.repo, goal.pr);
    if (pull.head.ref !== goal.branch) throw new GoalError("invalid", `PR #${goal.pr} is from ${pull.head.ref}, not the goal branch ${goal.branch}.`);
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

  // Codex: settle pending rounds from what it actually posted.
  const pending = goal.reviewRounds.filter((r) => r.verdict === "pending");
  if (pending.length) {
    const [comments, reviews, reviewComments] = await Promise.all([
      github.issueComments(goal.repo, goal.pr), github.reviews(goal.repo, goal.pr), github.reviewComments(goal.repo, goal.pr),
    ]);
    const verdicts = codexVerdicts(comments, reviews, reviewComments);
    for (const round of pending) {
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
      if (v.kind === "clean") {
        round.verdict = "clean";
        addEvent(goal, "review-clean", `Round ${round.n}: Codex found no major issues on ${round.requestedSha.slice(0, 10)}.`, now);
      } else {
        round.verdict = "findings";
        for (const f of v.findings) {
          if (goal.findings.some((g) => g.id === f.id)) continue;
          goal.findings.push({ ...f, round: round.n, status: "open", fixedIn: null, reason: null });
        }
        addEvent(goal, "review-findings", `Round ${round.n}: ${v.findings.length} finding(s): ${v.findings.map((f) => `${f.priority} ${f.title}`).join("; ") || "none listed"}.`, now);
      }
    }
  }
  return goal;
}
