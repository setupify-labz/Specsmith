// One-page diagnosis for catalogue searches whose reported result set is too
// large for the full walker. This command never walks page 2, selects parts,
// or writes a catalogue. Its only answer is the feed's page-one paging header.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import {
  assertPagingConsistent,
  classifyEmptyResult,
  fetchProductSearchXml,
  MAX_PAGES_PER_SEARCH,
  type ProductSearchQuery,
  type ProductSearchResponse,
} from '../rakuten/client';
import { parseProductSearchXml, readPageInfo } from '../rakuten/parseProductSearchXml';
import { RETAIL_CATEGORY_CONFIG, type RetailCategoryConfig } from './catalogConfig';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');

export const PREFLIGHT_CATEGORIES = ['motherboard', 'ram', 'keyboard'] as const satisfies readonly RetailPartCategory[];

export interface PagingPreflightRow {
  category: RetailPartCategory;
  keyword: string;
  categoryLeaf: string;
  totalPages: number;
  totalMatches: number | null;
  exceedsCurrentWalkerLimit: boolean;
  pagesRequested: 1;
}

export interface PagingPreflightReport {
  generatedAt: string;
  maxPagesPerSearch: number;
  pagesRequestedPerCategory: 1;
  catalogueWritten: false;
  rows: PagingPreflightRow[];
}

type FetchPageOne = (config: RetailCategoryConfig) => Promise<ProductSearchResponse>;

export function preflightQuery(config: RetailCategoryConfig): ProductSearchQuery {
  return {
    keyword: config.keyword,
    categoryLeaf: config.categoryLeaf,
    max: 100,
    pageNumber: 1,
  };
}

export async function inspectPageOne(
  configs: readonly RetailCategoryConfig[],
  fetchPageOne: FetchPageOne,
  generatedAt: string,
): Promise<PagingPreflightReport> {
  const rows: PagingPreflightRow[] = [];
  for (const config of configs) {
    const response = await fetchPageOne(config);
    const root = parseProductSearchXml(response.xml);
    const info = readPageInfo(root);
    const empty = classifyEmptyResult(root, info);

    if (empty.empty) {
      rows.push({
        category: config.category,
        keyword: config.keyword,
        categoryLeaf: config.categoryLeaf,
        totalPages: 0,
        totalMatches: 0,
        exceedsCurrentWalkerLimit: false,
        pagesRequested: 1,
      });
      continue;
    }

    assertPagingConsistent(info, 1, null);
    const totalPages = info.totalPages.value!;
    rows.push({
      category: config.category,
      keyword: config.keyword,
      categoryLeaf: config.categoryLeaf,
      totalPages,
      totalMatches: info.totalMatches.value,
      exceedsCurrentWalkerLimit: totalPages > MAX_PAGES_PER_SEARCH,
      pagesRequested: 1,
    });
  }

  return {
    generatedAt,
    maxPagesPerSearch: MAX_PAGES_PER_SEARCH,
    pagesRequestedPerCategory: 1,
    catalogueWritten: false,
    rows,
  };
}

export function resolvePreflightOutputPath(file: string, root: string = repoRoot): string {
  const output = path.resolve(file);
  const relative = path.relative(path.resolve(root), output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('output-inside-repository');
  }
  if (!fs.existsSync(path.dirname(output))) throw new Error('output-directory-missing');
  // Reject before any live request. `flag: wx` remains the final race-safe
  // guard, but discovering a known collision after spending three requests
  // would make a bad output path cost feed traffic.
  if (fs.existsSync(output)) throw new Error('output-exists');
  return output;
}

export async function runPagingPreflight(
  out: string,
  now: () => Date = () => new Date(),
  fetchPageOne: FetchPageOne = (config) => fetchProductSearchXml(preflightQuery(config)),
): Promise<PagingPreflightReport> {
  // Validate the destination before touching the live feed.
  const output = resolvePreflightOutputPath(out);
  const targets = RETAIL_CATEGORY_CONFIG.filter((config) =>
    PREFLIGHT_CATEGORIES.includes(config.category as (typeof PREFLIGHT_CATEGORIES)[number]));
  const report = await inspectPageOne(targets, fetchPageOne, now().toISOString());
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf-8', mode: 0o600, flag: 'wx',
  });
  return report;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) {
    console.error('Usage: pagingPreflight.ts --out /path/outside/repository/report.json');
    process.exitCode = 1;
  } else {
    void runPagingPreflight(args[1]).then(
      (report) => console.error(`Paging preflight wrote ${report.rows.length} page-one observations. No catalogue was written.`),
      (cause) => {
        console.error(`Paging preflight failed: ${cause instanceof Error ? cause.message : 'unknown-error'}. No catalogue was written.`);
        process.exitCode = 1;
      },
    );
  }
}
