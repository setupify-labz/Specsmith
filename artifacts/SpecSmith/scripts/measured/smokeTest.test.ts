import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkDependencies,
  checkPresentMon,
  checkResidues,
  detectGameProcess,
  formatReport,
  queryEtwSessionActive,
  resolveTsxImportUrl,
  runCancellationSmokeTest,
  runDirect,
  summarize,
  type CheckResult,
} from './smokeTest';
import { CANCELLED_EXIT_CODE } from './cancellation';
import { AmbiguousProcessError, type RunningProcess } from './presentmonRunner';

const here = path.dirname(fileURLToPath(import.meta.url));
const specsmithRoot = path.join(here, '..', '..');
const harness = path.join(here, '__fixtures__', 'cancelHarness.ts');
const internalCancelHarness = path.join(here, '__fixtures__', 'internalCancelHarness.ts');

// ---------------------------------------------------------------------------
// The report — pure, so no real machine needed
// ---------------------------------------------------------------------------

describe('summarize', () => {
  it('is PASS with no failures, even with skips', () => {
    const results: CheckResult[] = [
      { name: 'a', status: 'pass', detail: '' },
      { name: 'b', status: 'skip', detail: '' },
    ];
    expect(summarize(results)).toEqual({ passed: 1, failed: 0, skipped: 1, overall: 'PASS' });
  });

  it('is FAIL if anything failed, regardless of how much passed', () => {
    const results: CheckResult[] = [
      { name: 'a', status: 'pass', detail: '' },
      { name: 'b', status: 'pass', detail: '' },
      { name: 'c', status: 'fail', detail: 'broke' },
    ];
    expect(summarize(results).overall).toBe('FAIL');
  });
});

describe('formatReport', () => {
  it('includes every result and the overall verdict', () => {
    const report = formatReport([
      { name: 'Thing one', status: 'pass', detail: 'ok' },
      { name: 'Thing two', status: 'fail', detail: 'broken: reason' },
    ]);
    expect(report).toContain('[PASS] Thing one');
    expect(report).toContain('[FAIL] Thing two  broken: reason');
    expect(report).toMatch(/1 passed, 1 failed, 0 skipped — FAIL/);
  });
});

// ---------------------------------------------------------------------------
// The direct-spawn primitive — proves the "no pnpm in the middle" claim
// ---------------------------------------------------------------------------

describe('the direct-spawn primitive', () => {
  // This is the property the whole launcher depends on: a script spawned
  // directly (no pnpm) is waited on until it exits ON ITS OWN and reports
  // its OWN real exit code — no signal is ever sent to it by this function.
  // See internalCancelHarness.ts and 'self-cancellation without any signal'
  // below for the property that replaced signal-based cancellation testing.
  it('waits for a self-cancelling child and reports its real exit code, with no signal ever sent to it', async () => {
    const run = await runDirect(internalCancelHarness, ['--cancel-after', '20', '--linger', '150'], { timeoutMs: 10_000 });
    expect(run.stdout).toContain('WAITING');
    expect(run.stdout).toContain('CHILD_EXIT_CONFIRMED');
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
    // The defining property: this process was never sent a signal by
    // anything, including this test — it cancelled itself.
    expect(run.signal).toBeNull();
  }, 30_000);

  it('reports a normal exit code when nothing was signalled', async () => {
    const run = await runDirect(harness, ['--finish-immediately']);
    expect(run.stdout).toContain('FINISHED_NORMALLY');
    expect(run.code).toBe(0);
  }, 30_000);

  // THE regression a real Windows run of the launcher then found: `node
  // --import tsx` resolves the bare "tsx" specifier relative to the SPAWNED
  // PROCESS's own cwd, not relative to this repository. windows-smoke-test.ps1
  // was invoked from an unrelated worktree directory and failed with
  // ERR_MODULE_NOT_FOUND before the collector ever ran. runDirect always sets
  // the child's cwd to specsmithRoot, which happens to paper over this in
  // every OTHER test in this file — this is the one test that deliberately
  // does NOT rely on that, to prove tsx resolves even when it can't.
  it('resolves tsx correctly even when the spawned process’s own cwd is nothing to do with this repo', async () => {
    const run = await runDirect(harness, ['--finish-immediately'], { cwd: os.tmpdir() });
    expect(run.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(run.stdout).toContain('FINISHED_NORMALLY');
    expect(run.code).toBe(0);
  }, 30_000);

  // The other half: launching from the repository root itself must keep
  // working exactly as before — this is what every other test here already
  // covers implicitly, made explicit so a future change can't fix the
  // unrelated-directory case while quietly breaking the common one.
  it('still resolves tsx when launched from the repository root', async () => {
    const run = await runDirect(harness, ['--finish-immediately'], { cwd: specsmithRoot });
    expect(run.stdout).toContain('FINISHED_NORMALLY');
    expect(run.code).toBe(0);
  }, 30_000);
});

describe('resolveTsxImportUrl', () => {
  it('returns a file:// URL, not a bare specifier or an OS path', () => {
    const url = resolveTsxImportUrl(specsmithRoot);
    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain('/node_modules/tsx/dist/loader.mjs');
  });

  it('is unaffected by the process’s own current working directory', () => {
    const before = resolveTsxImportUrl(specsmithRoot);
    const originalCwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
      expect(resolveTsxImportUrl(specsmithRoot)).toBe(before);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('fails with a clear, actionable message rather than letting node produce ERR_MODULE_NOT_FOUND', () => {
    expect(() => resolveTsxImportUrl('/definitely/not/a/real/repo', () => false)).toThrow(
      /tsx's loader was not found.*pnpm install --frozen-lockfile/s,
    );
  });
});

// ---------------------------------------------------------------------------
// Dependency validation
// ---------------------------------------------------------------------------

describe('checkDependencies', () => {
  it('passes platform, node and tsx checks when everything is present', () => {
    const results = checkDependencies({
      platform: 'win32',
      nodeVersion: 'v20.11.0',
      existsSync: () => true,
      runPnpmVersion: () => '10.33.0',
    });
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails platform off Windows, without throwing', () => {
    const results = checkDependencies({ platform: 'linux', nodeVersion: 'v20.11.0', existsSync: () => true });
    const platformCheck = results.find((r) => r.name === 'Platform');
    expect(platformCheck?.status).toBe('fail');
  });

  it('fails when tsx has not been installed', () => {
    const results = checkDependencies({ platform: 'win32', nodeVersion: 'v20.11.0', existsSync: () => false });
    const tsxCheck = results.find((r) => r.name === 'tsx installed');
    expect(tsxCheck?.status).toBe('fail');
    expect(tsxCheck?.detail).toMatch(/pnpm install/);
  });

  it('fails on a too-old Node version', () => {
    const results = checkDependencies({ platform: 'win32', nodeVersion: 'v16.0.0', existsSync: () => true });
    expect(results.find((r) => r.name === 'Node.js')?.status).toBe('fail');
  });

  // A real Windows run reported this check as a hard failure (ENOENT) even
  // though `pnpm install` worked fine from an actual shell on that machine —
  // caused by execFileSync('pnpm', ...) with no `shell: true`, which does not
  // perform the PATHEXT resolution pnpm's Windows entry point (pnpm.cmd)
  // needs. Two things had to change: the detection itself (fixed at the
  // call site in main() — this suite covers checkDependencies's own
  // handling of whatever runPnpmVersion reports), and the SEVERITY: pnpm
  // is not required by this launcher at all, so its absence must never
  // fail the whole run.
  it('never fails the run over pnpm — it is informational only, not required by this direct launcher', () => {
    const missing = checkDependencies({
      platform: 'win32',
      nodeVersion: 'v20.11.0',
      existsSync: () => true,
      runPnpmVersion: () => {
        throw new Error('ENOENT');
      },
    });
    const pnpmCheck = missing.find((r) => r.name.startsWith('pnpm'));
    expect(pnpmCheck?.status).toBe('skip');
    expect(pnpmCheck?.status).not.toBe('fail');
    expect(pnpmCheck?.detail).toMatch(/not required by this launcher/);
  });

  it('reports the version when pnpm IS found', () => {
    const results = checkDependencies({
      platform: 'win32',
      nodeVersion: 'v20.11.0',
      existsSync: () => true,
      runPnpmVersion: () => '10.33.0',
    });
    const pnpmCheck = results.find((r) => r.name.startsWith('pnpm'));
    expect(pnpmCheck?.status).toBe('pass');
    expect(pnpmCheck?.detail).toBe('10.33.0');
  });

  it('is skipped entirely (not even attempted) when no pnpm probe is provided', () => {
    const results = checkDependencies({ platform: 'win32', nodeVersion: 'v20.11.0', existsSync: () => true });
    expect(results.find((r) => r.name.startsWith('pnpm'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PresentMon: locate and hash — reuses resolvePresentMonBinary directly
// ---------------------------------------------------------------------------

describe('checkPresentMon', () => {
  const fakeFs = {
    existsSync: () => true,
    statSync: () => ({ isFile: () => true, size: 1024 }),
    readFileSync: () => Buffer.from('fake presentmon bytes'),
  };

  it('passes and reports the digest for a correctly pinned binary', () => {
    const sha256 = createHash('sha256').update('fake presentmon bytes').digest('hex');
    const { result, binary } = checkPresentMon(
      { executablePath: 'C:\\tools\\PresentMon.exe', expectedSha256: sha256 },
      fakeFs,
    );
    expect(result.status).toBe('pass');
    expect(binary?.pinned).toBe(true);
  });

  it('fails with the refusal message when nothing is configured', () => {
    const { result, binary } = checkPresentMon({}, fakeFs);
    expect(result.status).toBe('fail');
    expect(binary).toBeUndefined();
    expect(result.detail).toMatch(/No PresentMon executable is configured/);
  });
});

// ---------------------------------------------------------------------------
// Game process detection — pauses only when it genuinely cannot resolve one
// ---------------------------------------------------------------------------

describe('detectGameProcess', () => {
  it('resolves immediately when the process is already running', async () => {
    const running: RunningProcess[] = [{ processId: 4242, name: 'game.exe' }];
    const { result, target } = await detectGameProcess(
      { processName: 'game.exe' },
      { listProcesses: () => running, pause: vi.fn() },
    );
    expect(result.status).toBe('pass');
    expect(target?.processId).toBe(4242);
  });

  it('pauses and retries until the process appears, rather than failing immediately', async () => {
    let calls = 0;
    const pause = vi.fn(async () => {
      calls += 1;
    });
    const listProcesses = () => (calls >= 2 ? [{ processId: 99, name: 'game.exe' }] : []);
    const { result, target } = await detectGameProcess(
      { processName: 'game.exe' },
      { listProcesses, pause, maxAttempts: 5 },
    );
    expect(pause).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('pass');
    expect(target?.processId).toBe(99);
  });

  it('fails after exhausting its attempts rather than pausing forever', async () => {
    const pause = vi.fn(async () => {});
    const { result, target } = await detectGameProcess(
      { processName: 'never-running.exe' },
      { listProcesses: () => [], pause, maxAttempts: 3 },
    );
    expect(result.status).toBe('fail');
    expect(target).toBeUndefined();
    // Paused between attempts, but not after the last one.
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('surfaces ambiguity the same way selectTargetProcess already does, not a generic message', async () => {
    const running: RunningProcess[] = [
      { processId: 1, name: 'game.exe' },
      { processId: 2, name: 'game.exe' },
    ];
    const { result } = await detectGameProcess(
      { processName: 'game.exe' },
      { listProcesses: () => running, pause: vi.fn(), maxAttempts: 1 },
    );
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/2 running processes are named/);
  });
});

// ---------------------------------------------------------------------------
// Residues
// ---------------------------------------------------------------------------

describe('checkResidues', () => {
  it('passes all four when nothing was left behind', () => {
    const results = checkResidues({
      existsSync: () => false,
      readdirSync: () => ['unrelated-file'],
      listProcesses: () => [],
      queryEtwSession: () => false,
    });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails the lock-file check when one is still present', () => {
    const results = checkResidues({ existsSync: () => true, readdirSync: () => [], listProcesses: () => [] });
    expect(results.find((r) => r.name === 'No lock file')?.status).toBe('fail');
  });

  it('fails the orphaned-directory check for a leftover specsmith-capture-* dir, and ignores unrelated entries', () => {
    const results = checkResidues({
      existsSync: () => false,
      readdirSync: () => ['specsmith-capture-abc123', 'some-other-app-tmp'],
      listProcesses: () => [],
    });
    const check = results.find((r) => r.name === 'No orphaned temp directory');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('specsmith-capture-abc123');
    expect(check?.detail).not.toContain('some-other-app-tmp');
  });

  it('fails the process check when PresentMon is still running', () => {
    const results = checkResidues({
      existsSync: () => false,
      readdirSync: () => [],
      listProcesses: () => [{ processId: 55, name: 'PresentMon.exe' }],
    });
    expect(results.find((r) => r.name === 'No PresentMon process')?.status).toBe('fail');
  });

  it('skips the ETW check rather than failing when logman is unavailable (off Windows)', () => {
    const results = checkResidues({ existsSync: () => false, readdirSync: () => [], listProcesses: () => [] });
    expect(results.find((r) => r.name === 'No leaked ETW session')?.status).toBe('skip');
  });

  it('fails the ETW check when the session is still active', () => {
    const results = checkResidues({
      existsSync: () => false,
      readdirSync: () => [],
      listProcesses: () => [],
      queryEtwSession: () => true,
    });
    expect(results.find((r) => r.name === 'No leaked ETW session')?.status).toBe('fail');
  });
});

describe('queryEtwSessionActive', () => {
  it('reports active when the query succeeds', () => {
    expect(queryEtwSessionActive('SpecSmithMeasuredCapture', () => {})).toBe(true);
  });

  it('reports inactive when the query fails — the expected, "not found" case', () => {
    expect(
      queryEtwSessionActive('SpecSmithMeasuredCapture', () => {
        throw new Error('not found');
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The cancellation smoke test itself — the actual point of this launcher
// ---------------------------------------------------------------------------

describe('runCancellationSmokeTest', () => {
  // internalCancelHarness.ts stands in for collect.ts's own
  // --internal-cancel-after-seconds path: cancellation is triggered from
  // INSIDE the spawned process on its own timer, never by a signal this
  // function — or anything else — sends it. collect.ts itself cannot be
  // driven this way off Windows (it probes real hardware first), which is
  // why this fixture exists at all; see its own header comment.
  it('passes when the self-cancelling child reports CANCELLED_EXIT_CODE, with no signal ever sent to it', async () => {
    const { result, run } = await runCancellationSmokeTest(internalCancelHarness, {
      args: ['--cancel-after', '20', '--linger', '150'],
      timeoutMs: 10_000,
    });
    expect(run.code).toBe(CANCELLED_EXIT_CODE);
    // THE regression this guards: a signal-based approach would report a
    // signal name here (as cancelHarness.ts's real-signal tests do in
    // cancellation.test.ts). This process was never signalled at all.
    expect(run.signal).toBeNull();
    expect(result.status).toBe('pass');
    expect(result.detail).toMatch(/self-cancelled internally/);
    expect(result.detail).not.toMatch(/simulat(e|ed|ing) Ctrl-C/i);
  }, 30_000);

  it('fails when the child does not exit with the expected code', async () => {
    const { result } = await runCancellationSmokeTest(harness, {
      args: ['--finish-immediately'],
    });
    expect(result.status).toBe('fail');
  }, 30_000);
});
