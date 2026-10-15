// Credential-free checks that the implement job leaves Git unable to authenticate.
// Run with: node --test docs/auto-goal-actions/no-git-auth.test.mjs
//
// No real credential is used. Where a credential route has to be present (to show the check finds
// it), the value is the placeholder PLACEHOLDER_NOT_A_TOKEN. Git talks only to a local HTTP server in
// this process that demands Basic authentication and records whether any request carried an
// Authorization header. Every git command runs with a fresh HOME and no system or global config, so
// the machine's own Git setup cannot leak in.
//
// What this cannot prove: see "What the no-git-auth test cannot prove" in SECURITY_REVIEW.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { CATEGORY, findGitAuth } from "./assert-no-git-auth.mjs";

const PLACEHOLDER = "PLACEHOLDER_NOT_A_TOKEN";
/** Mixed case, because Git lowercases config keys: a check for the exact string would miss a lowercased copy. */
const MIXED = "PlaceHolder_Not_A_Token";
const MESSAGES = new Set(Object.values(CATEGORY));

/** The guard's output must be only fixed category lines, and contain the secret in no case. */
function assertNoDisclosure(output, secret) {
  assert.ok(!output.toLowerCase().includes(secret.toLowerCase()), "the guard printed the credential (in some letter case)");
  for (const line of output.split("\n").filter((l) => l.startsWith("- "))) assert.ok(MESSAGES.has(line.slice(2)), `not a fixed category message: ${line.slice(0, 2)}…`);
}
const here = new URL(".", import.meta.url).pathname;

/** The implement step's environment as the workflow declares it, with placeholders, plus a clean, empty Git setup. */
function stepEnv(home, extra = {}) {
  return {
    PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_TERMINAL_PROMPT: "0",
    CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER, ISSUE_JSON: '{"number":1,"title":"t","body":"b"}',
    ...extra,
  };
}

/** A checkout like the implement job's: a repository whose origin is an HTTPS-style URL, with no credential config. */
function checkout(remote) {
  const root = mkdtempSync(join(tmpdir(), "no-git-auth-"));
  const home = join(root, "home"), repo = join(root, "repo");
  mkdirSync(home); mkdirSync(repo);
  writeFileSync(join(home, ".gitconfig"), "");
  const env = stepEnv(home);
  for (const args of [["init", "-q"], ["remote", "add", "origin", remote]]) assert.equal(spawnSync("git", args, { cwd: repo, env }).status, 0);
  return { root, home, repo };
}

/** A local server that demands Basic auth, like GitHub does for a push or a private fetch. */
async function authServer() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization ? "present" : "absent", value: req.headers.authorization ?? "" });
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    res.end("authentication required");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/owner/repo.git`, seen, close: () => new Promise((r) => server.close(r)) };
}

/** git as a child process, async, so this process's HTTP server can answer it. */
function git(args, cwd, env) {
  return new Promise((done) => {
    const child = spawn("git", args, { cwd, env });
    let out = "";
    child.stdout.on("data", (b) => { out += b; }); child.stderr.on("data", (b) => { out += b; });
    child.on("close", (code) => done({ code, out }));
  });
}

test("the implement step's Git cannot authenticate: no credential is offered and the request fails", async () => {
  const server = await authServer();
  const { root, home, repo } = checkout(server.url);
  try {
    const env = stepEnv(home);
    assert.deepEqual(findGitAuth(repo, env), []);
    for (const args of [["ls-remote", "origin"], ["push", "--dry-run", "origin", "HEAD:refs/heads/claude/x"]]) {
      const r = await git(args, repo, env);
      assert.notEqual(r.code, 0, `git ${args[0]} must fail`);
      assert.doesNotMatch(r.out, new RegExp(PLACEHOLDER));
    }
    assert.ok(server.seen.length > 0, "git reached the server");
    assert.ok(server.seen.every((s) => s.authorization === "absent"), "no request carried credentials");
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test("positive control: with checkout's persisted credential, the same Git does send one (so the test can see it)", async () => {
  const server = await authServer();
  const { root, home, repo } = checkout(server.url);
  try {
    const env = stepEnv(home);
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${PLACEHOLDER}`).toString("base64")}`;
    assert.equal(spawnSync("git", ["config", `http.${server.url.replace(/owner\/repo\.git$/, "")}.extraheader`, header], { cwd: repo, env }).status, 0);
    assert.deepEqual(findGitAuth(repo, env), [CATEGORY.extraHeader]);
    await git(["ls-remote", "origin"], repo, env);
    assert.ok(server.seen.some((s) => s.authorization === "present"), "the injected header reached the server");
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test("each known route is refused with a fixed category message, and nothing it read is printed", () => {
  const { root, home, repo } = checkout("https://github.com/owner/repo.git");
  const cli = join(here, "assert-no-git-auth.mjs");
  const refuse = (setup, expected) => {
    const env = stepEnv(home, setup.env ?? {});
    for (const args of setup.git ?? []) assert.equal(spawnSync("git", args, { cwd: repo, env }).status, 0);
    for (const [file, text] of setup.files ?? []) { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text); }
    const r = spawnSync(process.execPath, [cli, repo], { env, encoding: "utf8" });
    assert.equal(r.status, 1, `${expected} must be refused`);
    assert.ok(r.stderr.includes(`- ${expected}`), `expected "${expected}"`);
    assertNoDisclosure(r.stdout + r.stderr, MIXED);
    for (const args of setup.undo ?? []) spawnSync("git", args, { cwd: repo, env });
    for (const [file] of setup.files ?? []) rmSync(file, { force: true });
  };
  try {
    assert.equal(spawnSync(process.execPath, [cli, repo], { env: stepEnv(home), encoding: "utf8" }).status, 0);
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) refuse({ env: { [name]: MIXED } }, CATEGORY.tokenVariable);
    refuse({ env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: MIXED } }, CATEGORY.oidcVariable);
    refuse({ env: { GIT_ASKPASS: MIXED } }, CATEGORY.askpassVariable);
    refuse({ env: { GIT_CONFIG_PARAMETERS: `'http.extraheader=${MIXED}'` } }, CATEGORY.envConfig);
    refuse({ env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: MIXED } }, CATEGORY.envConfig);
    refuse({ git: [["config", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${MIXED}`]], undo: [["config", "--unset-all", "http.https://github.com/.extraheader"]] }, CATEGORY.extraHeader);
    refuse({ git: [["config", "credential.helper", "store"]], undo: [["config", "--unset-all", "credential.helper"]] }, CATEGORY.credentialConfig);
    refuse({ git: [["remote", "set-url", "origin", `https://x-access-token:${MIXED}@github.com/owner/repo.git`]], undo: [["remote", "set-url", "origin", "https://github.com/owner/repo.git"]] }, CATEGORY.remoteWithCredentials);
    refuse({ git: [["config", `url.https://x:${MIXED}@github.com/.insteadOf`, "https://github.com/"]], undo: [["config", "--remove-section", `url.https://x:${MIXED}@github.com/`]] }, CATEGORY.rewriteWithCredentials);
    refuse({ files: [[join(home, ".git-credentials"), `https://x:${MIXED}@github.com\n`]] }, CATEGORY.credentialFile);
    refuse({ files: [[join(home, ".config", "gh", "hosts.yml"), `github.com:\n  oauth_token: ${MIXED}\n`]] }, CATEGORY.credentialFile);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("regression (inline finding on #187): a credential in a URL rewrite key is not printed in any case", () => {
  // Git lowercases config section names, so the old guard printed `git config url.https://x:placeholder_not_a_token@…`.
  const { root, home, repo } = checkout("https://github.com/owner/repo.git");
  try {
    const env = stepEnv(home);
    assert.equal(spawnSync("git", ["config", `url.https://Oauth2:${MIXED}@GitHub.com/.InsteadOf`, "https://github.com/"], { cwd: repo, env }).status, 0);
    assert.equal(spawnSync("git", ["config", `remote.origin.pushUrl`, `https://X-Access-Token:${MIXED}@GitHub.com/owner/repo.git`], { cwd: repo, env }).status, 0);
    const found = findGitAuth(repo, env);
    assert.deepEqual(found.sort(), [CATEGORY.remoteWithCredentials, CATEGORY.rewriteWithCredentials].sort());
    const r = spawnSync(process.execPath, [join(here, "assert-no-git-auth.mjs"), repo], { env, encoding: "utf8" });
    assert.equal(r.status, 1);
    assertNoDisclosure(r.stdout + r.stderr, MIXED);
    assert.ok(!(r.stdout + r.stderr).toLowerCase().includes("github.com"), "no URL from the config is printed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow: the implement job has no GitHub token, and the issue is read in a separate job", () => {
  const yaml = readFileSync(join(here, "auto-goal-actions.yml"), "utf8");
  const code = yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const job = (name) => new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, "m").exec(code)?.[1] ?? "";
  const read = job("read-issue"), impl = job("implement");
  assert.ok(read && impl);
  // Issue reading: its own job, issues-only token, no checkout, no secrets, no Claude.
  assert.match(read, /permissions:\n      issues: read\n    outputs:/);
  assert.doesNotMatch(read, /actions\/checkout|secrets\.|claude/i);
  // Implement: contents read only, no GitHub token anywhere, no OIDC, no hosted action.
  assert.match(impl, /needs: read-issue/);
  assert.match(impl, /permissions:\n      contents: read\n    steps:/);
  assert.doesNotMatch(impl, /github\.token|GH_TOKEN|GITHUB_TOKEN|github_token|id-token|issues: |claude-code-action/);
  assert.match(impl, /persist-credentials: false/);
  // The Claude step: exactly these variables, the issue only as data from the other job, the check first.
  const step = /- name: Propose edits with no GitHub credential configured or passed\n([\s\S]*?)(?=\n      - )/.exec(impl)?.[1] ?? "";
  const envKeys = [...(/        env:\n((?:          [A-Z_]+: .*\n)+)/.exec(step)?.[1] ?? "").matchAll(/          ([A-Z_]+):/g)].map((m) => m[1]);
  assert.deepEqual(envKeys, ["CLAUDE_CODE_OAUTH_TOKEN", "ISSUE_JSON", "GIT_TERMINAL_PROMPT"]);
  assert.match(step, /ISSUE_JSON: \$\{\{ needs\.read-issue\.outputs\.issue_json \}\}/);
  assert.ok(step.indexOf("assert-no-git-auth.mjs") > 0 && step.indexOf("assert-no-git-auth.mjs") < step.indexOf("claude -p"));
  assert.doesNotMatch(step.slice(step.indexOf("run: |")), /\$\{\{/);   // issue text reaches the script only through the environment
  assert.match(step, /--restricted/);
  assert.match(step, /--disallowedTools "Bash,PowerShell,WebFetch,WebSearch,Write,NotebookEdit,Agent,mcp__\*"/);
  // The export step re-checks, and the validator and gates are unchanged.
  assert.match(impl, /- name: Export a narrow, text-only patch\n[\s\S]*assert-no-git-auth\.mjs[\s\S]*validate-proposal\.mjs/);
  for (const name of ["read-issue", "implement", "publish", "check"]) assert.match(job(name), /if: \$\{\{ false && github\.ref == 'refs\/heads\/main' \}\}/);
  assert.match(job("publish"), /needs: implement/);
});
