import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { main, parseArgs, resolveAuditOutputPath } from './audit-retailer-links';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');

function tempReportPath(): string {
  return path.join(os.tmpdir(), `specsmith-retailer-link-audit-${crypto.randomUUID()}.json`);
}

describe('the CLI is a bounded, fail-closed, credential-free evidence tool', () => {
  it('requires an output outside the repository', () => {
    expect(() => resolveAuditOutputPath(path.join(repoRoot, 'audit.json'), repoRoot)).toThrow('output-inside-repository');
    expect(resolveAuditOutputPath('/tmp/specsmith-retailer-link-audit.json', repoRoot)).toBe('/tmp/specsmith-retailer-link-audit.json');
  });

  it('accepts only the bounded command-line surface', () => {
    expect(parseArgs(['--out', '/tmp/audit.json'])).toMatchObject({});
    expect(() => parseArgs([])).toThrow('argument-invalid');
    expect(() => parseArgs(['--out', '/tmp/audit.json', '--gpu', 'rtx5070'])).toThrow('argument-invalid');
  });

  it('reads no environment variable and makes no network call in its own source', () => {
    const source = fs.readFileSync(path.join(here, 'audit-retailer-links.ts'), 'utf-8');
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

describe('a full run against the real repository catalogs', () => {
  it('completes deterministically, writes a report outside the repo, and reports real counts', async () => {
    const out = tempReportPath();
    let exitCode: number;
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    try {
      exitCode = await main(['--out', out]);
    } finally {
      console.error = originalError;
    }

    expect(fs.existsSync(out)).toBe(true);
    const report = JSON.parse(fs.readFileSync(out, 'utf-8'));
    fs.unlinkSync(out);

    // 500 retail-parts-catalog rows (one per SKU) + 2 rows (Amazon, Newegg)
    // per core-selector part. Both counts come straight off today's real,
    // committed data, so a real drop in either catalog's size — not just a
    // code change here — is what would move this assertion.
    const bySource = new Map<string, number>();
    for (const row of report.rows) bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
    expect(bySource.get('retail-parts-catalog')).toBe(500);
    expect((bySource.get('core-selector') ?? 0) % 2).toBe(0);
    expect(bySource.get('core-selector')).toBeGreaterThan(0);

    // The finding this audit exists to surface: every core-selector link is a
    // fallback search today, never exact — and it is never silently reported
    // any other way.
    const coreSelectorRows = report.rows.filter((row: { source: string }) => row.source === 'core-selector');
    expect(coreSelectorRows.every((row: { urlType: string }) => row.urlType === 'fallback-search')).toBe(true);
    expect(coreSelectorRows.every((row: { status: string }) => row.status === 'fail')).toBe(true);

    // A generic search link is never counted as exact coverage anywhere in the report.
    for (const row of report.rows) {
      if (row.urlType === 'fallback-search') expect(row.status).toBe('fail');
    }

    expect(logs.join('\n')).toContain('Retailer link integrity audit');
    expect(exitCode).toBe(0);
  });

  it('refuses to write inside the repository', async () => {
    const inside = path.join(repoRoot, 'retailer-link-audit-should-not-exist.json');
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    let exitCode: number;
    try {
      exitCode = await main(['--out', inside]);
    } finally {
      console.error = originalError;
    }
    expect(exitCode).toBe(1);
    expect(fs.existsSync(inside)).toBe(false);
  });
});
