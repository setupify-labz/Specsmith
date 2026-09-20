import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bingRead, googleAccessToken, googlePageMetrics, inspectGoogleUrl, type GoogleServiceAccount } from './clients';
import { buildGoogleRequestQueue, parseSitemap, SITE_ORIGIN, type InspectionSummary } from './core';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

function isoDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function mapBounded<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      result[index] = await work(values[index]);
    }
  }));
  return result;
}

function markdown(report: Record<string, any>): string {
  const queue = report.google.manualRequestQueue as Array<any>;
  const fixes = report.google.needsTechnicalFix as Array<any>;
  return `# SpecSmith search indexing audit

Generated: ${report.generatedAt}\
Sitemap URLs inspected: ${report.google.inspected}\
Google indexed: ${report.google.indexed}\
Google manual-request queue: ${queue.length}\
Technical blockers: ${fixes.length}

## Google manual-request queue

This is a prioritization aid, not an indexing guarantee. Request these through Search Console URL Inspection.

| # | URL | Coverage | Why |
|---:|---|---|---|
${queue.map((item, index) => `| ${index + 1} | ${item.url} | ${item.coverageState} | ${item.reasons.join('; ')} |`).join('\n') || '| — | None | — | — |'}

## Technical blockers to fix before requesting indexing

| URL | Coverage | Fetch | Robots |
|---|---|---|---|
${fixes.map((item) => `| ${item.url} | ${item.coverageState} | ${item.pageFetchState} | ${item.robotsTxtState} |`).join('\n') || '| None | — | — | — |'}

## Bing Webmaster read-only snapshot

The JSON report contains the unmodified Bing crawl, query, page, feed, and submission-quota responses. No Bing URL-submission call was made by this audit.
`;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sitemapPath = path.resolve(arg('--sitemap', path.join(root, 'dist', 'public', 'sitemap.xml')));
  const outDir = path.resolve(arg('--out', path.join(root, 'dist', 'search-indexing-audit')));
  const maxInspections = Number(arg('--max-inspections', '500'));
  const manualLimit = Number(arg('--manual-limit', '10'));
  if (!Number.isInteger(maxInspections) || maxInspections < 1 || maxInspections > 2_000) throw new Error('--max-inspections must be 1-2000.');
  if (!Number.isInteger(manualLimit) || manualLimit < 1 || manualLimit > 50) throw new Error('--manual-limit must be 1-50.');

  const googleJson = process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON;
  const bingKey = process.env.BING_WEBMASTER_API_KEY;
  if (!googleJson) throw new Error('GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON is not set.');
  if (!bingKey) throw new Error('BING_WEBMASTER_API_KEY is not set.');

  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(googleJson) as GoogleServiceAccount;
  } catch {
    throw new Error('GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }

  const urls = parseSitemap(await fs.readFile(sitemapPath, 'utf8')).slice(0, maxInspections);
  const siteProperty = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || 'sc-domain:specsmithpc.com';
  const token = await googleAccessToken(credentials);
  const metrics = await googlePageMetrics(siteProperty, token, isoDate(28), isoDate(1));
  const failures: Array<{ url: string; error: string }> = [];
  const inspections = (await mapBounded(urls, 3, async (url): Promise<InspectionSummary | null> => {
    try {
      return await inspectGoogleUrl(siteProperty, url, token);
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : 'Unknown inspection failure' });
      return null;
    }
  })).filter((value): value is InspectionSummary => value !== null);
  const queue = buildGoogleRequestQueue(inspections, metrics, manualLimit);

  const bingMethods = ['GetCrawlStats', 'GetQueryStats', 'GetPageStats', 'GetFeeds', 'GetUrlSubmissionQuota'] as const;
  const bing = Object.fromEntries(await Promise.all(bingMethods.map(async (method) => [
    method,
    await bingRead(method, SITE_ORIGIN, bingKey),
  ])));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { sitemapPath, siteOrigin: SITE_ORIGIN, googleProperty: siteProperty, analyticsWindow: { start: isoDate(28), end: isoDate(1) } },
    google: {
      sitemapUrls: urls.length,
      inspected: inspections.length,
      indexed: queue.indexedCount,
      inspectionFailures: failures,
      manualRequestQueue: queue.requestQueue,
      needsTechnicalFix: queue.needsFix,
      inspections,
    },
    bing,
    guarantees: {
      googleRequestsSubmitted: 0,
      bingUrlsSubmitted: 0,
      indexingGuaranteed: false,
    },
  };
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'search-indexing-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, 'search-indexing-audit.md'), markdown(report));
  console.log(`[search-indexing] inspected ${inspections.length}/${urls.length} Google URLs; ${queue.requestQueue.length} queued for manual review; ${queue.needsFix.length} need technical fixes.`);
  if (failures.length > 0) {
    console.error(`[search-indexing] ${failures.length} Google URL inspections failed; report preserved, run marked failed.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[search-indexing] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
