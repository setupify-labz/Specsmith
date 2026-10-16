import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog } from '../rakuten';
import cpuData from '../../../src/data/cpus.json';
import { DISCOVERY_SEARCHES, type DiscoverySearch } from './discoveryConfig';
import { classifyGeneration } from './generation';
import { isFanListing, normalizeUpc, type CatalogContext } from './discoverParts';
import { main, runDiscovery, type DiscoveryDeps } from './discover-parts';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const fixture = (name: string) => fs.readFileSync(path.join(here, '__fixtures__', name), 'utf-8');

const context: CatalogContext = {
  gpus: loadGpuCatalog(),
  cpus: (cpuData as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name })),
};
const search = (category: string) => DISCOVERY_SEARCHES.find((s) => s.category === category)!;
const SEARCHES: DiscoverySearch[] = [search('gpu'), search('fan')];

const fixtureDeps = (overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
  async fetchSearch(s) {
    return { xml: fixture(s.category === 'gpu' ? 'discovery-gpu.xml' : 'discovery-fan.xml'), fetchedAt: '2026-10-16T00:00:00.000Z' };
  },
  now: () => '2026-10-16T00:00:01.000Z',
  context,
  ...overrides,
});

describe('part discovery stages, never publishes', () => {
  it('admits real parts and rejects each non-part for its own reason', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    const gpu = staging.searches.find((s) => s.category === 'gpu')!;
    expect(gpu.listingsSeen).toBe(9);
    expect(gpu.accepted).toBe(5);
    expect(gpu.rejected).toEqual({ condition: 1, kind: 1, merchant: 1, category: 1 });
    const fan = staging.searches.find((s) => s.category === 'fan')!;
    expect(fan).toMatchObject({ accepted: 1, leafObserved: false, rejected: { kind: 2 } });
    expect(staging.publication).toBe('staged-not-published');
    for (const candidate of staging.candidates) expect(candidate.status).toBe('staged');
  });

  it('merges listings only on an exact UPC whose titles agree', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    const merged = staging.candidates.find((c) => c.dedupeKey === 'upc:111222333')!;
    expect(merged.listings.map((l) => l.retailerSku).sort()).toEqual(['FIXTUREGPU0001', 'FIXTUREGPU0002']);
    expect(merged.identifier).toBe('upc');
  });

  it('never merges a shared UPC whose titles disagree; it goes to review as ambiguous', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    expect(staging.ambiguous).toHaveLength(1);
    expect(staging.ambiguous[0]).toMatchObject({ dedupeKey: 'upc:444555666777', reason: 'upc-title-conflict' });
    expect(staging.candidates.some((c) => c.dedupeKey === 'upc:444555666777')).toBe(false);
  });

  it('keeps a listing with a malformed UPC on its own, keyed by retailer SKU', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    const alone = staging.candidates.find((c) => c.dedupeKey === 'sku:FIXTUREGPU0005')!;
    expect(alone).toMatchObject({ identifier: 'retailer-sku-only', upc: null });
  });

  it('proposes a canonical match only when the existing matcher verifies one', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    expect(staging.candidates.find((c) => c.dedupeKey === 'upc:111222333')!.canonical).toMatchObject({ status: 'proposed', canonicalId: 'rtx5070' });
    expect(staging.candidates.find((c) => c.category === 'fan')!.canonical.status).toBe('none');
  });

  it('orders the queue current-generation first, without dropping older parts', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    const tiers = staging.candidates.map((c) => c.generation.tier);
    expect(tiers[0]).toBe('current');
    expect(tiers).toContain('older'); // the RX 6600 is staged, just later
    expect(tiers.indexOf('older')).toBe(tiers.length - 1);
  });

  it('records a failed search and carries on', async () => {
    const staging = await runDiscovery(
      fixtureDeps({
        async fetchSearch(s) {
          if (s.category === 'fan') throw new Error('network down: https://example.invalid/?token=secret');
          return { xml: fixture('discovery-gpu.xml'), fetchedAt: '2026-10-16T00:00:00.000Z' };
        },
      }),
      SEARCHES,
    );
    expect(staging.searches.find((s) => s.category === 'fan')!.outcome).toBe('request-failed');
    expect(JSON.stringify(staging)).not.toContain('secret');
    expect(staging.candidates.length).toBeGreaterThan(0);
  });

  it('carries no prices: an observed feed price is not a verified offer', async () => {
    const staging = await runDiscovery(fixtureDeps(), SEARCHES);
    expect(JSON.stringify(staging)).not.toMatch(/"(retailPrice|salePrice|price)"/);
  });
});

describe('the published catalogue is untouched by a run', () => {
  const PUBLISHED = [
    'public/data/retail-parts.json',
    'src/data/cpus.json',
    'src/data/gpus.json',
    'src/data/components.json',
    'src/data/peripherals.json',
  ].map((file) => path.join(appRoot, file));
  const digest = () => PUBLISHED.map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));

  it('writes only the staging file, outside the repository, and leaves every published file byte-identical', async () => {
    const before = digest();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'));
    const out = path.join(dir, 'staged.json');
    expect(await main(['--out', out], () => fixtureDeps())).toBe(0);
    expect(digest()).toEqual(before);
    const staged = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(staged.publication).toBe('staged-not-published');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an output path inside the repository', async () => {
    expect(await main(['--out', path.join(appRoot, 'public', 'data', 'staged.json')], () => fixtureDeps())).toBe(1);
    expect(fs.existsSync(path.join(appRoot, 'public', 'data', 'staged.json'))).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizes UPC-A and EAN-13 forms of one code', () => {
    expect(normalizeUpc('000111222333')).toBe(normalizeUpc('0000111222333'));
  });

  it('recognizes case fans but not coolers, hubs or laptop fans', () => {
    expect(isFanListing('ARCTIC P12 PWM 120mm Case Fan')).toBe(true);
    expect(isFanListing('Noctua NF-A14 140 mm PC Fan')).toBe(true);
    expect(isFanListing('CPU Cooler with 120mm fan')).toBe(false);
    expect(isFanListing('PWM Fan Hub Splitter')).toBe(false);
    expect(isFanListing('Laptop cooling fan replacement')).toBe(false);
  });

  it('classifies generations by explicit rules and names the rule', () => {
    expect(classifyGeneration('gpu', 'GeForce RTX 5070')).toEqual({ tier: 'current', rule: 'gpu: RTX 50' });
    expect(classifyGeneration('cpu', 'AMD Ryzen 7 9800X3D')).toMatchObject({ tier: 'current' });
    expect(classifyGeneration('motherboard', 'MSI MAG B760 Tomahawk')).toMatchObject({ tier: 'recent' });
    expect(classifyGeneration('ram', 'DDR4-3200 16GB')).toMatchObject({ tier: 'older' });
    expect(classifyGeneration('headset', 'Any headset')).toMatchObject({ tier: 'unclassified' });
  });
});
