// Structural checks on the content-automator offline end-to-end pipeline's CI
// evidence workflow, mirroring the role auditRetailerLinksWorkflowSafety.test.ts
// plays for audit-retailer-links.yml — this workflow holds no credential at
// all, so there is no secret boundary to verify: only that it stays that
// way, stays scoped to this one branch (plus a manual rerun trigger), and
// never publishes or commits anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'content-e2e-offline.yml');
const yaml = fs.readFileSync(workflowPath, 'utf-8');
/** Workflow body with comment lines removed, so prose cannot satisfy a check. */
const body = yaml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('the content-automator offline e2e workflow is manual, credential-free and non-publishing', () => {
  it('exists', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('triggers on push to the implementation branch only, plus workflow_dispatch for reruns', () => {
    // workflow_dispatch cannot be triggered via the API for a workflow file
    // that only exists on a non-default branch — see this file's own header
    // — so a scoped `push` (the same pattern audit-retailer-links.yml and
    // validate-retail-snapshot.yml already use for the same reason) is what
    // actually produces pre-merge evidence.
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/intelligent-bohr-naord4');
    expect(body).toContain('workflow_dispatch:');
  });

  it('has NO pull_request trigger and no schedule', () => {
    expect(body).not.toMatch(/^\s*(pull_request|pull_request_target|schedule):/m);
  });

  it('references no secret anywhere', () => {
    expect(body).not.toContain('secrets.');
  });

  it('has read-only permissions, an exact checkout and no persisted git credential', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(body).toContain('ref: ${{ github.sha }}');
    expect(body).toContain('persist-credentials: false');
    expect(body).not.toContain('contents: write');
  });

  it('pins every action to a 40-character SHA with a reviewable version comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, comment] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(comment.trim()).toMatch(/^#\s*v\d/);
    }
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });

  it('uses the same audited shared-action pins as the other manual evidence-gate workflow', () => {
    const refsOf = (text: string): Set<string> =>
      new Set([...text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/g)].map((match) => match[1]));
    // checkout/pnpm/setup-node/upload-artifact all come from the existing
    // accepted-offers audit, the other workflow that installs, tests, builds
    // and uploads a one-day evidence artifact.
    const known = refsOf(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'audit-accepted-offers.yml'), 'utf-8'));
    const mine = [...refsOf(yaml)];
    expect(mine.length).toBeGreaterThan(0);
    for (const ref of mine) expect(known.has(ref), ref).toBe(true);
  });

  it('runs typecheck, the targeted content-automator tests, the full suite and a production build', () => {
    expect(body).toContain('pnpm typecheck');
    expect(body).toMatch(/vitest run scripts\/content-automator\s*2>&1/);
    expect(body).toMatch(/vitest run\s*2>&1/); // the untargeted full-suite run
    expect(body).toContain('pnpm run build');
  });

  it('installs Playwright Chromium and the offline TTS/compose system deps, with no paid provider', () => {
    expect(body).toContain('playwright install --with-deps chromium');
    expect(body).toContain('espeak-ng');
    expect(body).toContain('ffmpeg');
    expect(body).not.toMatch(/ELEVENLABS|GEMINI|MESHY|YOUTUBE_DATA_API_KEY|TIKTOK_BUSINESS/);
  });

  it('serves the built app locally rather than depending on any external host', () => {
    expect(body).toContain('npx --yes serve dist/public');
    expect(body).toContain('SPECSMITH_RENDER_BASE_URL: http://localhost:5178');
  });

  it('runs the real offline end-to-end pipeline script', () => {
    expect(body).toContain('scripts/content-automator/endToEndOfflinePipeline.ts');
  });

  it('captures the pipeline exit code rather than letting the documented evidence-mismatch stop fail the job', () => {
    // See the workflow's own header for why: the render is not
    // byte-reproducible across machines, so a fresh CI render very likely
    // will not match the one committed, already-inspected evidence file —
    // and that is the fail-closed gate blocker #2 added working correctly,
    // not a bug in this workflow.
    expect(body).toContain('set +e');
    expect(body).toContain('pipeline-exit-code.txt');
    expect(body).toContain('Evidence check: NO MATCH');
    expect(body).toContain('exit "${code}"');
  });

  it('uploads exactly the one evidence directory for one day, and does not commit or publish it', () => {
    expect(body).toContain('path: ${{ runner.temp }}/e2e');
    expect(body).toContain('retention-days: 1');
    expect(body).toContain('if-no-files-found: error');
    for (const forbidden of ['git add', 'git commit', 'git push', 'ELEVENLABS_API_KEY']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('confirms the checkout stayed clean, ignoring only this run\'s own gitignored output', () => {
    expect(body).toContain('git status --porcelain');
    // The pipeline's own render/store output is real, gitignored, generated
    // content — asserting the checkout is clean must not choke on it.
    expect(body).toContain("':!artifacts/SpecSmith/render-output'");
    expect(body).toContain("':!artifacts/SpecSmith/content-ideas'");
  });
});
