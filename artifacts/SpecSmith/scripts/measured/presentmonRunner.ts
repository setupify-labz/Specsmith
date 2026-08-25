// Automatic PresentMon capture: the manual step, run for you.
//
// The collector previously began at "you already have a CSV". Producing that
// CSV was a human typing a PresentMon command line, which is where the
// interesting mistakes live — a forgotten `--v1_metrics` yields a file with no
// `MsBetweenPresents` at all, and `--exclude_dropped` yields one that parses
// perfectly and is quietly wrong. This module owns that command line so those
// two outcomes stop being possible.
//
// WHAT IS AND IS NOT DECIDED HERE
// -------------------------------
// This module decides how to CAPTURE. It decides nothing about what a capture
// MEANS: no frame time is read, no statistic computed, no rule applied. The
// bytes go to parsePresentMonCsv and onward to the same statistics, validation
// and store the manual path already used. A second interpretation of a capture
// would be a second definition of what SpecSmith measures.
//
// THE ARGUMENT VECTOR IS CLOSED
// -----------------------------
// There is no passthrough for extra PresentMon flags. That is the point of
// "pinned": every flag is chosen here, in view, with a reason, and the set
// cannot be widened from a command line. Several PresentMon options produce a
// file that still parses and still validates while meaning something other
// than what the record claims:
//
//   --exclude_dropped   removes real rendered frames from a rendered-frame
//                       metric and breaks the delta chain (see presentmon.ts).
//   --no_track_gpu      removes msGPUActive, so segmentation's GPU-utilisation
//                       stage has no evidence the GPU was rendering.
//   --no_track_display  removes display-path columns, and PresentMode with
//                       them — segmentation's primary signal.
//   --multi_csv         splits output per process, so the path we then read is
//                       not the file we asked for.
//
// None of these can be reached from here. An operator who genuinely needs a
// different capture runs PresentMon by hand and uses --csv, which is unchanged.
//
// VERSION PINNING IS BY DIGEST, NOT BY VERSION STRING
// ---------------------------------------------------
// PresentMon's console application does not document a --version flag, so
// there is no supported way to ask a binary what it is. Asking would be the
// weaker check anyway: a version string is a claim the file makes about
// itself. The SHA-256 of the bytes is not. The operator pins the digest once,
// and every capture verifies the executable it is about to run against it.
//
// WHY THE BINARY IS NOT BUNDLED
// -----------------------------
// PresentMon is MIT licensed (Copyright (C) 2017-2024 Intel Corporation,
// verified against the LICENSE.txt in GameTechDev/PresentMon), so vendoring it
// would be permitted. It is still not vendored, because licence permission is
// only half the question and provenance is the other half: a Windows binary
// committed here could not be shown to be the one Intel published, and a
// build-host digest recorded by the same commit that adds the file proves
// nothing about its origin. The operator installs an official release and pins
// its digest — that pairing is checkable by whoever runs the capture, which a
// vendored blob is not.

import { createHash } from 'node:crypto';
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The configured PresentMon executable is missing, unreadable, or unpinned. */
export class PresentMonBinaryError extends Error {}

/** More than one candidate — or none — for the process, so the run is refused. */
export class AmbiguousProcessError extends Error {}

/** PresentMon failed to start, exited non-zero, or wrote nothing usable. */
export class CaptureFailedError extends Error {}

/** The capture ran past its deadline and was killed. */
export class CaptureTimedOutError extends CaptureFailedError {}

/** The operator (or a caller's AbortSignal) stopped the capture. */
export class CaptureCancelledError extends CaptureFailedError {}

// ---------------------------------------------------------------------------
// Which columns a capture must contain
// ---------------------------------------------------------------------------

/**
 * Columns whose absence makes a capture unusable, each with what needs it.
 *
 * These are verified against the header of the file PresentMon actually wrote,
 * not assumed from the flags that were passed. The flags are our intent; the
 * header is the outcome, and only the outcome is evidence. A PresentMon build
 * whose defaults differ from the documented ones would otherwise produce a
 * capture that silently lacks a column, and the failure would surface much
 * later — as a segmentation refusal on a 90-second run that cannot be redone
 * without the game still being open.
 *
 * Four of these matter for a reason that is easy to miss: `Application`,
 * `ProcessID`, `SwapChainAddress` and `Dropped` are all OPTIONAL to the parser,
 * which tolerates their absence for hand-made captures. But the parser's
 * fail-closed guards are built on them — the multi-process refusal reads
 * `Application`, the multi-swap-chain refusal reads `SwapChainAddress`. Absent,
 * those sets stay empty and the guards cannot fire. A capture missing them
 * does not fail; it silently loses its safety checks. So they are required
 * here, where we control the capture and their absence means something is
 * genuinely wrong.
 */
export const REQUIRED_CAPTURE_COLUMNS: ReadonlyArray<{ column: string; neededBy: string }> = [
  { column: 'MsBetweenPresents', neededBy: 'the frame-time series itself (presentmon.ts)' },
  { column: 'PresentMode', neededBy: "segmentation's presentation-path stage (segmentation.ts)" },
  { column: 'msGPUActive', neededBy: "segmentation's GPU-utilisation stage (segmentation.ts)" },
  { column: 'Application', neededBy: 'the parser\'s refusal to interleave two processes' },
  { column: 'ProcessID', neededBy: 'selecting this run\'s process by pid rather than by name' },
  { column: 'SwapChainAddress', neededBy: 'the parser\'s refusal to interleave two swap chains' },
  { column: 'Dropped', neededBy: 'disclosing how many presents were never displayed' },
];

/**
 * Present in a default capture and used when available, but not fatal.
 *
 * Segmentation records a missing TimeInSeconds as null rather than as 0, so a
 * capture without it is degraded, not wrong. Reported so the degradation is
 * visible instead of silent.
 */
export const OPTIONAL_CAPTURE_COLUMNS: readonly string[] = ['TimeInSeconds'];

export interface ColumnCheck {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
}

/**
 * Checks a CSV header against what the downstream code needs.
 *
 * Case-insensitive and whole-name, matching presentmon.ts exactly — real
 * PresentMon output writes `msBetweenPresents` while its own documentation
 * writes `MsBetweenPresents`, and a column that is merely similarly named is a
 * different measurement.
 */
export function checkCaptureColumns(headerLine: string): ColumnCheck {
  const present = new Set(
    headerLine.split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase()),
  );
  const missingRequired = REQUIRED_CAPTURE_COLUMNS
    .filter((c) => !present.has(c.column.toLowerCase()))
    .map((c) => c.column);
  const missingOptional = OPTIONAL_CAPTURE_COLUMNS.filter((c) => !present.has(c.toLowerCase()));
  return { ok: missingRequired.length === 0, missingRequired, missingOptional };
}

function describeMissingColumns(missing: readonly string[]): string {
  return missing
    .map((m) => {
      const entry = REQUIRED_CAPTURE_COLUMNS.find((c) => c.column === m);
      return `  ${m} — needed by ${entry ? entry.neededBy : 'the collector'}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Resolving and pinning the executable
// ---------------------------------------------------------------------------

export interface PresentMonBinary {
  path: string;
  sha256: string;
  sizeBytes: number;
  /** False only when the operator explicitly opted out of digest pinning. */
  pinned: boolean;
}

export interface BinaryResolution {
  /** Path to PresentMon.exe, from --presentmon or SPECSMITH_PRESENTMON. */
  executablePath?: string;
  /** Expected SHA-256, from --presentmon-sha256 or SPECSMITH_PRESENTMON_SHA256. */
  expectedSha256?: string;
  /** Explicit opt-out of pinning. Records pinned:false on the result. */
  allowUnpinned?: boolean;
}

export interface BinaryFsLike {
  existsSync(p: string): boolean;
  statSync(p: string): { isFile(): boolean; size: number };
  readFileSync(p: string): Buffer;
}

/**
 * Resolves the PresentMon executable and verifies it is the pinned one.
 *
 * PATH is deliberately not searched. "Whichever PresentMon happens to be on
 * PATH" is exactly the ambiguity this whole module exists to remove, and a
 * capture is not reproducible if the binary that produced it was chosen by
 * environment.
 */
export function resolvePresentMonBinary(
  resolution: BinaryResolution,
  fsLike: BinaryFsLike = fs,
): PresentMonBinary {
  const configured = resolution.executablePath?.trim();
  if (!configured) {
    throw new PresentMonBinaryError(
      'No PresentMon executable is configured. Pass --presentmon "C:\\path\\PresentMon.exe" or set SPECSMITH_PRESENTMON. ' +
        'PATH is not searched: a capture whose tool was chosen by environment is not reproducible, and PresentMon is not bundled ' +
        'because a binary committed to this repository could not be shown to be the one Intel published.',
    );
  }

  if (!fsLike.existsSync(configured)) {
    throw new PresentMonBinaryError(`PresentMon executable not found at ${configured}.`);
  }
  const stat = fsLike.statSync(configured);
  if (!stat.isFile()) {
    throw new PresentMonBinaryError(`${configured} is not a file.`);
  }

  const sha256 = createHash('sha256').update(fsLike.readFileSync(configured)).digest('hex');

  const expected = resolution.expectedSha256?.trim().toLowerCase();
  if (expected) {
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new PresentMonBinaryError(
        `--presentmon-sha256 "${resolution.expectedSha256}" is not a 64-character SHA-256 hex digest.`,
      );
    }
    if (expected !== sha256) {
      throw new PresentMonBinaryError(
        `PresentMon at ${configured} has SHA-256 ${sha256}, but the pinned digest is ${expected}. ` +
          'Refusing to capture with an executable that is not the one this collector was set up against. ' +
          'If you deliberately upgraded PresentMon, update the pinned digest.',
      );
    }
    return { path: configured, sha256, sizeBytes: stat.size, pinned: true };
  }

  if (!resolution.allowUnpinned) {
    throw new PresentMonBinaryError(
      `No pinned digest for ${configured}. Its SHA-256 is ${sha256}.\n` +
        'Pin it with --presentmon-sha256 <digest> (or SPECSMITH_PRESENTMON_SHA256) after checking the file against the official ' +
        'Intel release you downloaded, or pass --allow-unpinned-presentmon to capture anyway.\n' +
        'Unpinned is refused by default because the capture tool is part of what a measurement means: a different PresentMon can ' +
        'emit different columns, and the resulting record would not say so.',
    );
  }

  return { path: configured, sha256, sizeBytes: stat.size, pinned: false };
}

// ---------------------------------------------------------------------------
// Choosing the target process
// ---------------------------------------------------------------------------

export interface RunningProcess {
  processId: number;
  name: string;
  executablePath?: string;
}

export interface ProcessSelection {
  processId?: number;
  processName?: string;
}

/**
 * Picks the one process this capture targets, or refuses.
 *
 * Refusal is the interesting case. Two copies of the same executable — a
 * launcher and the game, two clients, a game plus its crash handler — are
 * ordinary on Windows, and PresentMon's `--process_name` would record whichever
 * of them presented. The resulting CSV names the right executable, parses
 * cleanly, and describes the wrong process. Nothing downstream could detect it,
 * so the ambiguity is resolved here or not at all.
 */
export function selectTargetProcess(
  running: readonly RunningProcess[],
  selection: ProcessSelection,
): RunningProcess {
  const { processId, processName } = selection;

  if (processId === undefined && !processName) {
    throw new AmbiguousProcessError(
      'No target process selected. Pass --capture-process-id <pid> (preferred) or --capture-process-name <name.exe>. ' +
        'The collector does not pick a foreground or "most likely" process: a capture attributed to the wrong process is ' +
        'indistinguishable from a correct one once it is a CSV.',
    );
  }

  const describe = (list: readonly RunningProcess[]) =>
    list.map((p) => `${p.name} (pid ${p.processId})`).join(', ');

  if (processId !== undefined) {
    const byId = running.filter((p) => p.processId === processId);
    if (byId.length === 0) {
      throw new AmbiguousProcessError(
        `No running process has pid ${processId}. Running processes: ${describe(running) || 'none reported'}.`,
      );
    }
    // Windows does not reuse a pid among live processes, so this is a
    // defensive check against a malformed process listing rather than a real
    // Windows state. It still refuses rather than taking the first.
    if (byId.length > 1) {
      throw new AmbiguousProcessError(`More than one process reported pid ${processId}: ${describe(byId)}.`);
    }
    const chosen = byId[0];
    if (processName && chosen.name.toLowerCase() !== processName.trim().toLowerCase()) {
      throw new AmbiguousProcessError(
        `pid ${processId} is "${chosen.name}", not "${processName}". Refusing to capture: one of the two is wrong, ` +
          'and guessing which would attribute the run to a process that was never measured.',
      );
    }
    return chosen;
  }

  const wanted = String(processName).trim().toLowerCase();
  const byName = running.filter((p) => p.name.toLowerCase() === wanted);
  if (byName.length === 0) {
    throw new AmbiguousProcessError(
      `No running process is named "${processName}". Start the game first, then run the capture. ` +
        `Running processes: ${describe(running) || 'none reported'}.`,
    );
  }
  if (byName.length > 1) {
    throw new AmbiguousProcessError(
      `${byName.length} running processes are named "${processName}": ${describe(byName)}. ` +
        'Pass --capture-process-id <pid> to say which one is the game. PresentMon would otherwise record whichever of them ' +
        'presented, and the CSV would name the right executable while describing the wrong process.',
    );
  }
  return byName[0];
}

/**
 * Lists running processes via PowerShell.
 *
 * Windows-only and injectable, matching environment.ts: the probe is the one
 * part that cannot be exercised off-target, so it is kept as thin as possible
 * and everything that decides anything lives in the pure functions above.
 */
export function listWindowsProcesses(
  runPowershell: (script: string) => string = (script) =>
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim(),
): RunningProcess[] {
  const raw = runPowershell(
    '@(Get-CimInstance Win32_Process | Select-Object -Property ProcessId, Name, ExecutablePath) | ' +
      'ConvertTo-Json -Compress -Depth 3',
  );
  if (!raw) return [];
  const parsed = JSON.parse(raw) as
    | Array<{ ProcessId?: number; Name?: string; ExecutablePath?: string }>
    | { ProcessId?: number; Name?: string; ExecutablePath?: string };
  // ConvertTo-Json emits a bare object rather than an array for a single item.
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .filter((p) => typeof p.ProcessId === 'number' && p.Name)
    .map((p) => ({
      processId: Number(p.ProcessId),
      name: String(p.Name).trim(),
      executablePath: p.ExecutablePath ? String(p.ExecutablePath).trim() : undefined,
    }));
}

// ---------------------------------------------------------------------------
// The argument vector
// ---------------------------------------------------------------------------

/** Bounds on --timed. Not a judgement about what makes a good benchmark. */
export const MIN_CAPTURE_SECONDS = 5;
export const MAX_CAPTURE_SECONDS = 3600;

/**
 * The ETW session name this collector uses.
 *
 * Distinct from PresentMon's default so a capture started here cannot collide
 * with, or silently stop, a PresentMon the operator is running themselves.
 */
export const CAPTURE_SESSION_NAME = 'SpecSmithMeasuredCapture';

export interface CaptureArgs {
  processId: number;
  seconds: number;
  outputFile: string;
}

/**
 * Builds the complete PresentMon command line.
 *
 * Every flag, with why it is here:
 *
 *   --process_id             targets the exact process selected above, not an
 *                            executable name that two processes may share.
 *   --output_file            the file we then read.
 *   --timed N                the requested capture length.
 *   --terminate_after_timed  makes PresentMon exit when the timer expires.
 *                            Without it PresentMon stops RECORDING but keeps
 *                            running, and the capture would hang until the
 *                            watchdog killed it.
 *   --terminate_on_proc_exit exits if the game closes or crashes mid-capture,
 *                            which turns a crash into a short file and a clear
 *                            error rather than a full-length wait.
 *   --stop_existing_session  a previous run killed mid-capture can leave its
 *                            ETW session behind, and a stale session makes
 *                            every subsequent capture fail to start. Only our
 *                            own session name is affected.
 *   --session_name           see CAPTURE_SESSION_NAME.
 *   --v1_metrics             emits MsBetweenPresents. PresentMon 2.x does not
 *                            write it otherwise, and presentmon.ts rejects a
 *                            capture without it rather than substituting a
 *                            column that would look plausible and be wrong.
 *   --no_console_stats       suppresses the live per-swap-chain table. We are
 *                            not a terminal UI and the table competes with the
 *                            collector's own output.
 *
 * Flags that are deliberately NOT passed are listed in the module header; they
 * cannot be added from a command line.
 */
export function buildPresentMonArgs(args: CaptureArgs): string[] {
  if (!Number.isInteger(args.processId) || args.processId <= 0) {
    throw new CaptureFailedError(`Process id ${args.processId} is not a positive integer.`);
  }
  if (!Number.isFinite(args.seconds) || args.seconds < MIN_CAPTURE_SECONDS || args.seconds > MAX_CAPTURE_SECONDS) {
    throw new CaptureFailedError(
      `Capture duration ${args.seconds}s is outside ${MIN_CAPTURE_SECONDS}–${MAX_CAPTURE_SECONDS}s.`,
    );
  }
  if (!Number.isInteger(args.seconds)) {
    throw new CaptureFailedError(`Capture duration ${args.seconds}s must be a whole number of seconds.`);
  }

  return [
    '--process_id', String(args.processId),
    '--output_file', args.outputFile,
    '--timed', String(args.seconds),
    '--terminate_after_timed',
    '--terminate_on_proc_exit',
    '--stop_existing_session',
    '--session_name', CAPTURE_SESSION_NAME,
    '--v1_metrics',
    '--no_console_stats',
  ];
}

/**
 * How long past `--timed` we wait before killing PresentMon.
 *
 * Startup, ETW session setup and the final flush all happen outside the timed
 * window, and a large capture takes real time to write. The watchdog exists to
 * bound a hang, not to police normal overhead, so the grace is generous: a
 * false kill discards a real run the operator has to play again.
 */
export function captureDeadlineMs(seconds: number, startupGraceMs = 30_000): number {
  return seconds * 1000 + startupGraceMs + Math.ceil(seconds * 1000 * 0.25);
}

// ---------------------------------------------------------------------------
// Running the capture
// ---------------------------------------------------------------------------

export interface ChildProcessLike {
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
}

export type SpawnLike = (command: string, args: readonly string[]) => ChildProcessLike;

export interface CaptureRequest extends ProcessSelection {
  seconds: number;
  binary: PresentMonBinary;
  /** Directory for the capture file. Defaults to a fresh mkdtemp directory. */
  outputDir?: string;
  /** Cancels an in-flight capture. */
  signal?: AbortSignal;
}

export interface CaptureOutcome {
  csvPath: string;
  csv: string;
  target: RunningProcess;
  binary: PresentMonBinary;
  seconds: number;
  columns: ColumnCheck;
  /** Directory this runner created and therefore owns, if any. */
  ownedTempDir?: string;
}

export interface CaptureDeps {
  spawn?: SpawnLike;
  listProcesses?: () => RunningProcess[];
  fsLike?: {
    existsSync(p: string): boolean;
    statSync(p: string): { size: number };
    readFileSync(p: string, enc: 'utf-8'): string;
    mkdtempSync(prefix: string): string;
    rmSync(p: string, opts: { recursive: boolean; force: boolean }): void;
  };
  /** Overrides the watchdog deadline. Tests use a small value. */
  deadlineMs?: number;
  platform?: NodeJS.Platform;
}

/**
 * Removes what this runner created, and only that.
 *
 * A directory we did not create is never removed: `--capture-output-dir` can
 * legitimately point at a folder holding other captures, and cleanup that
 * reaches outside its own temp directory is how a diagnostic tool deletes an
 * operator's data.
 */
function cleanupOwned(
  fsLike: NonNullable<CaptureDeps['fsLike']>,
  ownedTempDir: string | undefined,
): void {
  if (!ownedTempDir) return;
  try {
    fsLike.rmSync(ownedTempDir, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort. Reporting a failure to delete a temp directory
    // over the top of a real capture error would bury the error that matters.
  }
}

/**
 * Captures one run and returns its CSV, or throws explaining why it did not.
 *
 * Failure modes handled explicitly, each producing its own error rather than a
 * generic one: the executable cannot be spawned, the process vanishes before
 * the capture starts, PresentMon exits non-zero, the caller cancels, the
 * watchdog fires, no output file appears, the file is empty, or the file is
 * missing a column something downstream requires.
 */
export async function runPresentMonCapture(
  request: CaptureRequest,
  deps: CaptureDeps = {},
): Promise<CaptureOutcome> {
  const platform = deps.platform ?? process.platform;
  const fsLike = deps.fsLike ?? (fs as unknown as NonNullable<CaptureDeps['fsLike']>);
  const spawn = deps.spawn ?? ((cmd, args) => nodeSpawn(cmd, [...args], { windowsHide: true }) as unknown as ChildProcessLike);
  const listProcesses = deps.listProcesses ?? (() => listWindowsProcesses());

  if (platform !== 'win32') {
    throw new CaptureFailedError(
      `PresentMon capture is Windows-only (detected platform: ${platform}). ` +
        'There is no fallback path — a capture assembled off-target would describe nothing.',
    );
  }

  const target = selectTargetProcess(listProcesses(), request);

  let ownedTempDir: string | undefined;
  let outputDir = request.outputDir;
  if (!outputDir) {
    ownedTempDir = fsLike.mkdtempSync(path.join(os.tmpdir(), 'specsmith-capture-'));
    outputDir = ownedTempDir;
  }
  const csvPath = path.join(outputDir, `presentmon-${target.processId}-${Date.now()}.csv`);

  try {
    // A pre-existing file at this path would be read back as though PresentMon
    // had written it. The name embeds a pid and a timestamp so this is close to
    // impossible, which is exactly why it must be checked rather than assumed.
    if (fsLike.existsSync(csvPath)) {
      throw new CaptureFailedError(`Refusing to overwrite an existing file at ${csvPath}.`);
    }

    const args = buildPresentMonArgs({ processId: target.processId, seconds: request.seconds, outputFile: csvPath });
    await spawnAndWait(spawn, request, deps, args, target);

    if (!fsLike.existsSync(csvPath)) {
      throw new CaptureFailedError(
        `PresentMon exited without writing ${csvPath}.\n` +
          `The usual cause is that ${target.name} (pid ${target.processId}) presented no frames during the capture — ` +
          'it was minimised, on another GPU, or already closing. PresentMon also needs Administrator privileges to open an ' +
          'ETW session; without them it exits early. Nothing was recorded.',
      );
    }
    if (fsLike.statSync(csvPath).size === 0) {
      throw new CaptureFailedError(`PresentMon wrote an empty file at ${csvPath}; there is nothing to read.`);
    }

    const csv = fsLike.readFileSync(csvPath, 'utf-8');
    const firstLine = csv.split(/\r?\n/).find((l) => l.trim() !== '');
    if (!firstLine) {
      throw new CaptureFailedError(`The capture at ${csvPath} contains no header row.`);
    }

    const columns = checkCaptureColumns(firstLine);
    if (!columns.ok) {
      throw new CaptureFailedError(
        `The capture is missing ${columns.missingRequired.length} column(s) this collector requires:\n` +
          `${describeMissingColumns(columns.missingRequired)}\n` +
          `Header written: ${firstLine}\n` +
          'The capture flags are fixed by this collector and do include --v1_metrics, so this means the PresentMon build at ' +
          `${request.binary.path} does not emit them by default. Check that it is an official Intel release; a capture without ` +
          'these columns is rejected rather than analysed, because the missing pieces are the ones that keep a wrong reading ' +
          'from looking like a right one.',
      );
    }

    return { csvPath, csv, target, binary: request.binary, seconds: request.seconds, columns, ownedTempDir };
  } catch (error) {
    cleanupOwned(fsLike, ownedTempDir);
    throw error;
  }
}

/** Spawns PresentMon and settles on exit, error, cancellation or deadline. */
function spawnAndWait(
  spawn: SpawnLike,
  request: CaptureRequest,
  deps: CaptureDeps,
  args: readonly string[],
  target: RunningProcess,
): Promise<void> {
  const deadlineMs = deps.deadlineMs ?? captureDeadlineMs(request.seconds);

  return new Promise<void>((resolve, reject) => {
    let child: ChildProcessLike;
    try {
      child = spawn(request.binary.path, args);
    } catch (error) {
      reject(
        new CaptureFailedError(
          `Could not start PresentMon at ${request.binary.path}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stderr = '';

    // Every exit path runs this exactly once, so a kill, a timer and a
    // listener can never outlive the capture that owns them. A leaked
    // interval here would keep the collector's process alive after it had
    // printed its result.
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    /** SIGTERM first: PresentMon flushes its CSV on a graceful stop. */
    const stop = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone — the exit listener will settle this.
      }
    };

    function onAbort() {
      stop();
      finish(() =>
        reject(
          new CaptureCancelledError(
            `Capture of ${target.name} (pid ${target.processId}) was cancelled. Nothing was recorded.`,
          ),
        ),
      );
    }

    if (request.signal) {
      if (request.signal.aborted) {
        stop();
        finish(() => reject(new CaptureCancelledError('Capture was cancelled before it started.')));
        return;
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      stop();
      finish(() =>
        reject(
          new CaptureTimedOutError(
            `PresentMon did not exit within ${Math.round(deadlineMs / 1000)}s for a ${request.seconds}s capture and was stopped. ` +
              'It was asked to terminate itself with --terminate_after_timed, so overrunning means it hung rather than ran long. ' +
              'Nothing was recorded.',
          ),
        ),
      );
    }, deadlineMs);
    // A pending watchdog must not by itself keep the process alive.
    (timer as unknown as { unref?: () => void }).unref?.();

    child.stderr?.on('data', (chunk) => {
      // Bounded: a failing PresentMon can be chatty, and an unbounded buffer
      // turns a diagnostic into a memory problem.
      if (stderr.length < 8192) stderr += String(chunk);
    });

    // stdout is DRAINED even though nothing reads it.
    //
    // Node gives a spawned child a pipe for stdout, and a pipe nobody reads
    // fills up. Once full, PresentMon's next write blocks — forever, since
    // this process never drains it — and the capture hangs until the watchdog
    // kills it. The result would be a CaptureTimedOutError on a run that was
    // working perfectly, and the operator would have to play it again.
    // --no_console_stats suppresses the live swap-chain table but is not a
    // promise of total silence, so the pipe is drained rather than assumed
    // empty.
    child.stdout?.on('data', () => {});

    child.on('error', (error) => {
      finish(() =>
        reject(
          new CaptureFailedError(
            `PresentMon at ${request.binary.path} could not be run: ${error.message}. ` +
              'Check the path points at PresentMon.exe and that the console application, not the GUI, is installed.',
          ),
        ),
      );
    });

    child.on('exit', (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        const how = signal ? `was terminated by ${signal}` : `exited with code ${code}`;
        reject(
          new CaptureFailedError(
            `PresentMon ${how}.${stderr.trim() ? `\nPresentMon said: ${stderr.trim()}` : ''}\n` +
              'PresentMon needs Administrator privileges to open an ETW session; the most common cause of an immediate ' +
              'non-zero exit is running it without them.',
          ),
        );
      });
    });
  });
}

/**
 * Deletes the temp directory a successful capture left behind.
 *
 * Separate from the failure cleanup because a SUCCESSFUL capture's CSV has to
 * outlive this module — the caller parses it, and may be asked to keep it. The
 * caller therefore says when it is done.
 */
export function releaseCapture(
  outcome: Pick<CaptureOutcome, 'ownedTempDir'>,
  fsLike: Pick<NonNullable<CaptureDeps['fsLike']>, 'rmSync'> = fs,
): void {
  cleanupOwned(fsLike as NonNullable<CaptureDeps['fsLike']>, outcome.ownedTempDir);
}
