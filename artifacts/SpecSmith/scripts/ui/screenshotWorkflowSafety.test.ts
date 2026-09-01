import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_ID_ENV_VAR,
  CLIENT_SECRET_ENV_VAR,
  PUBLISHER_SID_ENV_VAR,
} from '../retail/rakuten/accessTokenRequest';
import { ACCESS_TOKEN_ENV_VAR } from '../retail/rakuten/types';

// Structural checks on the screenshot workflow.
//
// TEMPORARY, LIKE THE WORKFLOW IT GUARDS. Both were removed after the last
// review and are back only for the life of this branch, because the sandbox
// cannot reach the retailer image CDN and visual evidence has to come from
// somewhere. Delete this file with the workflow before merging.
//
// This is the second — and only other — workflow in the repository that holds
// `contents: write`. It earns that by being narrow in every other direction:
// it is manual, it holds no credential, it contacts no retailer API, and the
// only ref it may push to is a dead-end screenshot branch. None of that is
// enforced by typecheck or by any runtime test, so it is asserted here against
// the file itself, the same way the retail workflows are.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'capture-ui-screenshots.yml');
const scriptPath = path.join(here, 'captureBuilderScreenshots.mjs');

const yaml = fs.readFileSync(workflowPath, 'utf-8');
/** The workflow with comment lines removed: prose may neither satisfy a check nor fail one. */
const body = yaml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
const script = fs.readFileSync(scriptPath, 'utf-8');

/** The branch the run is allowed to push to. Deliberately not the working branch. */
const SCREENSHOT_BRANCH = 'claude/ui-screenshots-97h85y';

describe('the screenshot workflow starts on one branch or by hand, and nothing else', () => {
  it('runs on the working branch and on manual dispatch only', () => {
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('workflow_dispatch:');
    // Restricted to the one branch. A workflow that writes must not be
    // startable from a fork's branch or from someone else's pull request.
    expect(body).toMatch(/push:\s*\n\s*branches:\s*\n\s*- claude\/builder-wide-desktop-white-build\s*\n\s*paths:/);
    for (const event of ['pull_request', 'pull_request_target', 'schedule', 'issue_comment', 'workflow_run']) {
      expect(new RegExp(`^\\s*${event}:`, 'm').test(body), event).toBe(false);
    }
  });

  it('is limited to the paths that can change what the builder looks like', () => {
    const paths = [...body.matchAll(/^\s+- '([^']+)'$/gm)].map((match) => match[1]);
    expect(paths).toEqual([
      '.github/workflows/capture-ui-screenshots.yml',
      'artifacts/SpecSmith/scripts/ui/**',
      'artifacts/SpecSmith/src/components/builder/**',
      // The framing rule lives here, and it decides how large a product is
      // drawn. A change to it that never got photographed is exactly the kind
      // of thing this run exists to catch.
      'artifacts/SpecSmith/src/lib/retail/**',
      'artifacts/SpecSmith/src/pages/Builder.tsx',
    ]);
  });

  it('takes its one input through the environment rather than into a shell line', () => {
    // A dispatch input is text someone else wrote. Interpolating it directly
    // into a `run:` body makes it a command; passing it through `env:` makes
    // it a string the shell only ever expands as one word.
    expect(body).toContain("BEFORE_REF: ${{ inputs.before_ref || '619d40e' }}");
    expect(body).toContain('"${BEFORE_REF}"');
    expect(body).not.toContain('${{ inputs.before_ref }}"\n');
    const runLines = body.split('\n').filter((line) => !/^\s+\w[\w-]*:\s/.test(line));
    for (const line of runLines) {
      expect(line.includes('${{ inputs.'), line).toBe(false);
    }
  });
});

describe('the screenshot workflow holds no credential', () => {
  it('references no secret and no Rakuten variable', () => {
    expect(body).not.toContain('secrets.');
    for (const name of [CLIENT_ID_ENV_VAR, CLIENT_SECRET_ENV_VAR, PUBLISHER_SID_ENV_VAR, ACCESS_TOKEN_ENV_VAR]) {
      expect(yaml.includes(name), name).toBe(false);
    }
  });

  it('runs no token exchange and no live sweep', () => {
    // Not the bare word "rakuten": the working branch is named after that
    // adapter, so the branch filter above contains it legitimately. These are
    // the things a token exchange or a live sweep would actually need.
    for (const forbidden of ['mintAccessToken', 'add-mask', 'sweep', 'linksynergy', 'scripts/retail']) {
      expect(body.toLowerCase().includes(forbidden.toLowerCase()), forbidden).toBe(false);
    }
  });

  it('does not persist a checkout credential', () => {
    expect(body).toContain('persist-credentials: false');
    expect(body).toContain('ref: ${{ github.sha }}');
  });
});

describe('the write permission is confined to one branch and one directory', () => {
  it('pushes only to the screenshot branch, never to a ref it was handed', () => {
    expect(body).toContain('contents: write');
    expect(body).toContain(`SCREENSHOT_BRANCH: ${SCREENSHOT_BRANCH}`);
    expect(body).toContain('"HEAD:refs/heads/${SCREENSHOT_BRANCH}"');

    // Exactly one push, and its destination is the constant above.
    // A `git push` and its backslash continuations, taken as one command.
    const pushes = [...body.matchAll(/git push(?:[^\n]*\\\n)*[^\n]*/g)].map((match) => match[0]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain('${SCREENSHOT_BRANCH}');

    // Nothing here touches the default branch or the working branch.
    expect(pushes[0]).not.toContain('refs/heads/main');
    expect(pushes[0]).not.toContain('claude/builder-wide-desktop-white-build');
    expect(body).not.toContain('refs/heads/main');
  });

  it('refuses to publish anything outside the screenshots directory', () => {
    expect(body).toContain('git add -f -- screenshots');
    expect(body).toContain("grep -v '^screenshots/'");
    expect(body).toContain('Refusing to publish');
  });

  it('deploys nothing', () => {
    for (const forbidden of ['wrangler', 'cloudflare', 'deploy', 'pages publish', 'npm publish']) {
      expect(body.toLowerCase().includes(forbidden), forbidden).toBe(false);
    }
  });
});

describe('the workflow is pinned and bounded', () => {
  it('pins every action to a 40-character SHA with a version comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const [, ref, comment] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(comment.trim()).toMatch(/^#\s*v\d/);
    }
  });

  it('pins the browser driver to an exact version', () => {
    expect(body).toMatch(/PLAYWRIGHT_VERSION: \d+\.\d+\.\d+/);
    expect(body).toContain('"playwright@${PLAYWRIGHT_VERSION}"');
    // Installed outside the workspace, so the app's lockfile is untouched by
    // a tool only this job needs.
    expect(body).toContain('--no-save --prefix "${RUNNER_TEMP}/pw"');
  });

  it('has a timeout and retains its artifact for a week at most', () => {
    expect(body).toMatch(/timeout-minutes:\s*\d+/);
    const retention = body.match(/retention-days:\s*(\d+)/);
    expect(retention).not.toBeNull();
    expect(Number(retention?.[1])).toBeLessThanOrEqual(7);
  });
});
