import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CLIENT_ID_ENV_VAR,
  CLIENT_SECRET_ENV_VAR,
  PUBLISHER_SID_ENV_VAR,
} from '../rakuten/accessTokenRequest';
import { ACCESS_TOKEN_ENV_VAR } from '../rakuten/types';
import { AUDIT_ROW_KEYS } from './auditRecord';
import { parseArgs, resolveAuditOutputPath } from './audit-accepted-offers';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'audit-accepted-offers.yml');
const cliPath = path.join(here, 'audit-accepted-offers.ts');
const recordPath = path.join(here, 'auditRecord.ts');
const yaml = fs.readFileSync(workflowPath, 'utf-8');
const body = yaml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
const cli = fs.readFileSync(cliPath, 'utf-8');
const record = fs.readFileSync(recordPath, 'utf-8');
const credentialNames = [CLIENT_ID_ENV_VAR, CLIENT_SECRET_ENV_VAR, PUBLISHER_SID_ENV_VAR];

describe('the audit CLI is a one-way, fail-closed evidence tool', () => {
  it('requires an output outside the repository', () => {
    expect(() => resolveAuditOutputPath(path.join(repoRoot, 'audit.json'), repoRoot)).toThrow('output-inside-repository');
    expect(resolveAuditOutputPath('/tmp/specsmith-audit.json', repoRoot)).toBe('/tmp/specsmith-audit.json');
  });

  it('accepts only the bounded command-line surface', () => {
    expect(parseArgs(['--out', '/tmp/audit.json'])).toMatchObject({ requestsPerMinute: 90 });
    expect(() => parseArgs([])).toThrow('argument-invalid');
    expect(() => parseArgs(['--out', '/tmp/audit.json', '--gpu', 'rtx5070'])).toThrow('argument-invalid');
    expect(() => parseArgs(['--out', '/tmp/audit.json', '--requests-per-minute', '101'])).toThrow('argument-invalid');
  });

  it('performs the complete sweep and reuses the publication coverage gate before writing', () => {
    expect(cli).toContain('sweepOffers({ catalog');
    expect(cli).toContain('expectedGpuIds: catalog.map((gpu) => gpu.id)');
    expect(cli.indexOf('buildSnapshot({')).toBeLessThan(cli.indexOf('fs.writeFileSync('));
    expect(cli).not.toMatch(/--gpu|--limit/);
  });

  it('writes exactly one new owner-only file and never modifies the checkout', () => {
    expect(cli.match(/fs\.writeFileSync\(/g)).toHaveLength(1);
    expect(cli).toContain("mode: 0o600, flag: 'wx'");
    expect(cli).not.toMatch(/renameSync|appendFile|GITHUB_STEP_SUMMARY|public\/data|git\s+(add|commit|push)/);
  });

  it('uses the existing credential boundary and never names a long-lived secret', () => {
    expect(cli).toContain('readAccessToken()');
    expect(record).not.toContain('process.env');
    for (const name of credentialNames) {
      expect(cli, name).not.toContain(name);
      expect(record, name).not.toContain(name);
    }
  });

  it('logs only closed categories and the counts-only description', () => {
    const logLines = cli.split('\n').filter((line) => /console\.(error|log)/.test(line));
    expect(logLines).not.toHaveLength(0);
    for (const line of logLines) {
      expect(line).not.toMatch(/productName|\.title|JSON\.stringify|options\.out|cause\.message/);
    }
  });

  it('has a deliberately narrow artifact schema', () => {
    expect(AUDIT_ROW_KEYS).toEqual([
      'gpuId',
      'catalogName',
      'title',
      'titleRefused',
      'detectedModel',
      'detectedSuffixes',
      'modelMentionCount',
      'expectedMemoryGb',
      'titleMemoryGb',
      'memoryFromDescriptionOnly',
    ]);
    for (const forbidden of ['price', 'url', 'sku', 'upc', 'affiliate', 'xml', 'token']) {
      expect(AUDIT_ROW_KEYS.join(' ').toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('derives review evidence with the matcher itself, not a second parser', () => {
    expect(record).toContain("from '../rakuten/gpuModelMatch'");
    expect(record).toContain('findGpuMentions(');
    expect(record).toContain('findMemorySizes(');
    expect(record).toContain('mentionKey(');
    expect(record).not.toMatch(/new RegExp\([^)]*(rtx|radeon|arc)/i);
  });
});

describe('the audit workflow is manual, temporary and non-publishing', () => {
  it('has only workflow_dispatch — no push, PR or schedule', () => {
    expect(body).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(body).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule):/m);
  });

  it('has read-only permissions, an exact checkout and no persisted git credential', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(body).toContain('ref: ${{ github.sha }}');
    expect(body).toContain('persist-credentials: false');
    expect(body).not.toContain('contents: write');
  });

  it('pins every action to a 40-character SHA with a reviewable version comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses).toHaveLength(4);
    for (const [, ref, comment] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(comment.trim()).toMatch(/^#\s*v\d/);
    }
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });

  it('uses the same audited shared-action pins as the live validation workflow', () => {
    const refsOf = (text: string): Set<string> =>
      new Set([...text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/g)].map((match) => match[1]));
    const live = refsOf(
      fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'validate-rakuten-gpu-coverage.yml'), 'utf-8'),
    );
    const shared = [...refsOf(yaml)].filter(
      (ref) => ref.startsWith('actions/checkout@') || ref.startsWith('actions/setup-node@') || ref.startsWith('pnpm/action-setup@'),
    );
    expect(shared).toHaveLength(3);
    for (const ref of shared) expect(live.has(ref), ref).toBe(true);
  });

  it('expands the three long-lived secrets exactly once in one step', () => {
    const references = [...body.matchAll(/\$\{\{\s*secrets\.([A-Z_]+)\s*\}\}/g)].map((match) => match[1]);
    expect(references).toEqual(credentialNames);
    const lines = body.split('\n');
    const indices = lines.flatMap((line, index) => (line.includes('${{ secrets.') ? [index] : []));
    expect(indices[indices.length - 1] - indices[0]).toBe(credentialNames.length - 1);
    expect(body).not.toContain(`secrets.${ACCESS_TOKEN_ENV_VAR}`);
  });

  it('keeps the minted token inside the credential step and outside the artifact', () => {
    const credentialStep = body.slice(
      body.indexOf('Mint an access token and build the review artifact'),
      body.indexOf('Upload the audit for review'),
    );
    expect(credentialStep).toContain('umask 077');
    expect(credentialStep).toContain('export RAKUTEN_API_ACCESS_TOKEN');
    expect(credentialStep).not.toContain('GITHUB_ENV');
    const afterCredentialStep = body.slice(body.indexOf('Upload the audit for review'));
    expect(afterCredentialStep).not.toContain('secrets.');
    expect(afterCredentialStep).not.toContain(ACCESS_TOKEN_ENV_VAR);
    for (const name of credentialNames) expect(afterCredentialStep).not.toContain(name);
  });

  it('uploads exactly the one review file for one day', () => {
    expect(body).toContain('path: ${{ runner.temp }}/audit/accepted-offers.json');
    expect(body).toContain('retention-days: 1');
    expect(body).toContain('if-no-files-found: error');
    expect(body).not.toMatch(/upload-artifact[\s\S]*path:\s*(\.|artifacts\/SpecSmith|\$\{\{\s*github\.workspace)/);
  });

  it('does not print, summarize, publish or commit the artifact', () => {
    for (const forbidden of [
      'GITHUB_STEP_SUMMARY',
      'cat "${RUNNER_TEMP}/audit',
      'jq ',
      'head ',
      'tail ',
      'public/data',
      'git add',
      'git commit',
      'git push',
      'write-gpu-offer-snapshot',
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('runs all relevant tests and verifies that the checkout stayed clean', () => {
    expect(body).toContain('scripts/retail/audit');
    expect(body).toContain('scripts/retail/rakuten');
    expect(body).toContain('scripts/retail/snapshot');
    expect(body).toContain('src/lib/retail');
    expect(body).toContain('git status --porcelain');
  });
});

describe('the review tier cannot enter browser code', () => {
  it('is not imported anywhere under src', () => {
    const srcRoot = path.join(appRoot, 'src');
    const visit = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? visit(full) : [full];
      });
    for (const file of visit(srcRoot).filter((file) => /\.(ts|tsx)$/.test(file))) {
      expect(fs.readFileSync(file, 'utf-8'), file).not.toMatch(/retail\/audit|auditRecord|accepted-offers/);
    }
  });
});
