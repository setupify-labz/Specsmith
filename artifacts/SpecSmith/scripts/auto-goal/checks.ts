// The only commands the unattended runner executes for a goal's acceptance checks.
//
// A goal names a check by kind and, where the kind needs one, a file path. The path is validated
// against a fixed pattern and the command is assembled here, as an argument vector run without a
// shell. Nothing from a goal record, an issue comment or a review finding is ever passed to a shell
// or used as a command; a record that carries free-form command text is refused by the runner.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { GoalError } from "./record.ts";

export type CheckSpec =
  /** One Vitest file under artifacts/SpecSmith/src. */
  | { readonly kind: "vitest"; readonly file: string }
  /** A production build, then one browser-check script under artifacts/SpecSmith/scripts/ui. */
  | { readonly kind: "browser"; readonly script: string }
  | { readonly kind: "typecheck" }
  | { readonly kind: "suite" };

const APP = "artifacts/SpecSmith";
const VITEST_FILE = /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.tsx?$/;
const BROWSER_SCRIPT = /^scripts\/ui\/[A-Za-z0-9_-]+\.mjs$/;

/** One step: a program and its arguments, run from a directory under the repo, never through a shell. */
export interface Step { readonly argv: readonly string[]; readonly cwd: string }

/** Validates a spec and returns the exact steps it runs. Throws GoalError("refused") for anything else. */
export function stepsFor(spec: CheckSpec): Step[] {
  const s = spec as { kind?: unknown; file?: unknown; script?: unknown };
  const keys = Object.keys(spec ?? {}).sort().join(",");
  switch (s.kind) {
    case "vitest":
      if (keys !== "file,kind" || typeof s.file !== "string" || !VITEST_FILE.test(s.file) || s.file.includes("..")) break;
      return [{ argv: ["pnpm", "exec", "vitest", "run", s.file], cwd: APP }];
    case "browser":
      if (keys !== "kind,script" || typeof s.script !== "string" || !BROWSER_SCRIPT.test(s.script)) break;
      return [{ argv: ["pnpm", "run", "build"], cwd: APP }, { argv: ["node", s.script], cwd: APP }];
    case "typecheck":
      if (keys !== "kind") break;
      return [{ argv: ["pnpm", "run", "typecheck"], cwd: APP }];
    case "suite":
      if (keys !== "kind") break;
      return [{ argv: ["pnpm", "test"], cwd: APP }];
  }
  throw new GoalError("refused", `Not a trusted check: ${JSON.stringify(spec)}. Allowed: {kind:"vitest",file:"src/…\\.test.tsx?"}, {kind:"browser",script:"scripts/ui/<name>.mjs"}, {kind:"typecheck"}, {kind:"suite"}.`);
}

/** How a spec reads in the record and the report. */
export function describeCheck(spec: CheckSpec): string {
  return stepsFor(spec).map((step) => `(cd ${step.cwd} && ${step.argv.join(" ")})`).join(" && ");
}

/** The file a check needs to exist at the commit it runs on (the check's own test or script). */
export function checkFile(spec: CheckSpec): string | null {
  if (spec.kind === "vitest") return join(APP, spec.file);
  if (spec.kind === "browser") return join(APP, spec.script);
  return null;
}

export interface CheckResult { readonly exitCode: number; readonly tail: string; readonly timedOut: boolean }

/**
 * Runs a trusted check in `repoRoot`. Each step has `timeoutMs`; a missing check file counts as a
 * failure (exit 127) without running anything, which is what "before the fix" looks like when the
 * check is new.
 */
export async function runCheck(repoRoot: string, spec: CheckSpec, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<CheckResult> {
  const steps = stepsFor(spec);
  const file = checkFile(spec);
  if (file && !existsSync(join(repoRoot, file))) return { exitCode: 127, tail: `${file} does not exist at this commit.`, timedOut: false };
  let tail = "";
  for (const step of steps) {
    const result = await new Promise<CheckResult>((done) => {
      const child = spawn(step.argv[0], step.argv.slice(1), { cwd: join(repoRoot, step.cwd), env, shell: false });
      let buf = "";
      const keep = (chunk: Buffer) => { buf = (buf + chunk.toString("utf8")).slice(-20_000); };
      child.stdout.on("data", keep); child.stderr.on("data", keep);
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
      let timedOut = false;
      timer.unref?.();
      child.on("error", (e) => { clearTimeout(timer); done({ exitCode: 127, tail: String(e), timedOut: false }); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        timedOut = signal === "SIGKILL";
        done({ exitCode: code ?? 1, tail: buf.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-12).join("\n"), timedOut });
      });
    });
    tail = result.tail;
    if (result.exitCode !== 0 || result.timedOut) return { ...result, exitCode: result.exitCode || 1, tail: result.timedOut ? `Timed out after ${Math.round(timeoutMs / 60000)} min.\n${tail}` : tail };
  }
  return { exitCode: 0, tail, timedOut: false };
}
