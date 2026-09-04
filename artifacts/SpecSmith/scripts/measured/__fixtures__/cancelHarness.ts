// A stand-in collector, for driving the cancellation handler with a REAL
// signal in a REAL process.
//
// This exists because the Windows cancellation bug lived in a place unit tests
// structurally could not reach. The runner's abort handling was tested against
// an injected spawn and passed; what nobody exercised was whether the process
// survives the signal long enough to run any of it. That question only has an
// answer in a separate process that is actually sent a signal, which is what
// cancellation.test.ts does with this file.
//
// It deliberately uses the real installCancellationHandler and real files. The
// only thing faked is PresentMon: `--linger` models how long the capture takes
// to confirm the child has exited after the abort, so the test can prove the
// collector waits for it rather than dying first.
//
// Protocol, on stdout, one per line:
//   READY <tempDir> <lockPath>   resources exist; safe to signal
//   WAITING                      abort seen, standing by for "PresentMon"
//   CHILD_EXIT_CONFIRMED         "PresentMon" is gone; orderly exit follows

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installCancellationHandler } from '../cancellation';

function flagValue(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const lingerMs = flagValue('linger', 250);
const finishImmediately = process.argv.includes('--finish-immediately');

// ---------------------------------------------------------------------------
// Collapsing pnpm's own duplicate signal forward
// ---------------------------------------------------------------------------
//
// cancellation.test.ts drives this harness two ways: spawned directly with
// tsx, and spawned via `pnpm test:cancel-harness` with the signal sent to the
// whole OS process group (see that file's runViaPnpm — it models Windows
// delivering Ctrl+C to every console-attached process at once).
//
// Investigating this file's own CI flakiness (issue #93) found that going
// through pnpm adds a second, independent delivery of the SAME signal: pnpm
// bundles `foreground-child`, which registers its own `process.on(signal,
// ...)` and explicitly calls `child.kill(signal)` to relay whatever it
// receives to the process it spawned. The process-group send already reaches
// this process directly, on top of the OS group delivery every member of the
// group already gets, and both were observed to arrive here — one from the
// kernel, one relayed by pnpm — 55-65ms apart, consistently, across repeated
// runs. cancellation.ts has no way to know these are one physical Ctrl+C
// replayed by an intermediary rather than a genuine second press, so the
// second delivery hit the real "asked twice — abandon the wait" path within
// tens of milliseconds, well short of this run's own `lingerMs`.
//
// A real second press cannot land 55-65ms after the first, so a short
// debounce distinguishes pnpm's replay from an actual second press without
// weakening what the "gives up on the second signal" test (below, and in
// cancellation.test.ts) verifies: that test's two signals are 120ms apart,
// comfortably outside this window, and still abandon the wait as designed.
// This is scoped to this test fixture's injected `proc`, not to
// cancellation.ts itself: pnpm's replay is an artifact of how these tests
// simulate a console-wide signal against a non-Windows pnpm, not a
// production behavior change.
const SIGNAL_DEBOUNCE_MS = 100;

function debouncingProc(windowMs: number) {
  let lastForwardedAt = 0;
  const wrapped = new Map<(...args: unknown[]) => void, (...args: unknown[]) => void>();

  const wrap = (event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'exit') return listener; // runs once, at real process exit; nothing to debounce
    const debounced = (...args: unknown[]) => {
      const now = Date.now();
      if (now - lastForwardedAt < windowMs) return; // a replay of the signal just forwarded, not a new one
      lastForwardedAt = now;
      listener(...args);
    };
    wrapped.set(listener, debounced);
    return debounced;
  };

  return {
    pid: process.pid,
    get exitCode() {
      return process.exitCode;
    },
    set exitCode(value) {
      process.exitCode = value;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      process.on(event as never, wrap(event, listener) as never);
      return process;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      process.off(event as never, (wrapped.get(listener) ?? listener) as never);
      wrapped.delete(listener);
      return process;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      return this.off(event, listener);
    },
    exit(code?: number) {
      process.exit(code);
    },
  };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-cancel-harness-'));
fs.writeFileSync(path.join(tempDir, 'presentmon-capture.csv'), 'fake capture bytes');
const lockPath = path.join(os.tmpdir(), `specsmith-cancel-harness-${process.pid}.lock`);
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const cancellation = installCancellationHandler({ proc: debouncingProc(SIGNAL_DEBOUNCE_MS) as never });
cancellation.track({ ownedTempDir: tempDir, lockPath });

console.log(`READY ${tempDir} ${lockPath}`);

if (finishImmediately) {
  // The success path: the run completed and owns its own files from here, so
  // dispose() must stop the exit handler from removing them (this is what
  // --keep-capture depends on).
  cancellation.dispose();
  console.log('FINISHED_NORMALLY');
  process.exit(0);
}

cancellation.signal.addEventListener('abort', () => {
  console.log('WAITING');
  // Stands in for "waiting until PresentMon is confirmed exited". If the
  // process did not survive its own SIGINT, nothing below is ever printed —
  // which is precisely the failure this harness exists to catch.
  setTimeout(() => {
    console.log('CHILD_EXIT_CONFIRMED');
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }, lingerMs);
});

// A capture in progress: something is keeping the loop alive.
const keepAlive = setInterval(() => {}, 1_000);
process.on('exit', () => clearInterval(keepAlive));
