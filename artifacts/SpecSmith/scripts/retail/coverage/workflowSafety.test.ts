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
      'dry-run-retail-catalog.yml',
      'elevenlabs-voice-sample.yml',
      'measured-tests-ci.yml',
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

    // The dry run DOES carry the three credentials, because reporting what a
    // build would publish requires the same live feed a build reads. It is
    // held to the same confinement as the build itself: read-only, manual
    // dispatch only (a push trigger would spend live requests on every commit
    // touching the catalogue), the token minted rather than stored, and the
    // working tree asserted unchanged at the end.
    const dryRun = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'dry-run-retail-catalog.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(new Set([...dryRun.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((m) => m[1])))
      .toEqual(new Set(CREDENTIAL_SECRETS));
    expect(dryRun).not.toContain(`secrets.${ENV_VAR}`);
    expect(dryRun).not.toContain(RETIRED_SECRET);
    expect(dryRun).toContain('request-access-token.ts');
    expect(dryRun).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(dryRun).not.toContain('contents: write');
    expect(dryRun).toContain('persist-credentials: false');
    expect(dryRun).toMatch(/^\s*workflow_dispatch:/m);
    // No push trigger at all: a full sweep is ~120 live requests and must not
    // fire off a commit. It briefly had one confined to this file, as the only
    // way to run it from a feature branch before workflow_dispatch works.
    expect(dryRun).not.toMatch(/^\s*push:/m);
    // Scoped to the TRIGGER block: the run step names the generator script, of
    // course, but no catalogue source path may appear as a trigger path.
    const dryRunTriggers = dryRun.slice(dryRun.indexOf('on:'), dryRun.indexOf('permissions:'));
    expect(dryRunTriggers).not.toContain('scripts/retail');
    expect(dryRunTriggers).not.toContain('src/lib/retail');
    expect(dryRun).not.toMatch(/^\s*pull_request(_target)?:/m);
    // It runs the generator in dry-run mode, and writes only under the
    // runner's temporary directory — never into the checkout.
    expect(dryRun).toContain('--dry-run');
    expect(dryRun).toMatch(/--out "\$\{RUNNER_TEMP\}/);
    expect(dryRun).toContain('test -z "$(git status --porcelain)"');
    // A dry run that fell short of a quota is a FAILED run. The first version
    // swallowed the generator's exit code and the job went green while three
    // categories had published nothing, which is the one result that must
    // never look like a pass.
    expect(dryRun).toContain('dry-run-exit-code');
    expect(dryRun).toMatch(/exit "\$\{code\}"/);
    expect(dryRun).not.toContain('|| true');

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

    // The ElevenLabs voice sample is the only workflow that spends a paid
    // provider's credits, so its shape is the safety mechanism: manual
    // dispatch only, no automatic trigger of any kind, read-only, and a typed
    // confirmation before anything is generated.
    const voiceSample = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'elevenlabs-voice-sample.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(voiceSample).toContain('secrets.ELEVENLABS_API_KEY');
    expect(voiceSample).toContain('workflow_dispatch:');
    expect(voiceSample).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|repository_dispatch):/m);
    expect(voiceSample).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(voiceSample).not.toContain('contents: write');
    // A typed confirmation, checked in the job itself, so a stray dispatch
    // cannot spend credits.
    expect(voiceSample).toContain("inputs.confirm != 'generate'");

    const catalog = fs
      .readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-retail-affiliate-catalog.yml'), 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(catalog).toContain('secrets.');
    // The build no longer runs on a push either. It spent a full live sweep on
    // every commit under scripts/retail/catalog/**, and building a catalogue
    // is a deliberate act rather than a consequence of editing a file.
    expect(catalog).not.toMatch(/^\s*push:/m);
    expect(catalog).toMatch(/^\s*workflow_dispatch:/m);
    expect(catalog).not.toMatch(/^\s*pull_request(_target)?:/m);
    expect(catalog).not.toMatch(/^\s*schedule:/m);
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
