// A stand-in collector that cancels ITSELF, with no signal sent by anyone.
//
// WHY THIS IS A SEPARATE FIXTURE FROM cancelHarness.ts
// -------------------------------------------------------
// cancelHarness.ts proves cleanup works when a REAL signal is delivered to
// this process. It does not, and cannot, prove anything about
// --internal-cancel-after-seconds, whose entire reason to exist is that a
// real Windows run found `child.kill('SIGINT')` from an external launcher
// process does NOT deliver a catchable signal on Windows at all — it is
// closer to TerminateProcess, so the child just dies, mid-nothing, having
// run none of its own cancellation logic. Manual, real Ctrl-C in a real
// console continued to work fine throughout, because that IS a real console
// event; the failure was specific to one process trying to signal another
// externally on Windows.
//
// So this fixture never waits for a signal from outside at all. It calls
// cancellation.simulateSignal() from its OWN internal timer — the exact
// mechanism collect.ts's --internal-cancel-after-seconds uses — and proves
// that path produces the identical outcome cancelHarness.ts's real-signal
// tests already established: the message, the wait, the exit code, cleanup
// deferred until "PresentMon" is confirmed gone. No test in this file that
// drives THIS fixture ever calls child.kill() on it.
//
// Protocol, on stdout, one per line:
//   READY <tempDir> <lockPath>   resources exist; the internal timer is armed
//   WAITING                      simulated cancellation seen, standing by for "PresentMon"
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
const cancelAfterMs = flagValue('cancel-after', 50);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-internal-cancel-harness-'));
fs.writeFileSync(path.join(tempDir, 'presentmon-capture.csv'), 'fake capture bytes');
const lockPath = path.join(os.tmpdir(), `specsmith-internal-cancel-harness-${process.pid}.lock`);
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const cancellation = installCancellationHandler();
cancellation.track({ ownedTempDir: tempDir, lockPath });

console.log(`READY ${tempDir} ${lockPath}`);

cancellation.signal.addEventListener('abort', () => {
  console.log('WAITING');
  // Stands in for "waiting until PresentMon is confirmed exited" — same as
  // cancelHarness.ts. If simulateSignal had not actually driven the real
  // cancellation path, this listener would never fire and nothing below
  // would ever print, which is exactly the failure this fixture exists to
  // catch.
  setTimeout(() => {
    console.log('CHILD_EXIT_CONFIRMED');
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }, lingerMs);
});

// A capture in progress: something is keeping the loop alive, same as a real
// collector waiting out --capture-seconds.
const keepAlive = setInterval(() => {}, 1_000);
process.on('exit', () => clearInterval(keepAlive));

// THE mechanism under test: cancellation triggered from INSIDE this process,
// on its own timer, exactly as collect.ts's --internal-cancel-after-seconds
// does via the same simulateSignal() call — never from a signal an external
// process sent it.
setTimeout(() => {
  cancellation.simulateSignal('SIGINT');
}, cancelAfterMs);
