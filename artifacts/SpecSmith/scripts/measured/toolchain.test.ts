import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// FIX 3: the collector runs through tsx, but tsx was present only as a
// transitive dependency of another workspace package. A fresh install could
// have left `pnpm collect:measured` failing with "command not found".
describe('collector toolchain is declared, not inherited by accident', () => {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('declares tsx as a direct devDependency of this package', () => {
    expect(pkg.devDependencies.tsx).toBeDefined();
  });

  // The workspace pins shared versions centrally; declaring a literal range
  // here would let this package drift from the rest of the monorepo.
  it('uses the workspace catalog rather than a private version range', () => {
    expect(pkg.devDependencies.tsx).toBe('catalog:');
  });

  it('the collect script actually invokes tsx', () => {
    expect(pkg.scripts['collect:measured']).toContain('tsx');
  });
});

// Windows smoke testing found that the repository could not be INSTALLED on
// the one platform the collector targets. The root preinstall guard ran
// `sh -c '...'`, and npm/pnpm execute lifecycle scripts through the platform
// shell — cmd.exe on Windows, since this repository sets neither
// `script-shell` nor pnpm's `shell-emulator`. `sh` is then looked up on PATH
// and is not there (Git for Windows ships one under `Git\bin`, which its
// installer does not normally add to PATH). So `pnpm install
// --frozen-lockfile` died at preinstall before fetching a single dependency,
// while scripts/measured refuses to run anywhere BUT Windows.
describe('the workspace can be installed on Windows, not just Unix', () => {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const preinstall = rootPkg.scripts.preinstall;

  it('still has a preinstall guard at all', () => {
    expect(preinstall).toBeTruthy();
  });

  // The actual regression. `sh`, and equally any other Unix-only shell, is
  // not resolvable from cmd.exe.
  it('does not invoke a Unix shell', () => {
    expect(preinstall).not.toMatch(/\bsh\b/);
    expect(preinstall).not.toMatch(/\bbash\b/);
    expect(preinstall).not.toMatch(/\bzsh\b/);
  });

  // Nor any other Unix-only builtin: `rm -f` is just as absent from cmd.exe
  // as `sh` is, so swapping the shell out but keeping the commands would have
  // moved the failure rather than fixed it.
  it('does not invoke Unix-only commands', () => {
    expect(preinstall).not.toMatch(/\brm\b/);
    expect(preinstall).not.toMatch(/\bcase\b/);
  });

  // Node is the one interpreter guaranteed present: npm and pnpm are Node
  // programs and put it on the script PATH.
  it('runs through node, which exists on every platform this supports', () => {
    expect(preinstall).toMatch(/^node\s/);
  });

  it('points at a script that actually exists', () => {
    const scriptPath = preinstall.replace(/^node\s+/, '').trim();
    expect(fs.existsSync(path.join(repoRoot, scriptPath))).toBe(true);
  });

  // preinstall runs BEFORE dependencies are installed, so anything imported
  // from node_modules would fail on a clean clone — the exact moment this
  // script matters most.
  it('imports only Node built-ins, since node_modules does not exist yet', () => {
    const scriptPath = preinstall.replace(/^node\s+/, '').trim();
    const source = fs.readFileSync(path.join(repoRoot, scriptPath), 'utf-8');
    const imports = [...source.matchAll(/^import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toMatch(/^node:/);
  });
});

// The guard's own logic, exercised directly rather than inferred from the
// package.json string above.
describe('the preinstall guard behaves the same as the shell version it replaced', () => {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const load = async () => await import(path.join(repoRoot, 'tools', 'preinstall.mjs'));

  it('accepts pnpm', async () => {
    const { isPnpmUserAgent } = await load();
    expect(isPnpmUserAgent('pnpm/10.33.0 npm/? node/v22.22.2 win32 x64')).toBe(true);
  });

  it.each([
    ['npm', 'npm/10.9.2 node/v22.22.2 win32 x64'],
    ['yarn', 'yarn/1.22.22 npm/? node/v22.22.2 win32 x64'],
    ['bun', 'bun/1.1.38 npm/? node/v22.22.2 win32 x64'],
  ])('rejects %s', async (_name, userAgent) => {
    const { isPnpmUserAgent } = await load();
    expect(isPnpmUserAgent(userAgent)).toBe(false);
  });

  // Not run by a package manager at all is not pnpm either, matching the
  // shell version's `case "" in pnpm/*)` falling through to the error.
  it('rejects a missing user agent rather than assuming pnpm', async () => {
    const { isPnpmUserAgent } = await load();
    expect(isPnpmUserAgent(undefined)).toBe(false);
    expect(isPnpmUserAgent('')).toBe(false);
  });

  // "pnpmfoo/1.0" must not pass a prefix check that forgot the slash.
  it('matches on the pnpm/ prefix, not a bare substring', async () => {
    const { isPnpmUserAgent } = await load();
    expect(isPnpmUserAgent('pnpmfoo/1.0.0')).toBe(false);
    expect(isPnpmUserAgent('npm/10.9.2 pnpm/10.33.0')).toBe(false);
  });

  it('exits non-zero and explains itself under the wrong package manager', async () => {
    const { runPreinstall } = await load();
    const errors: string[] = [];
    const code = runPreinstall({
      userAgent: 'npm/10.9.2',
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-')),
      log: { error: (m: string) => errors.push(m) },
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/pnpm/i);
  });

  it('exits zero under pnpm', async () => {
    const { runPreinstall } = await load();
    const code = runPreinstall({
      userAgent: 'pnpm/10.33.0',
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-')),
      log: { error: () => {} },
    });
    expect(code).toBe(0);
  });

  it('removes conflicting lockfiles, and tolerates their absence like rm -f', async () => {
    const { removeConflictingLockfiles } = await load();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(removeConflictingLockfiles(dir).sort()).toEqual(['package-lock.json', 'yarn.lock']);
    expect(fs.readdirSync(dir)).toEqual([]);
    // Second run: nothing there, and no throw.
    expect(removeConflictingLockfiles(dir)).toEqual([]);
  });

  // Order matters and is inherited from the shell version: a stray
  // package-lock.json is cleaned up even on the run that then refuses.
  it('clears lockfiles even when it is about to refuse the package manager', async () => {
    const { runPreinstall } = await load();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(runPreinstall({ userAgent: 'npm/10.9.2', repoRoot: dir, log: { error: () => {} } })).toBe(1);
    expect(fs.existsSync(path.join(dir, 'package-lock.json'))).toBe(false);
  });

  // pnpm-lock.yaml is the one this workspace lives by.
  it('never deletes the pnpm lockfile', async () => {
    const { CONFLICTING_LOCKFILES, removeConflictingLockfiles } = await load();
    expect(CONFLICTING_LOCKFILES).not.toContain('pnpm-lock.yaml');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preinstall-'));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
    removeConflictingLockfiles(dir);
    expect(fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))).toBe(true);
  });
});
