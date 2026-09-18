export const SITE_ORIGIN = 'https://specsmithpc.com';

export interface SearchMetric {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface InspectionSummary {
  url: string;
  verdict: string;
  coverageState: string;
  indexingState: string;
  pageFetchState: string;
  robotsTxtState: string;
  userCanonical?: string;
  googleCanonical?: string;
  lastCrawlTime?: string;
  inspectionLink?: string;
}

export interface PriorityCandidate extends InspectionSummary {
  metric: SearchMetric;
  priorityScore: number;
  reasons: string[];
}

export function parseSitemap(xml: string, expectedOrigin = SITE_ORIGIN): string[] {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  if (urls.length === 0) throw new Error('The sitemap contains no <loc> URLs.');
  const unique = [...new Set(urls)];
  for (const value of unique) {
    const url = new URL(value);
    if (url.origin !== expectedOrigin) {
      throw new Error(`Refusing sitemap URL outside ${expectedOrigin}: ${value}`);
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`Refusing non-canonical sitemap URL: ${value}`);
    }
  }
  return unique;
}

const CORE_PRIORITY: Record<string, number> = {
  '/': 120,
  '/builder': 115,
  '/compare': 105,
  '/upgrade': 100,
  '/upgrade-cpu': 98,
  '/gpu-tier-list': 95,
  '/cpu-tier-list': 95,
  '/best-gpu': 90,
  '/best-cpu': 90,
  '/parts-guides': 88,
  '/best-motherboard': 85,
};

function canonicalPathname(url: string): string {
  return new URL(url).pathname.replace(/\/$/, '') || '/';
}

function editorialPriority(url: string): number {
  const pathname = canonicalPathname(url);
  const hubBonus = pathname.split('/').filter(Boolean).length === 1 ? 10 : 0;
  return (CORE_PRIORITY[pathname] ?? 30) + hubBonus;
}

/**
 * Selects a deterministic, bounded set of the site's most important canonical
 * pages. This intentionally uses editorial route importance only: provider
 * metrics can be incomplete for pages that have not yet been crawled.
 */
export function selectHighestValueUrls(sitemapUrls: string[], limit = 20): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('The highest-value URL limit must be an integer from 1 to 100.');
  }
  return [...new Set(sitemapUrls)]
    .sort((a, b) => editorialPriority(b) - editorialPriority(a) || a.localeCompare(b))
    .slice(0, limit);
}

function indexed(inspection: InspectionSummary): boolean {
  const state = inspection.coverageState.toLowerCase();
  return inspection.verdict === 'PASS' || (state.includes('indexed') && !state.includes('not indexed'));
}

function hasTechnicalBlock(inspection: InspectionSummary): boolean {
  const values = [inspection.indexingState, inspection.pageFetchState, inspection.robotsTxtState]
    .join(' ')
    .toUpperCase();
  if (/BLOCK|DISALLOW|DENIED|ERROR|NOT_FOUND|SOFT_404/.test(values)) return true;
  return Boolean(
    inspection.userCanonical &&
    inspection.googleCanonical &&
    inspection.userCanonical !== inspection.googleCanonical
  );
}

export function buildGoogleRequestQueue(
  inspections: InspectionSummary[],
  metricsByUrl: Map<string, SearchMetric>,
  limit = 10,
): { requestQueue: PriorityCandidate[]; needsFix: PriorityCandidate[]; indexedCount: number } {
  const candidates: PriorityCandidate[] = [];
  let indexedCount = 0;

  for (const inspection of inspections) {
    if (indexed(inspection)) {
      indexedCount += 1;
      continue;
    }
    const metric = metricsByUrl.get(inspection.url) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const pathname = canonicalPathname(inspection.url);
    const reasons: string[] = [];
    let priorityScore = editorialPriority(inspection.url);

    if (metric.impressions > 0) {
      priorityScore += Math.min(40, Math.log2(metric.impressions + 1) * 8);
      reasons.push(`${metric.impressions} recent Google impressions`);
    }
    if (metric.clicks > 0) {
      priorityScore += Math.min(30, metric.clicks * 5);
      reasons.push(`${metric.clicks} recent Google clicks`);
    }
    if (metric.position > 0 && metric.position <= 10) {
      priorityScore += 20;
      reasons.push(`average position ${metric.position.toFixed(1)}`);
    }
    if (CORE_PRIORITY[pathname]) reasons.push('core SpecSmith page');
    if (pathname.split('/').filter(Boolean).length === 1) {
      reasons.push('hub or primary tool page');
    }
    if (reasons.length === 0) reasons.push('present in the canonical sitemap');

    candidates.push({ ...inspection, metric, priorityScore, reasons });
  }

  const ordered = candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.url.localeCompare(b.url));
  const needsFix = ordered.filter(hasTechnicalBlock);
  const requestQueue = ordered.filter((item) => !hasTechnicalBlock(item)).slice(0, limit);
  return { requestQueue, needsFix, indexedCount };
}

const ROUTE_GROUPS: Array<[RegExp, string[]]> = [
  [/(GpuUpgradePage|upgradePages)\.(?:ts|tsx)$/, ['/upgrade', '/upgrade/']],
  [/(CpuUpgradePage|cpuUpgradePages)\.(?:ts|tsx)$/, ['/upgrade-cpu', '/upgrade-cpu/']],
  [/(BestGpuForGame|gamePages)\.(?:ts|tsx)$/, ['/best-gpu', '/best-gpu/']],
  [/(BestCpuForGame|cpuGamePages)\.(?:ts|tsx)$/, ['/best-cpu', '/best-cpu/']],
  [/(Matchup|matchups)\.(?:ts|tsx)$/, ['/vs', '/vs/']],
  [/(GpuTierList)\.tsx$/, ['/gpu-tier-list']],
  [/(CpuTierList)\.tsx$/, ['/cpu-tier-list']],
  [/(Builder)\.tsx$/, ['/builder']],
  [/(Compare)\.tsx$/, ['/compare']],
  [/(Home)\.tsx$/, ['/']],
];

export function selectIndexNowUrls(
  sitemapUrls: string[],
  previousSitemapUrls: string[],
  changedFiles: string[],
): string[] {
  const selected = new Set(sitemapUrls.filter((url) => !previousSitemapUrls.includes(url)));
  const production = changedFiles.filter((file) =>
    file.startsWith('artifacts/SpecSmith/src/') ||
    file === 'artifacts/SpecSmith/scripts/prerender.mjs' ||
    file === 'artifacts/SpecSmith/public/sitemap.xml',
  );

  if (production.some((file) => /(?:entry-server|App|seo)\.(?:ts|tsx)$/.test(file) || file.endsWith('/scripts/prerender.mjs'))) return sitemapUrls;
  if (production.some((file) => file.includes('/components/') || file.includes('/data/'))) return sitemapUrls;

  for (const file of production) {
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(file)) continue;
    let matched = false;
    for (const [pattern, prefixes] of ROUTE_GROUPS) {
      if (!pattern.test(file)) continue;
      matched = true;
      for (const url of sitemapUrls) {
        const path = new URL(url).pathname.replace(/\/$/, '') || '/';
        if (prefixes.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix.slice(0, -1) + '/') : path === prefix)) {
          selected.add(url);
        }
      }
    }
    // Unknown production code may feed multiple generated pages. Conservatism
    // is preferable here: IndexNow permits the site's canonical URLs, while a
    // guessed partial map could silently miss a materially changed page.
    if (!matched && /\.(?:ts|tsx)$/.test(file)) return sitemapUrls;
  }
  return [...selected].sort();
}
