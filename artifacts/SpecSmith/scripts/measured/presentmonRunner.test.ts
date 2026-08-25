import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

import {
  AmbiguousProcessError,
  CAPTURE_SESSION_NAME,
  CaptureCancelledError,
  CaptureFailedError,
  CaptureTimedOutError,
  MAX_CAPTURE_SECONDS,
  MIN_CAPTURE_SECONDS,
  PresentMonBinaryError,
  REQUIRED_CAPTURE_COLUMNS,
  buildPresentMonArgs,
  captureDeadlineMs,
  checkCaptureColumns,
  listWindowsProcesses,
  resolvePresentMonBinary,
  runPresentMonCapture,
  selectTargetProcess,
  type ChildProcessLike,
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

/** A ChildProcess stand-in whose exit the test drives. */
class FakeChild extends EventEmitter implements ChildProcessLike {
  killed: string[] = [];
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed.push(String(signal ?? 'SIGTERM'));
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

    return { child, files, fsDouble, spawn, spawned: () => spawnedWith };
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
      },
    );

  it('captures, verifies columns and returns the CSV', async () => {
    const h = harness({ csv: csvBody });
    const outcome = await run(h);
    expect(outcome.csv).toBe(csvBody);
    expect(outcome.target).toEqual(proc(29668, 'RDR2.exe'));
    expect(outcome.columns.ok).toBe(true);
    expect(h.spawned()?.cmd).toBe(binary.path);
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
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs(files) as never, platform: 'win32', deadlineMs: 500 },
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
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs({}) as never, platform: 'win32' },
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
        { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fakeFs({}) as never, platform: 'win32', deadlineMs: 500 },
      ),
    ).rejects.toThrow(/could not be run: EACCES/);
  });

  // PresentMon was asked to terminate itself, so overrunning means it hung.
  it('kills and reports a PresentMon that never exits', async () => {
    const h = harness({ neverExits: true });
    await expect(run(h)).rejects.toThrow(CaptureTimedOutError);
    expect(h.child.killed.length).toBeGreaterThan(0);
  });

  it('cancels on an abort signal, killing PresentMon', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    // SIGTERM first: PresentMon flushes its CSV on a graceful stop.
    expect(h.child.killed).toContain('SIGTERM');
  });

  it('refuses to start when already cancelled', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    controller.abort();
    await expect(run(h, { signal: controller.signal })).rejects.toThrow(/cancelled before it started/);
  });

  it('never resolves twice when exit follows a kill', async () => {
    const h = harness({ neverExits: true });
    const controller = new AbortController();
    const promise = run(h, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(CaptureCancelledError);
    // A late exit event after cancellation must not turn a rejection into a
    // second settle; an unhandled one would surface as a stray rejection.
    h.child.emit('exit', 0, null);
    await new Promise((r) => setTimeout(r, 5));
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
      { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500 },
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
        { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500 },
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
        { spawn: s.spawn, listProcesses: () => [proc(1, 'g.exe')], fsLike: s.fsDouble as never, platform: 'win32', deadlineMs: 500 },
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
        { spawn: () => child, listProcesses: () => [proc(1, 'g.exe')], fsLike: collidingFs as never, platform: 'win32', deadlineMs: 500 },
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
      { spawn, listProcesses: () => [proc(29668, 'RDR2.exe')], fsLike: fsDouble as never, platform: 'win32', deadlineMs: 500 },
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
