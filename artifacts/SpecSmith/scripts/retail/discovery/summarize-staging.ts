// Prints a human-readable report of a staging file for review (issue #192).
//
//   pnpm exec tsx scripts/retail/discovery/summarize-staging.ts /path/to/staged-parts.json
//
// The report is written to a CI job log, so it deliberately carries NO URLs:
// tracked links embed affiliate site and offer ids, and image URLs add
// nothing a reviewer needs here. Titles, retailer SKUs, UPC-based dedupe
// keys, canonical proposals and counts are enough to judge the run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StagingFile } from './discoverParts';

/**
 * Feed text is untrusted. Remove anything URL-like and every control
 * character (a newline could start a fresh log line, including a GitHub
 * workflow command), so the report stays URL-free whatever the feed sends.
 */
export function logSafe(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, '[link removed]')
    .replace(/\S*(?:linksynergy|click\.linksynergy|murl=|offerid=|subid=)\S*/gi, '[link removed]');
}

export function summarizeStaging(staging: StagingFile): string {
  const lines: string[] = [];
  lines.push(`Staging report (generated ${staging.generatedAt}, publication: ${staging.publication})`);
  lines.push('');
  lines.push('Searches:');
  for (const s of staging.searches) {
    const rejected = Object.entries(s.rejected).map(([reason, n]) => `${reason}=${n}`).join(', ') || 'none';
    lines.push(`  ${s.category.padEnd(12)} ${s.outcome.padEnd(15)} seen=${s.listingsSeen} accepted=${s.accepted} rejected: ${rejected}${s.leafObserved ? '' : ' (leaf not yet observed live)'}`);
  }

  const merged = staging.candidates.filter((c) => c.listings.length > 1);
  const proposed = staging.candidates.filter((c) => c.canonical.status === 'proposed');
  const ambiguousMatch = staging.candidates.filter((c) => c.canonical.status === 'ambiguous');
  lines.push('');
  lines.push(`Totals: ${staging.candidates.length} staged candidates, ${merged.length} merged duplicate groups, ${staging.ambiguous.length} ambiguous UPC groups, ${proposed.length} canonical proposals, ${ambiguousMatch.length} ambiguous canonical matches.`);

  lines.push('');
  lines.push('Candidates (tier | category | dedupe key | listings | canonical | title):');
  for (const c of staging.candidates) {
    const canonical = c.canonical.status === 'proposed'
      ? `-> ${c.canonical.canonicalId}`
      : c.canonical.status === 'ambiguous' ? `ambiguous(${c.canonical.candidates.join('/')})` : 'none';
    lines.push(`  ${c.generation.tier.padEnd(12)} ${c.category.padEnd(11)} ${logSafe(c.dedupeKey).padEnd(22)} x${c.listings.length} ${canonical.padEnd(22)} ${logSafe(c.title)}`);
  }

  lines.push('');
  lines.push('Merged duplicates (same UPC, agreeing titles):');
  for (const c of merged) {
    lines.push(`  ${logSafe(c.dedupeKey)}: ${c.listings.map((l) => `${logSafe(l.retailerSku)} "${logSafe(l.title)}"`).join(' | ')}`);
  }
  if (merged.length === 0) lines.push('  none');

  lines.push('');
  lines.push('Ambiguous UPC groups (not merged; need a person):');
  for (const g of staging.ambiguous) {
    lines.push(`  ${logSafe(g.dedupeKey)}: ${g.listings.map((l) => `${logSafe(l.retailerSku)} "${logSafe(l.title)}"`).join(' | ')}`);
  }
  if (staging.ambiguous.length === 0) lines.push('  none');
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: summarize-staging.ts <staged-parts.json>');
    process.exitCode = 1;
  } else {
    console.log(summarizeStaging(JSON.parse(fs.readFileSync(file, 'utf-8')) as StagingFile));
  }
}
