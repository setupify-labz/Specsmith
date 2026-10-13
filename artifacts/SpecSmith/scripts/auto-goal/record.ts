// The durable record of one Auto Goal: what was asked, how "done" is checked, and everything that
// has actually happened since. The next step is never stored as an instruction to obey; it is
// derived from this record by decide.ts, so a restarted session resumes from facts, not from a
// remembered plan.
//
// Every field records an observation (a command's exit code on a commit, a review Codex posted,
// a CI conclusion GitHub reported). Nothing here may be set to a state that did not occur: a
// finding is "fixed" only with the commit that fixed it, and the outcome is written once, by
// finalize() or block(), never edited afterwards.

export const RECORD_KIND = "specsmith-auto-goal";
export const RECORD_VERSION = 1;

/** Codex marks findings P0-P3. P3 is a nit; anything else, or an unbadged finding, is material. */
export type Priority = "P0" | "P1" | "P2" | "P3" | "unbadged";
export const isMaterial = (p: Priority) => p !== "P3";

export interface Criterion {
  readonly id: string;
  /** What must be true, in words a person can check. */
  readonly text: string;
  /** The command that checks it. It must fail before the fix and pass after. */
  readonly command: string;
  readonly kind: "unit" | "browser" | "build";
}

export interface CheckRun {
  readonly criterionId: string | null;
  /** "before": run to prove the defect (must fail). "after": run on a commit to prove the fix. "suite": a broader run. */
  readonly phase: "before" | "after" | "suite";
  readonly command: string;
  /** The commit the command ran against (the working tree must have been clean). */
  readonly sha: string;
  readonly exitCode: number;
  readonly summary: string;
  readonly at: string;
}

export interface Commit { readonly sha: string; readonly subject: string; readonly at: string }

export interface ReviewRound {
  readonly n: number;
  /** When the round was opened; replaced by the request comment's own timestamp once it is posted. */
  requestedAt: string;
  readonly requestedSha: string;
  /** The "@codex review" comment that asked for this round; null while the request is saved but not yet confirmed posted. */
  requestUrl: string | null;
  verdict: "pending" | "clean" | "findings" | "unavailable";
  reviewedSha: string | null;
  completedAt: string | null;
  /** Where Codex answered (the review or comment URL), or, when unavailable, its exact words. */
  evidence: string | null;
}

export interface Finding {
  /** Codex's review-comment id. */
  readonly id: string;
  readonly round: number;
  readonly priority: Priority;
  readonly title: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly url: string;
  readonly excerpt: string;
  status: "open" | "fixed" | "dismissed";
  /** The commit that fixes it (status "fixed"). */
  fixedIn: string | null;
  /** Why it was not changed (status "dismissed"); material findings cannot be dismissed without one. */
  reason: string | null;
}

export interface CiObservation {
  readonly sha: string;
  readonly observedAt: string;
  readonly runs: readonly { readonly name: string; readonly status: string; readonly conclusion: string | null; readonly url: string }[];
}

export interface Caps {
  /** Codex review rounds, including the first. */
  readonly maxReviewRounds: number;
  /** Commits made in answer to review findings or red CI. */
  readonly maxFixAttempts: number;
  /** How long Codex may take to answer one request before the goal is blocked. */
  readonly reviewTimeoutMinutes: number;
  /** Wall-clock budget for the whole goal. */
  readonly maxHours: number;
  /** Paid API spend allowed. The pilot allows none, and no code path here calls a paid API. */
  readonly paidSpendUsd: 0;
}

/** What this goal may never do. Fixed to false: the orchestrator has no code for any of them. */
export interface Policy { readonly merge: false; readonly paidGeneration: false; readonly scheduling: false; readonly publishing: false }

export interface Outcome {
  readonly status: "complete" | "blocked";
  readonly at: string;
  readonly reason: string;
  /** For "complete": the head commit, the passing checks, the green CI and the clean review it rests on. */
  readonly evidence: Record<string, unknown>;
}

export interface GoalEvent { readonly at: string; readonly type: string; readonly detail: string }

export interface GoalRecord {
  readonly kind: typeof RECORD_KIND;
  readonly version: typeof RECORD_VERSION;
  readonly id: string;
  readonly createdAt: string;
  updatedAt: string;
  /** Bumped on every save; a save that finds a different stored revision is refused. */
  revision: number;
  /** The instruction exactly as given. */
  readonly request: string;
  readonly acceptanceCriteria: readonly Criterion[];
  readonly repo: string;
  readonly baseBranch: string;
  readonly branch: string;
  /** The issue that holds this record (and states the request), once created. */
  issue: number | null;
  pr: number | null;
  /** The check-run names that must succeed on the final commit. */
  readonly requiredChecks: readonly string[];
  readonly caps: Caps;
  readonly policy: Policy;
  /** The last action decide.ts returned, for people reading the record; never read back as an instruction. */
  step: string;
  head: string | null;
  commits: Commit[];
  checks: CheckRun[];
  reviewRounds: ReviewRound[];
  findings: Finding[];
  ci: CiObservation | null;
  /** Commits made in answer to findings or red CI; fixAttempts is always their count. */
  fixCommits: string[];
  fixAttempts: number;
  outcome: Outcome | null;
  events: GoalEvent[];
  /** Revisions saved twice by concurrent sessions, resolved by choosing one copy (resolve-fork). */
  resolvedForks?: number[];
  /** The record comment this revision was built on (absent on revision 1 and on records from before parents were kept). */
  parentComment?: number | null;
}

export const DEFAULT_CAPS: Caps = { maxReviewRounds: 3, maxFixAttempts: 3, reviewTimeoutMinutes: 90, maxHours: 24, paidSpendUsd: 0 };
export const POLICY: Policy = { merge: false, paidGeneration: false, scheduling: false, publishing: false };

export class GoalError extends Error {
  constructor(readonly code: "invalid" | "conflict" | "not-found" | "refused" | "unavailable", message: string) {
    super(message);
    this.name = "GoalError";
  }
}

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function createGoal(input: {
  id: string; request: string; acceptanceCriteria: readonly Criterion[]; repo: string; baseBranch: string; branch: string;
  requiredChecks: readonly string[]; caps?: Partial<Omit<Caps, "paidSpendUsd">>; now?: Date;
}): GoalRecord {
  const at = (input.now ?? new Date()).toISOString();
  const goal: GoalRecord = {
    kind: RECORD_KIND, version: RECORD_VERSION, id: input.id, createdAt: at, updatedAt: at, revision: 0,
    request: input.request, acceptanceCriteria: input.acceptanceCriteria, repo: input.repo, baseBranch: input.baseBranch, branch: input.branch,
    issue: null, pr: null, requiredChecks: input.requiredChecks, caps: { ...DEFAULT_CAPS, ...input.caps, paidSpendUsd: 0 }, policy: POLICY,
    step: "reproduce", head: null, commits: [], checks: [], reviewRounds: [], findings: [], ci: null, fixCommits: [], fixAttempts: 0, outcome: null,
    events: [{ at, type: "started", detail: "Goal created from the request as given." }],
  };
  return validateGoal(goal);
}

/** Checks a record read from storage. Throws GoalError("invalid") naming the first problem. */
export function validateGoal(raw: unknown): GoalRecord {
  const g = raw as GoalRecord;
  const fail = (why: string): never => { throw new GoalError("invalid", `Goal record invalid: ${why}.`); };
  if (!g || typeof g !== "object" || g.kind !== RECORD_KIND || g.version !== RECORD_VERSION) fail(`expected kind "${RECORD_KIND}" version ${RECORD_VERSION}`);
  if (typeof g.id !== "string" || !ID.test(g.id)) fail("id must be 3-64 lowercase letters, digits or hyphens");
  if (typeof g.request !== "string" || g.request.trim() === "") fail("the original request is missing");
  if (!Array.isArray(g.acceptanceCriteria) || g.acceptanceCriteria.length === 0) fail("at least one acceptance criterion is required");
  const ids = new Set<string>();
  for (const c of g.acceptanceCriteria) {
    if (!c || typeof c.id !== "string" || typeof c.text !== "string" || typeof c.command !== "string" || c.command.trim() === "") fail("each criterion needs an id, text and a command");
    if (!["unit", "browser", "build"].includes(c.kind)) fail(`criterion ${c.id} has an unknown kind`);
    if (ids.has(c.id)) fail(`criterion id ${c.id} is repeated`);
    ids.add(c.id);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(g.repo)) fail("repo must be owner/name");
  if (!Array.isArray(g.requiredChecks) || g.requiredChecks.length === 0) fail("name at least one required CI check");
  const caps = g.caps;
  if (!caps || caps.paidSpendUsd !== 0) fail("paid spend must be 0 for this pilot");
  for (const k of ["maxReviewRounds", "maxFixAttempts", "reviewTimeoutMinutes", "maxHours"] as const) {
    if (!Number.isInteger(caps[k]) || caps[k] < 1) fail(`caps.${k} must be a positive integer`);
  }
  if (!g.policy || Object.values(g.policy).some((v) => v !== false)) fail("merge, paid generation, scheduling and publishing must all stay off");
  if (!Number.isInteger(g.revision) || g.revision < 0) fail("revision must be a non-negative integer");
  if (g.head !== null && !SHA.test(g.head)) fail("head must be a full commit sha");
  for (const c of g.checks) {
    if (!SHA.test(c.sha)) fail(`check "${c.command}" has no full commit sha`);
    if (!Number.isInteger(c.exitCode)) fail(`check "${c.command}" has no exit code`);
    if (c.criterionId !== null && !ids.has(c.criterionId)) fail(`check "${c.command}" names unknown criterion ${c.criterionId}`);
  }
  for (const f of g.findings) {
    if (f.status === "fixed" && (!f.fixedIn || !SHA.test(f.fixedIn))) fail(`finding ${f.id} is marked fixed without the commit that fixed it`);
    if (f.status === "dismissed" && (!f.reason || f.reason.trim() === "")) fail(`finding ${f.id} is dismissed without a reason`);
  }
  if (!Array.isArray(g.fixCommits) || g.fixAttempts !== new Set(g.fixCommits).size || g.fixAttempts !== g.fixCommits.length) fail("fixAttempts must equal the number of distinct fix commits");
  if (g.reviewRounds.length > caps.maxReviewRounds) fail(`more review rounds (${g.reviewRounds.length}) than the cap (${caps.maxReviewRounds})`);
  if (g.outcome && !["complete", "blocked"].includes(g.outcome.status)) fail("outcome must be complete or blocked");
  return g;
}

export function addEvent(goal: GoalRecord, type: string, detail: string, now = new Date()): void {
  goal.events.push({ at: now.toISOString(), type, detail });
}
