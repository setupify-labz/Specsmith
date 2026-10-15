// Credential-free checks of the implement job's Claude CLI restriction.
// Run with: node --test docs/auto-goal-actions/restricted-cli.test.mjs
//
// The static tests read the workflow's actual `claude` command. The CLI tests need the pinned CLI on
// this machine (AUTO_GOAL_CLAUDE_BIN=/path/to/claude, from `npm install @anthropic-ai/claude-code@<pin>`)
// and are skipped without it. They run that CLI with the workflow's exact flags against a local mock of
// the Messages API in this process: the "model" is a fixed script of tool calls, so no model, account
// or Anthropic service is involved. The only key is the placeholder below, accepted by nothing but the
// mock. HOME is a fresh empty directory, and the proxy points at a closed local port, so a request to
// any other host fails.
//
// What this cannot prove: see "What restricted mode still cannot protect" in SECURITY_REVIEW.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePatch } from "./validate-proposal.mjs";

const here = new URL(".", import.meta.url).pathname;
const repoRoot = join(here, "..", "..");
const yaml = readFileSync(join(here, "auto-goal-actions.yml"), "utf8");
const bin = process.env.AUTO_GOAL_CLAUDE_BIN;
const PLACEHOLDER_KEY = "placeholder-not-a-key";
const CANARY = "CANARY_NOT_A_SECRET_7f3c";
const MIN_RESTRICTED = [2, 1, 248]; // cli-reference: "--restricted ... Requires Claude Code v2.1.248 or later"

const implement = /^  implement:\n([\s\S]*?)(?=^  [a-z-]+:\n)/m.exec(yaml)?.[1] ?? "";
const pin = /@anthropic-ai\/claude-code@(\S+)/.exec(implement)?.[1] ?? "";

/** The workflow's `claude` invocation as an argv, with "$prompt" left as a marker. */
function workflowArgs() {
  const run = /- name: Propose edits with no GitHub credential configured or passed\n[\s\S]*?run: \|\n([\s\S]*?)(?=\n      - )/.exec(implement)?.[1] ?? "";
  const lines = run.split("\n");
  const start = lines.findIndex((l) => /^ *claude -p /.test(l));
  let line = "";
  for (let i = start; start >= 0 && i < lines.length; i++) {
    line += " " + lines[i].trim().replace(/\\$/, "");
    if (!lines[i].endsWith("\\")) break;
  }
  line = line.trim().replace(/^claude /, "");
  const argv = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) argv.push(m[1] ?? m[2] ?? m[3]);
  return argv;
}
const args = workflowArgs();
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const list = (name) => (flag(name) ?? "").split(",").filter(Boolean);

test("pin: the implement job installs one exact CLI version that documents --restricted", () => {
  assert.match(pin, /^\d+\.\d+\.\d+$/, "an exact version, not a range or tag");
  const v = pin.split(".").map(Number);
  const cmp = v[0] - MIN_RESTRICTED[0] || v[1] - MIN_RESTRICTED[1] || v[2] - MIN_RESTRICTED[2];
  assert.ok(cmp >= 0, `pinned ${pin} predates --restricted`);
  assert.equal([...yaml.matchAll(/@anthropic-ai\/claude-code@/g)].length, 1);
});

test("workflow: the CLI runs restricted, with only file tools and no route to approve more", () => {
  assert.equal(args[0], "-p");
  assert.equal(args[1], "$prompt");
  assert.ok(args.includes("--restricted"));
  assert.deepEqual(list("--tools"), ["Read", "Edit", "Glob", "Grep"]);
  for (const t of ["Bash", "PowerShell", "WebFetch", "WebSearch", "Write", "NotebookEdit", "Agent", "mcp__*"]) assert.ok(list("--disallowedTools").includes(t), t);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(flag("--permission-mode"), "default");
  assert.equal(flag("--permission-prompts"), "none");
  // Edit is allowed only on the validator's own source scope; nothing else is pre-approved.
  assert.deepEqual(list("--allowedTools"), ["Read", "Glob", "Grep", "Edit(./artifacts/SpecSmith/src/**/*.ts)", "Edit(./artifacts/SpecSmith/src/**/*.tsx)", "Edit(./artifacts/SpecSmith/src/**/*.css)"]);
  // No flag that adds directories, settings sources, tools, agents, plugins, MCP servers or bypass.
  for (const f of ["--add-dir", "--setting-sources", "--mcp-config", "--agents", "--agent", "--plugin-dir", "--plugin-url", "--permission-prompt-tool", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--bare", "--continue", "--resume"]) assert.ok(!args.includes(f), f);
  assert.deepEqual(args.filter((a) => a.startsWith("-")), ["-p", "--restricted", "--tools", "--allowedTools", "--disallowedTools", "--settings", "--strict-mcp-config", "--permission-mode", "--permission-prompts", "--no-session-persistence"], "no unreviewed flag");
});

test("workflow: inline settings reinstate the project's Read denials and turn off hooks and bypass", () => {
  // --restricted ignores .claude/settings.json, including its Read deny rules, so they must come back
  // through --settings. Inline JSON in the trusted workflow, so no file in the checkout supplies it.
  const settings = JSON.parse(flag("--settings"));
  const project = JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions.deny, project.permissions.deny);
  assert.ok(settings.permissions.deny.every((r) => r.startsWith("Read(")));
  assert.equal(settings.disableAllHooks, true);
  assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
  assert.deepEqual(Object.keys(settings).sort(), ["disableAllHooks", "permissions"]);
  assert.deepEqual(Object.keys(settings.permissions).sort(), ["deny", "disableBypassPermissionsMode"]);
});

test("workflow: the Claude step's environment, guard order and job gate are unchanged", () => {
  const step = /- name: Propose edits with no GitHub credential configured or passed\n([\s\S]*?)(?=\n      - )/.exec(implement)?.[1] ?? "";
  const envKeys = [...(/        env:\n((?:          [A-Z_]+: .*\n)+)/.exec(step)?.[1] ?? "").matchAll(/          ([A-Z_]+):/g)].map((m) => m[1]);
  assert.deepEqual(envKeys, ["CLAUDE_CODE_OAUTH_TOKEN", "TASK_JSON", "GIT_TERMINAL_PROMPT"]);
  assert.ok(step.indexOf("assert-no-git-auth.mjs") < step.indexOf("claude -p"));
  for (const job of ["read-dispatch", "implement", "publish", "gate-checks", "check", "record-check"]) {
    assert.match(new RegExp(`^  ${job}:\\n    if: \\$\\{\\{ false && github\\.ref == 'refs/heads/main' \\}\\}`, "m").exec(yaml)?.[0] ?? "", /false/, job);
  }
});

test("file scope: every path the Edit rules allow is one the validator accepts, and the rest are refused", () => {
  const rel = (p) => p.replace(/^Edit\(\.\//, "").replace(/\)$/, "");
  const globs = list("--allowedTools").filter((t) => t.startsWith("Edit(")).map(rel);
  const patch = (path) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;
  for (const g of globs) { const p = g.replace("**/*", "pages/x"); assert.deepEqual(validatePatch(patch(p)).paths, [p]); }
  for (const path of ["package.json", ".claude/settings.json", "CLAUDE.md", ".github/workflows/ci.yml", "docs/auto-goal-actions/auto-goal-actions.yml", "artifacts/SpecSmith/src/x.js", "artifacts/SpecSmith/vite.config.ts"]) {
    assert.throws(() => validatePatch(patch(path)), undefined, path);
  }
});

// ---- CLI behaviour against a local mock (skipped without the pinned CLI) -------------------------

/** A scratch checkout: SpecSmith's real .claude/settings.json and CLAUDE.md, plus small fixtures. */
function workdir() {
  const root = mkdtempSync(join(tmpdir(), "restricted-cli-"));
  const work = join(root, "work"), outside = join(root, "outside"), home = join(root, "home");
  for (const d of [join(work, ".claude"), join(work, "artifacts/SpecSmith/src/lib"), outside, home]) mkdirSync(d, { recursive: true });
  spawnSync("git", ["init", "-q", work]);
  copyFileSync(join(repoRoot, ".claude", "settings.json"), join(work, ".claude", "settings.json"));
  copyFileSync(join(repoRoot, "CLAUDE.md"), join(work, "CLAUDE.md"));
  writeFileSync(join(work, "artifacts/SpecSmith/src/lib/a.ts"), "export const a = 1;\n");
  writeFileSync(join(work, "artifacts/SpecSmith/src/lib/b.js"), "export const b = 1;\n");
  writeFileSync(join(work, "package.json"), '{"private":true}\n');
  writeFileSync(join(work, ".env"), `TOKEN=${CANARY}\n`);
  writeFileSync(join(outside, "target.ts"), `export const t = "${CANARY}";\n`);
  symlinkSync(join(outside, "target.ts"), join(work, "artifacts/SpecSmith/src/lib/link.ts"));
  return { root, work, outside, home };
}

/**
 * Runs the CLI with `argv` in `cwd`. The mock answers the first main-loop request with `calls` (one
 * tool_use block each), records the tool_result the CLI sends back for each, then ends the turn.
 */
function runCli(argv, { cwd, home, calls = [], env = {} }) {
  return new Promise((resolve, reject) => {
    const results = new Map(); let toolsOffered; let served = false;
    const server = createServer((req, res) => {
      let body = ""; req.on("data", (d) => { body += d; }); req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not JSON */ }
        const main = Array.isArray(j.tools) && j.tools.length > 0;
        if (main) toolsOffered ??= j.tools.map((t) => t.name).sort();
        for (const m of j.messages ?? []) for (const c of Array.isArray(m.content) ? m.content : []) {
          if (c.type === "tool_result") results.set(c.tool_use_id, { isError: c.is_error === true, text: JSON.stringify(c.content) });
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
        if (main && !served && calls.length) {
          served = true;
          calls.forEach(([name, input], i) => {
            ev("content_block_start", { index: i, content_block: { type: "tool_use", id: `toolu_${i}`, name, input: {} } });
            ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
            ev("content_block_stop", { index: i });
          });
          ev("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } });
        } else {
          ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
          ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "done" } });
          ev("content_block_stop", { index: 0 });
          ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
        }
        ev("message_stop", {}); res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const childEnv = {
        PATH: process.env.PATH, HOME: home, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        ANTHROPIC_API_KEY: PLACEHOLDER_KEY, HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "127.0.0.1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", GIT_TERMINAL_PROMPT: "0", ...env,
      };
      const child = spawn(bin, [...argv, "--output-format", "stream-json", "--verbose"], { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timer); server.close();
        const init = out.split("\n").map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).find((e) => e?.subtype === "init");
        resolve({ code, out, init, toolsOffered, results });
      });
    });
  });
}
const withPrompt = (a) => a.map((x) => (x === "$prompt" ? "Make the requested edits." : x));
const cliTest = (name, fn) => test(name, { skip: bin ? false : "set AUTO_GOAL_CLAUDE_BIN to the pinned CLI to run" }, fn);

cliTest("cli: the installed CLI is the pinned version", () => {
  const home = mkdtempSync(join(tmpdir(), "restricted-cli-home-"));
  try {
    const r = spawnSync(bin, ["--version"], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
    assert.equal(r.stdout.trim(), `${pin} (Claude Code)`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

cliTest("cli: with the workflow's flags only Read, Edit, Glob and Grep are offered, despite the project's Bash allow rules", async () => {
  const f = workdir();
  try {
    const r = await runCli(withPrompt(args), { cwd: f.work, home: f.home });
    assert.equal(r.code, 0);
    assert.deepEqual(r.init.tools.slice().sort(), ["Edit", "Glob", "Grep", "Read"]);
    assert.deepEqual(r.toolsOffered, ["Edit", "Glob", "Grep", "Read"]);
    assert.deepEqual(r.init.mcp_servers, []);
    assert.equal(r.init.permissionMode, "default");
    assert.equal(r.init.claude_code_version, pin);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

cliTest("positive control: without --restricted the same CLI does load the checkout's project settings", async () => {
  // A project deny rule for Read is visible in the offered tool list, so this shows the scratch
  // checkout's settings would be loaded, and that --restricted (previous test) is what ignores them.
  const f = workdir();
  try {
    writeFileSync(join(f.work, ".claude", "settings.json"), '{"permissions":{"deny":["Read"]}}\n');
    const r = await runCli(withPrompt(args.filter((a) => a !== "--restricted")), { cwd: f.work, home: f.home });
    assert.equal(r.code, 0);
    assert.ok(!r.init.tools.includes("Read"), "project settings were not loaded, so the control cannot see them");
    const r2 = await runCli(withPrompt(args), { cwd: f.work, home: f.home });
    assert.ok(r2.init.tools.includes("Read"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

cliTest("cli: scripted tool calls succeed only for a source edit; every other file, tool and path is refused", async () => {
  const f = workdir();
  const src = (p) => join(f.work, "artifacts/SpecSmith/src/lib", p);
  const calls = [
    ["Edit", { file_path: src("a.ts"), old_string: "a = 1", new_string: "a = 2" }],          // 0 allowed
    ["Edit", { file_path: join(f.work, "package.json"), old_string: "true", new_string: "false" }], // 1 outside scope
    ["Edit", { file_path: join(f.work, ".claude", "settings.json"), old_string: '"Read",', new_string: '"Bash",' }], // 2
    ["Edit", { file_path: join(f.work, ".git", "config"), old_string: "[core]", new_string: "[core]\n\tx = 1" }], // 3
    ["Edit", { file_path: src("b.js"), old_string: "b = 1", new_string: "b = 2" }],          // 4 wrong extension
    ["Edit", { file_path: join(f.outside, "target.ts"), old_string: "const t", new_string: "const u" }], // 5 outside cwd
    ["Read", { file_path: join(f.work, ".env") }],                                            // 6 denied by --settings
    ["Read", { file_path: join(f.outside, "target.ts") }],                                    // 7 outside cwd
    ["Read", { file_path: "/proc/self/environ" }],                                            // 8 own environment
    ["Grep", { pattern: CANARY, path: f.work, output_mode: "content" }],                     // 9 content of .env
    ["Bash", { command: "true" }],                                                            // 10 not offered
    ["WebFetch", { url: "http://127.0.0.1:9/", prompt: "x" }],                                // 11 not offered
    ["Write", { file_path: src("new.ts"), content: "export {};\n" }],                         // 12 not offered
    ["Read", { file_path: src("a.ts") }],                                                     // 13 allowed
    ["Grep", { pattern: CANARY, path: f.outside, output_mode: "content" }],                  // 14 outside cwd
    ["Glob", { pattern: "**/*.ts", path: f.outside }],                                        // 15 outside cwd
  ];
  try {
    const before = readFileSync(join(f.work, ".git", "config"), "utf8");
    const r = await runCli(withPrompt(args), { cwd: f.work, home: f.home, calls, env: { AUTO_GOAL_CANARY: CANARY } });
    assert.equal(r.code, 0);
    assert.equal(r.results.size, calls.length, "every scripted call got a result");
    const res = (i) => r.results.get(`toolu_${i}`);
    assert.equal(res(0).isError, false);
    assert.equal(readFileSync(src("a.ts"), "utf8"), "export const a = 2;\n");
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15]) assert.equal(res(i).isError, true, `call ${i} was not refused`);
    assert.equal(res(13).isError, false);
    assert.equal(readFileSync(join(f.work, "package.json"), "utf8"), '{"private":true}\n');
    assert.equal(readFileSync(join(f.work, ".claude", "settings.json"), "utf8"), readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
    assert.equal(readFileSync(join(f.work, ".git", "config"), "utf8"), before);
    assert.equal(readFileSync(src("b.js"), "utf8"), "export const b = 1;\n");
    assert.equal(readFileSync(join(f.outside, "target.ts"), "utf8"), `export const t = "${CANARY}";\n`);
    for (const [, v] of r.results) assert.ok(!v.text.includes(CANARY), "a tool result carried the canary");
    for (const n of ["Bash", "WebFetch", "Write"]) assert.match(res(calls.findIndex(([t]) => t === n)).text, /No such tool available/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

cliTest("positive controls: the .env denial comes from --settings, and the file scope from the Edit rules", async () => {
  // Without --settings, restricted mode ignores the project's deny rules and reads .env. With
  // acceptEdits in place of the scoped rules, an out-of-scope edit is accepted. So both refusals in the
  // previous test depend on these flags, not on something else in the environment.
  const f = workdir();
  try {
    const noSettings = [];
    for (let i = 0; i < args.length; i++) { if (args[i] === "--settings") { i++; continue; } noSettings.push(args[i]); }
    const r = await runCli(withPrompt(noSettings), { cwd: f.work, home: f.home, calls: [["Read", { file_path: join(f.work, ".env") }]] });
    assert.equal(r.results.get("toolu_0")?.isError, false);
    assert.ok(r.results.get("toolu_0").text.includes(CANARY));
    const accept = args.map((a, i) => (args[i - 1] === "--permission-mode" ? "acceptEdits" : a));
    const r2 = await runCli(withPrompt(accept), { cwd: f.work, home: f.home, calls: [["Edit", { file_path: join(f.work, "package.json"), old_string: "true", new_string: "false" }]] });
    assert.equal(r2.results.get("toolu_0")?.isError, false);
    assert.equal(readFileSync(join(f.work, "package.json"), "utf8"), '{"private":false}\n');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

cliTest("cli: an in-scope symlink to a file outside the checkout is not edited through", async () => {
  const f = workdir();
  try {
    const link = join(f.work, "artifacts/SpecSmith/src/lib/link.ts");
    const r = await runCli(withPrompt(args), { cwd: f.work, home: f.home, calls: [["Edit", { file_path: link, old_string: "const t", new_string: "const u" }]] });
    assert.equal(r.code, 0);
    assert.equal(r.results.get("toolu_0")?.isError, true);
    assert.equal(readFileSync(join(f.outside, "target.ts"), "utf8"), `export const t = "${CANARY}";\n`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
