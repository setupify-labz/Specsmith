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
