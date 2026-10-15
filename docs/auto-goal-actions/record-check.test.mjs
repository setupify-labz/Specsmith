// Credential-free tests of the record-check job.
// Run with: node --test docs/auto-goal-actions/record-check.test.mjs
//
// They extract the job's actual inline script from the workflow and run it against a fake GitHub API
// served by this process on 127.0.0.1. The token is the placeholder below, accepted only by the fake.
// PR fields and error bodies carry a second marker, standing in for untrusted text, and every test
// checks that neither marker reaches stdout or stderr.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const yaml = readFileSync(join(here, "auto-goal-actions.yml"), "utf8");
const script = yaml.split("// BEGIN TRUSTED CHECK RECORDER\n")[1]?.split("// END TRUSTED CHECK RECORDER")[0];
assert.ok(script, "the workflow's inline recorder is tested, not a copy");

const TOKEN = "PlaceHolder_Not_A_Token_1c9e";
const UNTRUSTED = "Untrusted_PR_Text_5b2d";
const REPO = "setupify-labz/Specsmith";
const SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const BRANCH = "claude/auto-goal-pilot-1";
const NUMBER = 42;

/** The PR as GitHub would return it for a correct proposal, with untrusted text in every free field. */
function goodPr(over = {}) {
  return {
    number: NUMBER, state: "open", draft: true, merged: false,
    title: `${UNTRUSTED} title`, body: `${UNTRUSTED} body`, user: { login: UNTRUSTED },
    base: { ref: "main", sha: "c".repeat(40), repo: { full_name: REPO } },
    head: { ref: BRANCH, sha: SHA, label: UNTRUSTED, repo: { full_name: REPO } },
    ...over,
  };
}

/**
 * A fake GitHub API. `prs` is a list of responses for successive GETs of the PR (the last one repeats),
 * each a PR object, or { status, body } for an error. Statuses are stored per SHA, as GitHub does.
 */
function fakeGitHub({ prs = [goodPr()], statusReply } = {}) {
  const requests = [];
  const statuses = new Map();
  let reads = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const send = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: `${UNTRUSTED} bad credentials` });
      if (req.method === "GET" && req.url === `/repos/${REPO}/pulls/${NUMBER}`) {
        const reply = prs[Math.min(reads++, prs.length - 1)];
        return reply.status ? send(reply.status, reply.body ?? { message: `${UNTRUSTED} not found` }) : send(200, reply);
      }
      const m = /^\/repos\/([^/]+\/[^/]+)\/statuses\/([0-9a-f]{40})$/.exec(req.url);
      if (req.method === "POST" && m && m[1] === REPO) {
        if (statusReply) return send(statusReply, { message: `${UNTRUSTED} server error` });
        const s = JSON.parse(body);
        statuses.set(m[2], [...(statuses.get(m[2]) ?? []), s]);
        return send(201, { ...s, id: 1, creator: { login: "github-actions[bot]" } });
      }
      return send(404, { message: `${UNTRUSTED} unknown route` });
    });
  });
  return { server, requests, statuses, posts: () => requests.filter((r) => r.method === "POST") };
}

async function record(fake, env = {}) {
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  try {
    const childEnv = {
      PATH: process.env.PATH, GH_TOKEN: TOKEN, GITHUB_API_URL: `http://127.0.0.1:${fake.server.address().port}`,
      GITHUB_REPOSITORY: REPO, GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "12345",
      CHECK_RESULT: "success", PR_NUMBER: String(NUMBER), PROPOSAL_SHA: SHA, PROPOSAL_BRANCH: BRANCH, CHECK_PHASE: "after", ...env,
    };
    for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
    }).then((r) => {
      // Nothing from the token, the PR or GitHub's responses reaches the log, in any letter case.
      for (const secret of [TOKEN, UNTRUSTED, SHA, NEW_SHA, BRANCH]) assert.ok(!r.out.toLowerCase().includes(secret.toLowerCase()), "the log carried a value it must not print");
      return r;
    });
  } finally { fake.server.close(); fake.server.closeAllConnections(); }
}

function refused(r, fake, reason) {
  assert.equal(r.code, 1);
  assert.match(r.out, /^Refusing to record the check: .*\.\n$/);
  assert.match(r.out, reason);
  assert.equal(fake.posts().length, 0, "no status was written");
  assert.equal(fake.statuses.size, 0);
}

test("success: the PR is re-read and success is written only on the proposal SHA", async () => {
  const fake = fakeGitHub();
  const r = await record(fake);
  assert.equal(r.code, 0);
  assert.equal(r.out, "Recorded the Auto Goal check success on the exact draft commit that was checked.\n");
  const posts = fake.posts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `/repos/${REPO}/statuses/${SHA}`);
  assert.deepEqual(JSON.parse(posts[0].body), { state: "success", context: "auto-goal/check", description: "Auto Goal check passed on this exact commit", target_url: `https://github.com/${REPO}/actions/runs/12345` });
  assert.deepEqual(fake.requests.map((q) => q.method), ["GET", "POST", "GET"], "read, write, read again");
  assert.ok(fake.requests.every((q) => q.auth === `Bearer ${TOKEN}`));
});

test("version 1: a before-fix pass writes auto-goal/before, and an unknown phase writes nothing", async () => {
  const fake = fakeGitHub();
  const r = await record(fake, { CHECK_PHASE: "before" });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(fake.posts()[0].body).context, "auto-goal/before");
  const none = fakeGitHub();
  refused(await record(none, { CHECK_PHASE: "sideways" }), none, /check phase is not valid/);
});

test("stale head: a PR whose head moved after the check gets no status", async () => {
  const fake = fakeGitHub({ prs: [goodPr({ head: { ...goodPr().head, sha: NEW_SHA } })] });
  refused(await record(fake), fake, /the PR head is not the commit that was checked/);
});

test("a later push does not inherit the old commit's success", async () => {
  // The head moves between the write and the second read: success stays on the tested SHA, the job
  // fails, and the new head has no auto-goal/check status at all.
  const fake = fakeGitHub({ prs: [goodPr(), goodPr({ head: { ...goodPr().head, sha: NEW_SHA } })] });
  const r = await record(fake);
  assert.equal(r.code, 1);
  assert.match(r.out, /the PR head is not the commit that was checked/);
  assert.deepEqual([...fake.statuses.keys()], [SHA]);
  assert.equal(fake.statuses.get(NEW_SHA), undefined);
});

test("wrong PR: another number, repository, fork, base or branch gets no status", async () => {
  for (const [pr, reason] of [
    [goodPr({ number: NUMBER + 1 }), /a different PR/],
    [goodPr({ base: { ...goodPr().base, repo: { full_name: "someone/else" } } }), /not between branches of this repository/],
    [goodPr({ head: { ...goodPr().head, repo: { full_name: "someone/Specsmith" } } }), /not between branches of this repository/],
    [goodPr({ head: { ...goodPr().head, repo: null } }), /not between branches of this repository/],
    [goodPr({ base: { ...goodPr().base, ref: "release" } }), /does not target main/],
    [goodPr({ head: { ...goodPr().head, ref: "claude/auto-goal-other-goal" } }), /not from the proposal branch/],
  ]) {
    const fake = fakeGitHub({ prs: [pr] });
    refused(await record(fake), fake, reason);
  }
});

test("closed, merged or no longer draft PRs get no status", async () => {
  for (const [pr, reason] of [
    [goodPr({ state: "closed" }), /not open/],
    [goodPr({ state: "closed", merged: true }), /not open/],
    [goodPr({ draft: false }), /not a draft/],
  ]) {
    const fake = fakeGitHub({ prs: [pr] });
    refused(await record(fake), fake, reason);
  }
});

test("missing PR, unreadable responses and a rejected write all fail", async () => {
  for (const [prs, reason] of [
    [[{ status: 404 }], /the PR does not exist/],
    [[{ status: 403 }], /could not be read/],
    [[{ status: 500 }], /could not be read/],
    [[{ status: 200, body: `${UNTRUSTED} not an object` }], /could not be read/],
    [[{ status: 200, body: [goodPr()] }], /could not be read/],
  ]) {
    const fake = fakeGitHub({ prs });
    refused(await record(fake), fake, reason);
  }
  const rejected = fakeGitHub({ statusReply: 500 });
  const r = await record(rejected);
  assert.equal(r.code, 1);
  assert.match(r.out, /GitHub did not accept the status/);
  assert.equal(rejected.statuses.size, 0);
});

test("failed check: any result other than success makes no request at all", async () => {
  for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
    const fake = fakeGitHub();
    const r = await record(fake, { CHECK_RESULT: result });
    refused(r, fake, /the check job did not succeed/);
    assert.equal(fake.requests.length, 0);
  }
});

test("invalid inputs make no request, and the bad values are not printed", async () => {
  for (const [env, reason] of [
    [{ PR_NUMBER: "42/../../statuses" }, /PR number/],
    [{ PR_NUMBER: "0" }, /PR number/],
    [{ PROPOSAL_SHA: SHA.toUpperCase() }, /proposal SHA/],
    [{ PROPOSAL_SHA: `${SHA}\n` }, /proposal SHA/],
    [{ PROPOSAL_BRANCH: `main` }, /proposal branch/],
    [{ GITHUB_REPOSITORY: "a/b/c" }, /runner context/],
    [{ GH_TOKEN: "" }, /no token/],
  ]) {
    const fake = fakeGitHub();
    const r = await record(fake, env);
    refused(r, fake, reason);
    assert.equal(fake.requests.length, 0);
  }
});

// ---- The workflow --------------------------------------------------------------------------------

const code = yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const job = (name) => new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, "m").exec(code)?.[1] ?? "";

test("workflow: record-check is gated, runs after check, and has only PR read and status write", () => {
  const rc = job("record-check");
  assert.ok(rc);
  assert.match(rc, /^    if: \$\{\{ false && github\.ref == 'refs\/heads\/main' \}\}/);
  assert.match(rc, /^    needs: \[read-dispatch, publish, check\]$/m);
  assert.match(rc, /^    permissions:\n      pull-requests: read\n      statuses: write\n    steps:/m);
  // No checkout, no action, no install, nothing from the proposal is executed.
  assert.doesNotMatch(rc, /\buses:|checkout|pnpm|npm |npx|git |download-artifact|node_modules|secrets\./);
  // Inputs come only from trusted job outputs and contexts, through the environment.
  const envKeys = [...(/        env:\n((?:          [A-Z_]+: .*\n)+)/.exec(rc)?.[1] ?? "").matchAll(/          ([A-Z_]+): (.*)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(envKeys, [
    ["GH_TOKEN", "${{ github.token }}"],
    ["CHECK_RESULT", "${{ needs.check.result }}"],
    ["PR_NUMBER", "${{ needs.publish.outputs.pr_number }}"],
    ["PROPOSAL_SHA", "${{ needs.publish.outputs.proposal_sha }}"],
    ["PROPOSAL_BRANCH", "${{ needs.publish.outputs.proposal_branch }}"],
    ["CHECK_PHASE", "${{ fromJSON(needs.read-dispatch.outputs.packet).check_phase }}"],
  ]);
  assert.doesNotMatch(rc.slice(rc.indexOf("run: |")), /\$\{\{/, "no expression is interpolated into the script");
  // The script logs only fixed strings.
  for (const m of script.matchAll(/console\.(?:log|error)\(([^;]*)\);/g)) assert.match(m[1], /^('[^']*'|`Refusing to record the check: \$\{message\}\.`)$/, m[1]);
  for (const m of script.matchAll(/refuse\(([^;]*?)\)(?=;|\s*$)/gm)) if (!m[1].startsWith("message")) assert.match(m[1], /^'[^']*'$/, m[1]);
});

test("workflow: publish outputs the PR number and branch, and every job stays disabled", () => {
  const pub = job("publish");
  assert.match(pub, /pr_number: \$\{\{ steps\.pr\.outputs\.pr_number \}\}/);
  assert.match(pub, /proposal_branch: \$\{\{ steps\.commit\.outputs\.branch \}\}/);
  assert.match(pub, /\[\[ "\$pr_number" =~ \^\[1-9\]\[0-9\]\{0,9\}\$ \]\]/);
  const names = [...code.matchAll(/^  ([a-z-]+):\n/gm)].map((m) => m[1]);
  assert.deepEqual(names, ["read-dispatch", "implement", "publish", "gate-checks", "check", "record-check"]);
  for (const n of names) assert.match(job(n), /^    if: \$\{\{ false && /, n);
  assert.match(yaml, /^permissions: \{\}$/m);
  assert.match(yaml, /^on:\n  workflow_dispatch:\n/m);
});
