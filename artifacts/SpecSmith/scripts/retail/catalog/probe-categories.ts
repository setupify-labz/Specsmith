// One-time category discovery for the 500-part retail catalog.
//
// Rakuten's `cat` filter takes the merchant's exact category leaf. We do not
// guess those strings: this command asks for one page per intended product
// kind and writes only category names and counts to a short-lived artifact.
// Product titles, prices, links, identifiers and raw XML never leave memory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchProductSearchXml,
  findItems,
  parseProductSearchXml,
  readAccessToken,
  readCategory,
} from '../rakuten';
import { DEFAULT_REQUESTS_PER_MINUTE, RateLimiter } from '../coverage/rateLimiter';

export const CATEGORY_PROBES = [
  { key: 'gpu', keyword: 'graphics card' },
  { key: 'cpu', keyword: 'desktop processor' },
  { key: 'motherboard', keyword: 'motherboard' },
  { key: 'ram', keyword: 'desktop memory' },
  { key: 'storage', keyword: 'internal SSD' },
  { key: 'psu', keyword: 'power supply' },
  { key: 'case', keyword: 'computer case' },
  { key: 'cooler', keyword: 'CPU cooler' },
  { key: 'monitor', keyword: 'gaming monitor' },
  { key: 'keyboard', keyword: 'mechanical keyboard' },
  { key: 'mouse', keyword: 'gaming mouse' },
  { key: 'headset', keyword: 'gaming headset' },
] as const;

export interface CategoryCount {
  primary: string | null;
  secondary: string | null;
  leaf: string | null;
  count: number;
}

export interface CategoryProbeResult {
  key: (typeof CATEGORY_PROBES)[number]['key'];
  itemsSeen: number;
  categories: CategoryCount[];
}

export interface CategoryProbeReport {
  generatedAt: string;
  probes: CategoryProbeResult[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');

class ProbeFailure extends Error {
  constructor(readonly code: 'argument-invalid' | 'output-inside-repository' | 'output-directory-missing' | 'request-failed' | 'write-failed') {
    super(code);
  }
}

export function resolveProbeOutputPath(file: string, root: string = repoRoot): string {
  const output = path.resolve(file);
  const relative = path.relative(path.resolve(root), output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new ProbeFailure('output-inside-repository');
  }
  return output;
}

export function parseArgs(argv: readonly string[]): { out: string } {
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1]) throw new ProbeFailure('argument-invalid');
  return { out: resolveProbeOutputPath(argv[1]) };
}

export function countCategories(xml: string): { itemsSeen: number; categories: CategoryCount[] } {
  const items = findItems(parseProductSearchXml(xml));
  const counts = new Map<string, CategoryCount>();
  for (const item of items) {
    const category = readCategory(item);
    const key = JSON.stringify([category.primary, category.secondary, category.secondaryLeaf]);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { primary: category.primary, secondary: category.secondary, leaf: category.secondaryLeaf, count: 1 });
  }
  return {
    itemsSeen: items.length,
    categories: [...counts.values()].sort((a, b) => b.count - a.count || String(a.leaf).localeCompare(String(b.leaf))),
  };
}

async function run(argv: readonly string[]): Promise<number> {
  const { out } = parseArgs(argv);
  if (!fs.existsSync(path.dirname(out))) throw new ProbeFailure('output-directory-missing');
  readAccessToken();

  const limiter = new RateLimiter(DEFAULT_REQUESTS_PER_MINUTE);
  const probes: CategoryProbeResult[] = [];
  for (const probe of CATEGORY_PROBES) {
    await limiter.acquire();
    const response = await fetchProductSearchXml({ keyword: probe.keyword, categoryLeaf: null, max: 100, pageNumber: 1 });
    probes.push({ key: probe.key, ...countCategories(response.xml) });
  }

  const report: CategoryProbeReport = { generatedAt: new Date().toISOString(), probes };
  try {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new ProbeFailure('write-failed');
  }
  console.error(`Category probe complete: ${probes.length} product kinds, ${probes.reduce((sum, p) => sum + p.itemsSeen, 0)} items classified.`);
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (cause) {
    const code = cause instanceof ProbeFailure ? cause.code : 'request-failed';
    console.error(`Category probe failed [${code}]. Nothing was written.`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
