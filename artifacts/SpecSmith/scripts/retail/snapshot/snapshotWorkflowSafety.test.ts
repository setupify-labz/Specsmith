import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACCESS_TOKEN_ENV_VAR } from '../rakuten/types';
import { CLIENT_ID_ENV_VAR, CLIENT_SECRET_ENV_VAR, PUBLISHER_SID_ENV_VAR } from '../rakuten/accessTokenRequest';

// Structural checks on the credential-free snapshot workflow.
//
// This tier's whole claim is that it needs nothing: no token, no API, no write.
// A claim like that decays the moment someone adds "just one" env var to get a
// test passing, so it is asserted here rather than promised in a comment — the
// same approach coverage/workflowSafety.test.ts takes to the workflow that DOES
// hold a credential.
//
// Every check reads a comment-stripped body, so the file's own prose about what
// it does not do cannot satisfy — or fail — an assertion.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const workflowPath = path.join(workflowsDir, 'validate-retail-snapshot.yml');

const yaml = fs.readFileSync(workflowPath, 'utf-8');
const body = yaml
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** The live sweep, for the assertions about what belongs to it and not here. */
const liveYaml = fs.readFileSync(path.join(workflowsDir, 'validate-rakuten-gpu-coverage.yml'), 'utf-8');

describe('the snapshot workflow runs the tests the live sweep was not running', () => {
  it('exists, on its own path', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('runs BOTH halves of the tier: the server-only writer and the browser reader', () => {
    // The gap this closes: the live workflow ran `vitest run scripts/retail`,
    // which never touched src/lib/retail — the schema, the freshness rule, and
    // the price, currency, affiliate-host and availability checks.
    expect(body).toContain('vitest run scripts/retail/snapshot src/lib/retail');
  });

  it('names both locations rather than one broad glob', () => {
    // They sit on opposite sides of the server/browser boundary; a path that
    // quietly stopped matching one would reopen exactly this gap.
    const testStep = body.slice(body.indexOf('Run the snapshot writer and browser loader tests'));
    expect(testStep).toContain('scripts/retail/snapshot');
    expect(testStep).toContain('src/lib/retail');
  });

  it('typechecks the workspace first', () => {
    expect(body).toContain('pnpm typecheck');
    expect(body.indexOf('pnpm typecheck')).toBeLessThan(body.indexOf('vitest run'));
  });

  it('installs through the repository\'s own pinned toolchain', () => {
    expect(body).toContain('pnpm install --frozen-lockfile');
    expect(body).toContain("node-version: '22'");
    expect(body).toContain('cache: pnpm');
    // No `version:` key: action-setup reads packageManager from package.json,
    // so CI and a local install cannot drift.
    expect(/^\s*version:/m.test(body)).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });

  it('triggers on the snapshot paths and offers a manual run', () => {
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/rakuten-newegg-adapter-97h85y');
    expect(body).toContain("'artifacts/SpecSmith/scripts/retail/snapshot/**'");
    expect(body).toContain("'artifacts/SpecSmith/src/lib/retail/**'");
    expect(body).toContain("'.github/workflows/validate-retail-snapshot.yml'");
    expect(body).toContain('workflow_dispatch:');
  });

  it('has no pull_request trigger and no schedule', () => {
    expect(/^\s*pull_request(_target)?:/m.test(body)).toBe(false);
    expect(/^\s*schedule:/m.test(body)).toBe(false);
  });
});

describe('the snapshot workflow holds no credential of any kind', () => {
  it('references no secret at all', () => {
    // Not "the right secrets" — NONE. There is nothing here a credential could
    // legitimately be for.
    expect(body).not.toContain('secrets.');
    expect(/\$\{\{\s*secrets\./.test(body)).toBe(false);
  });

  it('names none of the credential variables', () => {
    for (const name of [CLIENT_ID_ENV_VAR, CLIENT_SECRET_ENV_VAR, PUBLISHER_SID_ENV_VAR, ACCESS_TOKEN_ENV_VAR, 'RAKUTEN_API_KEY']) {
      expect(body.includes(name), `must not name ${name}`).toBe(false);
    }
    // Nor any RAKUTEN_-prefixed variable that might be added later.
    expect(/\bRAKUTEN_[A-Z_]+/.test(body)).toBe(false);
  });

  it('runs no token-minting code', () => {
    for (const forbidden of ['request-access-token', 'add-mask', 'accessTokenRequest', 'linksynergy.com/token', 'RUNNER_TEMP']) {
      expect(body.includes(forbidden), `must not reference ${forbidden}`).toBe(false);
    }
  });

  it('declares no env block at the job or step level', () => {
    // Nothing to hold. An env block here would be the first place a credential
    // could arrive without any other check noticing.
    expect(/^\s*env:/m.test(body)).toBe(false);
  });

  it('uses no shell tracing and echoes no environment', () => {
    for (const forbidden of ['set -x', 'set -o xtrace', 'printenv', 'env |', 'ACTIONS_STEP_DEBUG']) {
      expect(body.includes(forbidden), forbidden).toBe(false);
    }
    expect(body).toContain('set -euo pipefail');
  });
});

describe('the snapshot workflow makes no request and writes nothing', () => {
  it('runs no coverage sweep and no snapshot write', () => {
    for (const forbidden of ['measure-coverage', 'assert-coverage-gates', 'write-gpu-offer-snapshot', 'probe-response-shape', 'capture-fixture']) {
      expect(body.includes(forbidden), `must not run ${forbidden}`).toBe(false);
    }
    // Those belong to the live workflow, which is where they still are.
    expect(liveYaml).toContain('measure-coverage.ts');
  });

  it('runs only install, typecheck and vitest — nothing that could reach the network', () => {
    // `pnpm exec tsx` is how every network-touching command in this repository
    // is invoked, so its absence is the load-bearing half of this check.
    expect(body.includes('tsx '), 'must not invoke a tsx CLI').toBe(false);

    // Single-line `run:` values, checked against a whitelist of three commands.
    // `run: |` opens a block scalar and is handled below; everything else on
    // the line is a command.
    const inline = [...body.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim()).filter((c) => c !== '|');
    for (const command of inline) {
      expect(/^pnpm (install|typecheck|exec vitest)\b/.test(command), command).toBe(true);
    }

    // Block scalars (`run: |`) are shell, and their CONTENTS are where a
    // request would actually be written — a whitelist over the `run:` line
    // alone would never see one. So the whole file is scanned for the verbs.
    for (const forbidden of ['curl', 'wget', 'nc ', 'node -e', 'npx ', 'fetch(', 'Invoke-WebRequest']) {
      expect(body.includes(forbidden), `must not run ${forbidden.trim()}`).toBe(false);
    }
  });

  it('confirms the working tree is unchanged', () => {
    expect(body).toContain('git status --porcelain');
  });

  it('uploads no artifact and commits nothing', () => {
    for (const forbidden of ['upload-artifact', 'git commit', 'git push', 'add-and-commit', 'GITHUB_ENV', 'GITHUB_OUTPUT']) {
      expect(body.includes(forbidden), forbidden).toBe(false);
    }
  });
});

describe('the snapshot workflow holds the least authority it can', () => {
  it('grants read-only repository permissions', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    for (const forbidden of ['contents: write', 'packages: write', 'id-token: write', 'permissions: write-all']) {
      expect(body.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('checks out the exact triggering commit without persisting credentials', () => {
    expect(body).toContain('ref: ${{ github.sha }}');
    expect(body).toContain('persist-credentials: false');
  });

  it('pins concurrency and a timeout', () => {
    expect(body).toMatch(/concurrency:/);
    expect(body).toMatch(/timeout-minutes:\s*10/);
  });

  it('pins every action to a full commit SHA with its tag in a comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest.trim(), ref).toMatch(/^#\s*v\d/);
    }
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });

  it('pins the SAME audited commits as the live workflow', () => {
    // Two workflows drifting to different commits of the same action is two
    // things to audit instead of one, and the credential-bearing job is the
    // one that would end up on the unreviewed side.
    const refsOf = (text: string) => new Set([...text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/g)].map((m) => m[1]));
    const mine = refsOf(yaml);
    const live = refsOf(liveYaml);
    expect(mine.size).toBeGreaterThan(0);
    for (const ref of mine) expect(live.has(ref), `${ref} is not the commit the live workflow runs`).toBe(true);
  });
});
