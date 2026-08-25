// The Windows smoke-test launcher's actual logic.
//
// WHY THIS EXISTS
// ----------------
// Two real Windows retests of the Ctrl+C fix each required Aaron to copy a
// long checklist of individual PowerShell commands by hand (see the README's
// smoke-test table), and each retest still surfaced something the manual
// process did not catch cleanly: whether cleanup had ACTUALLY finished, and
// what the real exit code was, both got confused by how PowerShell displays
// prompts around a `pnpm collect:measured` invocation. This script replaces
// the copy-paste checklist with one command that runs the same checks
// itself, and — for exactly the steps that touch cancellation — spawns the
// collector directly rather than through pnpm.
//
// WHY IT AVOIDS PNPM FOR CANCELLATION
// ------------------------------------
// Two consecutive real Windows retests (3ef3ba5, then 34f97a6, which fixed
// a genuine internal exit-code bug in collect.ts) both still showed
// `$LASTEXITCODE` as 1 after `pnpm collect:measured` + Ctrl+C, not the
// collector's own deliberate 130. That is pnpm's own Windows behaviour when
// its wrapper process is hit by the same console-wide signal as its child —
// not a defect in this collector, and not something a further patch to
// collect.ts's own exit-code handling can fix, because by the time
// PowerShell reports $LASTEXITCODE, it is reporting pnpm's outcome, not the
// collector's. See the README's "pnpm's Windows exit code vs. the
// collector's own status" section. So this launcher spawns the collector
// with `node`/`tsx` directly — no pnpm in between — for every step where the
// exit code or cancellation timing needs to be trustworthy. That is a
// verified-on-this-platform property, not a guess: see
// 'the direct-spawn primitive' in smokeTest.test.ts, and
// 'the real pnpm package-script boundary' in cancellation.test.ts, which
// together show a DIRECT node/tsx child correctly reports its own exit code
// while a signalled pnpm wrapper does not reliably forward one at all.
//
// WHY TSX IS RESOLVED TO AN ABSOLUTE PATH, NOT A BARE SPECIFIER
// ----------------------------------------------------------------
// The first real Windows run of this launcher failed before the collector
// ever ran: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'`.
// windows-smoke-test.ps1 had been invoked from an unrelated worktree
// directory, and `node --import tsx` resolves a BARE specifier the same way
// a package import would — starting from the SPAWNED PROCESS's own working
// directory, not from this repository and not from the script about to run.
// So `--import tsx` only ever worked by accident, when the caller happened
// to already be standing in this repository. See resolveTsxImportUrl below:
// every direct invocation now passes an absolute `file://` URL to tsx's own
// published loader entry point, computed from this module's location, which
// does not depend on any process's cwd at all.
//
// WHAT THIS DOES NOT PROVE
// -------------------------
// The orchestration primitives here (spawning directly, waiting for a real
// exit, checking the four residues) are unit-tested against real child
// processes and real signals, off Windows. The Windows-only steps — hardware
// detection, `logman`, PresentMon itself — are not, and cannot be, exercised
// by those tests. A real Windows run of this launcher is still what confirms
// the whole thing end to end.

import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CAPTURE_SESSION_NAME,
  MIN_CAPTURE_SECONDS,
  captureLockPath,
  listWindowsProcesses,
  resolvePresentMonBinary,
  selectTargetProcess,
  type BinaryFsLike,
  type PresentMonBinary,
  type RunningProcess,
} from './presentmonRunner';
import { CANCELLED_EXIT_CODE } from './cancellation';

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..');
const collectScript = path.join(here, 'collect.ts');

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Pure: no I/O, so this is exercised directly by tests without a real machine. */
export function summarize(results: readonly CheckResult[]): {
  passed: number;
  failed: number;
  skipped: number;
  overall: 'PASS' | 'FAIL';
} {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  return { passed, failed, skipped, overall: failed === 0 ? 'PASS' : 'FAIL' };
}

const STATUS_LABEL: Record<CheckStatus, string> = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };

/** Pure: builds the printable report from results already collected. */
export function formatReport(results: readonly CheckResult[]): string {
  const width = Math.max(4, ...results.map((r) => r.name.length));
  const lines = results.map((r) => `[${STATUS_LABEL[r.status]}] ${r.name.padEnd(width)}  ${r.detail}`);
  const { passed, failed, skipped, overall } = summarize(results);
  return [
    'SpecSmith Windows smoke test',
    '='.repeat(29),
    ...lines,
    '-'.repeat(29),
    `${passed} passed, ${failed} failed, ${skipped} skipped — ${overall}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The direct-spawn primitive — the one thing every step below is built on
// ---------------------------------------------------------------------------

export interface DirectRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface DirectRunOptions {
  timeoutMs?: number;
  cwd?: string;
  /** Overridden in tests to point `node` at a different binary entirely. */
  nodePath?: string;
}

/**
 * The tsx loader as a verified, absolute `file://` URL — not the bare "tsx"
 * specifier.
 *
 * `node --import <specifier>` resolves a bare specifier the same way a
 * package import would, starting from the SPAWNED PROCESS's own cwd — not
 * from this repository, and not from the script it is about to run. A real
 * Windows run of this launcher was invoked from an unrelated worktree
 * directory and failed with `ERR_MODULE_NOT_FOUND: Cannot find package
 * 'tsx'` before the collector ever ran, because Node went looking for
 * `node_modules/tsx` next to wherever the caller happened to be standing.
 * An absolute path — resolved from repoRoot, not from any cwd — sidesteps
 * that resolution entirely. It has to be a `file://` URL rather than a bare
 * OS path: a Windows path like `C:\...` is not a valid specifier as-is (the
 * drive letter's colon parses as a URL scheme), which is exactly why
 * `pathToFileURL` exists rather than string-concatenating `file://`.
 */
export function resolveTsxImportUrl(repoRoot: string, existsSync: (p: string) => boolean = fs.existsSync): string {
  // "./dist/loader.mjs" is tsx's own published `--import`/`--loader` entry
  // point (see the "." condition in tsx's package.json exports) — not an
  // internal path this reaches into by guessing.
  const loaderPath = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (!existsSync(loaderPath)) {
    throw new Error(`tsx's loader was not found at ${loaderPath} — run \`pnpm install --frozen-lockfile\` from ${repoRoot} first.`);
  }
  return pathToFileURL(loaderPath).href;
}

/**
 * Runs a script directly with `node --import <tsx's loader>` and waits for
 * it to exit ON ITS OWN — not pnpm, not even tsx's own bin shim, and NOT by
 * this function sending it any signal.
 *
 * On Windows that shim is `node_modules\.bin\tsx.CMD`, a batch file cmd.exe
 * interprets — the same shape as the pnpm.cmd wrapper this whole launcher
 * exists to avoid, and with no signal handling of its own, plausibly the
 * same failure mode: an intermediate process with no custom Ctrl+C handler
 * dying to the console-wide signal before the real node.exe process
 * underneath it (which DOES install one, via installCancellationHandler)
 * has finished. `node --import` skips that shim entirely — PowerShell's
 * direct child is node.exe itself, nothing else, on every platform.
 *
 * DELIBERATELY HAS NO WAY TO SEND THE CHILD A SIGNAL
 * ----------------------------------------------------
 * An earlier version of this function could schedule `child.kill(signal)`
 * against the spawned process, to simulate Ctrl-C for the cancellation smoke
 * test below. A real Windows run showed that does not work: Node's
 * `child.kill()` on Windows is not a real console Ctrl-C event
 * (`GenerateConsoleCtrlEvent`) the child's own signal handler could catch —
 * it is closer to `TerminateProcess`, so the child exited immediately with
 * signal=SIGINT having run none of its own cancellation or cleanup logic,
 * leaving the ETW session, lock file and temp directory behind. Manual, real
 * Ctrl-C in a real console continued to work fine throughout, because that
 * IS a real console event — the failure was specific to one process trying
 * to signal another externally on Windows. Nothing outside a Windows process
 * can safely simulate that, so this function no longer offers a way to try:
 * see runCancellationSmokeTest below, which drives cancellation from INSIDE
 * the spawned process instead, via collect.ts's --internal-cancel-after-seconds.
 */
export function runDirect(scriptPath: string, args: readonly string[], options: DirectRunOptions = {}): Promise<DirectRunResult> {
  const nodePath = options.nodePath ?? process.execPath;
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, ['--import', resolveTsxImportUrl(specsmithRoot), scriptPath, ...args], {
      cwd: options.cwd ?? specsmithRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${scriptPath} did not exit within ${options.timeoutMs ?? 60_000}ms.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, options.timeoutMs ?? 60_000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Dependency validation
// ---------------------------------------------------------------------------

/**
 * Resolves pnpm to a real, extensioned file — `pnpm.CMD`, `pnpm.exe`,
 * whichever actually exists — without a shell and without building any
 * command string.
 *
 * WHY NOT THE BARE NAME
 * -----------------------
 * On Windows, pnpm's entry point is a script — `pnpm.cmd` / `pnpm.CMD` /
 * `pnpm.ps1` from a corepack or npm-global install, `pnpm.exe` from the
 * standalone installer — never a bare `pnpm` with no extension. Node's
 * `execFileSync('pnpm', ...)` without a shell does not perform the PATHEXT
 * resolution needed to find any of those; a real Windows run reported
 * ENOENT for exactly this reason, even on a machine where `pnpm install`
 * from an actual shell worked fine.
 *
 * WHY NOT `shell: true`
 * -----------------------
 * `shell: true` also fixes the resolution — cmd.exe does its own PATHEXT
 * search — but does it by handing the WHOLE COMMAND as a single string to
 * be parsed by a shell, which is broader than this needs and worth avoiding
 * on principle even with no user-controlled input in the args here today.
 * This function does the resolution itself instead: walk `PATH`, try each
 * extension `PATHEXT` lists, in order, and return the first real file
 * found — a plain, extensioned path that `execFileSync` can run directly,
 * with args passed as an array, never concatenated into a command string.
 *
 * Returns `undefined` off Windows or when nothing is found on PATH — the
 * caller decides what that means (see checkDependencies: never a hard
 * failure, since this launcher does not depend on pnpm to run at all).
 */
export function resolvePnpmCommand(
  deps: {
    platform?: NodeJS.Platform;
    pathEnv?: string;
    pathextEnv?: string;
    existsSync?: (p: string) => boolean;
  } = {},
): string | undefined {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    // POSIX has no PATHEXT concept — the OS's own exec search resolves a
    // bare name against PATH without any shell being involved, which is
    // exactly what execFileSync('pnpm', ...) already does correctly there.
    return 'pnpm';
  }
  const existsSync = deps.existsSync ?? fs.existsSync;
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? process.env.Path ?? '';
  const pathextEnv = deps.pathextEnv ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  // Windows always delimits PATH/PATHEXT with `;`, regardless of the host
  // platform running this code — using a literal here (rather than
  // path.delimiter, which reflects the ACTUAL runtime OS) is what keeps this
  // resolvable in a test on any platform.
  const dirs = pathEnv.split(';').filter(Boolean);
  const exts = pathextEnv.split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.win32.join(dir, `pnpm${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export interface DependencyDeps {
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  existsSync?: (p: string) => boolean;
  runPnpmVersion?: () => string;
}

export function checkDependencies(deps: DependencyDeps = {}): CheckResult[] {
  const platform = deps.platform ?? process.platform;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const results: CheckResult[] = [];

  results.push(
    platform === 'win32'
      ? { name: 'Platform', status: 'pass', detail: 'Windows' }
      : {
          name: 'Platform',
          status: 'fail',
          detail: `${platform} — PresentMon capture is Windows-only; this launcher can validate its own logic elsewhere, but a real run needs Windows.`,
        },
  );

  const nodeVersion = deps.nodeVersion ?? process.version;
  const nodeMajor = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
  results.push(
    Number.isFinite(nodeMajor) && nodeMajor >= 18
      ? { name: 'Node.js', status: 'pass', detail: nodeVersion }
      : { name: 'Node.js', status: 'fail', detail: `${nodeVersion} — expected 18 or newer` },
  );

  // Checked as a package, not a bin shim: runDirect uses `node --import tsx`,
  // which resolves the "tsx" package directly and never touches
  // node_modules/.bin/tsx.CMD — see runDirect's own comment for why that
  // shim is avoided.
  const tsxPackage = path.join(specsmithRoot, 'node_modules', 'tsx', 'package.json');
  results.push(
    existsSync(tsxPackage)
      ? { name: 'tsx installed', status: 'pass', detail: 'found in node_modules/tsx' }
      : {
          name: 'tsx installed',
          status: 'fail',
          detail: 'not found — run `pnpm install --frozen-lockfile` from the repo root first',
        },
  );

  // Informational only, and never 'fail': this launcher invokes node
  // directly (see runDirect above) and never shells out to pnpm itself, so
  // pnpm being unreachable here says nothing about whether the launcher can
  // run. It still matters enough to report, because `pnpm install` is how
  // node_modules/tsx above got there in the first place.
  //
  // A prior version detected it with execFileSync('pnpm', ['--version']),
  // with no shell — which is a real Windows bug independent of this
  // launcher's own logic: Node's execFileSync does not perform PATHEXT
  // resolution the way a shell does, and pnpm's actual Windows entry point
  // is a script (pnpm.cmd / pnpm.CMD / pnpm.ps1), not a bare "pnpm"
  // executable, so it went looking for a file that does not exist and
  // reported ENOENT — even on a machine where `pnpm install` from an actual
  // shell works fine, which is exactly what a real Windows run of this
  // launcher found. The fix after that used `shell: true`, which resolves
  // PATHEXT correctly but does so by handing a COMMAND STRING to cmd.exe —
  // broader than this needs. resolvePnpmCommand below does the same PATHEXT
  // resolution itself, without a shell and without building any command
  // string: it finds the real, extensioned file pnpm's name resolves to and
  // passes its args as an array — see resolvePnpmCommand's own comment.
  if (deps.runPnpmVersion) {
    try {
      results.push({ name: 'pnpm (informational)', status: 'pass', detail: deps.runPnpmVersion() });
    } catch {
      results.push({
        name: 'pnpm (informational)',
        status: 'skip',
        detail: 'not found on PATH — not required by this launcher, which invokes node directly; needed separately for `pnpm install`',
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Game id — no default, ever
// ---------------------------------------------------------------------------

/**
 * An automatic capture always requires an explicit `--game-id`; this
 * launcher never invents one.
 *
 * collect.ts's own `parseRunConditions` already treats `--game-id` as
 * required, not optional — this is the same rule, checked here so the
 * report names it explicitly rather than the run failing several steps
 * later with collect.ts's own generic "Missing required --game-id".
 * windows-smoke-test.ps1 supplies one explicitly (its own `-GameId`
 * parameter, default `"rdr2"`) precisely so this layer never has to guess —
 * a caller of smokeTest.ts directly that omits it gets this refusal instead
 * of a silently invented catalog id.
 */
export function checkGameId(gameId: string | undefined): CheckResult {
  // Matches collect.ts's own `required()` convention: whitespace-only is
  // treated the same as missing, not as a technically-non-undefined value
  // that happens to be useless.
  if (gameId === undefined || gameId.trim() === '') {
    return {
      name: 'Game id provided',
      status: 'fail',
      detail:
        '--game-id is required for an automatic capture; none was given. windows-smoke-test.ps1 passes its own ' +
        '-GameId (default "rdr2") automatically.',
    };
  }
  return { name: 'Game id provided', status: 'pass', detail: gameId };
}

// ---------------------------------------------------------------------------
// PresentMon: locate and hash
// ---------------------------------------------------------------------------

export function checkPresentMon(
  resolution: { executablePath?: string; expectedSha256?: string; allowUnpinned?: boolean },
  fsLike?: BinaryFsLike,
): { result: CheckResult; binary?: PresentMonBinary } {
  try {
    const binary = resolvePresentMonBinary(resolution, fsLike);
    return {
      binary,
      result: {
        name: 'PresentMon located',
        status: 'pass',
        detail: `${binary.path} — sha256 ${binary.sha256}${binary.pinned ? ' (pinned)' : ' (NOT PINNED)'}`,
      },
    };
  } catch (error) {
    return {
      result: {
        name: 'PresentMon located',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Game process detection — pauses ONLY here, and only when the process
// genuinely cannot be found without Aaron doing something about it.
// ---------------------------------------------------------------------------

export interface DetectProcessDeps {
  listProcesses?: () => readonly RunningProcess[];
  /** Waits for Aaron to act, then resolves. Overridden in tests. */
  pause?: (message: string) => Promise<void>;
  maxAttempts?: number;
}

export async function detectGameProcess(
  selection: { processId?: number; processName?: string },
  deps: DetectProcessDeps = {},
): Promise<{ result: CheckResult; target?: RunningProcess }> {
  const listProcesses = deps.listProcesses ?? (() => listWindowsProcesses());
  const pause = deps.pause ?? defaultPause;
  const maxAttempts = deps.maxAttempts ?? 12; // ~2 minutes at the default 10s pause below

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const target = selectTargetProcess(listProcesses(), selection);
      return { target, result: { name: 'Game process found', status: 'pass', detail: `${target.name} (pid ${target.processId})` } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts) {
        return { result: { name: 'Game process found', status: 'fail', detail: message } };
      }
      await pause(
        `${message}\nStart the game (or make sure it is not still loading), then this will check again in a moment.`,
      );
    }
  }
  // Unreachable — maxAttempts is always >= 1 and the loop above returns on
  // its last iteration either way — but keeps the return type honest.
  return { result: { name: 'Game process found', status: 'fail', detail: 'no attempts were made' } };
}

function defaultPause(message: string): Promise<void> {
  console.log(`\n${message}\nPress Enter to check again (or Ctrl+C to give up)…`);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// The residues — the same four the README's checklist step 8 asks Aaron to
// check by hand.
// ---------------------------------------------------------------------------

export interface ResidueDeps {
  existsSync?: (p: string) => boolean;
  readdirSync?: (p: string) => string[];
  listProcesses?: () => readonly RunningProcess[];
  queryEtwSession?: (sessionName: string) => boolean; // true = still running
}

/** Every residue that a leaked cancellation used to leave behind, checked fresh. */
export function checkResidues(deps: ResidueDeps = {}): CheckResult[] {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readdirSync = deps.readdirSync ?? ((p: string) => fs.readdirSync(p));
  const listProcesses = deps.listProcesses ?? (() => (process.platform === 'win32' ? listWindowsProcesses() : []));
  const results: CheckResult[] = [];

  const lockPath = captureLockPath();
  results.push(
    existsSync(lockPath)
      ? { name: 'No lock file', status: 'fail', detail: `still present at ${lockPath}` }
      : { name: 'No lock file', status: 'pass', detail: lockPath },
  );

  let orphanedTempDirs: string[] = [];
  try {
    orphanedTempDirs = readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('specsmith-capture-'));
  } catch {
    // Best effort — an unreadable temp dir is reported, not thrown, so the
    // rest of the report still prints.
  }
  results.push(
    orphanedTempDirs.length === 0
      ? { name: 'No orphaned temp directory', status: 'pass', detail: os.tmpdir() }
      : { name: 'No orphaned temp directory', status: 'fail', detail: orphanedTempDirs.join(', ') },
  );

  const stillRunning = listProcesses().filter((p) => p.name.toLowerCase() === 'presentmon.exe');
  results.push(
    stillRunning.length === 0
      ? { name: 'No PresentMon process', status: 'pass', detail: 'none running' }
      : { name: 'No PresentMon process', status: 'fail', detail: `pid ${stillRunning.map((p) => p.processId).join(', ')} still running` },
  );

  if (deps.queryEtwSession) {
    const active = deps.queryEtwSession(CAPTURE_SESSION_NAME);
    results.push(
      active
        ? { name: 'No leaked ETW session', status: 'fail', detail: `${CAPTURE_SESSION_NAME} is still active` }
        : { name: 'No leaked ETW session', status: 'pass', detail: `${CAPTURE_SESSION_NAME} not found` },
    );
  } else {
    results.push({ name: 'No leaked ETW session', status: 'skip', detail: '`logman` check unavailable off Windows' });
  }

  return results;
}

/** `logman query <session> -ets` on Windows; a failing command means "not found", the good case. */
export function queryEtwSessionActive(
  sessionName: string,
  run: (command: string, args: readonly string[]) => void = (command, args) => {
    execFileSync(command, [...args], { stdio: 'ignore', timeout: 30_000 });
  },
): boolean {
  try {
    run('logman', ['query', sessionName, '-ets']);
    return true; // the query succeeded, meaning the session exists
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The cancellation + cleanup-wait step — the actual point of this launcher
//
// THIS TESTS THE INTERNAL CANCELLATION/CLEANUP PATH, NOT THE WINDOWS CTRL-C
// BOUNDARY. It proves that once cancellation.ts's AbortController fires,
// PresentMon is stopped, cleanup runs, and the process exits with the
// documented code — collect.ts's own --internal-cancel-after-seconds
// triggers that same AbortController from a timer INSIDE the collector
// (see cancellation.ts's simulateSignal and collect.ts's
// validateInternalCancelAfterSeconds). It does NOT exercise, and cannot
// exercise, whether a real console Ctrl-C reaches this process at all —
// that is a genuinely different question, about OS signal delivery, that
// this launcher cannot safely test from outside the process (see runDirect's
// own comment for why not). The manual Ctrl-C checklist step in the README
// (step 8) is what actually tests that boundary, and remains the real check
// for it.
// ---------------------------------------------------------------------------

export interface CancellationSmokeTestOptions {
  args: readonly string[]; // everything else collect.ts needs, already assembled — including --internal-cancel-after-seconds
  timeoutMs?: number;
  runOptions?: DirectRunOptions;
}

/**
 * Runs collect.ts as a DIRECT child (see runDirect above) and waits for it
 * to exit ON ITS OWN — collect.ts's own --internal-cancel-after-seconds is
 * what triggers cancellation from inside it, not anything this function
 * does to the child from outside. "Wait for capture cleanup" means exactly
 * this: the result is only available once the process that owns the cleanup
 * has actually finished it, not once some other process (a pnpm wrapper, a
 * shell) has merely stopped waiting on it.
 */
export function runCancellationSmokeTest(
  scriptPath: string,
  options: CancellationSmokeTestOptions,
): Promise<{ result: CheckResult; run: DirectRunResult }> {
  return runDirect(scriptPath, options.args, {
    ...options.runOptions,
    timeoutMs: options.timeoutMs ?? 60_000,
  }).then((run) => ({
    run,
    result:
      run.code === CANCELLED_EXIT_CODE
        ? {
            name: 'Internal cancellation exit code (not a Ctrl-C test)',
            status: 'pass',
            detail:
              `exited ${CANCELLED_EXIT_CODE} — self-cancelled internally via --internal-cancel-after-seconds, invoked ` +
              'directly (no pnpm), never signalled from outside the process. This is a separate fact from what ' +
              '`pnpm collect:measured` shows in PowerShell, and does not test real Ctrl-C delivery — see the README.',
          }
        : {
            name: 'Internal cancellation exit code (not a Ctrl-C test)',
            status: 'fail',
            detail:
              `exited code=${run.code} signal=${run.signal}, expected ${CANCELLED_EXIT_CODE}. ` +
              `Last stderr: ${run.stderr.trim().slice(-400) || '(none)'}`,
          },
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Where the report is written: the OS temp directory by default, an
 * explicit path when one is given.
 *
 * Not the repository: this is a smoke-test artifact regenerated on every
 * run, not something for the repository to track, and a launcher run from
 * a real Windows checkout would otherwise leave an untracked file sitting
 * in the working tree after every use.
 */
export function resolveReportPath(explicitPath: string | undefined, tmpdir: string = os.tmpdir()): string {
  return explicitPath ?? path.join(tmpdir, 'specsmith-smoke-test-report.txt');
}

async function main(argv: string[]): Promise<void> {
  const results: CheckResult[] = [];

  results.push(
    ...checkDependencies({
      // No shell, no command string — see resolvePnpmCommand's own comment
      // for why a plain execFileSync('pnpm', ...) is not enough on Windows.
      runPnpmVersion: () => {
        const pnpmCommand = resolvePnpmCommand();
        if (pnpmCommand === undefined) {
          throw new Error('pnpm was not found on PATH');
        }
        return execFileSync(pnpmCommand, ['--version'], { encoding: 'utf-8' }).trim();
      },
    }),
  );

  const { result: presentMonResult, binary } = checkPresentMon({
    executablePath: flag(argv, 'presentmon') ?? process.env.SPECSMITH_PRESENTMON,
    expectedSha256: flag(argv, 'presentmon-sha256') ?? process.env.SPECSMITH_PRESENTMON_SHA256,
    allowUnpinned: argv.includes('--allow-unpinned-presentmon'),
  });
  results.push(presentMonResult);

  const processIdRaw = flag(argv, 'process-id');
  const { result: processResult, target } = await detectGameProcess({
    processId: processIdRaw !== undefined ? Number(processIdRaw) : undefined,
    processName: flag(argv, 'process-name'),
  });
  results.push(processResult);

  const gameId = flag(argv, 'game-id');
  results.push(checkGameId(gameId));

  if (binary && target && gameId !== undefined && gameId.trim() !== '') {
    // --dry-run never persists the observation, so the settings text only
    // needs to exist and be readable, not describe anything real. Rather
    // than make "create a settings file first" a manual prerequisite for a
    // smoke test, generate a throwaway one when the operator did not point
    // at a real one.
    let settingsFile = flag(argv, 'settings-file');
    if (settingsFile === undefined) {
      settingsFile = path.join(os.tmpdir(), 'specsmith-smoke-test-settings.txt');
      fs.writeFileSync(settingsFile, 'Generated by windows-smoke-test.ps1 for a dry-run only; not a real settings file.\n');
    }

    const captureSeconds = Math.max(MIN_CAPTURE_SECONDS, numberFlag(argv, 'capture-seconds', 20));
    const cancelAfterSeconds = Math.min(captureSeconds - 2, numberFlag(argv, 'cancel-after-seconds', 5));
    console.log(
      `\nAbout to run a ${captureSeconds}s DRY-RUN capture against ${target.name} (pid ${target.processId}), self-cancelling ` +
        `${cancelAfterSeconds}s after capture begins to check cleanup — via --internal-cancel-after-seconds, NOT a simulated ` +
        'Ctrl-C, see the README. Nothing is written to the store. Make sure the game is running and not minimized.',
    );
    await defaultPause('Ready to start the dry-run internal-cancellation test.');

    const { result: cancelResult } = await runCancellationSmokeTest(collectScript, {
      timeoutMs: (captureSeconds + 30) * 1000,
      args: [
        '--capture-process-id',
        String(target.processId),
        '--capture-seconds',
        String(captureSeconds),
        // Self-cancels from INSIDE collect.ts once capture begins — see
        // runCancellationSmokeTest's own header comment for why this
        // launcher does not simulate Ctrl-C from outside the process.
        '--internal-cancel-after-seconds',
        String(cancelAfterSeconds),
        '--presentmon',
        binary.path,
        // Forwards the SAME pinning decision checkPresentMon already made
        // above — collect.ts runs resolvePresentMonBinary again on its own,
        // and would otherwise refuse an unpinned binary a second time even
        // though this launcher already accepted it for this run.
        ...(binary.pinned ? ['--presentmon-sha256', binary.sha256] : ['--allow-unpinned-presentmon']),
        '--game-id',
        gameId,
        '--resolution',
        '1440p',
        '--preset',
        'high',
        '--ram-channels',
        '2',
        '--settings-file',
        settingsFile,
        '--dry-run',
      ],
    });
    results.push(cancelResult);

    results.push(...checkResidues({ queryEtwSession: process.platform === 'win32' ? queryEtwSessionActive : undefined }));
  } else {
    results.push({
      name: 'Internal cancellation exit code (not a Ctrl-C test)',
      status: 'skip',
      detail: 'skipped — PresentMon, the game process, or --game-id was not resolved above',
    });
    results.push(...checkResidues({ queryEtwSession: process.platform === 'win32' ? queryEtwSessionActive : undefined }));
  }

  const report = formatReport(results);
  console.log(`\n${report}`);

  // The OS temp directory, not the repository, unless the operator asked
  // for a specific path — see resolveReportPath's own comment for why.
  const reportPath = resolveReportPath(flag(argv, 'report-file'));
  fs.writeFileSync(reportPath, `${report}\n`);
  console.log(`\nReport written to ${reportPath}`);

  process.exitCode = summarize(results).overall === 'PASS' ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
      process.exitCode = 1;
    }
  });
}
