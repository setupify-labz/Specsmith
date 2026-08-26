// Ctrl+C handling for the collector CLI.
//
// WHY THIS IS ITS OWN MODULE
// --------------------------
// The runner's cancellation path was covered by tests against an injected
// spawn, and it passed. Windows smoke testing then found that pressing Ctrl+C
// during a real capture returned straight to the prompt with no message, no
// cleanup, a live ETW session, a stale lock file and an orphaned temp
// directory. Every one of those had a passing test.
//
// The tests were not wrong about what they tested; they tested the wrong
// boundary. Between "the runner reacts correctly to an AbortSignal" and "the
// operator presses Ctrl+C" sits the part nothing exercised: whether the
// process is still alive to react at all.
//
// So the signal handling lives here, apart from the Windows-only collector, in
// a module a test can drive in a real child process with a real signal.
//
// WHAT WINDOWS DOES DIFFERENTLY
// -----------------------------
// Ctrl+C is delivered as CTRL_C_EVENT to EVERY process attached to the
// console, not just the foreground one. For `pnpm collect:measured` that is
// cmd.exe, pnpm, tsx, this collector AND PresentMon, all at once. Two
// consequences shape everything below:
//
//   * The shell and pnpm tear down immediately, which is why the prompt came
//     back. This process has to be deliberately kept alive to finish; that is
//     what a registered listener buys, and why the first Ctrl+C must not exit.
//
//   * PresentMon got the same Ctrl+C and is already closing its trace session.
//     Killing it at that moment is what leaked the session — see
//     DEFAULT_SELF_EXIT_GRACE_MS in presentmonRunner.ts.
//
// LAST-RESORT CLEANUP
// -------------------
// Being kept alive is best-effort: a parent shell can still tear the process
// down. So resources are also removed from a synchronous `exit` handler, which
// runs even when the ordinary path does not. It cannot wait for PresentMon —
// nothing asynchronous can run there — so it is a backstop for the lock and
// temp directory, not a substitute for the orderly path.

import fs from 'node:fs';

/** Files and directories this run owns and must not leave behind. */
export interface CancellableResources {
  /** A temp directory the runner created. Never a --capture-output-dir. */
  ownedTempDir?: string;
  /** The single-capture lock file. */
  lockPath?: string;
}

export interface CancellationController {
  /** Passed to runPresentMonCapture. */
  readonly signal: AbortSignal;
  /** True once a signal has been seen. */
  readonly cancelled: boolean;
  /** Registers resources to clean up if this run does not finish normally. */
  track(resources: CancellableResources): void;
  /** The run finished (or handed the resources on). Stops tracking and unhooks. */
  dispose(): void;
  /**
   * Drives the exact same path a real OS signal would: aborts, sets the exit
   * code, logs the same message, waits for cleanup on a second call.
   *
   * Exists for collect.ts's `--internal-cancel-after-seconds` (see there):
   * on Windows, `ChildProcess.kill()` does not deliver a catchable signal the
   * way a real console Ctrl+C does — it is closer to TerminateProcess, and a
   * real Windows run confirmed exactly that: the child exited immediately
   * with signal=SIGINT and never ran any of this. Nothing OUTSIDE a process
   * can safely simulate Ctrl+C on Windows for testing purposes, so a caller
   * that wants to test the cancellation and cleanup path from a smoke test
   * has to trigger it from INSIDE the process being tested — which is what
   * this is for. It is not a substitute for a real Ctrl+C test.
   */
  simulateSignal(signal?: NodeJS.Signals): void;
}

export interface CancellationOptions {
  /** Defaults to process. Injected so tests can drive it without real signals. */
  proc?: Pick<
    NodeJS.Process,
    'on' | 'off' | 'removeListener' | 'exit' | 'pid'
  > & { exitCode?: number | string | null | undefined };
  log?: Pick<Console, 'error'>;
  fsLike?: Pick<typeof fs, 'existsSync' | 'readFileSync' | 'rmSync' | 'unlinkSync'>;
  /** Signals to catch. SIGBREAK is Windows' Ctrl+Break and does not exist elsewhere. */
  signals?: readonly NodeJS.Signals[];
}

/** POSIX convention for "terminated by SIGINT": 128 + 2. */
export const CANCELLED_EXIT_CODE = 130;

export const DEFAULT_CANCEL_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK'];

/**
 * Deletes the lock file only if this process still owns it.
 *
 * The lock records the pid that created it. Checking that before unlinking
 * closes a real race: by the time an exit handler runs, our own capture may
 * have finished and released the lock, and a SECOND capture may already hold
 * it. Deleting blindly would strip a live capture of its lock and let a third
 * one start alongside it — the exact collision the lock exists to prevent.
 */
export function removeOwnLock(
  lockPath: string,
  ownerPid: number,
  fsLike: CancellationOptions['fsLike'] = fs,
): boolean {
  const io = fsLike ?? fs;
  try {
    if (!io.existsSync(lockPath)) return false;
    const parsed = JSON.parse(String(io.readFileSync(lockPath, 'utf-8'))) as { pid?: unknown };
    if (parsed.pid !== ownerPid) return false;
    io.unlinkSync(lockPath);
    return true;
  } catch {
    // Unreadable, already gone, or raced away. Never throw from cleanup.
    return false;
  }
}

/** Removes whatever of `resources` is still present. Synchronous, so it works from an exit handler. */
export function cleanUpResources(
  resources: CancellableResources,
  ownerPid: number,
  fsLike: CancellationOptions['fsLike'] = fs,
): { removedTempDir: boolean; removedLock: boolean } {
  const io = fsLike ?? fs;
  let removedTempDir = false;
  if (resources.ownedTempDir) {
    try {
      io.rmSync(resources.ownedTempDir, { recursive: true, force: true });
      removedTempDir = true;
    } catch {
      // Best effort; a failure here must not bury the reason we are exiting.
    }
  }
  const removedLock = resources.lockPath ? removeOwnLock(resources.lockPath, ownerPid, io) : false;
  return { removedTempDir, removedLock };
}

/**
 * Installs the handlers that make Ctrl+C an orderly stop.
 *
 * First signal:  aborts the capture, says so, and DOES NOT EXIT. The runner
 *                then waits for PresentMon to stop before anything is removed.
 * Second signal: the operator has asked twice. Clean up synchronously and go,
 *                accepting that PresentMon may outlive us.
 * At exit:       whatever is still tracked is removed, however we got here.
 */
export function installCancellationHandler(options: CancellationOptions = {}): CancellationController {
  const proc = options.proc ?? process;
  const log = options.log ?? console;
  const io = options.fsLike ?? fs;
  const signals = options.signals ?? DEFAULT_CANCEL_SIGNALS;
  const ownerPid = proc.pid ?? process.pid;

  const controller = new AbortController();
  let resources: CancellableResources = {};
  let cancelled = false;
  let disposed = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (disposed) return;

    if (!cancelled) {
      cancelled = true;
      controller.abort();
      // Non-zero from here on. Set now rather than at exit, so even a torn-down
      // process reports failure rather than a successful-looking 0.
      proc.exitCode = CANCELLED_EXIT_CODE;
      log.error(
        `\n${signal} received — cancelling capture.\n` +
          'Waiting for PresentMon to close its trace session and exit; the temporary capture and the ' +
          'capture lock are removed only once it has. Press Ctrl+C again to give up waiting.',
      );
      return;
    }

    // Asked twice.
    log.error('Second interrupt — abandoning the wait. PresentMon may still be running; if a later ' +
      'capture reports a stale session, it clears it automatically with --stop_existing_session.');
    const removed = cleanUpResources(resources, ownerPid, io);
    log.error(
      `Removed: ${[removed.removedTempDir && 'temporary capture', removed.removedLock && 'capture lock']
        .filter(Boolean)
        .join(', ') || 'nothing left to remove'}.`,
    );
    proc.exit(CANCELLED_EXIT_CODE);
  };

  // One bound listener per signal, kept so dispose() can remove exactly these.
  const listeners = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const listener = () => onSignal(signal);
    try {
      proc.on(signal, listener);
      listeners.set(signal, listener);
    } catch {
      // SIGBREAK exists only on Windows; asking for it elsewhere throws. A
      // platform that does not have a signal cannot deliver it either, so
      // skipping it is correct rather than merely tolerable.
    }
  }

  // The backstop. Synchronous work is the only kind that runs here, which is
  // why this removes files rather than waiting for a process.
  const onExit = () => {
    if (disposed) return;
    cleanUpResources(resources, ownerPid, io);
  };
  proc.on('exit', onExit);

  return {
    signal: controller.signal,
    get cancelled() {
      return cancelled;
    },
    track(next: CancellableResources) {
      resources = { ...resources, ...next };
    },
    simulateSignal(signal: NodeJS.Signals = 'SIGINT') {
      onSignal(signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Untracked deliberately: past this point the run owns its own cleanup
      // (or --keep-capture asked us to leave the files alone), and the exit
      // handler must not second-guess it.
      resources = {};
      for (const [signal, listener] of listeners) {
        (proc.off ?? proc.removeListener).call(proc, signal, listener);
      }
      (proc.off ?? proc.removeListener).call(proc, 'exit', onExit);
    },
  };
}
