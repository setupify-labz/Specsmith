// Test-only: an in-file fake of the few GitHub REST routes wake.mjs uses, plus the routine /fire
// endpoint. State lives in the JSON file named by WAKE_HARNESS_STATE so that several processes
// (the workflow steps and the routine's guard) see one world, as they would on GitHub.

import { readFileSync, writeFileSync } from "node:fs";

export const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_HARNESS/fire";
const load = () => JSON.parse(readFileSync(process.env.WAKE_HARNESS_STATE, "utf8"));
const save = (s) => writeFileSync(process.env.WAKE_HARNESS_STATE, JSON.stringify(s, null, 2));

/** @returns {{ status: number, body: any }} */
export function handle(method, url, body) {
  const s = load();
  try { return route(s, method, url, body); } finally { save(s); }
}

function route(s, method, url, body) {
  if (url === FIRE_URL) {
    s.fireCalls.push(body?.text);
    if (s.fireFailures > 0) { s.fireFailures -= 1; return { status: 503, body: { error: "unavailable" } }; }
    s.fires.push(body?.text);
    return { status: 200, body: { session: "session_harness" } };
  }
  const u = new URL(url, "https://api.github.com/");
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
    const c = { id: s.nextId++, user: { login: "github-actions[bot]" }, body: body.body, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), issue_url: `https://api.github.com/repos/${s.repo}/issues/${m[1]}` };
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
  if (method === "GET" && (m = /^commits\/([0-9a-f]+)\/check-runs$/.exec(p))) return { status: 200, body: { check_runs: s.checkRuns[m[1]] ?? [] } };
  if (method === "GET" && (m = /^commits\/([0-9a-f]+)\/statuses$/.exec(p))) return { status: 200, body: s.statuses[m[1]] ?? [] };
  if (method === "POST" && (m = /^statuses\/([0-9a-f]+)$/.exec(p))) {
    (s.statuses[m[1]] ??= []).unshift({ ...body, created_at: new Date().toISOString(), creator: { login: "github-actions[bot]" } });
    return { status: 201, body: {} };
  }
  return { status: 404, body: { message: `harness has no route ${method} ${p}` } };
}
