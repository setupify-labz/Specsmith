import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANCELLED_EXIT_CODE,
  DEFAULT_CANCEL_SIGNALS,
  cleanUpResources,
  installCancellationHandler,
  removeOwnLock,
} from './cancellation';

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..');
const harness = path.join(here, '__fixtures__', 'cancelHarness.ts');
const exitCodeHarness = path.join(here, '__fixtures__', 'collectExitCodeHarness.ts');
const internalCancelHarness = path.join(here, '__fixtures__', 'internalCancelHarness.ts');
const tsx = path.join(specsmithRoot, 'node_modules', '.bin', 'tsx');

// ---------------------------------------------------------------------------
// The CLI signal boundary — a real process, a real signal
// ---------------------------------------------------------------------------

interface HarnessRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  tempDir: string;
  lockPath: string;
  msFromSignalToExit: number;
}

/**
 * Spawns the harness, waits for READY, sends real signals, and reports what
 * happened.
 *
 * Everything here is deliberately un-mocked: an actual child process, actual
 * files on disk, and actual `kill` calls. The bug this covers was invisible to
 * in-process tests precisely because it was about whether the process is still
 * alive to run its own handlers.
 */
function runHarness(options: {
  signals?: NodeJS.Signals[];
  args?: string[];
  gapMs?: number;
} = {}): Promise<HarnessRun> {
  const signals = options.signals ?? ['SIGINT'];
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [harness, ...(options.args ?? [])], {
      cwd: specsmithRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let tempDir = '';
    let lockPath = '';
    let signalledAt = 0;
    let sent = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Harness never finished.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 20_000);

    child.stdout.on('data', async (chunk) => {
      stdout += String(chunk);
      const ready = stdout.match(/^READY (\S+) (\S+)$/m);
      if (ready && !sent) {
        sent = true;
        [, tempDir, lockPath] = ready;
        signalledAt = Date.now();
        for (const [index, signal] of signals.entries()) {
          if (index > 0) await new Promise((r) => setTimeout(r, options.gapMs ?? 30));
          child.kill(signal);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        tempDir,
        lockPath,
        msFromSignalToExit: Date.now() - signalledAt,
      });
    });
  });
}

describe('Ctrl+C at the real CLI boundary', () => {
  // THE regression. On Windows, `pnpm collect:measured` + Ctrl+C returned
  // straight to the prompt: no message, no cleanup, a live ETW session, a
  // stale lock file and an orphaned temp directory. The collector had a SIGINT
  // listener that only called controller.abort() and did nothing to keep the
  // process alive to act on it.
  it('survives the first signal instead of dying where it stands', async () => {
    const run = await runHarness({ args: ['--linger', '250'] });

    // If the process had died on the signal, neither marker would exist.
    expect(run.stdout).toContain('WAITING');
    expect(run.stdout).toContain('CHILD_EXIT_CONFIRMED');
  }, 30_000);

  it('says out loud that it is cancelling, and that it is waiting', async () => {
    const run = await runHarness({ args: ['--linger', '150'] });
    expect(run.stderr).toMatch(/cancelling capture/i);
    expect(run.stderr).toMatch(/waiting for presentmon/i);
    // The operator needs to know a second Ctrl+C is available, or they will
    // assume it has hung and kill the terminal.
    expect(run.stderr).toMatch(/again/i);
  }, 30_000);

  // "Only clean temporary files after the process is confirmed stopped."
  it('removes the temp capture and the lock, and only once it is done waiting', async () => {
    const run = await runHarness({ args: ['--linger', '250'] });
    expect(run.stdout.indexOf('WAITING')).toBeLessThan(run.stdout.indexOf('CHILD_EXIT_CONFIRMED'));
    expect(run.msFromSignalToExit).toBeGreaterThanOrEqual(200);
    expect(fs.existsSync(run.tempDir)).toBe(false);
    expect(fs.existsSync(run.lockPath)).toBe(false);
  }, 30_000);

  it('exits non-zero, so a cancelled run is never mistaken for a completed one', async () => {
    const run = await runHarness({ args: ['--linger', '100'] });
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
  }, 30_000);

  // The escape hatch: an operator who does not want to wait must not have to
  // reach for Task Manager, and must not be charged a leaked lock for it.
  it('gives up on the second signal, still cleaning up', async () => {
    const run = await runHarness({ signals: ['SIGINT', 'SIGINT'], args: ['--linger', '10000'], gapMs: 120 });
    expect(run.stderr).toMatch(/second interrupt/i);
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
    expect(fs.existsSync(run.tempDir)).toBe(false);
    expect(fs.existsSync(run.lockPath)).toBe(false);
    // It really did give up early rather than sitting out the full linger.
    expect(run.msFromSignalToExit).toBeLessThan(5_000);
  }, 30_000);

  // SIGTERM is what a supervisor or `taskkill` sends; it should be as orderly
  // as Ctrl+C rather than leaving the same debris behind.
  it('treats SIGTERM the same way', async () => {
    const run = await runHarness({ signals: ['SIGTERM'], args: ['--linger', '150'] });
    expect(run.stdout).toContain('CHILD_EXIT_CONFIRMED');
    expect(fs.existsSync(run.tempDir)).toBe(false);
    expect(fs.existsSync(run.lockPath)).toBe(false);
  }, 30_000);

  // The other half of the contract: a run that finished normally owns its own
  // files, and the last-resort exit cleanup must not reach in and delete them.
  // This is what --keep-capture depends on.
  it('leaves files alone when the run completed and disposed', async () => {
    const run = await runHarness({ args: ['--finish-immediately'] });
    expect(run.stdout).toContain('FINISHED_NORMALLY');
    expect(run.code).toBe(0);
    expect(fs.existsSync(run.tempDir)).toBe(true);
    expect(fs.existsSync(run.lockPath)).toBe(true);
    fs.rmSync(run.tempDir, { recursive: true, force: true });
    fs.rmSync(run.lockPath, { force: true });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// simulateSignal — cancellation triggered from INSIDE the process, no signal
// sent by anyone, ever
// ---------------------------------------------------------------------------

interface InternalCancelRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  tempDir: string;
  lockPath: string;
}

/**
 * Spawns internalCancelHarness.ts and waits for it to exit — nothing here
 * ever calls child.kill() with a signal. The harness cancels itself on its
 * own internal timer via cancellation.ts's simulateSignal, exactly as
 * collect.ts's --internal-cancel-after-seconds does. See
 * internalCancelHarness.ts's own header for why: a real Windows run found
 * that this test file's OWN runHarness (above) — sending a real OS signal —
 * cannot stand in for what a smoke-test LAUNCHER does to a collector it
 * spawns as an external process, because Node's child.kill() on Windows
 * does not deliver a catchable signal at all, unlike the real console
 * signals runHarness sends here.
 */
function runInternalCancelHarness(args: string[] = []): Promise<InternalCancelRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [internalCancelHarness, ...args], {
      cwd: specsmithRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let tempDir = '';
    let lockPath = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Harness never finished.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 20_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const ready = stdout.match(/^READY (\S+) (\S+)$/m);
      if (ready) [, tempDir, lockPath] = ready;
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, tempDir, lockPath });
    });
  });
}

describe('simulateSignal drives the identical real path a real signal does, with no signal at all', () => {
  it('produces the same cancellation message a real Ctrl+C produces', async () => {
    const run = await runInternalCancelHarness(['--cancel-after', '20', '--linger', '150']);
    expect(run.stderr).toMatch(/cancelling capture/i);
    expect(run.stderr).toMatch(/waiting for presentmon/i);
  }, 30_000);

  it('waits for confirmed exit before cleaning up, in the same order as a real signal', async () => {
    const run = await runInternalCancelHarness(['--cancel-after', '20', '--linger', '250']);
    expect(run.stdout.indexOf('WAITING')).toBeLessThan(run.stdout.indexOf('CHILD_EXIT_CONFIRMED'));
    expect(fs.existsSync(run.tempDir)).toBe(false);
    expect(fs.existsSync(run.lockPath)).toBe(false);
  }, 30_000);

  it('exits with CANCELLED_EXIT_CODE, having never been sent any signal at all', async () => {
    const run = await runInternalCancelHarness(['--cancel-after', '20', '--linger', '100']);
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
    // The property this fixture exists to prove: unlike every test above,
    // which sends a real signal and can therefore report one, this process
    // was NEVER signalled — its exit is not attributable to any signal.
    expect(run.signal).toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The top-level catch (collect.ts) — the exit code, not just the handler
// ---------------------------------------------------------------------------

/**
 * Runs collectExitCodeHarness.ts, signals it once READY, and reports its
 * real process exit code.
 *
 * Deliberately a second, narrower harness rather than reusing runHarness:
 * the defect this covers lives OUTSIDE installCancellationHandler, in
 * collect.ts's own `main().catch(...)`, which cancelHarness.ts does not have
 * and so cannot exercise.
 */
function runExitCodeHarness(lingerMs = 150): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [exitCodeHarness, '--linger', String(lingerMs)], {
      cwd: specsmithRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let sent = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Harness never finished.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 20_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (!sent && /^READY /m.test(stdout)) {
        sent = true;
        child.kill('SIGINT');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

describe('the top-level catch does not clobber a deliberate cancellation exit code', () => {
  // THE regression a real Windows retest of the cleanup fix then found:
  // cleanup was clean, but `$LASTEXITCODE` came back 1, not the documented
  // 130. cancellation.ts's onSignal sets exitCode 130 on the first signal;
  // collect.ts's real capture path then awaits a rejection (the runner's
  // CaptureCancelledError) that reaches a generic top-level
  // `.catch((e) => { ...; process.exitCode = 1; })`, which ran AFTER
  // cancellation.ts's assignment and overwrote it unconditionally.
  it('reports CANCELLED_EXIT_CODE, not a generic 1, once the rejection reaches the top-level catch', async () => {
    const run = await runExitCodeHarness(150);
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
  }, 30_000);

  it('still logs the rejection message on its way through', async () => {
    const run = await runExitCodeHarness(120);
    expect(run.stderr).toMatch(/cancelled\. waiting for presentmon to stop/i);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The real pnpm package-script boundary
// ---------------------------------------------------------------------------

/**
 * Runs a script THROUGH pnpm — the layer `pnpm collect:measured` actually
 * adds over a direct `tsx` invocation — and signals the whole process
 * group, not just the one child.
 *
 * Windows delivers Ctrl+C to every process attached to the console at once:
 * PowerShell, the pnpm wrapper, and the collector all get it simultaneously.
 * `child.kill(signal)` against a single spawned pnpm process does not
 * reproduce that — it only reaches pnpm, not whatever pnpm itself has
 * spawned. `detached: true` plus a negative pid targets the whole group, the
 * same as a console-wide Ctrl+C, which is the boundary the user's retest
 * found broken and a direct-tsx test structurally cannot reach.
 */
function runViaPnpm(
  pnpmArgs: readonly string[],
  lingerMs = 250,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; msFromSignalToExit: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', [...pnpmArgs, '--', '--linger', String(lingerMs)], {
      cwd: specsmithRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let sent = false;
    let signalledAt = 0;
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // Already gone.
      }
      reject(new Error(`pnpm harness never finished.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 20_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (!sent && /^READY /m.test(stdout)) {
        sent = true;
        signalledAt = Date.now();
        // The whole GROUP, matching console-wide Ctrl+C delivery — not just
        // the pnpm process this test spawned directly.
        try {
          process.kill(-child.pid!, 'SIGINT');
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, msFromSignalToExit: Date.now() - signalledAt });
    });
  });
}

describe('the real pnpm package-script boundary, not just a direct tsx subprocess', () => {
  // `pnpm collect:measured` interposes pnpm's own script-runner process
  // between the shell and the collector. A test that only spawns tsx
  // directly, as cancelHarness.ts's own tests do, never exercises that
  // wrapper — so it cannot see whether pnpm itself dies to the same
  // console-wide signal before the collector underneath it finishes.
  it('waits for the collector to finish before the pnpm wrapper exits, run via `pnpm run <script>`', async () => {
    const run = await runViaPnpm(['run', 'test:cancel-harness'], 250);
    expect(run.stdout.indexOf('WAITING')).toBeGreaterThanOrEqual(0);
    expect(run.stdout.indexOf('CHILD_EXIT_CONFIRMED')).toBeGreaterThan(run.stdout.indexOf('WAITING'));
    // Not merely fast — actually waited out the collector's own linger,
    // rather than the pnpm wrapper dying to the same signal immediately.
    expect(run.msFromSignalToExit).toBeGreaterThanOrEqual(200);
  }, 30_000);

  // `pnpm <script>` (no `run`) is the shorthand the documented command,
  // `pnpm collect:measured`, actually uses. Covered separately from `pnpm
  // run` because pnpm resolves the two through slightly different code
  // paths, and the shorthand is the one operators actually type.
  it('waits for the collector to finish before the pnpm wrapper exits, run via the `pnpm <script>` shorthand', async () => {
    const run = await runViaPnpm(['test:cancel-harness'], 250);
    expect(run.stdout).toContain('CHILD_EXIT_CONFIRMED');
    expect(run.msFromSignalToExit).toBeGreaterThanOrEqual(200);
  }, 30_000);

  // The residues a leaked ETW session, lock file and temp directory would
  // leave behind — the exact symptom the earlier Windows report described —
  // must still be gone once pnpm's own wrapper process has exited, not just
  // once the collector's own process has.
  it('leaves no lock file or temp directory once the pnpm wrapper itself has exited', async () => {
    const run = await runViaPnpm(['run', 'test:cancel-harness'], 200);
    const ready = run.stdout.match(/^READY (\S+) (\S+)$/m);
    expect(ready).not.toBeNull();
    const [, tempDir, lockPath] = ready!;
    expect(fs.existsSync(tempDir)).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(false);
  }, 30_000);

  // The exit code a real shell prompt sees, at the ACTUAL boundary rather
  // than at the collector's own process. pnpm's own process is hit by the
  // same console-wide signal here, so this is what the operator's shell
  // reports, not an internal detail of the collector alone.
  it('reports the wrapper as stopped by the same signal the operator sent', async () => {
    const run = await runViaPnpm(['run', 'test:cancel-harness'], 150);
    expect(run.signal).toBe('SIGINT');
  }, 30_000);

  // Documents why the README tells operators to run `pnpm collect:measured`
  // and never `pnpm exec tsx ...`: unlike a package SCRIPT, `pnpm exec` has
  // no lifecycle wrapper of its own to survive the signal long enough to
  // wait on its child, and dies almost immediately — reproducing, on this
  // platform, the exact "returned to the prompt before cleanup" failure
  // mode the Windows report described.
  it('`pnpm exec` does NOT wait for the collector — this is why it must not be used for cancellation-sensitive runs', async () => {
    const run = await runViaPnpm(['exec', 'tsx', path.relative(specsmithRoot, harness)], 500);
    // pnpm exec's own process dies to the group signal before the 500ms
    // linger elapses; the collector underneath may still be cleaning up.
    expect(run.msFromSignalToExit).toBeLessThan(400);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused lifecycle behaviour
// ---------------------------------------------------------------------------

/** A process double, so the handler can be driven without real signals. */
function fakeProc() {
  const listeners = new Map<string, Array<() => void>>();
  const exits: number[] = [];
  return {
    pid: 4242,
    exitCode: undefined as number | undefined,
    exits,
    listenerCount: (event: string) => (listeners.get(event) ?? []).length,
    on(event: string, listener: () => void) {
      if (event === 'SIGBREAK') throw new Error('Unknown signal: SIGBREAK');
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    off(event: string, listener: () => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
      return this;
    },
    removeListener(event: string, listener: () => void) {
      return this.off(event, listener);
    },
    exit(code: number) {
      exits.push(code);
    },
    emit(event: string) {
      for (const l of [...(listeners.get(event) ?? [])]) l();
    },
  };
}

function tempResources() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-unit-'));
  fs.writeFileSync(path.join(dir, 'capture.csv'), 'x');
  const lockPath = path.join(dir, '..', `cancel-unit-${Date.now()}-${Math.random().toString(16).slice(2)}.lock`);
  return { dir, lockPath };
}

describe('the cancellation lifecycle', () => {
  it('aborts and marks the run cancelled on the first signal, without exiting', () => {
    const proc = fakeProc();
    const controller = installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    expect(controller.cancelled).toBe(false);

    proc.emit('SIGINT');

    expect(controller.cancelled).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // The whole point: the first signal must NOT end the process.
    expect(proc.exits).toEqual([]);
    expect(proc.exitCode).toBe(CANCELLED_EXIT_CODE);
  });

  it('exits on the second signal', () => {
    const proc = fakeProc();
    installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    proc.emit('SIGINT');
    proc.emit('SIGINT');
    expect(proc.exits).toEqual([CANCELLED_EXIT_CODE]);
  });

  // SIGBREAK is Windows' Ctrl+Break and does not exist elsewhere; asking for it
  // on Linux throws. A missing signal cannot be delivered either, so skipping
  // it is correct rather than merely tolerable — but it must not take the other
  // handlers down with it.
  it('still registers the signals a platform does have when one is unavailable', () => {
    const proc = fakeProc(); // throws for SIGBREAK, like Linux
    expect(() => installCancellationHandler({ proc: proc as never, log: { error: () => {} } })).not.toThrow();
    expect(proc.listenerCount('SIGINT')).toBe(1);
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    expect(proc.listenerCount('SIGBREAK')).toBe(0);
  });

  it('catches Ctrl+C, Ctrl+Break and SIGTERM', () => {
    expect(DEFAULT_CANCEL_SIGNALS).toContain('SIGINT');
    expect(DEFAULT_CANCEL_SIGNALS).toContain('SIGTERM');
    expect(DEFAULT_CANCEL_SIGNALS).toContain('SIGBREAK');
  });

  it('removes every listener it added on dispose', () => {
    const proc = fakeProc();
    const controller = installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    expect(proc.listenerCount('SIGINT')).toBe(1);
    expect(proc.listenerCount('exit')).toBe(1);
    controller.dispose();
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('exit')).toBe(0);
  });

  it('ignores a signal that arrives after dispose', () => {
    const proc = fakeProc();
    const controller = installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    const listener = proc as unknown as { emit(e: string): void };
    controller.dispose();
    listener.emit('SIGINT'); // no listeners left, but be explicit about the intent
    expect(controller.cancelled).toBe(false);
    expect(proc.exits).toEqual([]);
  });

  it('cleans tracked resources at exit however the process got there', () => {
    const proc = fakeProc();
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: proc.pid }));
    const controller = installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    controller.track({ ownedTempDir: dir, lockPath });

    proc.emit('exit');

    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('stops tracking on dispose, so a completed run keeps its files', () => {
    const proc = fakeProc();
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: proc.pid }));
    const controller = installCancellationHandler({ proc: proc as never, log: { error: () => {} } });
    controller.track({ ownedTempDir: dir, lockPath });
    controller.dispose();

    proc.emit('exit');

    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(lockPath, { force: true });
  });
});

describe('the lock is only ever removed by the process that owns it', () => {
  // The race this closes: by the time an exit handler runs, our capture may
  // have finished and released the lock, and a SECOND capture may already hold
  // it. Deleting blindly would strip a live capture of its lock and let a third
  // start alongside it — the exact collision the lock exists to prevent.
  it('refuses to delete a lock held by a different pid', () => {
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999_999 }));
    expect(removeOwnLock(lockPath, 4242)).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(lockPath, { force: true });
  });

  it('deletes its own lock', () => {
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 4242 }));
    expect(removeOwnLock(lockPath, 4242)).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats an unreadable lock as not ours rather than throwing', () => {
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, 'not json');
    expect(removeOwnLock(lockPath, 4242)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(lockPath, { force: true });
  });

  it('is a no-op when there is no lock file', () => {
    expect(removeOwnLock(path.join(os.tmpdir(), 'definitely-not-here.lock'), 4242)).toBe(false);
  });

  it('never throws out of cleanup, whatever the filesystem says', () => {
    expect(() =>
      cleanUpResources({ ownedTempDir: '/proc/1/definitely-not-removable', lockPath: '/proc/1/nope' }, 4242),
    ).not.toThrow();
  });

  it('reports what it actually removed', () => {
    const { dir, lockPath } = tempResources();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 4242 }));
    expect(cleanUpResources({ ownedTempDir: dir, lockPath }, 4242)).toEqual({
      removedTempDir: true,
      removedLock: true,
    });
  });
});
