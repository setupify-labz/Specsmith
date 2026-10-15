import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = new URL('.', import.meta.url).pathname;
const yaml = readFileSync(join(source, 'auto-goal-actions.yml'), 'utf8');
const validationStep = yaml.match(/      - name: Refuse out-of-scope changes before publishing\n        working-directory: work\n        shell: bash\n        run: \|\n([\s\S]*?)(?=      - name: )/)?.[1];
assert.ok(validationStep, 'publisher validation step exists');
const script = validationStep.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
const allowed = 'artifacts/SpecSmith/src/components/PartSelector.tsx';
const other = 'artifacts/SpecSmith/src/components/Other.tsx';
const link = 'artifacts/SpecSmith/src/components/Link.tsx';
const criterion = 'artifacts/SpecSmith/src/components/PartSelector.test.tsx';

function run(cmd, args, cwd, env = {}) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

// The publish job's layout: trusted/ is the executor commit (the validator runs from there), work/ is
// the dispatch base the patch applies to (PILOT_HANDOFF_CONTRACT.md §1A.4 change 12).
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'specsmith-boundary-'));
  const dir = join(root, 'work');
  for (const path of [allowed, other, link, criterion]) mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, allowed), 'export const value = 1;\n');
  writeFileSync(join(dir, other), 'export const other = 1;\n');
  writeFileSync(join(dir, criterion), 'export {};\n');
  symlinkSync('PartSelector.tsx', join(dir, link));
  mkdirSync(join(root, 'trusted/docs/auto-goal-actions'), { recursive: true });
  cpSync(join(source, 'validate-proposal.mjs'), join(root, 'trusted/docs/auto-goal-actions/validate-proposal.mjs'));
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']]) {
    const result = run('git', args, dir);
    assert.equal(result.status, 0, result.stderr);
  }
  const temp = join(root, 'temp');
  mkdirSync(join(temp, 'diff'), { recursive: true });
  const base = run('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  return { dir, temp, base, patch: join(temp, 'diff/proposal.patch'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function validate(f, phase = 'implement', base = f.base) {
  const TASK_JSON = JSON.stringify({ phase, base_sha: base, criterion_file: criterion });
  return run('bash', ['-c', script], f.dir, { RUNNER_TEMP: f.temp, TASK_JSON, GH_TOKEN: 'DISPOSABLE_SENTINEL_NO_REAL_CREDENTIAL' });
}

test('publisher gate accepts a regular edit and binds the committed change to the patch', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, allowed), 'export const value = 2;\n');
    const diff = run('git', ['diff', '--', allowed], f.dir);
    assert.equal(diff.status, 0);
    writeFileSync(f.patch, diff.stdout);
    assert.equal(run('git', ['checkout', '--', allowed], f.dir).status, 0);
    const result = validate(f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run('git', ['apply', f.patch], f.dir).status, 0);
    assert.equal(run('git', ['add', '--', allowed], f.dir).status, 0);
    assert.equal(run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'proposal'], f.dir).status, 0);
    const committed = run('git', ['show', '--format=', '--', allowed], f.dir);
    assert.equal(committed.stdout, diff.stdout);
    assert.equal(readFileSync(join(f.dir, allowed), 'utf8'), 'export const value = 2;\n');
  } finally { f.cleanup(); }
});

test('publisher gate refuses a symlink and a shifted per-file index before applying anything', () => {
  const f = fixture();
  try {
    const first = `diff --git a/${link} b/${link}\n--- a/${link}\n+++ b/${link}\n@@ -1 +1 @@\n-PartSelector.tsx\n+Other.tsx\n`;
    const second = `diff --git a/${other} b/${other}\nindex 1111111..2222222 100644\nindex 1111111..2222222 100644\n--- a/${other}\n+++ b/${other}\n@@ -1 +1 @@\n-export const other = 1;\n+export const other = 2;\n`;
    writeFileSync(f.patch, first + second);
    assert.notEqual(validate(f).status, 0);
    writeFileSync(f.patch, `diff --git a/${link} b/${link}\nindex 1111111..2222222 100644\n--- a/${link}\n+++ b/${link}\n@@ -1 +1 @@\n-PartSelector.tsx\n+Other.tsx\n`);
    assert.notEqual(validate(f).status, 0);
    assert.equal(run('git', ['diff', '--exit-code'], f.dir).status, 0);
    assert.equal(readFileSync(join(f.dir, link), 'utf8'), 'export const value = 1;\n');
  } finally { f.cleanup(); }
});

test('publisher gate refuses a path outside the source allowlist', () => {
  const f = fixture();
  try {
    writeFileSync(f.patch, 'diff --git a/.github/workflows/verify.yml b/.github/workflows/verify.yml\nindex 1111111..2222222 100644\n--- a/.github/workflows/verify.yml\n+++ b/.github/workflows/verify.yml\n@@ -1 +1 @@\n-old\n+new\n');
    assert.notEqual(validate(f).status, 0);
  } finally { f.cleanup(); }
});

test('publisher gate applies the version 1 phase rules and refuses a checkout that is not the dispatch base', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, criterion), 'export const failing = true;\n');
    const testOnly = run('git', ['diff', '--', criterion], f.dir).stdout;
    assert.equal(run('git', ['checkout', '--', criterion], f.dir).status, 0);
    writeFileSync(join(f.dir, allowed), 'export const value = 2;\n');
    const sourceOnly = run('git', ['diff', '--', allowed], f.dir).stdout;
    assert.equal(run('git', ['checkout', '--', allowed], f.dir).status, 0);
    writeFileSync(f.patch, testOnly);
    assert.equal(validate(f, 'reproduce').status, 0, 'reproduce may change only the acceptance test');
    assert.notEqual(validate(f, 'implement').status, 0, 'implement may not change the acceptance test');
    writeFileSync(f.patch, sourceOnly);
    assert.notEqual(validate(f, 'reproduce').status, 0, 'reproduce may not change application source');
    assert.equal(validate(f, 'implement').status, 0);
    assert.notEqual(validate(f, 'implement', 'f'.repeat(40)).status, 0, 'the checkout must be the dispatch base');
    assert.equal(run('git', ['diff', '--exit-code'], f.dir).status, 0);
  } finally { f.cleanup(); }
});
