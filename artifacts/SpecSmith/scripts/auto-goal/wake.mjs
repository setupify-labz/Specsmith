#!/usr/bin/env node
// The Auto Goal wake bridge: decides, from one GitHub event and the goal record, whether to start
// the next unattended runner session through the routine's API trigger.
//
// It runs in .github/workflows/auto-goal-wake.yml, from the default branch only (every trigger it
// uses is one GitHub runs from the default branch), with no checkout of PR code and no
// dependencies. It never reads or forwards review text: the fire payload is a fixed line of ids.
//
//   node wake.mjs event              the workflow step: decide, write a wake ticket, fire
//   node wake.mjs retry              the workflow's retry job: re-fire tickets whose call failed
//   node wake.mjs guard --ticket N   the routine's first step: the goal ticket N was written for, or refuse
//   node wake.mjs watchdog           the scheduled fallback: wake a goal whose owner died without leaving an event
//
// A wake ticket is a comment the workflow posts on the goal's issue before it calls the routine. The
// routine is told only the ticket's comment id; the guard reads that comment back from GitHub,
// checks it was written by the workflow for a goal whose trusted record still matches, and prints
// that goal. So a wake for one goal can never start another, and a failed call is a ticket in state
// `failed` that the retry job (or a redelivered event) fires again, while a ticket in state
// `pending` or `fired` keeps duplicate deliveries from starting a second run.
//
// Plain JavaScript on purpose: GitHub's runner has Node, and nothing has to be installed first.

import { readFileSync } from "node:fs";

export const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
export const GOAL_LABEL = "auto-goal";
/** The login GITHUB_TOKEN writes as; only its comments can be wake tickets. */
export const WORKFLOW_LOGIN = "github-actions[bot]";
/** Calls to the routine per ticket, across the event step and the retry job. */
export const MAX_FIRE_ATTEMPTS = 4;
/** Calls per step, so the event step and one retry job each get a share. */
export const FIRE_ATTEMPTS_PER_STEP = 2;
const TICKET = /^<!-- specsmith-auto-goal-wake goal=([a-z0-9-]+) issue=(\d+) pr=(\d+|none) sha=([0-9a-f]{40}|none) reason=(codex|checks|goal-submitted|recovery) state=(pending|fired|failed) attempts=(\d+)(?: recovers=([a-z0-9-]+))? -->/;
/** Run claims (claim.ts): branches the runner creates atomically before it opens a run. */
export const CLAIM_PREFIX = "claude/auto-goal-claims";
const MAX_CLAIM_ATTEMPTS = 3;
const CLAIM_SUBJECT = /^auto-goal claim goal=([a-z0-9-]+) run=(\d+) attempt=(\d+) session=(\S+) at=(\S+)$/;
/** Recovery wakes per goal, over its whole life. Past this a stalled goal waits for a person. */
export const MAX_RECOVERIES = 3;
/** After a run ends on one of these, the next wake normally comes from Codex or CI; the watchdog re-reads them. */
const WAITING_STEPS = new Set(["wait-review", "wait-ci"]);
/** A result this old with no wake after it is a missed event, not one still being delivered. */
export const EVENT_GRACE_MINUTES = 10;
/** decide.ts's default for caps.ciTimeoutMinutes. */
const DEFAULT_CI_TIMEOUT_MINUTES = 60;
const NOTICE = /^<!-- specsmith-auto-goal-stall goal=([a-z0-9-]+) key=([a-z0-9-]+) -->/;
/** A wake not yet followed by a run start is treated as pending for this long, then retried. */
export const WAKE_PENDING_MINUTES = 45;
/** A run that has not finished within its run-time cap plus this margin is dead, not one to wait for (runner.ts uses the same window). */
export const RUN_STALE_MARGIN_MINUTES = 15;
const DEFAULT_RUN_MINUTES = 25;
export const runStaleMinutes = (record) => (record.caps?.maxRunMinutes ?? DEFAULT_RUN_MINUTES) + RUN_STALE_MARGIN_MINUTES;
const MARKER = /^<!-- specsmith-auto-goal id=([a-z0-9-]+)(?: rev=(\d+))? -->/;
const SUMMARY = "<!-- codex-pull-request-review-summary -->";
/** When GitHub says the record comment was posted (kept off the record's own fields). */
const POSTED_AT = Symbol("postedAt");

/**
 * The event, reduced to what the decision needs. Anything that is not a Codex verdict on a PR,
 * a check completion, or a goal issue labelled by the trusted login is dropped here.
 * @returns {{ kind: "codex" | "checks" | "goal-submitted", sha: string | null, prs: number[], issue: number | null } | { skip: string }}
 */
export function normalizeEvent(eventName, payload, trustedLogin) {
  switch (eventName) {
    case "issue_comment": {
      if (!payload.issue?.pull_request) return { skip: "comment is not on a pull request" };
      if (payload.comment?.user?.login !== CODEX_LOGIN) return { skip: "comment is not from Codex" };
      const body = String(payload.comment.body ?? "");
      // The status table counts only once it reports the review finished.
      if (body.startsWith(SUMMARY) && !/✅\s*\*\*Completed\*\*/.test(body)) return { skip: "Codex is still reviewing" };
      if (payload.action === "edited" && !body.startsWith(SUMMARY)) return { skip: "an edited Codex comment other than the status table" };
      return { kind: "codex", sha: null, prs: [payload.issue.number], issue: null };
    }
    case "workflow_run": {
      const run = payload.workflow_run;
      if (payload.action !== "completed" || !run) return { skip: "workflow run not completed" };
      return { kind: "checks", sha: run.head_sha, prs: (run.pull_requests ?? []).map((p) => p.number), issue: null };
    }
    case "check_suite": {
      const suite = payload.check_suite;
      if (payload.action !== "completed" || !suite) return { skip: "check suite not completed" };
      return { kind: "checks", sha: suite.head_sha, prs: (suite.pull_requests ?? []).map((p) => p.number), issue: null };
    }
    case "issues": {
      if (payload.action !== "labeled" || payload.label?.name !== GOAL_LABEL) return { skip: `not the ${GOAL_LABEL} label` };
      if (payload.sender?.login !== trustedLogin) return { skip: `labelled by ${payload.sender?.login}, not the trusted login` };
      return { kind: "goal-submitted", sha: null, prs: [], issue: payload.issue.number };
    }
    default:
      return { skip: `event ${eventName} is not one the bridge reacts to` };
  }
}

/**
 * The current record of a goal: the highest revision posted by the trusted login. Comments by
 * anyone else are ignored; two copies of the top revision (a fork) are reported, not guessed.
 * @returns {{ record: any } | { skip: string }}
 */
export function currentRecord(comments, goalId, trustedLogin) {
  const entries = [];
  for (const c of comments) {
    if (c.user?.login !== trustedLogin) continue;
    const m = MARKER.exec(String(c.body ?? ""));
    if (!m || (goalId && m[1] !== goalId)) continue;
    const json = /```json\n([\s\S]*?)\n```/.exec(c.body);
    if (!json) continue;
    try { entries.push(Object.defineProperty(JSON.parse(json[1]), POSTED_AT, { value: c.created_at, enumerable: false })); } catch { /* not a record */ }
  }
  if (!entries.length) return { skip: `no record for goal ${goalId ?? "(any)"} by ${trustedLogin}` };
  const top = Math.max(...entries.map((e) => e.revision));
  const atTop = entries.filter((e) => e.revision === top);
  const resolved = new Set(atTop.at(-1).resolvedForks ?? []);
  const revs = entries.map((e) => e.revision);
  const forked = revs.filter((r, i) => revs.indexOf(r) !== i && !resolved.has(r));
  if (forked.length) return { skip: `the record has diverging saves at revision ${forked[0]}; resolve-fork first` };
  return { record: atTop.at(-1) };
}

const minutes = (ms) => ms / 60_000;

/** Why a goal cannot take another run right now, or null when it can. */
export function runBlocker(record, now) {
  if (record.outcome) return `goal is already ${record.outcome.status}: ${record.outcome.reason}`;
  const open = (record.runs ?? []).find((r) => r.endedAt === null);
  if (open && minutes(now - Date.parse(open.startedAt)) < runStaleMinutes(record)) return `run ${open.n} (${open.sessionId}) is still in progress`;
  return null;
}

/** A wake ticket, or null for any comment that is not one written by the workflow. */
export function parseTicket(comment) {
  if (comment?.user?.login !== WORKFLOW_LOGIN) return null;
  const m = TICKET.exec(String(comment.body ?? ""));
  if (!m) return null;
  const onIssue = /\/issues\/(\d+)$/.exec(String(comment.issue_url ?? ""));
  return {
    id: comment.id, goal: m[1], issue: Number(m[2]), pr: m[3] === "none" ? null : Number(m[3]), sha: m[4] === "none" ? null : m[4],
    reason: m[5], state: m[6], attempts: Number(m[7]), recovers: m[8] ?? null, note: (/^Why: (.+)$/m.exec(String(comment.body)) ?? [])[1] ?? null,
    createdAt: comment.created_at, updatedAt: comment.updated_at ?? comment.created_at, onIssue: onIssue ? Number(onIssue[1]) : null,
  };
}

export function ticketBody(t) {
  const marker = `<!-- specsmith-auto-goal-wake goal=${t.goal} issue=${t.issue} pr=${t.pr ?? "none"} sha=${t.sha ?? "none"} reason=${t.reason} state=${t.state} attempts=${t.attempts}${t.recovers ? ` recovers=${t.recovers}` : ""} -->`;
  const what = t.state === "fired" ? "Woke the Auto Goal runner" : t.state === "failed" ? `Could not wake the Auto Goal runner (${t.attempts}/${MAX_FIRE_ATTEMPTS} calls failed${t.attempts >= MAX_FIRE_ATTEMPTS ? "; giving up" : "; the retry job will try again"})` : "Waking the Auto Goal runner";
  return `${marker}\n${what} for goal \`${t.goal}\` (${t.reason}${t.sha ? ` on \`${t.sha.slice(0, 10)}\`` : ""}). Written by the auto-goal-wake workflow; a routine run only proceeds for the ticket it was woken with.${t.note ? `\nWhy: ${t.note}` : ""}`;
}

const lastRunStart = (record) => Math.max(0, ...(record.runs ?? []).map((r) => Date.parse(r.startedAt)));
/** The goal's tickets that no run has started after, newest first. */
const unconsumed = (comments, record) => comments.map(parseTicket)
  .filter((t) => t && t.goal === record.id && t.onIssue === record.issue && Date.parse(t.createdAt) > lastRunStart(record))
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
/** Does the record still stand where the ticket says it did? */
const stillCurrent = (t, record) => t.reason === "recovery"
  ? (record.pr === t.pr && (record.head ?? null) === t.sha ? null : `goal ${record.id} has moved since recovery ticket ${t.id}`)
  : t.sha === null
  ? (record.pr === null && (record.runs ?? []).length === 0 ? null : "the goal has started since this ticket")
  : (record.pr === t.pr && record.head === t.sha ? null : `goal ${record.id} is now at PR ${record.pr} / ${String(record.head).slice(0, 10)}, not the ticket's PR ${t.pr} / ${t.sha.slice(0, 10)}`);

/** A wake already in flight for this goal and commit: a ticket pending or fired that no run has picked up. */
function inFlight(comments, record, sha, now) {
  return unconsumed(comments, record).find((t) => t.sha === sha && t.state !== "failed" && minutes(now - Date.parse(t.createdAt)) < WAKE_PENDING_MINUTES) ?? null;
}

/**
 * The routine's first step, decided: run the goal this ticket was written for, or refuse.
 * @param {{ ticket: any, issue: any, comments: any[], trustedLogin: string, now: number }} ctx  ticket: the raw comment
 */
export function verifyTicket(ctx) {
  const no = (why) => ({ proceed: false, why });
  const t = parseTicket(ctx.ticket);
  if (!t) return no("that comment is not a wake ticket written by the wake workflow");
  if (t.onIssue !== t.issue) return no(`ticket ${t.id} names issue ${t.issue} but was posted on issue ${t.onIssue}`);
  if (!ctx.issue || ctx.issue.number !== t.issue) return no(`issue ${t.issue} could not be read`);
  if (ctx.issue.state !== "open" || !(ctx.issue.labels ?? []).some((l) => (l.name ?? l) === GOAL_LABEL)) return no(`issue ${t.issue} is not an open ${GOAL_LABEL} issue`);
  if (ctx.trustedLogin === WORKFLOW_LOGIN) return no("the trusted login cannot be the workflow's own login");
  const found = currentRecord(ctx.comments, t.goal, ctx.trustedLogin);
  if ("skip" in found) return no(found.skip);
  const record = found.record;
  if (record.issue !== t.issue) return no(`goal ${t.goal}'s record lives on issue ${record.issue}, not ${t.issue}`);
  const consumed = (record.runs ?? []).find((r) => Date.parse(r.startedAt) >= Date.parse(t.createdAt));
  if (consumed) return no(`ticket ${t.id} was already taken by run ${consumed.n} (${consumed.sessionId})`);
  const moved = stillCurrent(t, record);
  if (moved) return no(moved);
  const blocked = runBlocker(record, ctx.now);
  if (blocked) return no(blocked);
  return { proceed: true, goal: record.id, issue: record.issue, ticket: t.id };
}

/** The ticket the retry job should fire again for this goal, or null. Only the newest ticket counts. */
export function retryTicket(comments, record, now) {
  if (runBlocker(record, now)) return null;
  const [newest] = unconsumed(comments, record);
  if (!newest || newest.state === "fired" || newest.attempts >= MAX_FIRE_ATTEMPTS) return null;
  return stillCurrent(newest, record) ? null : newest;
}

/** A run claim from its ref and commit subject (the format claim.ts writes), or null. */
export function parseClaim(goal, ref, subject) {
  const name = new RegExp(`^${CLAIM_PREFIX}/${goal}/(\\d+)-(\\d+)$`).exec(ref);
  const m = CLAIM_SUBJECT.exec(String(subject ?? "").trim());
  if (!name || !m || m[1] !== goal || m[2] !== name[1] || m[3] !== name[2] || Number.isNaN(Date.parse(m[5]))) return null;
  return { ref, run: Number(m[2]), attempt: Number(m[3]), session: m[4], at: m[5] };
}

/**
 * The scheduled fallback, decided. A goal is stalled only when nothing can still move it: no live
 * run, no live claim, no wake in flight, its last step was not one that waits for Codex or CI, and
 * nothing has been written for long enough that a live owner would have written. Each distinct
 * stall gets one recovery wake (a failed call is retried), and a goal gets at most MAX_RECOVERIES.
 * The woken session is checked again by the guard and by the runner's own claim, and the runner
 * enforces the goal's caps (it records the goal blocked at the run or time cap).
 * @param {{ comments: any[], claims: { ref: string, subject: string }[], trustedLogin: string, now: number }} ctx
 */
export function decideRecovery(ctx) {
  const { comments, trustedLogin, now } = ctx;
  const no = (why) => ({ wake: false, why });
  const found = currentRecord(comments, null, trustedLogin);
  if ("skip" in found) return no(found.skip);
  const record = found.record;
  if (record.outcome) return no(`goal ${record.id} is already ${record.outcome.status}`);
  const stale = runStaleMinutes(record);
  const claims = ctx.claims.map((c) => parseClaim(record.id, c.ref, c.subject)).filter(Boolean);
  if (claims.length !== ctx.claims.length) return no("a claim ref could not be read; not guessing");
  const runs = record.runs ?? [];
  const open = runs.find((r) => r.endedAt === null);
  const nextRun = runs.length + 1;
  if (claims.some((c) => c.run > nextRun)) return no(`a claim exists beyond run ${nextRun}, ahead of the record; not guessing`);
  const top = claims.filter((c) => c.run === nextRun).sort((a, b) => a.attempt - b.attempt).at(-1) ?? null;
  const age = (at) => minutes(now - Date.parse(at));
  if (open && age(open.startedAt) < stale) return no(`run ${open.n} by ${open.sessionId} is live (${Math.round(age(open.startedAt))} of ${stale} min)`);
  if (top && age(top.at) < stale) return no(`run ${nextRun} is claimed by ${top.session}, live (${Math.round(age(top.at))} of ${stale} min)`);
  if (top && top.attempt >= MAX_CLAIM_ATTEMPTS) return stuck(comments, record, `r${record.revision}-c${nextRun}-exhausted`, `Run ${nextRun} was claimed ${MAX_CLAIM_ATTEMPTS} times and never opened (last by ${top.session}), so no session can take it; a person must look.`);
  if (!open && !top && WAITING_STEPS.has(record.step)) return waitingStall(ctx, record, tickets(comments, record), now);
  const mine = tickets(comments, record);
  // GitHub's own time for the record comment is always there; a missing or odd field must not make a goal look abandoned.
  const times = [record[POSTED_AT], record.updatedAt, ...runs.flatMap((r) => [r.startedAt, r.endedAt]), ...mine.map((t) => t.createdAt), ...claims.map((c) => c.at)];
  const lastWrite = Math.max(...times.map((t) => Date.parse(t ?? "")).filter((t) => !Number.isNaN(t)));
  if (!Number.isFinite(lastWrite)) return no(`goal ${record.id} has no readable time of last activity; not guessing`);
  // A stale run or claim is already past its owner's lease; with neither, wait as long as a live owner could take.
  const quiet = open || top ? RUN_STALE_MARGIN_MINUTES : stale;
  if (minutes(now - lastWrite) < quiet) return no(`last activity ${Math.round(minutes(now - lastWrite))} min ago (needs ${quiet} min of quiet)`);
  const key = `r${record.revision}${top ? `-c${top.run}-${top.attempt}` : open ? `-o${open.n}` : ""}`;
  const what = top ? `claim ${top.ref} by ${top.session} went stale without opening run ${nextRun}` : open ? `run ${open.n} by ${open.sessionId} went stale without finishing` : `nothing happened for ${Math.round(minutes(now - lastWrite))} min after ${record.step}`;
  return bounded(comments, record, mine, now, key, what);
}

const tickets = (comments, record) => comments.map(parseTicket).filter((t) => t && t.goal === record.id && t.onIssue === record.issue);

/** One wake per stall, a failed call retried, MAX_RECOVERIES per goal; a stall it will not wake gets a visible notice. */
function bounded(comments, record, mine, now, key, what) {
  const flying = unconsumed(comments, record).find((t) => t.state !== "failed" && minutes(now - Date.parse(t.updatedAt)) < WAKE_PENDING_MINUTES);
  if (flying) return { wake: false, why: `wake ticket ${flying.id} is ${flying.state} and no run has started since` };
  const recoveries = mine.filter((t) => t.reason === "recovery");
  const same = recoveries.find((t) => t.recovers === key);
  if (same) {
    // A fired wake that no run took up within the pending window did not recover the stall (the
    // session may have stopped before the guard): call again, within the same attempt budget.
    const taken = lastRunStart(record) >= Date.parse(same.createdAt);
    const unanswered = same.state === "failed" || (same.state === "fired" && !taken && minutes(now - Date.parse(same.updatedAt)) >= WAKE_PENDING_MINUTES);
    if (unanswered && same.attempts < MAX_FIRE_ATTEMPTS) return { wake: true, retry: same, why: `${same.state === "failed" ? "retrying" : "no run took up"} recovery ticket ${same.id}: ${what}` };
    if (unanswered) return stuck(comments, record, `${key}-unrecovered`, `${what}. Recovery ticket ${same.id} was sent ${same.attempts} times and no run took it up; a person must look.`);
    return { wake: false, why: `this stall (${key}) already had its recovery wake: ticket ${same.id}, ${same.state}` };
  }
  if (recoveries.length >= MAX_RECOVERIES) return stuck(comments, record, `${key}-cap`, `${what}. The goal has used its ${MAX_RECOVERIES} recovery wakes, so the watchdog will not wake it again; a person must look.`);
  return { wake: true, why: what, goal: record.id, issue: record.issue, pr: record.pr ?? null, sha: record.head ?? null, reason: "recovery", recovers: key };
}

/** A stall the watchdog will not wake: say so once on the goal issue, not only in the Action log. */
function stuck(comments, record, key, text) {
  const posted = comments.some((c) => c.user?.login === WORKFLOW_LOGIN && (NOTICE.exec(String(c.body ?? "")) ?? [])[2] === key && NOTICE.exec(c.body)[1] === record.id);
  return { wake: false, why: text, notice: posted ? null : { key, body: noticeBody(record.id, key, text) } };
}

export function noticeBody(goal, key, text) {
  return `<!-- specsmith-auto-goal-stall goal=${goal} key=${key} -->\n**Auto Goal \`${goal}\` is stalled.** ${text}\n\nPosted once by the auto-goal-wake watchdog.`;
}

const REVIEWED = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/;

/**
 * Codex's verdicts on a PR, by the same rules as the runner's codex.ts (codexVerdicts), so the
 * watchdog never wakes for an answer the runner would not accept: a clean comment or a review names
 * the commit it reviewed; any other Codex comment (usage limits, an error) is "unavailable" and
 * answers whatever was requested; the status table counts only when it reports a failure.
 */
export function codexAnswers(prComments, reviews) {
  const out = [];
  for (const c of prComments ?? []) {
    if (c.user?.login !== CODEX_LOGIN) continue;
    const body = String(c.body ?? "");
    if (body.startsWith(SUMMARY)) { if (/\b(Failed|Error)\b|❌/.test(body)) out.push({ kind: "unavailable", at: c.created_at, prefix: null, url: c.html_url }); continue; }
    const reviewed = REVIEWED.exec(body);
    out.push(/Didn't find any major issues/i.test(body) && reviewed ? { kind: "clean", at: c.created_at, prefix: reviewed[1], url: c.html_url } : { kind: "unavailable", at: c.created_at, prefix: null, url: c.html_url });
  }
  for (const r of reviews ?? []) {
    if (r.user?.login !== CODEX_LOGIN) continue;
    out.push({ kind: "findings", at: r.submitted_at, prefix: REVIEWED.exec(String(r.body ?? ""))?.[1] ?? r.commit_id ?? null, url: r.html_url });
  }
  return out.filter((a) => a.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The first answer at or after the request that concerns the requested commit (codex.ts verdictFor). */
export function answerFor(answers, requestedSha, requestedAt) {
  const since = Date.parse(requestedAt);
  return answers.find((a) => Date.parse(a.at) >= since && (a.kind === "unavailable" || (a.prefix && requestedSha.startsWith(a.prefix)))) ?? null;
}

/**
 * A goal parked at wait-review or wait-ci. `ctx.live` is GitHub's state read on this pass: the PR's
 * head, Codex's answers on the PR and the head's check runs. A result already there with no wake
 * after it is a missed event: wake once. A timeout passed: wake once so the runner (the only writer
 * of the record) records the specific blocked outcome; the ticket on the issue says why.
 */
function waitingStall(ctx, record, mine, now) {
  const no = (why) => ({ wake: false, why });
  const live = ctx.live;
  if (!live) return no(`goal ${record.id} is at ${record.step} and GitHub's current state for PR ${record.pr} was not read`);
  const head = record.head;
  const short = String(head).slice(0, 10);
  if (live.prHead !== head) return no(`PR #${record.pr}'s head is ${String(live.prHead).slice(0, 10)}, not the goal's ${short}; its push event wakes the goal`);
  const round = (record.reviewRounds ?? []).filter((r) => r.requestedSha === head).at(-1);
  if (!round) return no(`no review round for ${short}`);
  const since = Date.parse(round.requestedAt);
  const age = (t) => Math.round(minutes(now - t));
  let key, what;
  if (record.step === "wait-review") {
    const answer = answerFor(codexAnswers(live.prComments, live.reviews), head, round.requestedAt);
    const limit = record.caps?.reviewTimeoutMinutes ?? 90;
    if (answer) {
      if (minutes(now - Date.parse(answer.at)) < EVENT_GRACE_MINUTES) return no(`Codex answered ${age(Date.parse(answer.at))} min ago; its event may still be arriving`);
      [key, what] = ["missed-review", `Codex answered review round ${round.n} on \`${short}\` ${age(Date.parse(answer.at))} min ago (${answer.url}), but no run followed: its event was missed`];
    } else if (minutes(now - since) <= limit) {
      return no(`Codex has not answered round ${round.n} yet (${age(since)} of ${limit} min)`);
    } else {
      [key, what] = ["review-timeout", `Codex has not answered review round ${round.n} on \`${short}\` after ${age(since)} min (timeout ${limit} min). Waking the runner to record the goal blocked; no new review is requested`];
    }
  } else {
    const required = record.requiredChecks ?? [];
    const runs = live.checkRuns ?? [];
    const pending = required.filter((name) => !runs.some((r) => r.name === name && r.status === "completed"));
    const limit = record.caps?.ciTimeoutMinutes ?? DEFAULT_CI_TIMEOUT_MINUTES;
    if (!pending.length) {
      const done = Math.max(...required.map((name) => Date.parse(runs.find((r) => r.name === name && r.status === "completed").completed_at ?? 0) || 0));
      if (minutes(now - done) < EVENT_GRACE_MINUTES) return no(`the required checks finished ${age(done)} min ago; their event may still be arriving`);
      [key, what] = ["missed-ci", `The required checks on \`${short}\` finished ${age(done)} min ago, but no run followed: their event was missed`];
    } else if (minutes(now - since) <= limit) {
      return no(`required check(s) ${pending.join(", ")} still running on ${short} (${age(since)} of ${limit} min)`);
    } else {
      [key, what] = ["ci-timeout", `Required check(s) ${pending.join(", ")} have not finished on \`${short}\` after ${age(since)} min (timeout ${limit} min). Waking the runner to record the goal blocked`];
    }
  }
  // Keyed by commit and round, not record revision: a woken run that saves without moving the goal on
  // must not make the same stall look new.
  return bounded(ctx.comments, record, mine, now, `${key}-${head.slice(0, 7)}-r${round.n}`, what);
}

/**
 * The whole decision. Pure: everything it needs is passed in.
 * @param {{ event: any, pr?: any, comments: any[], checkRuns?: any[], trustedLogin: string, repo: string, now: number }} ctx  comments: the goal issue's
 * @returns {{ wake: false, why: string } | { wake: true, why: string, goal: string, issue: number, pr: number | null, sha: string | null, reason: string }}
 */
export function decideWake(ctx) {
  const { event, pr, comments, trustedLogin, repo, now } = ctx;
  const no = (why) => ({ wake: false, why });

  if (event.kind === "goal-submitted") {
    const found = currentRecord(comments, null, trustedLogin);
    if ("skip" in found) return no(found.skip);
    const record = found.record;
    const blocked = runBlocker(record, now);
    if (blocked) return no(blocked);
    if ((record.runs ?? []).length > 0 || record.pr !== null) return no("goal has already started; later runs are woken by its PR events");
    const sent = inFlight(comments, record, null, now);
    if (sent) return no(`wake ticket ${sent.id} for this goal is ${sent.state} and no run has started since`);
    return { wake: true, why: "goal submitted", goal: record.id, issue: record.issue, pr: null, sha: null, reason: "goal-submitted" };
  }

  // A PR event: only a draft, same-repository Auto Goal PR, on its current commit.
  if (!pr) return no("no pull request for this event");
  if (pr.state !== "open" || pr.merged) return no(`PR #${pr.number} is not open`);
  if (!pr.draft) return no(`PR #${pr.number} is not a draft; the runner only drives its own draft PRs`);
  if (pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo) return no(`PR #${pr.number} is not from ${repo}`);
  if (!String(pr.head?.ref ?? "").startsWith("claude/")) return no(`PR #${pr.number} branch ${pr.head?.ref} is not a claude/ branch`);
  const title = /^Auto Goal ([a-z0-9][a-z0-9-]{2,63}):/.exec(String(pr.title ?? ""));
  const issueRef = /Goal record: #(\d+)\./.exec(String(pr.body ?? ""));
  if (!title || !issueRef) return no(`PR #${pr.number} is not an Auto Goal PR`);
  const head = pr.head.sha;
  if (event.sha && event.sha !== head) return no(`event is for ${event.sha.slice(0, 10)}, but the PR head is now ${head.slice(0, 10)}`);

  const found = currentRecord(comments, title[1], trustedLogin);
  if ("skip" in found) return no(found.skip);
  const record = found.record;
  if (record.pr !== pr.number) return no(`goal ${record.id} records PR ${record.pr}, not #${pr.number}`);
  if (record.head !== head) return no(`goal ${record.id} is at ${String(record.head).slice(0, 10)}, the PR head is ${head.slice(0, 10)}: a run is mid-push or the PR moved outside the goal`);
  const blocked = runBlocker(record, now);
  if (blocked) return no(blocked);

  if (event.kind === "checks") {
    const runs = ctx.checkRuns ?? [];
    const waiting = (record.requiredChecks ?? []).filter((name) => !runs.some((r) => r.name === name && r.status === "completed"));
    if (waiting.length) return no(`required checks still running on ${head.slice(0, 10)}: ${waiting.join(", ")}`);
  }

  // Duplicate deliveries: a wake already sent for this commit that no run has picked up yet. A ticket
  // whose call failed does not count, so a redelivered event tries again.
  const sent = inFlight(comments, record, head, now);
  if (sent) return no(`wake ticket ${sent.id} for ${head.slice(0, 10)} is ${sent.state} (${Math.round(minutes(now - Date.parse(sent.createdAt)))} min ago) and no run has started since`);

  const reason = event.kind === "codex" ? "codex" : "checks";
  return { wake: true, why: `${reason} on ${head.slice(0, 10)}`, goal: record.id, issue: record.issue, pr: pr.number, sha: head, reason };
}

// ---- I/O (exercised end to end by wake.process.test.ts against a fake GitHub) ----------------

const env = (name) => { const v = process.env[name]; if (!v) throw new Error(`${name} is not set`); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

async function allComments(repo, issue) {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await gh(`repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function fireOnce(text) {
  const url = env("AUTO_GOAL_ROUTINE_FIRE_URL"), token = env("AUTO_GOAL_ROUTINE_TOKEN");
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) throw new Error("routine fire URL is not an Anthropic routine /fire endpoint");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  // Only the status is logged: the response names the session, and the request carries the token.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Call the routine for a ticket (up to this step's share of attempts) and record the outcome on the ticket. */
async function fireTicket(repo, t) {
  const budget = Math.min(FIRE_ATTEMPTS_PER_STEP, MAX_FIRE_ATTEMPTS - t.attempts);
  const backoff = Number(process.env.AUTO_GOAL_FIRE_BACKOFF_MS ?? 15_000);
  let attempts = t.attempts, ok = false;
  for (let i = 0; i < budget && !ok; i += 1) {
    if (i > 0) await sleep(backoff * i);
    attempts += 1;
    try { await fireOnce(`wake ticket=${t.id}`); ok = true; } catch (error) { console.log(`routine call ${attempts}/${MAX_FIRE_ATTEMPTS} for ticket ${t.id} failed: ${error.message}`); }
  }
  const next = { ...t, state: ok ? "fired" : "failed", attempts };
  await gh(`repos/${repo}/issues/comments/${t.id}`, { method: "PATCH", body: JSON.stringify({ body: ticketBody(next) }) });
  console.log(ok ? `fired the routine for ticket ${t.id}` : `ticket ${t.id} is failed after ${attempts} call(s)`);
  return ok;
}

async function eventMain() {
  const repo = env("GITHUB_REPOSITORY"), trustedLogin = env("AUTO_GOAL_TRUSTED_LOGIN");
  const payload = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const event = normalizeEvent(process.env.GITHUB_EVENT_NAME, payload, trustedLogin);
  if ("skip" in event) { console.log(`skip: ${event.skip}`); return; }
  const now = Date.now();
  const decisions = [];
  if (event.kind === "goal-submitted") {
    decisions.push(decideWake({ event, comments: await allComments(repo, event.issue), trustedLogin, repo, now }));
  } else {
    for (const number of event.prs.slice(0, 5)) {
      const pr = await gh(`repos/${repo}/pulls/${number}`);
      const issueRef = /Goal record: #(\d+)\./.exec(String(pr.body ?? ""));
      const comments = issueRef ? await allComments(repo, Number(issueRef[1])) : [];
      const checkRuns = (await gh(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs;
      decisions.push(decideWake({ event, pr, comments, checkRuns, trustedLogin, repo, now }));
    }
    if (!decisions.length) console.log("skip: the event names no pull request in this repository");
  }
  let failed = 0;
  for (const d of decisions) {
    console.log(`${d.wake ? "wake" : "skip"}: ${d.why}`);
    if (!d.wake) continue;
    // The ticket is written first, so a duplicate delivery arriving during the call sees it pending.
    const draft = { goal: d.goal, issue: d.issue, pr: d.pr, sha: d.sha, reason: d.reason, state: "pending", attempts: 0 };
    const created = await gh(`repos/${repo}/issues/${d.issue}/comments`, { method: "POST", body: JSON.stringify({ body: ticketBody(draft) }) });
    if (!(await fireTicket(repo, { ...draft, id: created.id }))) failed += 1;
  }
  // A failed call fails the job, which starts the workflow's retry job.
  if (failed) process.exitCode = 1;
}

async function retryMain() {
  const repo = env("GITHUB_REPOSITORY"), trustedLogin = env("AUTO_GOAL_TRUSTED_LOGIN");
  await sleep(Number(process.env.AUTO_GOAL_RETRY_DELAY_MS ?? 120_000));
  const issues = (await gh(`repos/${repo}/issues?labels=${GOAL_LABEL}&state=open&per_page=50`)).filter((i) => !i.pull_request);
  let failed = 0, tried = 0;
  for (const issue of issues) {
    const comments = await allComments(repo, issue.number);
    const found = currentRecord(comments, null, trustedLogin);
    if ("skip" in found) continue;
    const t = retryTicket(comments, found.record, Date.now());
    if (!t) continue;
    tried += 1;
    if (!(await fireTicket(repo, t))) failed += 1;
  }
  console.log(tried ? `retried ${tried} ticket(s), ${failed} still failed` : "nothing to retry");
  if (failed) process.exitCode = 1;
}

/** Every claim ref of a goal, with its commit subject. Throws if any cannot be read: the watchdog never acts on a partial view. */
async function readClaims(repo, goal) {
  const refs = await gh(`repos/${repo}/git/matching-refs/heads/${CLAIM_PREFIX}/${goal}/`);
  const out = [];
  for (const r of refs.slice(0, 60)) {
    const commit = await gh(`repos/${repo}/git/commits/${r.object.sha}`);
    out.push({ ref: r.ref.replace(/^refs\/heads\//, ""), subject: String(commit.message ?? "").split("\n")[0] });
  }
  return out;
}

/** GitHub's current state for a goal parked at wait-review or wait-ci: PR head, Codex's answers, the head's checks. */
async function readLive(repo, record) {
  const pr = await gh(`repos/${repo}/pulls/${record.pr}`);
  const prComments = await allComments(repo, record.pr);
  const reviews = await gh(`repos/${repo}/pulls/${record.pr}/reviews?per_page=100`);
  const checkRuns = (await gh(`repos/${repo}/commits/${record.head}/check-runs?per_page=100`)).check_runs;
  return { prHead: pr.head.sha, prComments, reviews, checkRuns };
}

async function watchdogMain() {
  const repo = env("GITHUB_REPOSITORY"), trustedLogin = env("AUTO_GOAL_TRUSTED_LOGIN");
  const issues = (await gh(`repos/${repo}/issues?labels=${GOAL_LABEL}&state=open&per_page=50`)).filter((i) => !i.pull_request);
  let failed = 0;
  for (const issue of issues) {
    let d;
    try {
      const comments = await allComments(repo, issue.number);
      const found = currentRecord(comments, null, trustedLogin);
      const record = "record" in found ? found.record : null;
      const claims = record ? await readClaims(repo, record.id) : [];
      const live = record && !record.outcome && WAITING_STEPS.has(record.step) && record.pr && record.head ? await readLive(repo, record) : null;
      d = decideRecovery({ comments, claims, live, trustedLogin, now: Date.now() });
    } catch (error) {
      console.log(`#${issue.number}: skip: could not read the goal's state (${error.message})`);
      continue;
    }
    console.log(`#${issue.number}: ${d.wake ? "recover" : "skip"}: ${d.why}`);
    if (d.notice) await gh(`repos/${repo}/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: d.notice.body }) });
    if (!d.wake) continue;
    let t = d.retry;
    if (!t) {
      const draft = { goal: d.goal, issue: d.issue, pr: d.pr, sha: d.sha, reason: "recovery", recovers: d.recovers, note: d.why, state: "pending", attempts: 0 };
      const created = await gh(`repos/${repo}/issues/${d.issue}/comments`, { method: "POST", body: JSON.stringify({ body: ticketBody(draft) }) });
      t = { ...draft, id: created.id };
    }
    if (!(await fireTicket(repo, t))) failed += 1;
  }
  if (failed) process.exitCode = 1;
}

/** The routine's first step: the goal named by a verified wake ticket, or exit 3. Reads GitHub through `gh api`. */
async function guardMain(argv) {
  const repo = process.env.AUTO_GOAL_REPO ?? "setupify-labz/Specsmith", trustedLogin = process.env.AUTO_GOAL_TRUSTED_LOGIN ?? "setupify-labz";
  const refuse = (why) => { console.log(JSON.stringify({ proceed: false, why })); process.exitCode = 3; };
  const i = argv.indexOf("--ticket");
  const id = i >= 0 ? argv[i + 1] : undefined;
  if (!id || !/^\d{1,15}$/.test(id)) return refuse("no wake ticket id: this run cannot tell which goal it was woken for");
  const { execFileSync } = await import("node:child_process");
  const api = (path) => {
    try { return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })); } catch { return null; }
  };
  const ticket = api(`repos/${repo}/issues/comments/${id}`);
  if (!ticket) return refuse(`wake ticket ${id} could not be read`);
  const t = parseTicket(ticket);
  const issue = t ? api(`repos/${repo}/issues/${t.issue}`) : null;
  const comments = [];
  if (issue) for (let page = 1; page <= 20; page += 1) { const b = api(`repos/${repo}/issues/${t.issue}/comments?per_page=100&page=${page}`) ?? []; comments.push(...b); if (b.length < 100) break; }
  const verdict = verifyTicket({ ticket, issue, comments, trustedLogin, now: Date.now() });
  console.log(JSON.stringify(verdict));
  if (!verdict.proceed) process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [mode, ...rest] = process.argv.slice(2);
  const main = { event: eventMain, retry: retryMain, watchdog: watchdogMain, guard: () => guardMain(rest) }[mode];
  (main ? main() : Promise.reject(new Error("usage: wake.mjs event | retry | watchdog | guard --ticket <id>")))
    .catch((error) => { console.error(String(error.message ?? error)); process.exitCode = 1; });
}
