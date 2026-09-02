// The shared row shape and safe rendering for the retailer-link integrity
// audit. See `audit-retailer-links.ts` for the CLI that produces one of
// these from the two audit sources.
//
// WHAT MAY APPEAR IN A ROW
// ------------------------
// `intendedProduct` carries a product name. For a `retail-parts-catalog` row
// that name is the merchant's own listing title — already published, verbatim,
// in the committed `public/data/retail-parts.json` this audit reads, so
// nothing new is exposed by repeating it here. For a `core-selector` row it is
// SpecSmith's own maintained catalog name ("RTX 5090"), never merchant text.
// Nothing else here is free text: `evidence` is the closed vocabulary from
// `linkIntegrity.ts`, and no URL, token or credential is ever stored on a row.

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { ALL_LINK_URL_TYPES, type LinkEvidence, type LinkUrlType } from './linkIntegrity';

export type LinkAuditSource = 'retail-parts-catalog' | 'core-selector';
export type LinkAuditRetailer = 'Amazon' | 'Newegg';
export type LinkAuditStatus = 'pass' | 'fail';

export interface LinkAuditRow {
  partId: string;
  intendedProduct: string;
  source: LinkAuditSource;
  category: RetailPartCategory;
  retailer: LinkAuditRetailer;
  urlType: LinkUrlType;
  attributed: boolean;
  evidence: LinkEvidence;
  /** 'pass' only for an exact, attributed link. Every other outcome fails closed. */
  status: LinkAuditStatus;
}

/** A row is 'pass' only when the destination is exact AND the network's own attribution is present. */
export const statusFor = (urlType: LinkUrlType, attributed: boolean): LinkAuditStatus =>
  urlType === 'exact' && attributed ? 'pass' : 'fail';

export interface LinkAuditReport {
  generatedAt: string;
  rows: LinkAuditRow[];
}

export interface LinkAuditSummary {
  generatedAt: string;
  totalRows: number;
  passCount: number;
  failCount: number;
  bySource: Record<LinkAuditSource, { total: number; pass: number }>;
  byRetailer: Record<LinkAuditRetailer, { total: number; pass: number }>;
  byUrlType: Record<LinkUrlType, number>;
}

/** Counts only — safe for a CI log. No part id, name, URL or evidence string. */
export function summarizeLinkAudit(report: LinkAuditReport): LinkAuditSummary {
  const byUrlType = Object.fromEntries(ALL_LINK_URL_TYPES.map((t) => [t, 0])) as Record<LinkUrlType, number>;
  const bySource: LinkAuditSummary['bySource'] = {
    'retail-parts-catalog': { total: 0, pass: 0 },
    'core-selector': { total: 0, pass: 0 },
  };
  const byRetailer: LinkAuditSummary['byRetailer'] = {
    Amazon: { total: 0, pass: 0 },
    Newegg: { total: 0, pass: 0 },
  };

  let passCount = 0;
  for (const row of report.rows) {
    byUrlType[row.urlType] += 1;
    bySource[row.source].total += 1;
    byRetailer[row.retailer].total += 1;
    if (row.status === 'pass') {
      passCount += 1;
      bySource[row.source].pass += 1;
      byRetailer[row.retailer].pass += 1;
    }
  }

  return {
    generatedAt: report.generatedAt,
    totalRows: report.rows.length,
    passCount,
    failCount: report.rows.length - passCount,
    bySource,
    byRetailer,
    byUrlType,
  };
}

const pct = (n: number, of: number): string => (of === 0 ? '  n/a' : `${((n / of) * 100).toFixed(1).padStart(5)}%`);
const num = (n: number, w: number) => String(n).padStart(w);
const pad = (s: string, n: number) => s.padEnd(n);

/** Renders the counts-only summary as plain text. Safe for stdout / CI logs. */
export function renderLinkAuditSummary(summary: LinkAuditSummary): string {
  const lines: string[] = [];
  lines.push('Retailer link integrity audit');
  lines.push('='.repeat(60));
  lines.push(`Generated  ${summary.generatedAt}`);
  lines.push(`Rows       ${num(summary.totalRows, 6)}`);
  lines.push(`Pass       ${num(summary.passCount, 6)}   ${pct(summary.passCount, summary.totalRows)} (exact AND attributed)`);
  lines.push(`Fail       ${num(summary.failCount, 6)}   ${pct(summary.failCount, summary.totalRows)}`);
  lines.push('');

  lines.push('By source');
  for (const [source, counts] of Object.entries(summary.bySource)) {
    lines.push(`  ${pad(source, 24)} ${num(counts.pass, 6)} / ${num(counts.total, 6)}   ${pct(counts.pass, counts.total)}`);
  }
  lines.push('');

  lines.push('By retailer');
  for (const [retailer, counts] of Object.entries(summary.byRetailer)) {
    lines.push(`  ${pad(retailer, 24)} ${num(counts.pass, 6)} / ${num(counts.total, 6)}   ${pct(counts.pass, counts.total)}`);
  }
  lines.push('');

  lines.push('By URL type (never counts a search link as exact coverage)');
  for (const type of ALL_LINK_URL_TYPES) {
    lines.push(`  ${pad(type, 24)} ${num(summary.byUrlType[type], 6)}`);
  }

  return lines.join('\n');
}

/** URL types that mean the audit could not trust the link at all. These fail the run closed. */
export const UNTRUSTED_URL_TYPES: readonly LinkUrlType[] = ['malformed', 'wrong-domain', 'ambiguous', 'unverifiable'];
