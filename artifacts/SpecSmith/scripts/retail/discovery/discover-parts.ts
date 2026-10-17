// Discovers new parts on the Newegg feed and writes a STAGING file (issue #192).
//
//   RAKUTEN_API_ACCESS_TOKEN=... pnpm exec tsx scripts/retail/discovery/discover-parts.ts --out /tmp/staged.json
//
// The output path must be OUTSIDE the repository, the same rule the catalogue
// generator enforces: this job has no business writing any repository file,
// and the published catalogue (src/data, public/data) is never opened for
// writing. A search that fails is recorded in the report and the run carries
// on; a staging file is a review queue, not a gate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cpuCatalogData from '../../../src/data/cpus.json';
import { fetchProductSearchXml, findItems, loadGpuCatalog, parseProductSearchXml, readAccessToken } from '../rakuten';
import { readShortDescription } from '../rakuten/admitOffer';
import { DEFAULT_REQUESTS_PER_MINUTE, RateLimiter } from '../coverage/rateLimiter';
import { resolveCatalogOutputPath } from '../catalog/generate-affiliate-catalog';
import { DISCOVERY_PAGE_SIZE, DISCOVERY_SEARCHES, type DiscoverySearch } from './discoveryConfig';
import {
  admitDiscoveredListing,
  stageListings,
  STAGING_SCHEMA_VERSION,
  type CatalogContext,
  type DiscoveredListing,
  type SearchReport,
  type StagingFile,
} from './discoverParts';

export interface DiscoveryDeps {
  /** Returns the raw feed XML for one search, plus when it was read. */
  fetchSearch(search: DiscoverySearch): Promise<{ xml: string; fetchedAt: string }>;
  now(): string;
  context: CatalogContext;
}

export async function runDiscovery(
  deps: DiscoveryDeps,
  searches: readonly DiscoverySearch[] = DISCOVERY_SEARCHES,
): Promise<StagingFile> {
  const accepted: DiscoveredListing[] = [];
  const descriptions = new Map<string, string>();
  const reports: SearchReport[] = [];

  for (const search of searches) {
    const report: SearchReport = {
      category: search.category,
      keyword: search.keyword,
      categoryLeaf: search.categoryLeaf,
      leafObserved: search.leafObserved,
      outcome: 'ok',
      listingsSeen: 0,
      accepted: 0,
      rejected: {},
    };
    try {
      const response = await deps.fetchSearch(search);
      const items = findItems(parseProductSearchXml(response.xml));
      report.listingsSeen = items.length;
      for (const item of items) {
        const admission = admitDiscoveredListing(item, search, response.fetchedAt);
        if (admission.status === 'accepted') {
          accepted.push(admission.listing);
          descriptions.set(admission.listing.retailerSku, readShortDescription(item) ?? '');
          report.accepted += 1;
        } else {
          report.rejected[admission.reason] = (report.rejected[admission.reason] ?? 0) + 1;
        }
      }
    } catch {
      // No detail is kept: an error message from the client could carry a URL.
      report.outcome = 'request-failed';
    }
    reports.push(report);
  }

  const staged = stageListings(accepted, deps.context, descriptions);
  return {
    schemaVersion: STAGING_SCHEMA_VERSION,
    publication: 'staged-not-published',
    source: 'rakuten-linkshare-newegg',
    generatedAt: deps.now(),
    searches: reports,
    candidates: staged.candidates,
    ambiguous: staged.ambiguous,
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

export function parseArgs(argv: readonly string[]): { out: string } {
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1]) throw new Error('usage: --out <path outside the repository>');
  return { out: resolveCatalogOutputPath(argv[1], repoRoot) };
}

/**
 * The lexical check in parseArgs can be fooled by a symlinked directory that
 * points into the checkout. Re-check the real directory the file would land
 * in; the write itself uses O_EXCL ('wx'), so the file cannot be a symlink.
 */
export function resolveRealOutputPath(out: string, root: string = repoRoot): string {
  const realDir = fs.realpathSync(path.dirname(out));
  return resolveCatalogOutputPath(path.join(realDir, path.basename(out)), fs.realpathSync(root));
}

export function writeStagingFile(out: string, staging: StagingFile): void {
  fs.writeFileSync(out, `${JSON.stringify(staging, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
}

export function liveDeps(): DiscoveryDeps {
  readAccessToken();
  const limiter = new RateLimiter(DEFAULT_REQUESTS_PER_MINUTE);
  return {
    async fetchSearch(search) {
      await limiter.acquire();
      const response = await fetchProductSearchXml({
        keyword: search.keyword,
        categoryLeaf: search.categoryLeaf,
        max: DISCOVERY_PAGE_SIZE,
        pageNumber: 1,
      });
      return { xml: response.xml, fetchedAt: response.fetchedAt };
    },
    now: () => new Date().toISOString(),
    context: {
      gpus: loadGpuCatalog(),
      cpus: (cpuCatalogData as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name })),
    },
  };
}

export async function main(argv: readonly string[], deps: () => DiscoveryDeps = liveDeps): Promise<number> {
  let out: string;
  try {
    ({ out } = parseArgs(argv));
    if (!fs.existsSync(path.dirname(out))) throw new Error('output directory missing');
    out = resolveRealOutputPath(out);
  } catch (cause) {
    console.error(`Part discovery refused: ${(cause as Error).message}. Nothing was written.`);
    return 1;
  }
  try {
    const staging = await runDiscovery(deps());
    writeStagingFile(out, staging);
    const failed = staging.searches.filter((s) => s.outcome === 'request-failed').map((s) => s.category);
    console.error(
      `Staged ${staging.candidates.length} candidates (${staging.ambiguous.length} ambiguous groups) from ${staging.searches.length} searches.` +
        (failed.length ? ` Failed searches: ${failed.join(', ')}.` : ''),
    );
    return 0;
  } catch {
    console.error('Part discovery failed. Nothing was written.');
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
