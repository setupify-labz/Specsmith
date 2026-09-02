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
//
// WHAT "pass" DOES AND DOES NOT MEAN — READ THIS BEFORE TRUSTING A COUNT
// ------------------------------------------------------------------------
// `status: 'pass'` means the URL's shape names one specific product page
// (`urlType: 'exact'`) AND carries SpecSmith's own known attribution. It does
// NOT mean an independent source confirmed the product behind that URL is
// the one SpecSmith intended — see `identityEvidence` below, and the longer
// explanation in `linkIntegrity.ts`'s module doc. A "500/500 pass" count is a
// real, useful signal (every one of those links is well-formed, points at a
// specific product, and is properly attributed) — it is not a claim that 500
// independent product-identity checks were performed, because none exist in
// this repository today.

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { ALL_LINK_URL_TYPES, type LinkEvidence, type LinkUrlType } from './linkIntegrity';

export type LinkAuditSource = 'retail-parts-catalog' | 'core-selector';
export type LinkAuditRetailer = 'Amazon' | 'Newegg';
export type LinkAuditStatus = 'pass' | 'fail';

/**
 * What evidence, if any, backs the claim that a link's declared product
 * identity is the one SpecSmith intended.
 *
 *   - 'self-consistent': the link's own declared id agrees with an id
 *     reconstructed from the catalog's own record — but both were derived
 *     from the SAME upstream listing, so this catches a record that
 *     contradicts itself (a swapped or corrupted link), not a record that is
 *     consistently wrong about which product it is.
 *   - 'shape-only': there was no expected identifier to compare against at
 *     all (e.g. no per-part affiliate link exists to check — the
 *     core-selector rows today). The urlType still reflects the URL's shape,
 *     with nothing behind it.
 *   - 'independent': reserved for a future check against a source that does
 *     not share provenance with the link itself (e.g. a stored manufacturer
 *     part number cross-checked separately). Not produced anywhere today —
 *     see the PR discussion on issue #85 for why.
 */
export type LinkIdentityEvidence = 'self-consistent' | 'shape-only' | 'independent';

/** Where the price shown beside this link comes from — never the price value itself, which goes stale immediately. */
export type LinkPriceSource =
  /** A retailer feed's own listing price, stamped with when it was read (see `fetchedAt` on `AffiliatePart`). */
  | 'retailer-feed'
  /** SpecSmith's own hand-maintained planning estimate (`price_usd` in `src/data/*.json`) — not a live retailer price. */
  | 'editorial-estimate';

export interface LinkAuditRow {
  partId: string;
  intendedProduct: string;
  source: LinkAuditSource;
  category: RetailPartCategory;
  retailer: LinkAuditRetailer;
  urlType: LinkUrlType;
  attributed: boolean;
  evidence: LinkEvidence;
  identityEvidence: LinkIdentityEvidence;
  priceSource: LinkPriceSource;
  /** 'pass' only for an exact, attributed link — see the module doc for exactly what that does and does not prove. */
  status: LinkAuditStatus;
}

/** A row is 'pass' only when the destination is exact AND SpecSmith's own attribution is present. */
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
  byIdentityEvidence: Record<LinkIdentityEvidence, number>;
  byPriceSource: Record<LinkPriceSource, number>;
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
  const byIdentityEvidence: LinkAuditSummary['byIdentityEvidence'] = { 'self-consistent': 0, 'shape-only': 0, independent: 0 };
  const byPriceSource: LinkAuditSummary['byPriceSource'] = { 'retailer-feed': 0, 'editorial-estimate': 0 };

  let passCount = 0;
  for (const row of report.rows) {
    byUrlType[row.urlType] += 1;
    bySource[row.source].total += 1;
    byRetailer[row.retailer].total += 1;
    byIdentityEvidence[row.identityEvidence] += 1;
    byPriceSource[row.priceSource] += 1;
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
    byIdentityEvidence,
    byPriceSource,
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
  lines.push(`Pass       ${num(summary.passCount, 6)}   ${pct(summary.passCount, summary.totalRows)} (exact AND attributed — see "pass" caveat below)`);
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
  lines.push('');

  lines.push('By identity evidence (what backs an "exact" classification — see the "pass" caveat below)');
  for (const [evidence, count] of Object.entries(summary.byIdentityEvidence)) {
    lines.push(`  ${pad(evidence, 24)} ${num(count, 6)}`);
  }
  lines.push('');

  lines.push('By displayed-price source');
  for (const [source, count] of Object.entries(summary.byPriceSource)) {
    lines.push(`  ${pad(source, 24)} ${num(count, 6)}`);
  }
  lines.push('');

  lines.push('"pass" means: the URL is shaped as one specific product page, and carries');
  lines.push('SpecSmith\'s own known attribution. It does NOT mean an independently sourced');
  lines.push('identifier confirmed the product is the one intended — "self-consistent" rows');
  lines.push('were only checked against the catalog\'s own record, not a second source.');

  return lines.join('\n');
}

/** URL types that mean the audit could not trust the link at all. These fail the run closed. */
export const UNTRUSTED_URL_TYPES: readonly LinkUrlType[] = ['malformed', 'wrong-domain', 'ambiguous', 'unverifiable'];
