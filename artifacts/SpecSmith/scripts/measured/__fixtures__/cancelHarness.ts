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
//   PARENT_PID <pid>             this process's direct parent — see cancellation.test.ts's
//                                 runViaPnpmTargeted, which signals exactly this pid
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-cancel-harness-'));
fs.writeFileSync(path.join(tempDir, 'presentmon-capture.csv'), 'fake capture bytes');
const lockPath = path.join(os.tmpdir(), `specsmith-cancel-harness-${process.pid}.lock`);
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const cancellation = installCancellationHandler();
cancellation.track({ ownedTempDir: tempDir, lockPath });

console.log(`READY ${tempDir} ${lockPath}`);
console.log(`PARENT_PID ${process.ppid}`);

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
