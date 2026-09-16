import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACCESS_TOKEN_ENV_VAR } from '../rakuten/types';
import {
  CLIENT_ID_ENV_VAR,
  CLIENT_SECRET_ENV_VAR,
  PUBLISHER_SID_ENV_VAR,
} from '../rakuten/accessTokenRequest';

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

/**
 * The three long-lived credentials, stored as GitHub Actions secrets and
 * exchanged for a short-lived access token at the start of every run.
 *
 * Names come from accessTokenRequest.ts rather than string literals, so
 * renaming a constant breaks this test instead of silently producing an unset
 * variable and a sweep that looks like an authentication failure.
 */
const CREDENTIAL_SECRETS = [CLIENT_ID_ENV_VAR, CLIENT_SECRET_ENV_VAR, PUBLISHER_SID_ENV_VAR];
/** The variable the adapter reads. Produced by the token exchange, never stored. */
const ENV_VAR = ACCESS_TOKEN_ENV_VAR;
const mappingFor = (name: string) => `${name}: \${{ secrets.${name} }}`;
/** The temporary secret from the previous approach. Must no longer be referenced. */
const RETIRED_SECRET = 'RAKUTEN_API_KEY';

describe('the validation workflow exists and is wired to the right events', () => {
  it('inventories every workflow, with every credential-bearing workflow accounted for', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const dir = path.join(repoRoot, '.github', 'workflows');
    const all = fs.readdirSync(dir).sort();
    expect(all).toEqual([
      'audit-accepted-offers.yml',
      'audit-retailer-links.yml',
      'build-retail-affiliate-catalog.yml',
      'content-e2e-offline.yml',
      'elevenlabs-voice-sample.yml',
      'measured-tests-ci.yml',
      'newegg-paging-preflight.yml',
      'refresh-retail-prices.yml',
      'validate-rakuten-gpu-coverage.yml',
      'validate-retail-snapshot.yml',
      'verify-pr.yml',
    ]);

    // EXACTLY ONE workflow may write to the repository, and it is the price
    // refresh. Every other one stays read-only, so the write permission is
    // confined to a single reviewable file rather than spreading quietly.
    const writers = all.filter((name) =>
      fs
        .readFileSync(path.join(dir, name), 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
        .includes('contents: write'),
    );
    expect(writers).toEqual(['refresh-retail-prices.yml']);

    const other = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'validate-retail-snapshot.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(other).not.toContain('secrets.');

    const linkAudit = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'audit-retailer-links.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(linkAudit).not.toContain('secrets.');

    const contentE2eOffline = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'content-e2e-offline.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(contentE2eOffline).not.toContain('secrets.');

    const measuredTestsCi = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'measured-tests-ci.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(measuredTestsCi).not.toContain('secrets.');

    // The generic PR gate is deliberately credential-free. It may run on a
    // pull_request because it cannot read repository secrets, cannot write the
    // repository, and checkout never persists a credential.
    const verifyPr = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'verify-pr.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(verifyPr).not.toContain('secrets.');
    expect(verifyPr).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(verifyPr).not.toContain('contents: write');
    expect(verifyPr).toContain('persist-credentials: false');
    expect(verifyPr).toMatch(/^\s*pull_request:/m);
    expect(verifyPr).not.toMatch(/^\s*pull_request_target:/m);

    // The accepted-offer audit is a second, manual live tool. Its own safety
    // suite proves its credentials are confined to one step and that it can
    // neither publish nor commit its one-day evidence artifact.
    const audit = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'audit-accepted-offers.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(audit).toContain('secrets.');
    expect(audit).toContain('workflow_dispatch:');
    expect(audit).not.toMatch(/^\s*(push|pull_request|schedule):/m);

    // The voice sample is the only workflow that spends a paid provider's
    // credits. Manual dispatch only, behind a typed confirmation, so it cannot
    // be started by a push, a schedule, or a pull request from a fork.
    const voiceSample = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'elevenlabs-voice-sample.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(voiceSample).toContain('secrets.ELEVENLABS_API_KEY');
    expect(voiceSample).toContain('workflow_dispatch:');
    expect(voiceSample).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule):/m);
    expect(voiceSample).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    // The confirmation gate is the thing standing between a stray dispatch and
    // a spend, so it is asserted rather than assumed.
    expect(voiceSample).toContain("inputs.confirm != 'generate'");

    const catalog = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-retail-affiliate-catalog.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(catalog).toContain('secrets.');
    expect(catalog).toMatch(/^\s*push:/m);
    expect(catalog).not.toMatch(/^\s*pull_request(_target)?:/m);
    expect(catalog).not.toMatch(/^\s*schedule:/m);

    const pagingPreflight = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'newegg-paging-preflight.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(new Set([...pagingPreflight.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((m) => m[1])))
      .toEqual(new Set(CREDENTIAL_SECRETS));
    expect(pagingPreflight).toMatch(/^\s*workflow_dispatch:/m);
    expect(pagingPreflight).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|repository_dispatch):/m);
    expect(pagingPreflight).toContain("if: inputs.confirm == 'inspect'");
    expect(pagingPreflight).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(pagingPreflight).not.toContain('contents: write');
    expect(pagingPreflight).toContain('persist-credentials: false');
    expect(pagingPreflight).toContain('pagingPreflight.ts');
    expect(pagingPreflight).not.toContain('generate-affiliate-catalog.ts');
    expect(pagingPreflight).not.toMatch(/git\s+(add|commit|push)/);
    expect(pagingPreflight).toContain('${RUNNER_TEMP}/paging-preflight/report.json');
    expect(pagingPreflight).toContain('if-no-files-found: error');
    expect(pagingPreflight).toContain('test -z "$(git status --porcelain)"');
  });

  /**
   * INVARIANTS THAT APPLY TO EVERY WORKFLOW, INCLUDING ONES NOT YET WRITTEN.
   *
   * The inventory above is a hand-written list, and a hand-written list is why
   * a new workflow could arrive holding a paid API key while pinning its
   * actions to moving tags, persisting a push token it never needed, and
   * running without a timeout: the list failed, someone added the filename,
   * and nothing looked at the file. These three checks read every workflow in
   * the directory, so the next one is held to the same standard on the day it
   * lands rather than whenever somebody thinks to look.
   */
  const workflowDir = path.join(repoRoot, '.github', 'workflows');
  const eachWorkflow = () =>
    fs.readdirSync(workflowDir).sort().map((name) => ({
      name,
      body: fs
        .readFileSync(path.join(workflowDir, name), 'utf-8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n'),
    }));

  it('pins every action to a commit SHA, never a moving tag', () => {
    // A tag is repointable by whoever controls the action's repository. Several
    // of these jobs hold a credential while that code runs.
    const offenders: string[] = [];
    for (const { name, body: text } of eachWorkflow()) {
      for (const [, ref] of text.matchAll(/uses:\s*(\S+)/g)) {
        if (!/@[0-9a-f]{40}$/.test(ref)) offenders.push(`${name}: ${ref}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every workflow a timeout', () => {
    const offenders = eachWorkflow()
      .filter(({ body: text }) => !/timeout-minutes:\s*\d+/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('checks out without a push token everywhere except the one workflow that commits', () => {
    // `refresh-retail-prices.yml` persists credentials deliberately: it is the
    // only workflow that pushes, and the only one holding `contents: write`.
    const offenders = eachWorkflow()
      .filter(({ name, body: text }) => name !== 'refresh-retail-prices.yml'
        && /uses:\s*actions\/checkout/.test(text)
        && !text.includes('persist-credentials: false'))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  /**
   * A workflow may not invoke a script that is not in the repository.
   *
   * ONE DOCUMENTED EXCEPTION. `elevenlabs-voice-sample.yml` was merged in #134
   * ahead of its script on purpose — registering the file is what makes the
   * manual dispatch button exist in the GitHub UI, and the entrypoint arrives
   * with the rest of the MASTER #6 work. The run fails at the generate step
   * with a module-resolution error, BEFORE any request to the provider, so a
   * stray dispatch costs nothing. When that script lands, delete the exception
   * rather than the test.
   */
  const PENDING_ENTRYPOINTS = new Set(['scripts/content-automator/elevenLabsVoiceSample.ts']);

  it('invokes only scripts that exist', () => {
    const missing: string[] = [];
    for (const { name, body: text } of eachWorkflow()) {
      for (const [, script] of text.matchAll(/(?:pnpm exec tsx|node)\s+(\S+\.(?:ts|mjs|js))/g)) {
        if (PENDING_ENTRYPOINTS.has(script)) continue;
        if (!fs.existsSync(path.join(repoRoot, 'artifacts', 'SpecSmith', script))) missing.push(`${name}: ${script}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the pending entrypoint list honest', () => {
    // If a pending script has landed, the exception is stale and the line
    // above is now hiding a real check. Fails when that happens.
    const stillPending = [...PENDING_ENTRYPOINTS].filter(
      (script) => !fs.existsSync(path.join(repoRoot, 'artifacts', 'SpecSmith', script)),
    );
    expect(stillPending).toEqual([...PENDING_ENTRYPOINTS]);
  });

  it('the live sweep no longer runs on every change under scripts/retail', () => {
    expect(body).not.toContain("'artifacts/SpecSmith/scripts/retail/**'");
    expect(body).not.toContain("'artifacts/SpecSmith/src/lib/retail/**'");
    expect(body).not.toContain("'artifacts/SpecSmith/scripts/retail/snapshot/**'");
  });

  it('still runs on the code the sweep actually exercises', () => {
    expect(body).toContain("'artifacts/SpecSmith/scripts/retail/rakuten/**'");
    expect(body).toContain("'artifacts/SpecSmith/scripts/retail/coverage/**'");
    expect(body).toContain("'.github/workflows/validate-rakuten-gpu-coverage.yml'");
  });

  it('triggers on push to the implementation branch', () => {
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/rakuten-newegg-adapter-97h85y');
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

  it('pins every action to a full commit SHA, with the tag it came from in a comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest.trim(), ref).toMatch(/^#\s*v\d/);
    }
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });
});

describe('credentials are confined and never become arguments', () => {
  it('references exactly the three credential secrets, each only as a step-scoped env value', () => {
    const references = [...body.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(references)).toEqual(new Set(CREDENTIAL_SECRETS));
    expect(references.length).toBe(CREDENTIAL_SECRETS.length);

    for (const line of body.split('\n')) {
      if (!line.includes('${{ secrets.')) continue;
      const name = /secrets\.([A-Z_]+)/.exec(line)![1];
      expect(CREDENTIAL_SECRETS, line).toContain(name);
      expect(line.trim(), line).toBe(mappingFor(name));
    }
  });

  it('no longer uses the temporary RAKUTEN_API_KEY secret', () => {
    expect(body).not.toContain(RETIRED_SECRET);
    expect(yaml).not.toContain(`secrets.${RETIRED_SECRET}`);
  });

  it('the access token is produced, never stored as a secret', () => {
    expect(body).not.toContain(`secrets.${ENV_VAR}`);
    expect(body).toContain('request-access-token.ts');
  });

  it('there is no separate credential preflight step', () => {
    expect(body).not.toContain('Confirm the API credentials are available');
    for (const name of CREDENTIAL_SECRETS) {
      expect(body, name).not.toContain(`if [ -z "\${${name}:-}" ]`);
    }
    const lines = body.split('\n');
    const at = lines.flatMap((l, i) => (l.includes('${{ secrets.') ? [i] : []));
    expect(at).toHaveLength(CREDENTIAL_SECRETS.length);
    expect(at[at.length - 1] - at[0]).toBe(CREDENTIAL_SECRETS.length - 1);
  });

  it('a credential is never expanded into a command, a flag or a URL', () => {
    const expansions = body
      .split('\n')
      .filter((l) => !l.includes('${{ secrets.'))
      .filter((l) => CREDENTIAL_SECRETS.some((n) => new RegExp(`\\$\\{?${n}\\b`).test(l)));
    expect(expansions).toEqual([]);
    expect(body).not.toMatch(/--token|--client|token=|client_secret=|access_token=/);
  });

  it('the minted token stays inside the one step that uses it', () => {
    const sweep = body.slice(
      body.indexOf('Mint an access token and run the full GPU coverage sweep'),
      body.indexOf('Validate gates and publish the report'),
    );
    expect(sweep).not.toContain('GITHUB_ENV');
    expect(sweep).toContain('umask 077');
    expect(sweep).toContain('${RUNNER_TEMP}/rakuten-access-token');
    expect(sweep).toContain("trap 'rm -f \"${token_file}\"' EXIT");
    expect(sweep).toContain('rm -f "${token_file}"');
    expect(sweep).toContain('export RAKUTEN_API_ACCESS_TOKEN');
  });

  it('the reporting step receives no credential of any kind', () => {
    const afterSweep = body.slice(body.indexOf('Validate gates and publish the report'));
    expect(afterSweep).not.toContain('secrets.');
    expect(afterSweep).not.toContain(ENV_VAR);
    for (const name of CREDENTIAL_SECRETS) expect(afterSweep, name).not.toContain(name);
  });

  it('uses no shell tracing and echoes no environment', () => {
    for (const forbidden of ['set -x', 'set -o xtrace', 'printenv', 'env |', 'echo $RAKUTEN', 'ACTIONS_STEP_DEBUG']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
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
    expect(body).toMatch(/uses: pnpm\/action-setup@[0-9a-f]{40}\b/);
    expect(/^\s*version:/m.test(body), 'pnpm version must come from packageManager').toBe(false);
    expect(body).toContain('--frozen-lockfile');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});
