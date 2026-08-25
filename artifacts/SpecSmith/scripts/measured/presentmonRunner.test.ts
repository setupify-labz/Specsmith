import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

import {
  AmbiguousProcessError,
  CAPTURE_SESSION_NAME,
  CaptureCancelledError,
  CaptureFailedError,
  CaptureLockError,
  CaptureTimedOutError,
  DEFAULT_SELF_EXIT_GRACE_MS,
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_CAPTURE_SECONDS,
  MIN_CAPTURE_SECONDS,
  PresentMonBinaryError,
  REQUIRED_CAPTURE_COLUMNS,
  acquireCaptureLock,
  buildPresentMonArgs,
  captureDeadlineMs,
  captureLockPath,
  checkCaptureColumns,
  listWindowsProcesses,
  resolvePresentMonBinary,
  runPresentMonCapture,
  selectTargetProcess,
  stopEtwSession,
  type ChildProcessLike,
  type LockFsLike,
  type PresentMonBinary,
  type RunningProcess,
} from './presentmonRunner';

// Everything here runs off Windows against injected doubles. The one part that
// genuinely cannot be tested anywhere but Aaron's machine is PresentMon itself
// producing a file — see README.md's smoke-test section. What IS testable is
// every decision made around it: which process, which flags, and what happens
// when the capture does not go to plan.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real 19-column header from the pinned RDR2 fixture, BOM included. */
const REAL_HEADER =
  '\ufeffApplication,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,' +
  'msInPresentAPI,msBetweenPresents,AllowsTearing,PresentMode,msUntilRenderComplete,msUntilDisplayed,' +
  'msBetweenDisplayChange,msFlipDelay,msUntilRenderStart,msGPUActive,msSinceInput';

const proc = (processId: number, name: string): RunningProcess => ({ processId, name });

const binary: PresentMonBinary = {
  path: 'C:\\tools\\PresentMon.exe',
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  pinned: true,
};

/**
 * A ChildProcess stand-in whose exit the test drives.
 *
 * `exitAfterSignal` models a real PresentMon's response to being killed: set
 * it to have this fake emit 'exit' some delay after receiving a specific
 * signal, so a test can choose whether the graceful stop "works" (respond to
 * SIGTERM) or must be escalated (respond only to SIGKILL, or not at all).
 */
class FakeChild extends EventEmitter implements ChildProcessLike {
  killed: string[] = [];
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  exitAfterSignal?: { signal: string; delayMs: number; code?: number | null };
  kill(signal?: NodeJS.Signals | number): boolean {
    const sig = String(signal ?? 'SIGTERM');
    this.killed.push(sig);
    if (this.exitAfterSignal?.signal === sig) {
      setTimeout(() => this.emit('exit', this.exitAfterSignal?.code ?? null, sig), this.exitAfterSignal.delayMs);
    }
    return true;
  }
}

function fakeFs(files: Record<string, string>) {
  const removed: string[] = [];
  const made: string[] = [];
  return {
    removed,
    made,
    existsSync: (p: string) => p in files,
    statSync: (p: string) => ({ size: Buffer.byteLength(files[p] ?? ''), isFile: () => true }),
    readFileSync: ((p: string) => files[p] ?? '') as never,
    mkdtempSync: (prefix: string) => {
      const dir = `${prefix}TEST`;
      made.push(dir);
      return dir;
    },
    rmSync: (p: string) => {
      removed.push(p);
    },
  };
}

/** A no-op lock for tests that are not exercising lock behaviour themselves. */
function noopLock() {
  return { release: () => {} };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

describe('capture column verification', () => {
  it('accepts the real 19-column PresentMon header', () => {
    const check = checkCaptureColumns(REAL_HEADER);
    expect(check.ok).toBe(true);
    expect(check.missingRequired).toEqual([]);
    expect(check.missingOptional).toEqual([]);
  });

  // The parser matches case-insensitively because real output writes
  // msBetweenPresents while the docs write MsBetweenPresents. This check has to
  // agree, or it would reject captures the parser reads perfectly.
  it('matches column names case-insensitively, as the parser does', () => {
    expect(checkCaptureColumns(REAL_HEADER.toUpperCase()).ok).toBe(true);
    expect(checkCaptureColumns(REAL_HEADER.toLowerCase()).ok).toBe(true);
  });

  it('names the missing column and what needed it', () => {
    const noGpu = REAL_HEADER.split(',').filter((c) => c !== 'msGPUActive').join(',');
    const check = checkCaptureColumns(noGpu);
    expect(check.ok).toBe(false);
    expect(check.missingRequired).toEqual(['msGPUActive']);
  });

  // These four are OPTIONAL to the parser, which tolerates hand-made captures
  // without them. But the parser's fail-closed guards are built on them: with
  // no Application column the multi-process refusal cannot fire, and with no
  // SwapChainAddress the multi-swap-chain refusal cannot either. A capture
  // missing them does not fail — it silently loses its safety checks.
  it.each(['Application', 'ProcessID', 'SwapChainAddress', 'Dropped'])(
    'requires %s, because a parser guard is built on it',
    (column) => {
      const without = REAL_HEADER.split(',').filter((c) => c.replace('\ufeff', '') !== column).join(',');
      expect(checkCaptureColumns(without).missingRequired).toContain(column);
    },
  );

  it('reports a missing TimeInSeconds without failing the capture', () => {
    const without = REAL_HEADER.split(',').filter((c) => c !== 'TimeInSeconds').join(',');
    const check = checkCaptureColumns(without);
    expect(check.ok).toBe(true);
    expect(check.missingOptional).toEqual(['TimeInSeconds']);
  });

  it('requires the column the parser cannot work without', () => {
    expect(REQUIRED_CAPTURE_COLUMNS.map((c) => c.column)).toContain('MsBetweenPresents');
  });
});

// ---------------------------------------------------------------------------
// The argument vector
// ---------------------------------------------------------------------------

describe('the PresentMon command line', () => {
  const args = buildPresentMonArgs({ processId: 4242, seconds: 90, outputFile: 'C:\\tmp\\run.csv' });

  it('targets the exact pid rather than an executable name', () => {
    expect(args).toContain('--process_id');
    expect(args[args.indexOf('--process_id') + 1]).toBe('4242');
    expect(args).not.toContain('--process_name');
  });

  // PresentMon 2.x emits MsBetweenPresents only under this flag, and the parser
  // rejects a capture without it rather than substituting a column that would
  // look plausible and be wrong.
  it('always requests v1 metrics', () => {
    expect(args).toContain('--v1_metrics');
  });

  it('asks PresentMon to stop itself when the timer expires', () => {
    expect(args).toContain('--timed');
    expect(args[args.indexOf('--timed') + 1]).toBe('90');
    // Without this PresentMon stops recording but keeps running, and the
    // capture would hang until the watchdog killed it.
    expect(args).toContain('--terminate_after_timed');
  });

  it('stops if the game exits or crashes mid-capture', () => {
    expect(args).toContain('--terminate_on_proc_exit');
  });

  // A run killed mid-capture leaves its ETW session behind, and a stale session
  // makes every later capture fail to start.
  it('clears a stale session from a previous killed run', () => {
    expect(args).toContain('--stop_existing_session');
  });

  // Using PresentMon's default session name would let this collector silently
  // stop a PresentMon the operator is running themselves.
  it('uses its own session name', () => {
    expect(args[args.indexOf('--session_name') + 1]).toBe(CAPTURE_SESSION_NAME);
    expect(CAPTURE_SESSION_NAME).not.toBe('PresentMon');
  });

  // Each of these produces a file that still parses and still validates while
  // meaning something other than what the record claims. There is no
  // passthrough for extra flags, so they cannot be reached from a command line
  // — this asserts the fixed vector does not contain them either.
  it.each([
    ['--exclude_dropped', 'removes real rendered frames and breaks the delta chain'],
    ['--no_track_gpu', 'removes msGPUActive, which segmentation needs'],
    ['--no_track_display', 'removes PresentMode, segmentation\'s primary signal'],
    ['--multi_csv', 'splits output per process, so the path we read is not the file we asked for'],
  ])('never passes %s (%s)', (flag) => {
    expect(args).not.toContain(flag);
  });

  it('refuses a duration outside its bounds', () => {
    const base = { processId: 1, outputFile: 'x.csv' };
    expect(() => buildPresentMonArgs({ ...base, seconds: MIN_CAPTURE_SECONDS - 1 })).toThrow(CaptureFailedError);
    expect(() => buildPresentMonArgs({ ...base, seconds: MAX_CAPTURE_SECONDS + 1 })).toThrow(CaptureFailedError);
    expect(() => buildPresentMonArgs({ ...base, seconds: 12.5 })).toThrow(/whole number/);
  });

  it('refuses a nonsense pid', () => {
    expect(() => buildPresentMonArgs({ processId: 0, seconds: 30, outputFile: 'x.csv' })).toThrow(CaptureFailedError);
    expect(() => buildPresentMonArgs({ processId: -3, seconds: 30, outputFile: 'x.csv' })).toThrow(CaptureFailedError);
  });

  // Startup, ETW setup and the final flush all happen outside --timed. A false
  // kill discards a run the operator has to play again, so the grace is
  // generous rather than tight.
  it('allows real overhead past the timed window before the watchdog fires', () => {
    expect(captureDeadlineMs(90)).toBeGreaterThan(90_000);
    expect(captureDeadlineMs(90)).toBeGreaterThanOrEqual(90_000 + 30_000);
  });
});

// ---------------------------------------------------------------------------
// Process selection — the fail-closed core
// ---------------------------------------------------------------------------

describe('choosing which process to capture', () => {
  it('requires an explicit selection rather than guessing a foreground process', () => {
    expect(() => selectTargetProcess([proc(1, 'game.exe')], {})).toThrow(AmbiguousProcessError);
    expect(() => selectTargetProcess([proc(1, 'game.exe')], {})).toThrow(/--capture-process-id/);
  });

  it('selects by pid', () => {
    const chosen = selectTargetProcess([proc(1, 'a.exe'), proc(2, 'game.exe')], { processId: 2 });
    expect(chosen).toEqual(proc(2, 'game.exe'));
  });

  it('selects the only process with a given name', () => {
    const chosen = selectTargetProcess([proc(1, 'a.exe'), proc(2, 'game.exe')], { processName: 'game.exe' });
    expect(chosen.processId).toBe(2);
  });

  it('matches a name case-insensitively, as Windows does', () => {
    expect(selectTargetProcess([proc(7, 'RDR2.exe')], { processName: 'rdr2.exe' }).processId).toBe(7);
  });

  // THE case this exists for. A launcher and the game, two clients, a game and
  // its crash handler — all ordinary on Windows. PresentMon's --process_name
  // would record whichever of them presented, and the CSV would name the right
  // executable while describing the wrong process. Nothing downstream could
  // detect it.
  it('REFUSES two processes sharing a name, and lists their pids', () => {
    const running = [proc(11, 'game.exe'), proc(22, 'game.exe')];
    expect(() => selectTargetProcess(running, { processName: 'game.exe' })).toThrow(AmbiguousProcessError);
    expect(() => selectTargetProcess(running, { processName: 'game.exe' })).toThrow(/11/);
    expect(() => selectTargetProcess(running, { processName: 'game.exe' })).toThrow(/22/);
    expect(() => selectTargetProcess(running, { processName: 'game.exe' })).toThrow(/--capture-process-id/);
  });

  it('refuses a pid that is not running', () => {
    expect(() => selectTargetProcess([proc(1, 'a.exe')], { processId: 999 })).toThrow(/No running process has pid 999/);
  });

  it('refuses a name that is not running, and says to start the game first', () => {
    expect(() => selectTargetProcess([proc(1, 'a.exe')], { processName: 'game.exe' })).toThrow(/Start the game first/);
  });

  // Supplying both is a consistency check the operator gets for free: if the
  // two disagree, one of them is wrong and guessing which would attribute the
  // run to a process that was never measured.
  it('refuses when a supplied pid and name disagree', () => {
    const running = [proc(5, 'launcher.exe')];
    expect(() => selectTargetProcess(running, { processId: 5, processName: 'game.exe' })).toThrow(AmbiguousProcessError);
    expect(() => selectTargetProcess(running, { processId: 5, processName: 'game.exe' })).toThrow(/launcher\.exe/);
  });

  it('accepts a pid and name that agree', () => {
    expect(selectTargetProcess([proc(5, 'game.exe')], { processId: 5, processName: 'game.exe' }).processId).toBe(5);
  });
});

describe('listing processes from PowerShell', () => {
  it('reads an array of processes', () => {
    const list = listWindowsProcesses(() =>
      JSON.stringify([
        { ProcessId: 4, Name: 'game.exe', ExecutablePath: 'C:\\g\\game.exe' },
        { ProcessId: 9, Name: 'other.exe' },
      ]),
    );
    expect(list).toEqual([
      { processId: 4, name: 'game.exe', executablePath: 'C:\\g\\game.exe' },
      { processId: 9, name: 'other.exe', executablePath: undefined },
    ]);
  });

  // ConvertTo-Json emits a bare object rather than an array for a single item,
  // which is the same shape trap environment.ts documents for adapters.
  it('reads the bare object PowerShell emits for a single process', () => {
    expect(listWindowsProcesses(() => JSON.stringify({ ProcessId: 4, Name: 'game.exe' }))).toEqual([
      { processId: 4, name: 'game.exe', executablePath: undefined },
    ]);
  });

  it('drops entries with no usable pid or name rather than inventing one', () => {
    const list = listWindowsProcesses(() => JSON.stringify([{ Name: 'nopid.exe' }, { ProcessId: 3 }, { ProcessId: 8, Name: 'ok.exe' }]));
    expect(list).toEqual([{ processId: 8, name: 'ok.exe', executablePath: undefined }]);
  });
});

// ---------------------------------------------------------------------------
// Binary resolution and pinning
// ---------------------------------------------------------------------------

describe('resolving and pinning the PresentMon executable', () => {
  const bytes = Buffer.from('MZ fake presentmon');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const okFs = {
    existsSync: (p: string) => p === 'C:\\tools\\PresentMon.exe',
    statSync: () => ({ isFile: () => true, size: bytes.length }),
    readFileSync: () => bytes,
  };

  it('refuses when nothing is configured, and does not search PATH', () => {
    expect(() => resolvePresentMonBinary({}, okFs)).toThrow(PresentMonBinaryError);
    expect(() => resolvePresentMonBinary({}, okFs)).toThrow(/PATH is not searched/);
  });

  it('refuses a path that does not exist', () => {
    expect(() => resolvePresentMonBinary({ executablePath: 'C:\\nope.exe' }, okFs)).toThrow(/not found/);
  });

  it('refuses a directory', () => {
    const dirFs = { ...okFs, statSync: () => ({ isFile: () => false, size: 0 }) };
    expect(() => resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe' }, dirFs)).toThrow(/not a file/);
  });

  it('accepts a binary whose digest matches the pin', () => {
    const resolved = resolvePresentMonBinary(
      { executablePath: 'C:\\tools\\PresentMon.exe', expectedSha256: digest },
      okFs,
    );
    expect(resolved).toEqual({ path: 'C:\\tools\\PresentMon.exe', sha256: digest, sizeBytes: bytes.length, pinned: true });
  });

  it('is case-insensitive about the pinned digest', () => {
    expect(
      resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe', expectedSha256: digest.toUpperCase() }, okFs).pinned,
    ).toBe(true);
  });

  // A different PresentMon can emit different columns, and the resulting record
  // would not say so.
  it('REFUSES a binary whose digest does not match the pin', () => {
    expect(() =>
      resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe', expectedSha256: 'b'.repeat(64) }, okFs),
    ).toThrow(/is not the one this collector was set up against/);
  });

  it('refuses a malformed pin rather than ignoring it', () => {
    expect(() =>
      resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe', expectedSha256: 'not-a-digest' }, okFs),
    ).toThrow(/64-character SHA-256/);
  });

  // Unpinned is refused by DEFAULT — the escape hatch has to be asked for.
  it('refuses an unpinned binary by default, printing the digest to pin', () => {
    expect(() => resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe' }, okFs)).toThrow(/No pinned digest/);
    expect(() => resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe' }, okFs)).toThrow(new RegExp(digest));
  });

  it('records pinned:false when the operator explicitly opts out', () => {
    const resolved = resolvePresentMonBinary({ executablePath: 'C:\\tools\\PresentMon.exe', allowUnpinned: true }, okFs);
    expect(resolved.pinned).toBe(false);
    expect(resolved.sha256).toBe(digest);
  });
});

// ---------------------------------------------------------------------------
// Running a capture end to end, against a fake PresentMon
// ---------------------------------------------------------------------------

describe('running a capture', () => {
  const csvBody = `${REAL_HEADER}\nRDR2.exe,29668,0x1,Other,-1,0,0,0.034,0,15.88,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,0.36,10.6`;

  /** Drives a fake PresentMon that writes `csv` and exits with `code`. */
  function harness(opts: { csv?: string; code?: number | null; signalName?: string | null; neverExits?: boolean } = {}) {
    const child = new FakeChild();
    const files: Record<string, string> = {};
    const fsDouble = fakeFs(files);
    let spawnedWith: { cmd: string; args: readonly string[] } | undefined;
    let lockReleased = false;
    // In-memory, per-harness lock double — real acquireCaptureLock has its own
    // dedicated tests below. Using a real file lock here would leak state
    // between tests (and between this whole file and a real machine's temp
    // directory), exactly the coupling a fake avoids.
    const lock = { release: () => { lockReleased = true; } };

    const spawn = (cmd: string, args: readonly string[]) => {
      spawnedWith = { cmd, args };
      if (!opts.neverExits) {
        setTimeout(() => {
          const outFile = String(args[args.indexOf('--output_file') + 1]);
          if (opts.csv !== undefined) files[outFile] = opts.csv;
          child.emit('exit', opts.code ?? 0, opts.signalName ?? null);
        }, 1);
      }
      return child;
    };

    return { child, files, fsDouble, spawn, spawned: () => spawnedWith, lockReleased: () => lockReleased, acquireLock: () => lock };
  }

  const run = (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) =>
    runPresentMonCapture(
      { processId: 29668, seconds: 30, binary, ...extra },
      {
        spawn: h.spawn,
        listProcesses: () => [proc(29668, 'RDR2.exe')],
        fsLike: h.fsDouble as never,
        platform: 'win32',
        deadlineMs: 500,
        // Short so escalation tests don't wait a real 5s; deliberately still
        // long enough that a fake configured to respond to SIGTERM settles
        // well before it, distinguishing "graceful stop worked" from
        // "had to be escalated" in test timing.
        terminationGraceMs: 30,
        // Phase 0 — the window a cancelled capture is left completely alone so
        // PresentMon can close its own ETW session. Small here; the real
        // default is DEFAULT_SELF_EXIT_GRACE_MS.
        selfExitGraceMs: 20,
        acquireLock: h.acquireLock,
      },
    );

  it('captures, verifies columns and returns the CSV', async () => {
    const h = harness({ csv: csvBody });
    const outcome = await run(h);
    expect(outcome.csv).toBe(csvBody);
    expect(outcome.target).toEqual(proc(29668, 'RDR2.exe'));
    expect(outcome.columns.ok).toBe(true);
    expect(h.spawned()?.cmd).toBe(binary.path);
    // The single-capture lock is released once the run is done, so a second
    // capture can start.
    expect(h.lockReleased()).toBe(true);
  });

  it('refuses to run anywhere but Windows', async () => {
    const h = harness({ csv: csvBody });
    await expect(
      runPresentMonCapture({ processId: 1, seconds: 30, binary }, { spawn: h.spawn, listProcesses: () => [], platform: 'linux' }),
    ).rejects.toThrow(/Windows-only/);
  });

  // The game closed or crashed. --terminate_on_proc_exit makes PresentMon stop,
  // and the result is no file rather than a full-length wait.
  it('explains a capture that produced no file', async () => {
    const h = harness({ csv: undefined });
    await expect(run(h)).rejects.toThrow(/exited without writing/);
    await expect(run(h)).rejects.toThrow(/presented no frames/);
  });

  it('rejects an empty file rather than parsing nothing', async () => {
    const h = harness({ csv: '' });
    await expect(run(h)).rejects.toThrow(/empty file/);
  });

  it('rejects a file with no header row', async () => {
    const h = harness({ csv: '\n\n' });
    await expect(run(h)).rejects.toThrow(/no header row/);
  });

  // The flags are ours and do include --v1_metrics, so a missing column means
  // the binary is not what we think it is.
  it('rejects a capture missing a required column, naming it and what needed it', async () => {
    const noGpu = csvBody
      .split('\n')
      .map((l, i) => (i === 0 ? l.split(',').filter((c) => c !== 'msGPUActive').join(',') : l))
      .join('\n');
    const h = harness({ csv: noGpu });
    await expect(run(h)).rejects.toThrow(/msGPUActive/);
    await expect(run(h)).rejects.toThrow(/segmentation/);
  });

  it('surfaces a non-zero exit with PresentMon\'s own stderr and the admin hint', async () => {
    const child = new FakeChild();
    const files: Record<string, string> = {};
    const spawn = () => {
      setTimeout(() => {
        child.stderr.emit('data', 'error: failed to start trace session');
        child.emit('exit', 1, null);
      }, 1);
      return child;
    };
    await expect(
      runPresentMonCapture(
        { processId: 29668, seconds: 30, binary },
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs(files) as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
      ),
    ).rejects.toThrow(/failed to start trace session[\s\S]*Administrator/);
  });

  // Node gives the child a pipe for stdout, and a pipe nobody reads fills up.
  // Once full, PresentMon's next write blocks forever and the capture hangs
  // until the watchdog kills it — a CaptureTimedOutError on a run that was
  // working perfectly, and a run the operator has to play again.
  it('drains stdout so a chatty PresentMon cannot deadlock on a full pipe', async () => {
    const h = harness({ csv: csvBody });
    const promise = run(h);
    // Nothing consumes this in production either; the assertion is that a
    // listener is attached at all, which is what keeps the pipe flowing.
    expect(h.child.stdout.listenerCount('data')).toBeGreaterThan(0);
    for (let i = 0; i < 500; i += 1) h.child.stdout.emit('data', 'x'.repeat(1024));
    await expect(promise).resolves.toBeDefined();
  });

  it('reports a binary that cannot be spawned at all', async () => {
    const spawn = () => {
      throw new Error('spawn ENOENT');
    };
    await expect(
      runPresentMonCapture(
        { processId: 29668, seconds: 30, binary },
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs({}) as never, platform: 'win32', acquireLock: noopLock },
      ),
    ).rejects.toThrow(/Could not start PresentMon/);
  });

  it('reports an async spawn error', async () => {
    const child = new FakeChild();
    const spawn = () => {
      setTimeout(() => child.emit('error', new Error('EACCES')), 1);
      return child;
    };
    await expect(
      runPresentMonCapture(
        { processId: 29668, seconds: 30, binary },
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs({}) as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
      ),
    ).rejects.toThrow(/could not be run: EACCES/);
  });

  // PresentMon was asked to terminate itself, so overrunning means it hung.
  // The watchdog requests termination; since this fake never responds at
  // all, that escalates to a forced kill, and only once THAT is (simulated
  // to be) honoured does the promise settle.
  it('escalates to a forced kill when PresentMon ignores the watchdog\'s stop request', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGKILL', delayMs: 5 };
    await expect(run(h)).rejects.toThrow(CaptureTimedOutError);
    expect(h.child.killed).toEqual(['SIGTERM', 'SIGKILL']);
    expect(h.lockReleased()).toBe(true);
  });

  // The graceful stop is given a real chance to work first: if PresentMon
  // responds to SIGTERM within the grace period, SIGKILL is never sent.
  it('does not escalate when PresentMon exits during the graceful-stop grace period', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGTERM', delayMs: 5 };
    await expect(run(h)).rejects.toThrow(CaptureTimedOutError);
    expect(h.child.killed).toEqual(['SIGTERM']);
  });

  it('cancels on an abort signal: requests a graceful stop, and settles once PresentMon actually exits', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGTERM', delayMs: 5 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    expect(h.child.killed).toEqual(['SIGTERM']);
    expect(h.lockReleased()).toBe(true);
  });

  // The bug this sequence exists to fix: cancelling used to settle the
  // promise (and let the caller clean up) the moment SIGTERM was SENT, not
  // when PresentMon actually exited — so a temp directory could be deleted
  // while PresentMon still held its CSV file open. This asserts the fix
  // directly: cleanup has not happened yet immediately after requesting
  // cancellation, and has happened once the exit is confirmed.
  it('does not clean up temporary files until the process is confirmed stopped', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGTERM', delayMs: 20 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();

    // PresentMon has been asked to stop but has not exited yet.
    await new Promise((r) => setTimeout(r, 1));
    expect(h.fsDouble.removed).toEqual([]);
    expect(h.lockReleased()).toBe(false);

    await expect(promise).rejects.toThrow(CaptureCancelledError);

    // Only now, after the confirmed exit, is anything cleaned up.
    expect(h.fsDouble.removed).toHaveLength(1);
    expect(h.lockReleased()).toBe(true);
  });

  // An abort that escalates all the way to a forced kill must still wait for
  // that kill to be confirmed before cleaning up — not merely for the kill to
  // have been SENT.
  it('escalates a cancellation to a forced kill if the graceful stop is ignored', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGKILL', delayMs: 5 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    expect(h.child.killed).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('refuses to start when already cancelled, without touching the lock or spawning', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    controller.abort();
    await expect(run(h, { signal: controller.signal })).rejects.toThrow(/cancelled before it started/);
    expect(h.spawned()).toBeUndefined();
    expect(h.lockReleased()).toBe(false); // never acquired, so nothing to release
  });

  it('never settles twice if a stray exit event follows the confirmed one', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGTERM', delayMs: 5 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    // A second exit event after the capture already settled must not attempt
    // a second settle; an unhandled one would surface as a stray rejection.
    h.child.emit('exit', 0, null);
    await new Promise((r) => setTimeout(r, 5));
  });

  it('rejects when another capture already holds the lock, without spawning PresentMon', async () => {
    const h = harness({ csv: csvBody });
    let spawnCalled = false;
    const spawn: typeof h.spawn = (cmd, args) => {
      spawnCalled = true;
      return h.spawn(cmd, args);
    };
    await expect(
      runPresentMonCapture(
        { processId: 29668, seconds: 30, binary },
        {
          spawn,
          listProcesses: () => [proc(29668, 'RDR2.exe')],
          fsLike: h.fsDouble as never,
          platform: 'win32',
          acquireLock: () => {
            throw new CaptureLockError('Another SpecSmith capture is already running (pid 4242).');
          },
        },
      ),
    ).rejects.toThrow(CaptureLockError);
    expect(spawnCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Temp-file lifecycle
// ---------------------------------------------------------------------------

describe('temporary capture files', () => {
  const csvBody = `${REAL_HEADER}\nRDR2.exe,29668,0x1,Other,-1,0,0,0.034,0,15.88,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,0.36,10.6`;

  function setup(opts: { csv?: string; code?: number } = {}) {
    const child = new FakeChild();
    const files: Record<string, string> = {};
    const fsDouble = fakeFs(files);
    const spawn = (_cmd: string, args: readonly string[]) => {
      setTimeout(() => {
        const outFile = String(args[args.indexOf('--output_file') + 1]);
        if (opts.csv !== undefined) files[outFile] = opts.csv;
        child.emit('exit', opts.code ?? 0, null);
      }, 1);
      return child;
    };
    return { fsDouble, spawn };
  }

  it('creates a temp directory when none is given, and reports owning it', async () => {
    const s = setup({ csv: csvBody });
    const outcome = await runPresentMonCapture(
      { processId: 1, seconds: 30, binary },
      { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
    );
    expect(outcome.ownedTempDir).toBeDefined();
    expect(s.fsDouble.made).toHaveLength(1);
    // Not removed on success: the caller still has to read and parse it.
    expect(s.fsDouble.removed).toEqual([]);
  });

  it('removes its temp directory when the capture fails', async () => {
    const s = setup({ csv: undefined });
    await expect(
      runPresentMonCapture(
        { processId: 1, seconds: 30, binary },
        { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
      ),
    ).rejects.toThrow();
    expect(s.fsDouble.removed).toHaveLength(1);
  });

  // --capture-output-dir can legitimately point at a folder holding other
  // captures. Cleanup that reached outside its own temp directory is how a
  // diagnostic tool deletes an operator's data.
  it('never removes a directory the operator chose, even on failure', async () => {
    const s = setup({ csv: undefined });
    await expect(
      runPresentMonCapture(
        { processId: 1, seconds: 30, binary, outputDir: 'D:\\captures' },
        { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
      ),
    ).rejects.toThrow();
    expect(s.fsDouble.removed).toEqual([]);
    expect(s.fsDouble.made).toEqual([]);
  });

  it('refuses to overwrite a file that is already there', async () => {
    const child = new FakeChild();
    const fsDouble = fakeFs({});
    // Every path reports as existing, which is the collision this guards.
    const collidingFs = { ...fsDouble, existsSync: () => true };
    await expect(
      runPresentMonCapture(
        { processId: 1, seconds: 30, binary, outputDir: 'D:\\captures' },
        { spawn: () => child, listProcesses: () => [proc(1, 'g.exe')], fsLike: collidingFs as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
      ),
    ).rejects.toThrow(/Refusing to overwrite/);
  });
});

// ---------------------------------------------------------------------------
// Integration: a captured CSV flows into the existing parser unchanged
// ---------------------------------------------------------------------------

describe('a captured file feeds the existing parser', () => {
  it('parses through parsePresentMonCsv with no reinterpretation here', async () => {
    const { parsePresentMonCsv } = await import('./presentmon');
    const rows = [
      REAL_HEADER,
      'RDR2.exe,29668,0x1,Other,-1,0,0,0.000,0,0,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,0.36,10.6',
      'RDR2.exe,29668,0x1,Other,-1,0,0,0.016,0,16.0,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,4.2,10.6',
      'RDR2.exe,29668,0x1,Other,-1,0,1,0.032,0,16.5,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,4.4,10.6',
    ].join('\n');

    const child = new FakeChild();
    const files: Record<string, string> = {};
    const fsDouble = fakeFs(files);
    const spawn = (_c: string, args: readonly string[]) => {
      setTimeout(() => {
        files[String(args[args.indexOf('--output_file') + 1])] = rows;
        child.emit('exit', 0, null);
      }, 1);
      return child;
    };

    const outcome = await runPresentMonCapture(
      { processId: 29668, seconds: 30, binary },
      { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fsDouble as never, platform: 'win32', deadlineMs: 500, acquireLock: noopLock },
    );

    const parsed = parsePresentMonCsv(outcome.csv, outcome.target.name);
    // The first present has no interval and is discarded; the dropped present
    // is RETAINED, both decisions owned by presentmon.ts rather than re-made
    // here.
    expect(parsed.frameTimesMs).toEqual([16.0, 16.5]);
    expect(parsed.discardedFirstFrames).toBe(1);
    expect(parsed.droppedFrames).toBe(1);
    // Segmentation's signal survived the capture.
    expect(parsed.frames.every((f) => f.presentMode === 'Hardware: Legacy Flip')).toBe(true);
    expect(parsed.frames.every((f) => Number.isFinite(f.msGpuActive))).toBe(true);
  });

  // The runner reimplements nothing: it must not export a statistic, a frame
  // filter, or a second opinion about what a capture means.
  it('exports no statistics or frame interpretation of its own', async () => {
    const runner = await import('./presentmonRunner');
    const suspicious = Object.keys(runner).filter((k) => /fps|average|percentile|frameTime|stats|dropped/i.test(k));
    expect(suspicious).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The single-capture lock
// ---------------------------------------------------------------------------

describe('the single-capture lock', () => {
  function fakeLockFs(initial: Record<string, string> = {}): LockFsLike & { files: Record<string, string>; writeCalls: number; unlinkCalls: number } {
    const files = { ...initial };
    let writeCalls = 0;
    let unlinkCalls = 0;
    return {
      files,
      get writeCalls() { return writeCalls; },
      get unlinkCalls() { return unlinkCalls; },
      existsSync: (p) => p in files,
      readFileSync: (p) => {
        if (!(p in files)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        return files[p];
      },
      writeFileSync: (p, data, opts) => {
        writeCalls += 1;
        if (opts.flag === 'wx' && p in files) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        files[p] = data;
      },
      unlinkSync: (p) => {
        unlinkCalls += 1;
        if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        delete files[p];
      },
    };
  }

  const LOCK_PATH = 'C:\\temp\\SpecSmithMeasuredCapture.lock';

  it('creates the lock file when none exists', () => {
    const fsLike = fakeLockFs();
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike });
    expect(fsLike.existsSync(LOCK_PATH)).toBe(true);
    expect(JSON.parse(fsLike.files[LOCK_PATH]).pid).toBe(process.pid);
    lock.release();
  });

  // The exact scenario the lock exists to prevent: a second capture would
  // otherwise stop the first one's ETW session out from under it.
  it('REFUSES when a live process already holds the lock, naming its pid', () => {
    const fsLike = fakeLockFs({ [LOCK_PATH]: JSON.stringify({ pid: 999 }) });
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike, isProcessAlive: () => true })).toThrow(CaptureLockError);
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike, isProcessAlive: () => true })).toThrow(/pid 999/);
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike, isProcessAlive: () => true })).toThrow(/SpecSmithMeasuredCapture/);
  });

  // A crashed collector leaves its lock file behind. Treating that as
  // permanent would mean nobody could ever capture again after one crash.
  it('clears and recreates a lock left by a process that is no longer running', () => {
    const fsLike = fakeLockFs({ [LOCK_PATH]: JSON.stringify({ pid: 999 }) });
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike, isProcessAlive: () => false });
    expect(JSON.parse(fsLike.files[LOCK_PATH]).pid).toBe(process.pid);
    lock.release();
  });

  it('treats an unreadable/corrupt lock file as stale rather than refusing forever', () => {
    const fsLike = fakeLockFs({ [LOCK_PATH]: 'not json' });
    // isProcessAlive must not even be consulted — there is no pid to check.
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike, isProcessAlive: () => true });
    expect(JSON.parse(fsLike.files[LOCK_PATH]).pid).toBe(process.pid);
    lock.release();
  });

  it('release() removes the lock file', () => {
    const fsLike = fakeLockFs();
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike });
    lock.release();
    expect(fsLike.existsSync(LOCK_PATH)).toBe(false);
  });

  it('release() is idempotent', () => {
    const fsLike = fakeLockFs();
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike });
    lock.release();
    const unlinkCallsAfterFirstRelease = fsLike.unlinkCalls;
    expect(() => lock.release()).not.toThrow();
    expect(fsLike.unlinkCalls).toBe(unlinkCallsAfterFirstRelease); // no second unlink attempt
  });

  // Exercises the REAL default liveness check (no isProcessAlive override):
  // this test's own pid is, definitionally, alive, so a lock file recording
  // it must be refused rather than treated as stale and cleared.
  it('the default liveness check correctly identifies this very process as alive', () => {
    const fsLike = fakeLockFs({ [LOCK_PATH]: JSON.stringify({ pid: process.pid }) });
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike })).toThrow(CaptureLockError);
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike })).toThrow(new RegExp(`pid ${process.pid}`));
  });

  // A pid this large is not a real process on any platform this collector
  // targets, so the default check must find it dead and clear the lock.
  it('the default liveness check correctly identifies an implausible pid as dead', () => {
    const fsLike = fakeLockFs({ [LOCK_PATH]: JSON.stringify({ pid: 999_999_999 }) });
    const lock = acquireCaptureLock({ lockPath: LOCK_PATH, fsLike });
    expect(JSON.parse(fsLike.files[LOCK_PATH]).pid).toBe(process.pid);
    lock.release();
  });

  it('propagates a real filesystem error that is not a lock collision', () => {
    const fsLike: LockFsLike = {
      existsSync: () => false,
      readFileSync: () => { throw new Error('unreachable'); },
      writeFileSync: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); },
      unlinkSync: () => {},
    };
    expect(() => acquireCaptureLock({ lockPath: LOCK_PATH, fsLike })).toThrow(/EACCES/);
  });

  it('captureLockPath is fixed and identifies the session it protects', () => {
    expect(captureLockPath()).toContain(CAPTURE_SESSION_NAME);
  });

  // Not a full lifecycle test (that needs the real filesystem and a real
  // pid), just proof the constant this module documents is what ships.
  it('DEFAULT_TERMINATION_GRACE_MS is generous enough for a real flush', () => {
    expect(DEFAULT_TERMINATION_GRACE_MS).toBeGreaterThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// The ETW leak: what Windows smoke testing actually found
// ---------------------------------------------------------------------------

// Pressing Ctrl+C during a real capture left the SpecSmithMeasuredCapture ETW
// session running, and it had to be stopped by hand with `logman stop`. The
// cause was this module: Windows delivers Ctrl+C to every process on the
// console, so PresentMon had ALREADY been told to stop and was closing its own
// session — and the runner immediately called child.kill(), which Node
// implements as TerminateProcess on Windows. PresentMon was destroyed
// mid-shutdown and its session outlived it. The collector leaked the session it
// was trying to clean up.
describe('a cancelled capture lets PresentMon close its own ETW session first', () => {
  const csvBody = `${REAL_HEADER}\nRDR2.exe,29668,0x1,Other,-1,0,0,0.034,0,15.88,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,0.36,10.6`;

  function harness(opts: { neverExits?: boolean } = {}) {
    const child = new FakeChild();
    const files: Record<string, string> = {};
    const fsDouble = fakeFs(files);
    const stopped: string[] = [];
    const spawn = (_cmd: string, args: readonly string[]) => {
      if (!opts.neverExits) {
        setTimeout(() => {
          files[String(args[args.indexOf('--output_file') + 1])] = csvBody;
          child.emit('exit', 0, null);
        }, 1);
      }
      return child;
    };
    return { child, files, fsDouble, spawn, stopped, stopSession: () => stopped.push('stopped') };
  }

  const run = (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) =>
    runPresentMonCapture(
      { processId: 29668, seconds: 30, binary, ...extra },
      {
        spawn: h.spawn,
        listProcesses: () => [proc(29668, 'RDR2.exe')],
        fsLike: h.fsDouble as never,
        platform: 'win32',
        deadlineMs: 5000,
        terminationGraceMs: 30,
        selfExitGraceMs: 60,
        acquireLock: noopLock,
        stopSession: h.stopSession,
        ...deps,
      },
    );

  // THE regression. Nothing may be sent to PresentMon in the phase-0 window.
  it('sends NO signal at all while PresentMon is still shutting itself down', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();

    // Mid-window: the abort has been seen, but the child is untouched.
    await new Promise((r) => setTimeout(r, 25));
    expect(h.child.killed).toEqual([]);

    h.child.emit('exit', 0, null);
    await expect(promise).rejects.toThrow(CaptureCancelledError);
  });

  // The clean path, and the whole point of the window: PresentMon exits by
  // itself, having closed its session, and is never signalled.
  it('never signals PresentMon at all when it exits within the window', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    setTimeout(() => h.child.emit('exit', 0, null), 10);
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    expect(h.child.killed).toEqual([]);
  });

  // A PresentMon that ignores its own Ctrl+C still gets escalated — the window
  // is a grace period, not a licence to hang.
  it('escalates once the window expires without an exit', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGKILL', delayMs: 5 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    expect(h.child.killed).toEqual(['SIGTERM', 'SIGKILL']);
  });

  // A watchdog timeout is not a console Ctrl+C: nothing signalled the child, so
  // there is no self-shutdown to wait for and waiting would only add delay.
  it('does not wait for a self-exit on a watchdog timeout', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGTERM', delayMs: 5 };
    const promise = run(h, {}, { deadlineMs: 10, selfExitGraceMs: 10_000 });
    await expect(promise).rejects.toThrow(CaptureTimedOutError);
    expect(h.child.killed).toEqual(['SIGTERM']);
  });

  // Backstop for the case the window did not cover.
  it('stops a leaked session after a cancelled capture', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGKILL', delayMs: 5 };
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    expect(h.stopped).toEqual(['stopped']);
  });

  it('stops a leaked session after a watchdog timeout', async () => {
    const h = harness({ neverExits: true });
    h.child.exitAfterSignal = { signal: 'SIGKILL', delayMs: 5 };
    await expect(run(h, {}, { deadlineMs: 10 })).rejects.toThrow(CaptureTimedOutError);
    expect(h.stopped).toEqual(['stopped']);
  });

  // A capture that succeeded closed its own session; reaching for logman there
  // would be noise, and on a shared machine, risk.
  it('does not touch any session after a normal capture', async () => {
    const h = harness();
    await run(h);
    expect(h.stopped).toEqual([]);
  });

  it('does not touch any session when PresentMon could not even start', async () => {
    const h = harness();
    await expect(
      run(h, {}, {
        spawn: () => {
          throw new Error('spawn ENOENT');
        },
      }),
    ).rejects.toThrow(/Could not start PresentMon/);
    expect(h.stopped).toEqual([]);
  });

  it('leaves a real grace window by default, not a token one', () => {
    expect(DEFAULT_SELF_EXIT_GRACE_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('stopping a leaked ETW session', () => {
  it('runs the documented logman incantation for our session only', () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    expect(
      stopEtwSession(CAPTURE_SESSION_NAME, { platform: 'win32', run: (cmd, args) => { calls.push({ cmd, args }); } }),
    ).toBe(true);
    expect(calls).toEqual([{ cmd: 'logman', args: ['stop', CAPTURE_SESSION_NAME, '-ets'] }]);
  });

  // A bug here could otherwise tear down an unrelated trace on the machine.
  it('REFUSES to stop a session this collector does not own', () => {
    expect(() => stopEtwSession('NT Kernel Logger', { platform: 'win32', run: () => {} })).toThrow(/only owns/);
  });

  it('is a no-op off Windows, where there are no ETW sessions', () => {
    let called = false;
    expect(stopEtwSession(CAPTURE_SESSION_NAME, { platform: 'linux', run: () => { called = true; } })).toBe(false);
    expect(called).toBe(false);
  });

  // "Session not found" is the GOOD outcome — PresentMon closed it itself.
  it('reports failure quietly rather than throwing when there is nothing to stop', () => {
    expect(
      stopEtwSession(CAPTURE_SESSION_NAME, {
        platform: 'win32',
        run: () => { throw new Error('Data Collector Set was not found.'); },
      }),
    ).toBe(false);
  });
});

// Until this callback existed, ownedTempDir and the lock path were reachable
// only through a SUCCESSFUL outcome — so a cancelled run left both on disk,
// which is exactly what Windows smoke testing reported.
describe('resources are announced before the capture, not after it succeeds', () => {
  it('reports the temp directory and lock path before PresentMon is spawned', async () => {
    const child = new FakeChild();
    const files: Record<string, string> = {};
    const fsDouble = fakeFs(files);
    const seen: Array<{ ownedTempDir?: string; lockPath: string }> = [];
    let spawnedAfterCallback = false;

    const spawn = (_c: string, args: readonly string[]) => {
      spawnedAfterCallback = seen.length > 0;
      setTimeout(() => {
        files[String(args[args.indexOf('--output_file') + 1])] =
          `${REAL_HEADER}\nRDR2.exe,29668,0x1,Other,-1,0,0,0.034,0,15.88,0,Hardware: Legacy Flip,0.07,6.16,16.66,0,-15.8,0.36,10.6`;
        child.emit('exit', 0, null);
      }, 1);
      return child;
    };

    await runPresentMonCapture(
      { processId: 29668, seconds: 30, binary, onResourcesAllocated: (r) => seen.push(r) },
      {
        spawn,
        listProcesses: () => [proc(29668, 'RDR2.exe')],
        fsLike: fsDouble as never,
        platform: 'win32',
        deadlineMs: 500,
        acquireLock: noopLock,
        stopSession: () => {},
      },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].lockPath).toContain(CAPTURE_SESSION_NAME);
    expect(seen[0].ownedTempDir).toBeDefined();
    expect(spawnedAfterCallback).toBe(true);
  });

  // A --capture-output-dir belongs to the operator and must never be offered
  // up for deletion.
  it('reports no temp directory when the operator chose the output directory', async () => {
    const child = new FakeChild();
    const fsDouble = fakeFs({});
    const seen: Array<{ ownedTempDir?: string; lockPath: string }> = [];
    await expect(
      runPresentMonCapture(
        { processId: 1, seconds: 30, binary, outputDir: 'D:\\captures', onResourcesAllocated: (r) => seen.push(r) },
        {
          spawn: () => {
            setTimeout(() => child.emit('exit', 0, null), 1);
            return child;
          },
          listProcesses: () => [proc(1, 'g.exe')],
          fsLike: fsDouble as never,
          platform: 'win32',
          deadlineMs: 500,
          acquireLock: noopLock,
          stopSession: () => {},
        },
      ),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0].ownedTempDir).toBeUndefined();
  });
});
