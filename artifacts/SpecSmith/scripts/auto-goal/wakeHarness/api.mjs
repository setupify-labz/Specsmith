// Test-only: an in-file fake of the few GitHub REST routes wake.mjs uses, plus the routine /fire
// endpoint. State lives in the JSON file named by WAKE_HARNESS_STATE so that several processes
// (the workflow steps and the routine's guard) see one world, as they would on GitHub.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";

export const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_HARNESS/fire";
const load = () => JSON.parse(readFileSync(process.env.WAKE_HARNESS_STATE, "utf8"));
const save = (s) => { const tmp = `${process.env.WAKE_HARNESS_STATE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, process.env.WAKE_HARNESS_STATE); };

/** Several processes share the state file, as several clients share GitHub: one request at a time. */
function locked(fn) {
  const lock = `${process.env.WAKE_HARNESS_STATE}.lock`, nap = new Int32Array(new SharedArrayBuffer(4)), until = Date.now() + 10_000;
  for (;;) {
    try { mkdirSync(lock); break; } catch { if (Date.now() > until) throw new Error("harness lock timed out"); Atomics.wait(nap, 0, 0, 5); }
  }
  try { return fn(); } finally { rmdirSync(lock); }
}

/**
 * @param actor  the login the call is made as: the workflow's fetch calls are github-actions[bot],
 *               a session's `gh` calls are the orchestrator's login.
 * @returns {{ status: number, body: any }}
 */
export function handle(method, url, body, actor = "github-actions[bot]") {
  return locked(() => { const s = load(); try { return route(s, method, url, body, actor); } finally { save(s); } });
}

function route(s, method, url, body, actor) {
  if (url === FIRE_URL) {
    s.fireCalls.push(body?.text);
    if (s.fireFailures > 0) { s.fireFailures -= 1; return { status: 503, body: { error: "unavailable" } }; }
    // The ambiguous case: the routine starts a session, but the caller never sees the answer.
    s.deliveries.push(body?.text);
    if (s.fireLost > 0) { s.fireLost -= 1; return { status: 504, body: { error: "gateway timeout" } }; }
    s.fires.push(body?.text);
    return { status: 200, body: { session: "session_harness" } };
  }
  const u = new URL(url, "https://api.github.com/");
  if (method === "GET" && u.pathname === "/user") return { status: 200, body: { login: actor } };
  const p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\//, "");
  const page = Number(u.searchParams.get("page") ?? 1);
  let m;
  if (method === "GET" && (m = /^pulls\/(\d+)$/.exec(p))) return s.pulls[m[1]] ? { status: 200, body: s.pulls[m[1]] } : { status: 404, body: {} };
  if (method === "GET" && (m = /^issues\/(\d+)\/comments$/.exec(p))) return { status: 200, body: page > 1 ? [] : (s.comments[m[1]] ?? []) };
  if (method === "GET" && (m = /^issues\/comments\/(\d+)$/.exec(p))) {
    const c = Object.values(s.comments).flat().find((x) => String(x.id) === m[1]);
    return c ? { status: 200, body: c } : { status: 404, body: {} };
  }
  if (method === "PATCH" && (m = /^issues\/comments\/(\d+)$/.exec(p))) {
    const c = Object.values(s.comments).flat().find((x) => String(x.id) === m[1]);
    if (!c) return { status: 404, body: {} };
    c.body = body.body; c.updated_at = new Date().toISOString();
    return { status: 200, body: c };
  }
  if (method === "POST" && (m = /^issues\/(\d+)\/comments$/.exec(p))) {
    const c = { id: s.nextId++, user: { login: actor }, body: body.body, html_url: `https://github.com/${s.repo}/issues/${m[1]}#issuecomment-${s.nextId - 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), issue_url: `https://api.github.com/repos/${s.repo}/issues/${m[1]}` };
    (s.comments[m[1]] ??= []).push(c);
    return { status: 201, body: c };
  }
  if (method === "GET" && (m = /^issues\/(\d+)$/.exec(p))) {
    const i = s.issues.find((x) => String(x.number) === m[1]);
    return i ? { status: 200, body: i } : { status: 404, body: {} };
  }
  if (method === "GET" && p === "issues") {
    const label = u.searchParams.get("labels");
    return { status: 200, body: page > 1 ? [] : s.issues.filter((i) => i.state === "open" && i.labels.some((l) => l.name === label)) };
  }
  if (method === "GET" && (m = /^pulls\/(\d+)\/reviews$/.exec(p))) return { status: 200, body: page > 1 ? [] : (s.reviews?.[m[1]] ?? []) };
  if (method === "GET" && /^pulls\/\d+\/comments$/.test(p)) return { status: 200, body: [] };
  // Branches and commits, read from the local bare repository standing in for origin (s.origin).
  const realGit = (...a) => execFileSync(process.env.WAKE_HARNESS_REAL_GIT ?? "git", ["-C", s.origin, ...a], { encoding: "utf8" });
  if (method === "GET" && (m = /^git\/matching-refs\/(heads\/.+)$/.exec(p))) {
    if (!s.origin) return { status: 200, body: [] };
    const prefix = `refs/${m[1]}`;
    const lines = realGit("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/").split("\n").filter(Boolean);
    return { status: 200, body: lines.map((l) => l.split(" ")).filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, object: { sha, type: "commit" } })) };
  }
  if (method === "GET" && (m = /^git\/commits\/([0-9a-f]{40})$/.exec(p))) {
    if (!s.origin) return { status: 404, body: {} };
    return { status: 200, body: { sha: m[1], message: realGit("log", "-1", "--format=%B", m[1]) } };
  }
  if (method === "GET" && (m = /^commits\/([0-9a-f]+)\/check-runs$/.exec(p))) return { status: 200, body: { check_runs: s.checkRuns[m[1]] ?? [] } };
  if (method === "GET" && (m = /^commits\/([0-9a-f]+)\/statuses$/.exec(p))) return { status: 200, body: s.statuses[m[1]] ?? [] };
  if (method === "POST" && (m = /^statuses\/([0-9a-f]+)$/.exec(p))) {
    (s.statuses[m[1]] ??= []).unshift({ ...body, created_at: new Date().toISOString(), creator: { login: "github-actions[bot]" } });
    return { status: 201, body: {} };
  }
  // The executor workflow (PILOT_HANDOFF_CONTRACT.md §1A): the coordinator only reads its id and runs and
  // sends dispatches; the harness records each dispatch and never starts a run.
  if (method === "GET" && p === "actions/workflows/auto-goal-actions.yml") return { status: 200, body: { id: 777, path: ".github/workflows/auto-goal-actions.yml", state: "active" } };
  if (method === "POST" && p === "actions/workflows/auto-goal-actions.yml/dispatches") {
    (s.dispatches ??= []).push({ ref: body?.ref, inputs: body?.inputs, actor });
    return { status: 204, body: {} };
  }
  if (method === "GET" && p === "actions/workflows/auto-goal-actions.yml/runs") return { status: 200, body: { total_count: 0, workflow_runs: [] } };
  if (method === "GET" && (m = /^git\/ref\/heads\/(.+)$/.exec(p))) {
    if (!s.origin) return { status: 404, body: {} };
    try { return { status: 200, body: { ref: `refs/heads/${m[1]}`, object: { sha: realGit("rev-parse", "--verify", "-q", `refs/heads/${m[1]}`).trim(), type: "commit" } } }; } catch { return { status: 404, body: { message: "Not Found" } }; }
  }
  return { status: 404, body: { message: `harness has no route ${method} ${p}` } };
}
