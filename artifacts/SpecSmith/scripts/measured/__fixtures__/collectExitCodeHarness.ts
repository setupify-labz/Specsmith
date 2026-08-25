// A stand-in for collect.ts's OWN top-level control flow, not for the
// cancellation handler cancelHarness.ts already covers.
//
// WHY THIS IS A SEPARATE FIXTURE
// -------------------------------
// cancelHarness.ts proves the collector survives a signal and cleans up. It
// does not, and structurally cannot, catch the defect a real Windows retest
// of that fix then found: cancellation.ts's onSignal sets
// `proc.exitCode = CANCELLED_EXIT_CODE` (130) on the first signal, but
// collect.ts's real capture path then AWAITS runPresentMonCapture, which
// rejects with a CaptureCancelledError once PresentMon is confirmed stopped.
// That rejection propagates out of main() to a top-level
// `main().catch((e) => { ...; process.exitCode = 1; })` — which ran a
// generic 1 straight over the 130 cancellation.ts had already set, because
// nothing in that catch checked whether an exit code had already been
// decided. `$LASTEXITCODE` on the real machine came back 1, not the
// documented 130.
//
// cancelHarness.ts's own exit path reads whatever exitCode is already set
// and reuses it — the opposite of the bug, so it would not have caught it
// even with the regression reintroduced. This fixture instead reproduces
// collect.ts's actual shape: an async operation that REJECTS after
// cancellation (as runPresentMonCapture does), caught by an outer
// `.catch()` that must not clobber the exit code cancellation.ts already
// set. It is a structural clone, not the real collect.ts, because collect.ts
// cannot reach this code path off Windows — it probes real hardware first.
//
// Protocol, on stdout, one per line:
//   READY <lockPath>    resources exist; safe to signal
//   REJECTING           the simulated capture is about to throw

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

const lingerMs = flagValue('linger', 150);

const lockPath = path.join(os.tmpdir(), `specsmith-collect-exit-harness-${process.pid}.lock`);
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

class SimulatedCaptureCancelledError extends Error {}

/** Stands in for runPresentMonCapture: resolves normally, or rejects once cancelled. */
function simulatedCapture(cancellation: ReturnType<typeof installCancellationHandler>): Promise<void> {
  return new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {}, 1_000);
    cancellation.signal.addEventListener('abort', () => {
      setTimeout(() => {
        clearInterval(keepAlive);
        console.log('REJECTING');
        reject(new SimulatedCaptureCancelledError('Capture was cancelled. Waiting for PresentMon to stop before cleaning up.'));
      }, lingerMs);
    });
  });
}

async function main(): Promise<void> {
  const cancellation = installCancellationHandler();
  cancellation.track({ lockPath });
  console.log(`READY ${lockPath}`);
  try {
    await simulatedCapture(cancellation);
  } finally {
    cancellation.dispose();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  // The exact fix under test: only supply a generic failure code when
  // nothing already decided the process's exit status.
  if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
    process.exitCode = 1;
  }
});
