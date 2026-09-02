import { describe, expect, it } from 'vitest';

import { renderLinkAuditSummary, statusFor, summarizeLinkAudit, UNTRUSTED_URL_TYPES, type LinkAuditReport, type LinkAuditRow } from './linkAuditReport';

function row(overrides: Partial<LinkAuditRow>): LinkAuditRow {
  return {
    partId: 'p1',
    intendedProduct: 'RTX 5090',
    source: 'core-selector',
    category: 'gpu',
    retailer: 'Amazon',
    urlType: 'fallback-search',
    attributed: false,
    evidence: 'search-path-shape',
    status: 'fail',
    ...overrides,
  };
}

describe('statusFor', () => {
  it('passes only exact and attributed', () => {
    expect(statusFor('exact', true)).toBe('pass');
    expect(statusFor('exact', false)).toBe('fail');
    expect(statusFor('fallback-search', true)).toBe('fail');
  });
});

describe('summarizeLinkAudit', () => {
  it('counts by source, retailer and url type without leaking any row-level field', () => {
    const report: LinkAuditReport = {
      generatedAt: '2026-09-02T00:00:00.000Z',
      rows: [
        row({ source: 'core-selector', retailer: 'Amazon', urlType: 'fallback-search', status: 'fail' }),
        row({ source: 'core-selector', retailer: 'Newegg', urlType: 'fallback-search', status: 'fail' }),
        row({ source: 'retail-parts-catalog', retailer: 'Newegg', urlType: 'exact', attributed: true, status: 'pass' }),
      ],
    };
    const summary = summarizeLinkAudit(report);
    expect(summary.totalRows).toBe(3);
    expect(summary.passCount).toBe(1);
    expect(summary.failCount).toBe(2);
    expect(summary.bySource['core-selector']).toEqual({ total: 2, pass: 0 });
    expect(summary.bySource['retail-parts-catalog']).toEqual({ total: 1, pass: 1 });
    expect(summary.byRetailer.Amazon).toEqual({ total: 1, pass: 0 });
    expect(summary.byUrlType['fallback-search']).toBe(2);
    expect(summary.byUrlType.exact).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('p1');
  });
});

describe('renderLinkAuditSummary', () => {
  it('renders counts only, never a part id, name, url or evidence string', () => {
    const report: LinkAuditReport = { generatedAt: '2026-09-02T00:00:00.000Z', rows: [row({})] };
    const text = renderLinkAuditSummary(summarizeLinkAudit(report));
    expect(text).toContain('Retailer link integrity audit');
    expect(text).not.toContain('p1');
    expect(text).not.toContain('RTX 5090');
    expect(text).not.toContain('http');
  });
});

describe('UNTRUSTED_URL_TYPES', () => {
  it('never treats a known, documented outcome as untrusted', () => {
    expect(UNTRUSTED_URL_TYPES).not.toContain('exact');
    expect(UNTRUSTED_URL_TYPES).not.toContain('fallback-search');
    expect(UNTRUSTED_URL_TYPES).not.toContain('missing');
  });

  it('treats every low-confidence outcome as untrusted', () => {
    expect(UNTRUSTED_URL_TYPES).toEqual(expect.arrayContaining(['malformed', 'wrong-domain', 'ambiguous', 'unverifiable']));
  });
});
