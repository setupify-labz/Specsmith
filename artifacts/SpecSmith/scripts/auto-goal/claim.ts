// Run ownership: who may open run n of a goal, decided by an atomic claim before anything is saved.
//
// GitHub comments have no compare-and-swap, so two sessions that read the record and then post a
// revision can fork it. Git refs do: creating a branch that already exists is rejected by the
// server, so of two sessions pushing the same new ref, exactly one succeeds (checked against
// GitHub through the session proxy: five simultaneous pairs, one winner each, the ref holding the
// winner's commit). A session must create the claim ref
//
//   claude/auto-goal-claims/<goal>/<run>-<attempt>
//
// before it opens run <run>; the commit's message names the session and the time. The session that
// created it owns the run; every other session stops without saving. Only the owner of the open run
// writes the record, so revisions no longer fork when duplicate sessions race.
//
// The owner may die. Its claim (or its open run) is live for the run-time cap plus 15 minutes; after
// that the next session claims the next attempt for the same run (a dead claim that never opened a
// run) or the next run (a dead open run). The old owner fences itself: it stops writing once its own
// run is that old minus a 5-minute margin, or as soon as a later claim exists. That is a lease, so it
// assumes session clocks agree to within the margin.
//
// Claim commits carry `[skip ci]` (Cloudflare Workers Builds skips them) and point at the base
// branch's commit, so they add no code. Sessions cannot delete branches through the proxy, so claims
// stay until someone removes them; there are at most maxRuns x MAX_CLAIM_ATTEMPTS per goal.

import { GoalError } from "./record.ts";

export const CLAIM_PREFIX = "claude/auto-goal-claims";
export const MAX_CLAIM_ATTEMPTS = 3;
/** The owner stops writing this long before others may take its run over. */
export const FENCE_MARGIN_MINUTES = 5;

export interface Claim {
  readonly ref: string;
  readonly run: number;
  readonly attempt: number;
  readonly session: string;
  readonly at: string;
}

export interface ClaimStore {
  /** Every claim pushed for the goal, read from the remote. */
  list(goal: string): Promise<Claim[]>;
  /**
   * Tries to create the claim's ref on the remote. The result is not trusted: a rejected push and a
   * push whose answer was lost look alike, so the caller re-lists to see who holds the ref.
   */
  create(claim: Claim, message: string): Promise<void>;
}

export const claimRef = (goal: string, run: number, attempt: number) => `${CLAIM_PREFIX}/${goal}/${run}-${attempt}`;

export function claimMessage(goal: string, c: Omit<Claim, "ref">): string {
  return `auto-goal claim goal=${goal} run=${c.run} attempt=${c.attempt} session=${c.session} at=${c.at}\n\nOwnership of run ${c.run} of Auto Goal ${goal}. No code; see scripts/auto-goal/claim.ts.\n\n[skip ci]\n`;
}

const SUBJECT = /^auto-goal claim goal=([a-z0-9-]+) run=(\d+) attempt=(\d+) session=(\S+) at=(\S+)$/;

/** A claim from its ref name and commit subject, or null for anything that is not one. */
export function parseClaim(goal: string, ref: string, subject: string): Claim | null {
  const name = new RegExp(`^${CLAIM_PREFIX}/${goal}/(\\d+)-(\\d+)$`).exec(ref);
  const m = SUBJECT.exec(subject.trim());
  if (!name || !m || m[1] !== goal || m[2] !== name[1] || m[3] !== name[2] || Number.isNaN(Date.parse(m[5]))) return null;
  return { ref, run: Number(m[2]), attempt: Number(m[3]), session: m[4], at: m[5] };
}

const minutesSince = (at: string, now: Date) => (now.getTime() - Date.parse(at)) / 60_000;

export type Acquired = { readonly owned: true; readonly claim: Claim } | { readonly owned: false; readonly why: string };

/**
 * Claims run `run` for `session`, or says who holds it. `staleMinutes`: how long a claim stays live
 * (the run-time cap plus the margin the guard also uses).
 */
export async function acquireRun(store: ClaimStore, goal: string, run: number, session: string, now: Date, staleMinutes: number): Promise<Acquired> {
  const all = await store.list(goal);
  const ahead = all.filter((c) => c.run > run);
  if (ahead.length) return { owned: false, why: `run ${Math.max(...ahead.map((c) => c.run))} is already claimed, so this session's copy of the record is behind; it stops.` };
  const forRun = all.filter((c) => c.run === run).sort((a, b) => a.attempt - b.attempt);
  const top = forRun.at(-1);
  if (top?.session === session) return { owned: true, claim: top };   // this session's own claim, from a push whose answer was lost
  if (top && minutesSince(top.at, now) < staleMinutes) {
    return { owned: false, why: `run ${run} is claimed by session ${top.session} (${top.ref}, ${Math.max(0, Math.round(minutesSince(top.at, now)))} min ago, live for ${staleMinutes} min); this session stops without changing the goal.` };
  }
  const attempt = (top?.attempt ?? 0) + 1;
  if (attempt > MAX_CLAIM_ATTEMPTS) return { owned: false, why: `run ${run} was claimed ${MAX_CLAIM_ATTEMPTS} times and never opened; stopping instead of claiming again.` };
  const want = { run, attempt, session, at: now.toISOString() };
  await store.create({ ...want, ref: claimRef(goal, run, attempt) }, claimMessage(goal, want)).catch(() => undefined);
  const held = (await store.list(goal)).find((c) => c.run === run && c.attempt === attempt);
  if (!held) throw new GoalError("unavailable", `Could not create or read ${claimRef(goal, run, attempt)}; nothing was saved. Try again.`);
  if (held.session !== session) return { owned: false, why: `session ${held.session} claimed run ${run} first (${held.ref}); this session stops without changing the goal.` };
  return { owned: true, claim: held };
}

/**
 * Throws unless `session` may still write for its run: its lease has not run out and no later claim
 * (a later attempt at this run, or any later run) exists.
 */
export async function fence(store: ClaimStore, goal: string, run: { n: number; claim?: string; startedAt: string; sessionId: string }, now: Date, staleMinutes: number): Promise<void> {
  const age = minutesSince(run.startedAt, now);
  if (age >= staleMinutes - FENCE_MARGIN_MINUTES) {
    throw new GoalError("refused", `Run ${run.n} started ${Math.round(age)} min ago; its lease ends at ${staleMinutes - FENCE_MARGIN_MINUTES} min, after which another session may take the run over, so this session stops writing.`);
  }
  if (!run.claim) return;
  const mine = (await store.list(goal)).filter((c) => c.ref === run.claim || c.run > run.n || (c.run === run.n && c.attempt > Number(run.claim!.split("-").at(-1))));
  const later = mine.filter((c) => c.ref !== run.claim);
  if (later.length) throw new GoalError("refused", `Run ${run.n} was taken over (${later.map((c) => `${c.ref} by ${c.session}`).join(", ")}); this session stops writing.`);
}
