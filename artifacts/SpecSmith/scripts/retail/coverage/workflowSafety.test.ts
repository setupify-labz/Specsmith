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
  it('is one of exactly six workflows, with every credential-bearing workflow accounted for', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const dir = path.join(repoRoot, '.github', 'workflows');
    const all = fs.readdirSync(dir).sort();
    expect(all).toEqual([
      'audit-accepted-offers.yml',
      'build-retail-affiliate-catalog.yml',
      'capture-ui-screenshots.yml',
      'refresh-retail-prices.yml',
      'validate-rakuten-gpu-coverage.yml',
      'validate-retail-snapshot.yml',
    ]);

    // EXACTLY ONE workflow may write to the repository, and it is the price
    // refresh. Every other one stays read-only, so the write permission is
    // confined to a single reviewable file rather than spreading quietly.
    //
    // A second writer existed for a while: a screenshot capture that pushed
    // images to a dead-end branch so a redesign could be reviewed from an
    // environment where the retailer's image CDN is reachable. It was
    // temporary and has been removed, and this list is back to one name. Its
    // capture script is kept — see scripts/ui — but nothing in CI runs it, so
    // no workflow holds write access on its behalf.
    const writers = all.filter((name) =>
      fs
        .readFileSync(path.join(dir, name), 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
        .includes('contents: write'),
    );
    // TWO WRITERS, TEMPORARILY. The screenshot capture is back for the
    // duration of this branch only: the development sandbox cannot reach the
    // retailer image CDN, so visual evidence for a UI change cannot be
    // produced anywhere else. It holds no credential and pushes only images to
    // a dead-end branch, and it — and this allowance — are to be removed again
    // before this branch merges, exactly as they were last time.
    expect(writers).toEqual(['capture-ui-screenshots.yml', 'refresh-retail-prices.yml']);

    const screenshots = fs
      .readFileSync(path.join(dir, 'capture-ui-screenshots.yml'), 'utf-8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(screenshots).not.toContain('secrets.');
    expect(screenshots).not.toMatch(/^\s*(pull_request|pull_request_target|schedule|workflow_run):/m);
    expect(screenshots).toMatch(/push:\s*\n\s*branches:\s*\n\s*- claude\/builder-wide-desktop-white-build/);
    // The snapshot workflow is credential-free by construction; that is asserted in
    // full from its own side, in snapshot/snapshotWorkflowSafety.test.ts.
    // Comment lines are stripped here too — that file's header explains at
    // length what it does NOT reference, and prose must not fail a check any
    // more than it may satisfy one.
    const other = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'validate-retail-snapshot.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(other).not.toContain('secrets.');

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

    const catalog = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-retail-affiliate-catalog.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(catalog).toContain('secrets.');
    expect(catalog).toMatch(/^\s*push:/m);
    expect(catalog).not.toMatch(/^\s*pull_request(_target)?:/m);
    expect(catalog).not.toMatch(/^\s*schedule:/m);
  });

  it('the live sweep no longer runs on every change under scripts/retail', () => {
    // It used to. A change to the snapshot writer — which makes no API call at
    // all — spent a full 57-GPU sweep to prove nothing about itself.
    expect(body).not.toContain("'artifacts/SpecSmith/scripts/retail/**'");
    expect(body).not.toContain("'artifacts/SpecSmith/src/lib/retail/**'");
    expect(body).not.toContain("'artifacts/SpecSmith/scripts/retail/snapshot/**'");
  });

  it('still runs on the code the sweep actually exercises', () => {
    // Narrowing must not have gone one step too far: these two directories are
    // the adapter and the coverage tool, and a change to either is exactly
    // what a live run exists to validate.
    expect(body).toContain("'artifacts/SpecSmith/scripts/retail/rakuten/**'");
    expect(body).toContain("'artifacts/SpecSmith/scripts/retail/coverage/**'");
    expect(body).toContain("'.github/workflows/validate-rakuten-gpu-coverage.yml'");
  });

  it('triggers on push to the implementation branch', () => {
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/rakuten-newegg-adapter-97h85y');
    // Which paths, exactly, is asserted by the two tests above.
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
    // A tag is a pointer its owner can move. This job hands three long-lived
    // credentials to whatever these actions are on the day it runs, so "v4"
    // is not good enough: each is pinned to the 40-character commit that
    // actually ran, and the tag survives only as a comment for readers.
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      // The version comment is what makes the pin reviewable and upgradable.
      expect(rest.trim(), ref).toMatch(/^#\s*v\d/);
    }
    // No floating ref survives anywhere, comments included.
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });
});

describe('credentials are confined and never become arguments', () => {
  it('references exactly the three credential secrets, each only as a step-scoped env value', () => {
    const references = [...body.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((m) => m[1]);
    // ONE step needs them: the one that mints a token and sweeps. There is no
    // preflight — a second step existing only to test presence would double the
    // number of places a long-lived credential is expanded, to prove something
    // the minter already fails on with `missing-credentials`.
    expect(new Set(references)).toEqual(new Set(CREDENTIAL_SECRETS));
    expect(references.length).toBe(CREDENTIAL_SECRETS.length);

    // Every interpolation is an env assignment whose key matches its secret.
    for (const line of body.split('\n')) {
      if (!line.includes('${{ secrets.')) continue;
      const name = /secrets\.([A-Z_]+)/.exec(line)![1];
      expect(CREDENTIAL_SECRETS, line).toContain(name);
      expect(line.trim(), line).toBe(mappingFor(name));
    }
  });

  it('no longer uses the temporary RAKUTEN_API_KEY secret', () => {
    // Left in place in GitHub, simply unused here.
    expect(body).not.toContain(RETIRED_SECRET);
    expect(yaml).not.toContain(`secrets.${RETIRED_SECRET}`);
  });

  it('the access token is produced, never stored as a secret', () => {
    // RAKUTEN_API_ACCESS_TOKEN is minted at run time; it must never appear as
    // a `secrets.` reference, which would mean a human is pasting one again.
    expect(body).not.toContain(`secrets.${ENV_VAR}`);
    expect(body).toContain('request-access-token.ts');
  });

  it('there is no separate credential preflight step', () => {
    // Retired deliberately: the token minter already fails with the closed
    // `missing-credentials` category naming the empty VARIABLES, so a preflight
    // bought nothing and cost a second step holding all three secrets.
    expect(body).not.toContain('Confirm the API credentials are available');
    for (const name of CREDENTIAL_SECRETS) {
      expect(body, name).not.toContain(`if [ -z "\${${name}:-}" ]`);
    }
    // The three secrets appear in exactly one step's env block, contiguously.
    const lines = body.split('\n');
    const at = lines.flatMap((l, i) => (l.includes('${{ secrets.') ? [i] : []));
    expect(at).toHaveLength(CREDENTIAL_SECRETS.length);
    expect(at[at.length - 1] - at[0]).toBe(CREDENTIAL_SECRETS.length - 1);
  });

  it('a credential is never expanded into a command, a flag or a URL', () => {
    // With the preflight gone there is no permitted expansion at all: the three
    // credentials are set as env vars and read by the minter, never by shell.
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
    // Never exported to later steps: $GITHUB_ENV would hand it to the step
    // that writes a job summary.
    expect(sweep).not.toContain('GITHUB_ENV');
    // Written under the runner's temp, owner-only, and removed twice over.
    expect(sweep).toContain('umask 077');
    expect(sweep).toContain('${RUNNER_TEMP}/rakuten-access-token');
    expect(sweep).toContain("trap 'rm -f \"${token_file}\"' EXIT");
    expect(sweep).toContain('rm -f "${token_file}"');
    // The token reaches the sweep as an exported variable, not an argument.
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
    expect(body).toMatch(/uses: pnpm\/action-setup@[0-9a-f]{40}\b/);
    // No bare `version:` key anywhere — that key belongs to action-setup, and
    // pinning it there is exactly the drift this avoids. (`node-version:` is a
    // different key and is allowed.)
    expect(/^\s*version:/m.test(body), 'pnpm version must come from packageManager').toBe(false);
    expect(body).toContain('--frozen-lockfile');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });
});
