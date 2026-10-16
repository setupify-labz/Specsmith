// The next step, derived only from the record. Pure and deterministic: the same record and clock
// always give the same action, so a session that restarts mid-goal picks up exactly where the facts
// say it is. Whoever drives the loop (the Claude Code session subscribed to the PR) performs the
// action, records what happened, and asks again.

import { isExecutorMode, isMaterial, liveDispatch, type Finding, type GoalRecord } from "./record.ts";

export type Action =
  | { readonly action: "complete"; readonly why: string }
  | { readonly action: "blocked"; readonly why: string }
  | { readonly action: "done"; readonly why: string }
  | { readonly action: "reproduce"; readonly why: string; readonly criteria: readonly string[] }
  | { readonly action: "implement"; readonly why: string }
  | { readonly action: "fix-findings"; readonly why: string; readonly findings: readonly Finding[] }
  | { readonly action: "fix-ci"; readonly why: string; readonly failing: readonly string[] }
  | { readonly action: "verify"; readonly why: string; readonly criteria: readonly string[] }
  | { readonly action: "open-pr"; readonly why: string }
  | { readonly action: "request-review"; readonly why: string }
  | { readonly action: "wait-review"; readonly why: string; readonly until: string }
  | { readonly action: "wait-ci"; readonly why: string }
  /** Executor mode: a dispatch is live; the executor owns the next step. */
  | { readonly action: "wait-executor"; readonly why: string; readonly nonce: string };

const OK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export function openMaterialFindings(goal: GoalRecord): Finding[] {
  return goal.findings.filter((f) => f.status === "open" && isMaterial(f.priority));
}

/** The latest result for each criterion on one commit (a later run replaces an earlier one). */
export function criteriaResults(goal: GoalRecord, sha: string): Map<string, number> {
  const out = new Map<string, number>();
  // Executor results carry no raw exit code (they report whether the expectation was met); decideExecutor reads those.
  for (const c of goal.checks) if (c.criterionId && c.sha === sha && c.phase === "after" && c.exitCode !== undefined) out.set(c.criterionId, c.exitCode);
  return out;
}

/** CI on one commit: green only when every required check succeeded and nothing reported is red or still running. */
export function ciState(goal: GoalRecord, sha: string): { state: "unknown" | "pending" | "red" | "green"; failing: string[]; missing: string[] } {
  if (!goal.ci || goal.ci.sha !== sha) return { state: "unknown", failing: [], missing: [...goal.requiredChecks] };
  const runs = goal.ci.runs;
  const failing = runs.filter((r) => r.status === "completed" && !OK_CONCLUSIONS.has(r.conclusion ?? "")).map((r) => r.name);
  if (failing.length) return { state: "red", failing, missing: [] };
  const missing = goal.requiredChecks.filter((name) => !runs.some((r) => r.name === name && r.status === "completed"));
  if (missing.length || runs.some((r) => r.status !== "completed")) return { state: "pending", failing: [], missing };
  return { state: "green", failing: [], missing: [] };
}

export const DEFAULT_CI_TIMEOUT_MINUTES = 60;

export function decide(goal: GoalRecord, now = new Date()): Action {
  if (goal.outcome) return { action: "done", why: `Goal already ${goal.outcome.status}: ${goal.outcome.reason}` };

  const ageHours = (now.getTime() - Date.parse(goal.createdAt)) / 3_600_000;
  if (ageHours > goal.caps.maxHours) return { action: "blocked", why: `Time cap reached: ${ageHours.toFixed(1)} h since the goal started (cap ${goal.caps.maxHours} h).` };
  if (isExecutorMode(goal)) return decideExecutor(goal, now);

  // 1. The defect must be shown before anything is changed: every criterion's check has to have failed once.
  const unproven = goal.acceptanceCriteria.filter((c) => !goal.checks.some((r) => r.criterionId === c.id && r.phase === "before" && r.exitCode !== 0));
  if (unproven.length) return { action: "reproduce", why: "Each acceptance check must fail before the fix, so it is known to detect the defect.", criteria: unproven.map((c) => c.id) };

  // 2. A change has to exist.
  if (!goal.head || goal.commits.length === 0) return { action: "implement", why: "No commit on the goal branch yet." };
  const head = goal.head;

  // 3. Material review findings go back to the implementation step, within the fix cap.
  const open = openMaterialFindings(goal);
  if (open.length) {
    if (goal.fixAttempts >= goal.caps.maxFixAttempts) return { action: "blocked", why: `Fix cap reached (${goal.fixAttempts}/${goal.caps.maxFixAttempts}) with ${open.length} material finding(s) still open: ${open.map((f) => f.title).join("; ")}.` };
    return { action: "fix-findings", why: `${open.length} material Codex finding(s) open.`, findings: open };
  }

  // 4. Red CI on the head goes back to the implementation step too.
  const ci = ciState(goal, head);
  if (ci.state === "red") {
    if (goal.fixAttempts >= goal.caps.maxFixAttempts) return { action: "blocked", why: `Fix cap reached (${goal.fixAttempts}/${goal.caps.maxFixAttempts}) with CI red on ${head.slice(0, 10)}: ${ci.failing.join(", ")}.` };
    return { action: "fix-ci", why: `CI is red on ${head.slice(0, 10)}.`, failing: ci.failing };
  }

  // 5. Every acceptance check must pass on the exact head.
  const results = criteriaResults(goal, head);
  const unverified = goal.acceptanceCriteria.filter((c) => results.get(c.id) !== 0);
  // Checks already run on this head and failed: the change is not done, so it goes back to implementation.
  const failedHere = new Set(goal.checks.filter((r) => r.sha === head && r.criterionId && r.exitCode !== 0).map((r) => r.criterionId!));
  const failing = unverified.filter((c) => results.has(c.id) || (failedHere.has(c.id) && !results.has(c.id)));
  if (failing.length) return { action: "implement", why: `Acceptance check(s) ${failing.map((c) => c.id).join(", ")} fail on ${head.slice(0, 10)}.` };
  if (unverified.length) return { action: "verify", why: `Acceptance checks not yet passing on ${head.slice(0, 10)}.`, criteria: unverified.map((c) => c.id) };

  // 6. Review happens on a PR.
  if (goal.pr === null) return { action: "open-pr", why: "The change is verified locally; open a draft PR for review and CI." };

  return reviewThenCi(goal, head, ci, now);
}

/** The executor's bound result for one check on one commit and phase (contract §3): success means the expectation was met. */
export function executorResult(goal: GoalRecord, phase: "before" | "after", sha: string, criterionId: string | null, command: string) {
  return goal.checks.find((c) => c.source && c.phase === phase && c.sha === sha && c.criterionId === criterionId && c.command === command);
}

/**
 * Executor mode, version 1 (PILOT_HANDOFF_CONTRACT.md §1A): reproduce → implement → review → complete,
 * each code step done by the executor. syncGoal records every executor failure as the goal's outcome;
 * the checks here are the decide-level blockers of §1A.3 and a defensive restatement of the rest.
 */
function decideExecutor(goal: GoalRecord, now: Date): Action {
  const blocked = (why: string): Action => ({ action: "blocked", why });
  const live = liveDispatch(goal);
  if (live) return { action: "wait-executor", why: `Waiting for the executor run for ${live.nonce} (${live.phase} from ${live.baseSha.slice(0, 10)}).`, nonce: live.nonce };
  const [d1, d2] = goal.dispatches ?? [];
  const criterion = goal.acceptanceCriteria[0];
  if (!d1) return { action: "reproduce", why: "No reproduce dispatch yet: the executor must first make the acceptance test fail on the current code.", criteria: [criterion.id] };
  if (d1.state !== "succeeded" || !d1.result) return blocked(`Reproduce dispatch ${d1.nonce} did not succeed.`);
  if (executorResult(goal, "before", d1.result, criterion.id, criterion.command)?.source?.conclusion !== "success") return blocked(`Reproduce did not prove the defect on ${d1.result.slice(0, 10)}: no passing before-fix result for ${criterion.id}.`);
  if (!d2) return { action: "implement", why: `The defect is reproduced on ${d1.result.slice(0, 10)}; the executor must now make ${criterion.id} pass.` };
  if (d2.state !== "succeeded" || !d2.result) return blocked(`Implement dispatch ${d2.nonce} did not succeed.`);
  const head = goal.head;
  if (head !== d2.result) return blocked(`Foreign head ${head ?? "none"} on ${goal.branch}: the executor published ${d2.result}.`);
  if (executorResult(goal, "after", head, criterion.id, criterion.command)?.source?.conclusion !== "success") return blocked(`Fix did not pass on ${head.slice(0, 10)}: ${criterion.id} has no passing after-fix result.`);
  // Version 1 fixes no findings: a material one stops the goal for a person to read.
  const open = openMaterialFindings(goal);
  if (open.length) return blocked(`Codex found ${open.length} material finding(s) on ${head.slice(0, 10)}; version 1 does not fix findings: ${open.map((f) => `${f.priority} ${f.title}`).join("; ")}.`);
  const ci = ciState(goal, head);
  if (ci.state === "red") return blocked(`Fix did not pass on ${head.slice(0, 10)}: ${ci.failing.join(", ")} failed.`);
  return reviewThenCi(goal, head, ci, now);
}

/** Steps 7 and 8, shared by both modes: Codex on the exact head, then the required checks on it. */
function reviewThenCi(goal: GoalRecord, head: string, ci: ReturnType<typeof ciState>, now: Date): Action {
  // 7. Codex must have reviewed the exact head.
  const latest = goal.reviewRounds.at(-1);
  // A round saved but not confirmed posted (the session stopped in between) is finished, not repeated.
  if (latest && latest.requestedSha === head && latest.requestUrl === null && latest.verdict === "pending") return { action: "request-review", why: `Round ${latest.n} was opened but its request is not confirmed posted; post it or adopt the one already posted.` };
  if (!latest || latest.requestedSha !== head) {
    if (goal.reviewRounds.length >= goal.caps.maxReviewRounds) return { action: "blocked", why: `Review cap reached (${goal.reviewRounds.length}/${goal.caps.maxReviewRounds}) and ${head.slice(0, 10)} has not been reviewed.` };
    return { action: "request-review", why: latest ? `The head moved to ${head.slice(0, 10)} after round ${latest.n}.` : "No Codex review requested yet." };
  }
  if (latest.verdict === "unavailable") return { action: "blocked", why: `Codex could not review round ${latest.n}: ${latest.evidence ?? "no reason given"}.` };
  if (latest.verdict === "pending" || (latest.outstanding ?? 0) > 0) {
    const until = new Date(Date.parse(latest.requestedAt) + goal.caps.reviewTimeoutMinutes * 60_000);
    if (now > until) return { action: "blocked", why: `Codex did not answer review round ${latest.n} within ${goal.caps.reviewTimeoutMinutes} min (${latest.requestUrl}).` };
    return { action: "wait-review", why: `Waiting for Codex on ${head.slice(0, 10)} (round ${latest.n}${(latest.outstanding ?? 0) > 0 ? `, ${latest.outstanding} request(s) unanswered` : ""}).`, until: until.toISOString() };
  }
  // A "findings" round on the head reaches here only when none of its findings is open and material
  // (step 3): they were nits, or dismissed with a recorded reason. A fixed finding would have moved the head.

  // 8. CI must be green on the exact head.
  if (ci.state !== "green") {
    // CI starts when the head is pushed, which is when its review was requested. A required check
    // that has not finished by the timeout never will without someone looking at it.
    const limit = goal.caps.ciTimeoutMinutes ?? DEFAULT_CI_TIMEOUT_MINUTES;
    const waited = (now.getTime() - Date.parse(latest.requestedAt)) / 60_000;
    const unfinished = ci.missing.length ? ci.missing : goal.requiredChecks;
    if (waited > limit) return { action: "blocked", why: `Required check(s) ${unfinished.join(", ")} did not finish on ${head.slice(0, 10)} within ${limit} min of the push (waited ${Math.round(waited)} min).` };
  }
  if (ci.state !== "green") return { action: "wait-ci", why: ci.state === "unknown" ? `No CI observation for ${head.slice(0, 10)} yet.` : `CI still running on ${head.slice(0, 10)}${ci.missing.length ? ` (waiting for ${ci.missing.join(", ")})` : ""}.` };

  return { action: "complete", why: `Acceptance checks pass, CI is green and Codex found no major issues on ${head.slice(0, 10)}.` };
}
