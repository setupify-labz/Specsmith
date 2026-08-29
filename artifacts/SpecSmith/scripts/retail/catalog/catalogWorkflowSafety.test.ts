import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'build-retail-affiliate-catalog.yml');
const body = fs.readFileSync(workflowPath, 'utf-8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('500-part catalog workflow safety', () => {
  it('is branch-scoped, manually rerunnable and has no pull-request or schedule trigger', () => {
    expect(body).toContain('workflow_dispatch:');
    expect(body).toMatch(/on:\s*\n\s*workflow_dispatch:\s*\n\s*push:/);
    expect(body).toContain('claude/rakuten-newegg-adapter-97h85y');
    expect(body).not.toMatch(/^\s*pull_request(_target)?:/m);
    expect(body).not.toMatch(/^\s*schedule:/m);
  });

  it('has read-only repository permission and cannot persist checkout credentials', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(body).not.toContain('contents: write');
    expect(body).toContain('persist-credentials: false');
    expect(body).toContain('ref: ${{ github.sha }}');
  });

  it('pins every external action to a full commit SHA', () => {
    const uses = [...body.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
  });

  it('keeps credentials step-scoped and never places them in arguments or URLs', () => {
    for (const name of ['RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_PUBLISHER_SID']) {
      expect(body.match(new RegExp(`secrets\\.${name}`, 'g'))).toHaveLength(1);
      expect(body).toContain(`${name}: \${{ secrets.${name} }}`);
      expect(body).not.toMatch(new RegExp(`https?://[^\\n]*\\$\\{?${name}`));
      expect(body).not.toMatch(new RegExp(`--[^\\n]*\\$\\{?${name}`));
    }
    expect(body).not.toContain('set -x');
  });

  it('writes generated data only under RUNNER_TEMP and uploads it for one day', () => {
    expect(body).toContain('${RUNNER_TEMP}/affiliate-catalog/retail-parts.json');
    expect(body).toContain('${{ runner.temp }}/affiliate-catalog/retail-parts.json');
    expect(body).toContain('retention-days: 1');
    expect(body).not.toMatch(/git\s+(add|commit|push)/);
  });

  it('tests before the live build and confirms the checkout stays clean', () => {
    expect(body.indexOf('pnpm typecheck')).toBeLessThan(body.indexOf('generate-affiliate-catalog.ts'));
    expect(body).toContain('test -z "$(git status --porcelain)"');
  });
});
