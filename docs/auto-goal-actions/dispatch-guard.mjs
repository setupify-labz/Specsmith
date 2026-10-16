#!/usr/bin/env node
// The executor's dispatch guard (PILOT_HANDOFF_CONTRACT.md §1A.4 change 9, §1A.5). Trusted code from
// the reviewed executor commit E; it never runs proposed code and prints only fixed messages.
//
//   node docs/auto-goal-actions/dispatch-guard.mjs read        read-dispatch job: validate, emit the work packet
//   node docs/auto-goal-actions/dispatch-guard.mjs pre-push    publish job, the last step before `git push`
//   node docs/auto-goal-actions/dispatch-guard.mjs post-push   publish job, right after the push
//   node docs/auto-goal-actions/dispatch-guard.mjs pre-check   check job, before checking out the proposal
//
// Every mode reads the goal record fresh from the issue and validates every revision by the trusted
// login the way the coordinator's store does (record-guard.mjs: validateGoal, marker revisions, fields
// pinned to the first revision, executor mode, no unresolved fork) before it uses the record's branch
// or dispatch fields. It refuses unless the goal is still open and the dispatch is its one live dispatch. pre-push also requires the branch to be at the dispatch base
// and the commit to carry the dispatch's parent and trailers. The record and the branch are separate
// GitHub objects, so these checks are not atomic with the push (contract §1A.5).

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { RECORD_PROBLEM, validatedRecord } from "./record-guard.mjs";

/** Every refusal the guard can print. Nothing read from GitHub, the record or git is ever printed. */
export const REFUSAL = Object.freeze({
  input: "the dispatch inputs are malformed",
  noRecord: "no single current goal record by the trusted login",
  invalidRecord: "the goal record is not a valid executor-mode record",
  wrongIssue: "the record does not live on the dispatched issue",
  stopped: "the goal is no longer open (outcome recorded)",
  executorMoved: "this run is not the executor commit the goal pinned",
  notCurrent: "the nonce is not the goal's one live dispatch",
  wrongPhase: "the dispatch phase does not match this step",
  branchMoved: "the goal branch is not where the dispatch expects",
  commit: "the commit does not have the dispatch's parent and trailers",
  unavailable: "GitHub could not be read",
});

const GOAL = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * The validated current record, or the refusal that applies: records by anyone else are ignored; no
 * record or an unresolved fork is noRecord; any revision that fails validation is invalidRecord.
 */
export function readRecord(comments, goalId, trustedLogin) {
  const v = validatedRecord(comments, goalId, trustedLogin);
  if ("record" in v) return { record: v.record };
  return { why: v.problem === RECORD_PROBLEM.none || v.problem === RECORD_PROBLEM.forked ? REFUSAL.noRecord : REFUSAL.invalidRecord };
}

/** The validated current record, or null. */
export function readCurrent(comments, goalId, trustedLogin) {
  const r = readRecord(comments, goalId, trustedLogin);
  return "record" in r ? r.record : null;
}

/**
 * §1A.5 steps 2-4. `branchHead` is the goal branch's commit, or null when the branch is absent;
 * undefined skips the branch check (after the push, when the branch is expected to have moved).
 */
export function checkDispatch({ record, issue, nonce, phase, githubSha, branchHead }) {
  if (!record) return { ok: false, why: REFUSAL.noRecord };
  if (record.issue !== issue) return { ok: false, why: REFUSAL.wrongIssue };
  if (record.outcome !== null && record.outcome !== undefined) return { ok: false, why: REFUSAL.stopped };
  if (typeof record.executorSha !== "string" || record.executorSha !== githubSha) return { ok: false, why: REFUSAL.executorMoved };
  const live = (record.dispatches ?? []).filter((d) => d.state === "pending" || d.state === "bound");
  if (live.length !== 1 || live[0].nonce !== nonce) return { ok: false, why: REFUSAL.notCurrent };
  const d = live[0];
  if (phase !== undefined && d.phase !== phase) return { ok: false, why: REFUSAL.wrongPhase };
  if (branchHead !== undefined && (d.phase === "reproduce" ? branchHead !== null : branchHead !== d.baseSha)) return { ok: false, why: REFUSAL.branchMoved };
  return { ok: true, dispatch: d };
}

/** §1A.5 step 5: one parent, the dispatch base, and exactly one of each trailer naming this dispatch and run. */
export function checkCommit({ parents, message, dispatch, runId }) {
  const one = (key) => { const all = [...String(message).matchAll(new RegExp(`^${key}: (\\S+)$`, "gm"))]; return all.length === 1 ? all[0][1] : null; };
  if (parents.length !== 1 || parents[0] !== dispatch.baseSha) return { ok: false, why: REFUSAL.commit };
  if (one("Auto-Goal-Dispatch") !== dispatch.nonce || one("Auto-Goal-Run") !== String(runId)) return { ok: false, why: REFUSAL.commit };
  return { ok: true };
}

/** What the later jobs need, as data. The request is untrusted text and only ever reaches the restricted implementer. */
export function workPacket(record, dispatch) {
  const criterion = record.acceptanceCriteria[0];
  const checks = [{ label: criterion.id, check: `vitest:${criterion.check.file}` }];
  if (dispatch.phase === "implement") checks.push({ label: "typecheck", check: "typecheck" });
  return {
    phase: dispatch.phase, base_sha: dispatch.baseSha, branch: record.branch, nonce: dispatch.nonce,
    criterion_file: `artifacts/SpecSmith/${criterion.check.file}`, check_phase: dispatch.phase === "reproduce" ? "before" : "after",
    checks, request: record.request,
  };
}

// ---- I/O --------------------------------------------------------------------------------------

async function api(path) {
  const res = await fetch(`${process.env.GITHUB_API_URL}${path}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GH_TOKEN}`, "x-github-api-version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("unavailable");
  return res.json();
}

async function comments(repo, issue) {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await api(`/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("unavailable");
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function branchHead(repo, branch) {
  const ref = await api(`/repos/${repo}/git/ref/heads/${branch}`);
  return ref === null ? null : ref.object.sha;
}

function refuse(why) { console.error(`Refusing: ${why}.`); process.exit(1); }

async function main(mode) {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY ?? "", goal = env.GOAL ?? "", nonce = env.NONCE ?? "";
  // Plain digits only: Number() alone would read "4e2" as issue 400.
  if (!/^[1-9]\d{0,9}$/.test(env.ISSUE ?? "")) refuse(REFUSAL.input);
  const issue = Number(env.ISSUE);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !GOAL.test(goal) || !new RegExp(`^${goal}\\.d[1-9]\\d{0,2}$`).test(nonce)) refuse(REFUSAL.input);
  if (!SHA.test(env.GITHUB_SHA ?? "") || !env.AUTO_GOAL_TRUSTED_LOGIN || !env.GH_TOKEN || !/^https?:\/\/\S+$/.test(env.GITHUB_API_URL ?? "")) refuse(REFUSAL.input);
  let read, head;
  try { read = readRecord(await comments(repo, issue), goal, env.AUTO_GOAL_TRUSTED_LOGIN); } catch { refuse(REFUSAL.unavailable); }
  // Nothing below reads the record's branch or dispatch fields unless every revision validated.
  if (!("record" in read)) refuse(read.why);
  const record = read.record;
  try { head = await branchHead(repo, record.branch); } catch { refuse(REFUSAL.unavailable); }
  if (mode === "post-push" || mode === "pre-check") {
    // After the push the branch is at the new commit, so only the record half is re-checked here.
    const r = checkDispatch({ record, issue, nonce, githubSha: env.GITHUB_SHA, branchHead: undefined });
    if (!r.ok) refuse(r.why);
    console.log(`The goal is still open and ${mode === "post-push" ? "this dispatch is still current" : "the checks may run"}.`);
    return;
  }
  const r = checkDispatch({ record, issue, nonce, githubSha: env.GITHUB_SHA, branchHead: head });
  if (!r.ok) refuse(r.why);
  if (mode === "read") {
    if (!env.GITHUB_OUTPUT) refuse(REFUSAL.input);
    // One line of JSON: newlines in the request are escaped, so it cannot add outputs of its own.
    appendFileSync(env.GITHUB_OUTPUT, `packet=${JSON.stringify(workPacket(record, r.dispatch))}\n`);
    console.log("The dispatch is current; work packet written.");
    return;
  }
  if (mode === "pre-push") {
    const sha = env.PROPOSAL_SHA ?? "";
    if (!SHA.test(sha) || !/^\d{1,20}$/.test(env.GITHUB_RUN_ID ?? "")) refuse(REFUSAL.input);
    let parents, message;
    try {
      parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", sha], { encoding: "utf8" }).trim().split(" ").slice(1);
      message = execFileSync("git", ["log", "-1", "--format=%B", sha], { encoding: "utf8" });
    } catch { refuse(REFUSAL.commit); }
    const c = checkCommit({ parents, message, dispatch: r.dispatch, runId: env.GITHUB_RUN_ID });
    if (!c.ok) refuse(c.why);
    console.log("The goal is open, the dispatch is current and the branch is at its base: push allowed.");
    return;
  }
  refuse(REFUSAL.input);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main(process.argv[2]);
