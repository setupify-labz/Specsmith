// Structural checks on the retailer-link audit's CI evidence workflow,
// mirroring the role auditSafety.test.ts plays for audit-accepted-offers.yml
// — except this workflow holds no credential at all, so there is no secret
// boundary to verify: only that it stays that way, stays manual, stays
// read-only, and never publishes or commits anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'audit-retailer-links.yml');
const yaml = fs.readFileSync(workflowPath, 'utf-8');
const body = yaml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('the retailer-link audit workflow is manual, credential-free and non-publishing', () => {
  it('exists', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('triggers on push to the implementation branch only, plus workflow_dispatch for reruns', () => {
    // workflow_dispatch cannot be triggered via the API for a workflow file
    // that only exists on a non-default branch — see the module doc — so a
    // scoped `push` (the same pattern validate-retail-snapshot.yml already
    // uses for the same reason) is what actually produces pre-merge evidence.
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/intelligent-bohr-gm9u8f');
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

  it('uses the same audited shared-action pins as the other retail workflows', () => {
    const refsOf = (text: string): Set<string> =>
      new Set([...text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/g)].map((match) => match[1]));
    // checkout/pnpm/setup-node come from the live sweep; upload-artifact comes
    // from the other manual evidence gate, which is the only other workflow
    // that uploads anything.
    const known = new Set([
      ...refsOf(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'validate-rakuten-gpu-coverage.yml'), 'utf-8')),
      ...refsOf(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'audit-accepted-offers.yml'), 'utf-8')),
    ]);
    const mine = [...refsOf(yaml)];
    expect(mine.length).toBeGreaterThan(0);
    for (const ref of mine) expect(known.has(ref), ref).toBe(true);
  });

  it('runs typecheck, the targeted audit tests, the full suite and a production build', () => {
    expect(body).toContain('pnpm typecheck');
    expect(body).toContain('vitest run scripts/retail/audit');
    expect(body).toMatch(/vitest run\s*2>&1/); // the untargeted full-suite run
    expect(body).toContain('pnpm run build');
  });

  it('captures the audit CLI exit code rather than letting an expected nonzero fail the job', () => {
    expect(body).toContain('set +e');
    expect(body).toContain('audit-exit-code.txt');
  });

  it('never writes row-level or merchant-controlled data to the step summary', () => {
    const summaryLines = body.split('\n').filter((line) => line.includes('GITHUB_STEP_SUMMARY'));
    expect(summaryLines.length).toBeGreaterThan(0);
    for (const line of summaryLines) {
      expect(line).toMatch(/commit/i);
    }
    expect(body).not.toMatch(/cat "\$\{RUNNER_TEMP\}\/audit\/retailer-link-audit\.json"[\s\S]*GITHUB_STEP_SUMMARY/);
  });

  it('uploads exactly the one evidence directory for one day, and does not commit or publish it', () => {
    expect(body).toContain('path: ${{ runner.temp }}/audit');
    expect(body).toContain('retention-days: 1');
    expect(body).toContain('if-no-files-found: error');
    // 'public/data' legitimately appears once, as a trigger path filter
    // (src/data and retail-parts.json changes should re-run this workflow) —
    // checked for a WRITE to that path, not the bare substring.
    expect(body).not.toMatch(/write-gpu-offer-snapshot|>\s*.*public\/data|git\s+(add|commit|push)/);
    expect(body).not.toContain('jq ');
  });

  it('confirms the checkout stayed clean', () => {
    expect(body).toContain('git status --porcelain');
  });
});
