#!/usr/bin/env node
// The Auto Goal wake bridge: decides, from one GitHub event and the goal record, whether to start
// the next unattended runner session through the routine's API trigger.
//
// It runs in .github/workflows/auto-goal-wake.yml, from the default branch only (every trigger it
// uses is one GitHub runs from the default branch), with no checkout of PR code and no
// dependencies. It never reads or forwards review text: the fire payload is a fixed line of ids.
//
//   node wake.mjs event    the workflow step: decide, mark, fire (needs GITHUB_* env + routine secrets)
//   node wake.mjs guard    the routine's first step: name the active goal, or refuse an overlapping run
//
// Plain JavaScript on purpose: GitHub's runner has Node, and nothing has to be installed first.

import { readFileSync } from "node:fs";

export const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
export const GOAL_LABEL = "auto-goal";
export const WAKE_CONTEXT = "auto-goal/wake";
/** A wake not yet followed by a run start is treated as pending for this long, then retried. */
export const WAKE_PENDING_MINUTES = 45;
/** A run that has not finished within this long is treated as dead, not as one to wait for. */
export const RUN_STALE_MINUTES = 40;
const MARKER = /^<!-- specsmith-auto-goal id=([a-z0-9-]+)(?: rev=(\d+))? -->/;
const SUMMARY = "<!-- codex-pull-request-review-summary -->";

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
    try { entries.push(JSON.parse(json[1])); } catch { /* not a record */ }
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
  if (open && minutes(now - Date.parse(open.startedAt)) < RUN_STALE_MINUTES) return `run ${open.n} (${open.sessionId}) is still in progress`;
  return null;
}

/**
 * The whole decision. Pure: everything it needs is passed in.
 * @param {{ event: any, pr?: any, comments: any[], checkRuns?: any[], statuses?: any[], trustedLogin: string, repo: string, now: number }} ctx
 * @returns {{ wake: false, why: string } | { wake: true, why: string, goal: string, issue: number, pr: number | null, sha: string | null, text: string }}
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
    return { wake: true, why: "goal submitted", goal: record.id, issue: record.issue, pr: null, sha: null, text: `wake goal=${record.id} issue=${record.issue} reason=goal-submitted` };
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

  // Duplicate deliveries: a wake already sent for this commit that no run has picked up yet.
  const lastRunStart = Math.max(0, ...(record.runs ?? []).map((r) => Date.parse(r.startedAt)));
  const pending = (ctx.statuses ?? []).filter((s) => s.context === WAKE_CONTEXT)
    .map((s) => Date.parse(s.created_at))
    .filter((t) => t > lastRunStart && minutes(now - t) < WAKE_PENDING_MINUTES);
  if (pending.length) return no(`a wake for ${head.slice(0, 10)} was sent ${Math.round(minutes(now - Math.max(...pending)))} min ago and no run has started since`);

  const reason = event.kind === "codex" ? "codex" : "checks";
  return { wake: true, why: `${reason} on ${head.slice(0, 10)}`, goal: record.id, issue: record.issue, pr: pr.number, sha: head, text: `wake goal=${record.id} issue=${record.issue} pr=${pr.number} sha=${head} reason=${reason}` };
}

// ---- I/O (not unit-tested; the decision above is) -------------------------------------------

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

async function fire(text) {
  const url = process.env.AUTO_GOAL_ROUTINE_FIRE_URL, token = process.env.AUTO_GOAL_ROUTINE_TOKEN;
  if (!url || !token) throw new Error("routine fire URL or token secret is not set");
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) throw new Error("routine fire URL is not an Anthropic routine /fire endpoint");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  // Only the status is logged: the response names the session, and the request carries the token.
  if (!res.ok) throw new Error(`routine fire: HTTP ${res.status}`);
}

async function eventMain() {
  const repo = process.env.GITHUB_REPOSITORY, trustedLogin = process.env.AUTO_GOAL_TRUSTED_LOGIN;
  if (!trustedLogin) throw new Error("AUTO_GOAL_TRUSTED_LOGIN is not set");
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
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
      const statuses = await gh(`repos/${repo}/commits/${pr.head.sha}/statuses?per_page=100`);
      decisions.push(decideWake({ event, pr, comments, checkRuns, statuses, trustedLogin, repo, now }));
    }
    if (!decisions.length) console.log("skip: the event names no pull request in this repository");
  }
  for (const d of decisions) {
    console.log(`${d.wake ? "wake" : "skip"}: ${d.why}`);
    if (!d.wake) continue;
    // Mark first, so a duplicate delivery arriving during the fire sees a pending wake.
    if (d.sha) await gh(`repos/${repo}/statuses/${d.sha}`, { method: "POST", body: JSON.stringify({ state: "success", context: WAKE_CONTEXT, description: `Woke the Auto Goal runner (${d.why})`.slice(0, 140) }) });
    await fire(d.text);
    console.log("fired the routine");
  }
}

/** The routine's first step: the oldest active goal, or exit 3 when a run is already in progress. */
async function guardMain() {
  const repo = process.env.AUTO_GOAL_REPO ?? "setupify-labz/Specsmith", trustedLogin = process.env.AUTO_GOAL_TRUSTED_LOGIN ?? "setupify-labz";
  const { execFileSync } = await import("node:child_process");
  const api = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const issues = api(`repos/${repo}/issues?labels=${GOAL_LABEL}&state=open&sort=created&direction=asc&per_page=20`).filter((i) => !i.pull_request);
  for (const issue of issues) {
    const comments = [];
    for (let page = 1; page <= 20; page += 1) { const b = api(`repos/${repo}/issues/${issue.number}/comments?per_page=100&page=${page}`); comments.push(...b); if (b.length < 100) break; }
    const found = currentRecord(comments, null, trustedLogin);
    if ("skip" in found) continue;
    if (found.record.outcome) continue;
    const blocked = runBlocker(found.record, Date.now());
    if (blocked) { console.log(JSON.stringify({ goal: found.record.id, issue: issue.number, proceed: false, why: blocked })); process.exitCode = 3; return; }
    console.log(JSON.stringify({ goal: found.record.id, issue: issue.number, proceed: true }));
    return;
  }
  console.log(JSON.stringify({ proceed: false, why: "no active Auto Goal" }));
  process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  (mode === "event" ? eventMain() : mode === "guard" ? guardMain() : Promise.reject(new Error("usage: wake.mjs event|guard")))
    .catch((error) => { console.error(String(error.message ?? error)); process.exitCode = 1; });
}
