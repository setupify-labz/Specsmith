import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Structural checks on .github/workflows/discover-parts.yml (issue #192). The
// workflow handles a credential on a schedule, so its shape is pinned here:
// it may read the feed and upload a staging artifact, and nothing more.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..');
const body = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'discover-parts.yml'), 'utf-8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('part discovery workflow safety', () => {
  it('runs only on a schedule or by hand, never on a push or pull request', () => {
    expect(body).toMatch(/^\s*schedule:/m);
    expect(body).toContain('workflow_dispatch:');
    expect(body).not.toMatch(/^\s*(push|pull_request|pull_request_target):/m);
  });

  it('is read-only and never persists checkout credentials', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(body).not.toContain('contents: write');
    expect(body).toContain('persist-credentials: false');
    expect(body).not.toMatch(/git\s+(add|commit|push)/);
  });

  it('pins every external action to a full commit SHA', () => {
    const uses = [...body.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
  });

  it('confines each credential to one step and never puts it in arguments or URLs', () => {
    for (const name of ['RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_PUBLISHER_SID']) {
      expect(body.match(new RegExp(`secrets\\.${name}`, 'g'))).toHaveLength(1);
      expect(body).toContain(`${name}: \${{ secrets.${name} }}`);
      expect(body).not.toMatch(new RegExp(`https?://[^\\n]*\\$\\{?${name}`));
      expect(body).not.toMatch(new RegExp(`--[^\\n]*\\$\\{?${name}`));
    }
    expect(body).not.toContain('set -x');
  });

  it('writes only under RUNNER_TEMP, uploads the staging file, and proves the checkout is clean', () => {
    expect(body).toContain('${RUNNER_TEMP}/part-discovery/staged-parts.json');
    expect(body).toContain('${{ runner.temp }}/part-discovery/staged-parts.json');
    expect(body).not.toMatch(/public\/data|src\/data/);
    expect(body.indexOf('pnpm typecheck')).toBeLessThan(body.indexOf('discover-parts.ts'));
    expect(body).toContain('test -z "$(git status --porcelain)"');
  });
});
