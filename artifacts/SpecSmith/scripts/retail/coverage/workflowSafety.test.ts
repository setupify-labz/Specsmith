import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Structural checks on the validation workflow.
//
// A workflow is the one file in this repository that can hand a credential to
// a process, and it is not covered by typecheck or by any other test. These
// assertions are deliberately about SHAPE — where the secret may appear, which
// events may start a secret-bearing job, what permissions the job holds — the
// same structural approach serverOnly.test.ts takes to the adapter.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'validate-rakuten-gpu-coverage.yml');

const yaml = fs.readFileSync(workflowPath, 'utf-8');
/** Workflow body with comment lines removed, so prose cannot satisfy a check. */
const body = yaml
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

const SECRET = 'RAKUTEN_API_ACCESS_TOKEN';
const secretExpr = `\${{ secrets.${SECRET} }}`;

describe('the validation workflow exists and is wired to the right events', () => {
  it('is a single workflow at the expected path', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const all = fs.readdirSync(path.join(repoRoot, '.github', 'workflows'));
    expect(all).toEqual(['validate-rakuten-gpu-coverage.yml']);
  });

  it('triggers on push to the implementation branch, scoped to the retail paths', () => {
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/rakuten-newegg-adapter-97h85y');
    expect(body).toContain('artifacts/SpecSmith/scripts/retail/**');
    expect(body).toContain('.github/workflows/validate-rakuten-gpu-coverage.yml');
  });

  it('offers workflow_dispatch for manual reruns', () => {
    expect(body).toContain('workflow_dispatch:');
  });

  it('has NO pull_request trigger — a fork PR must never hold this credential', () => {
    expect(/^\s*pull_request(_target)?:/m.test(body)).toBe(false);
  });

  it('has no schedule — this validates, it does not refresh prices', () => {
    expect(/^\s*schedule:/m.test(body)).toBe(false);
  });
});

describe('the workflow holds the least authority it can', () => {
  it('grants read-only repository permissions', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    for (const forbidden of ['contents: write', 'packages: write', 'id-token: write', 'permissions: write-all']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('checks out without persisting credentials', () => {
    expect(body).toContain('persist-credentials: false');
  });

  it('pins concurrency and a timeout', () => {
    expect(body).toMatch(/concurrency:/);
    expect(body).toMatch(/timeout-minutes:\s*10/);
  });

  it('checks out the exact triggering commit', () => {
    expect(body).toContain('ref: ${{ github.sha }}');
  });
});

describe('the secret is confined to one step and never becomes an argument', () => {
  it('references only this secret, and only as a step-scoped env value', () => {
    const references = [...body.matchAll(/\$\{\{\s*secrets\.[A-Z_]+\s*\}\}/g)].map((m) => m[0]);
    // Two steps legitimately need it: the presence preflight and the sweep.
    // Both must be the env-assignment form and no other secret may appear.
    expect(new Set(references)).toEqual(new Set([secretExpr]));
    expect(references.length).toBe(2);
    expect(body).toContain(`${SECRET}: ${secretExpr}`);
  });

  it('the preflight tests presence only — it never reads, prints or measures the value', () => {
    const preflight = body.slice(
      body.indexOf('Confirm the API credential is available'),
      body.indexOf('Run the full GPU coverage sweep'),
    );
    // `-z` is the whole interaction: is it empty, yes or no.
    expect(preflight).toContain('if [ -z "${RAKUTEN_API_ACCESS_TOKEN:-}" ]');
    // No length, no substring, no hashing, no echo of the variable itself.
    for (const forbidden of ['${#RAKUTEN', 'echo "$RAKUTEN', 'echo $RAKUTEN', 'wc -c', 'md5sum', 'sha256sum', 'cut -c']) {
      expect(preflight, forbidden).not.toContain(forbidden);
    }
    // It says what to fix, so a missing secret is self-diagnosing.
    expect(preflight).toContain('Repository secrets');
    expect(preflight).toContain('not a coverage result');
  });

  it('never places the secret in a command argument or a query parameter', () => {
    // Only INTERPOLATIONS matter. The preflight's help text names the secret
    // in prose so a missing one is self-diagnosing; naming it is not exposing
    // it, and the value never reaches that string.
    for (const line of body.split('\n')) {
      if (!line.includes('${{ secrets.')) continue;
      expect(line.trim(), line).toMatch(new RegExp(`^${SECRET}: \\$\\{\\{ secrets\\.${SECRET} \\}\\}$`));
    }
    // The shell variable is never expanded into a command, a flag or a URL.
    // `[ -z "${VAR:-}" ]` is the one permitted use: a presence test.
    const expansions = body
      .split('\n')
      .filter((l) => /\$\{?RAKUTEN_API_ACCESS_TOKEN/.test(l))
      .filter((l) => !l.includes('if [ -z "${RAKUTEN_API_ACCESS_TOKEN:-}" ]'));
    expect(expansions).toEqual([]);
    expect(body).not.toMatch(/--token|token=|access_token=/);
  });

  it('the reporting step does not receive the secret', () => {
    // Everything after the sweep step renders output; none of it needs the
    // credential, so none of it has it.
    const afterSweep = body.slice(body.indexOf('Validate gates and publish the report'));
    expect(afterSweep).not.toContain('secrets.');
    expect(afterSweep).not.toContain(SECRET);
  });

  it('uses no shell tracing and echoes no environment', () => {
    for (const forbidden of ['set -x', 'set -o xtrace', 'printenv', 'env |', 'echo $RAKUTEN', 'ACTIONS_STEP_DEBUG']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    // `set -euo pipefail` is required where output is piped or chained.
    expect(body).toContain('set -euo pipefail');
  });
});

describe('the workflow runs the whole sweep and cannot appear green when it fails', () => {
  it('runs the coverage CLI with no --limit and no --gpu filter', () => {
    expect(body).toContain('measure-coverage.ts --json');
    expect(body).not.toContain('--limit');
    expect(body).not.toContain('--gpu ');
  });

  it('asserts gates on structured JSON rather than regexes over rendered text', () => {
    expect(body).toContain('assert-coverage-gates.ts');
    expect(body).toContain('--report');
  });

  it('feeds the sweep exit code into the gate assertion', () => {
    // Captured rather than allowed to end the job, so the report still
    // explains WHY — then asserted, so it cannot be swallowed.
    expect(body).toContain('exit_code=');
    expect(body).toContain('--sweep-exit');
    expect(body).toContain("steps.sweep.outputs.exit_code || '1'");
  });

  it('runs tests and typecheck before spending an API call', () => {
    const sweepAt = body.indexOf('measure-coverage.ts');
    expect(body.indexOf('pnpm typecheck')).toBeLessThan(sweepAt);
    expect(body.indexOf('vitest run scripts/retail')).toBeLessThan(sweepAt);
  });
});

describe('the workflow writes nothing into the repository', () => {
  it('writes the report outside the checkout', () => {
    expect(body).toContain('"${RUNNER_TEMP}/coverage.json"');
    expect(body).not.toMatch(/>\s*\.?\/?(artifacts|src|public|scripts)\//);
  });

  it('verifies the working tree is unchanged', () => {
    expect(body).toContain('git status --porcelain');
  });

  it('uploads no artifact and commits nothing', () => {
    for (const forbidden of ['upload-artifact', 'git commit', 'git push', 'add-and-commit']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('reads the toolchain from the repository instead of inventing versions', () => {
    // pnpm/action-setup with no `version` reads packageManager from
    // package.json, so CI and local installs cannot drift.
    expect(body).toContain('pnpm/action-setup@v4');
    // No bare `version:` key anywhere — that key belongs to action-setup, and
    // pinning it there is exactly the drift this avoids. (`node-version:` is a
    // different key and is allowed.)
    expect(/^\s*version:/m.test(body), 'pnpm version must come from packageManager').toBe(false);
    expect(body).toContain('--frozen-lockfile');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});
