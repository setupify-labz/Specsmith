import { describe, it, expect } from 'vitest';

import {
  catalogMention,
  findGpuMentions,
  findMemorySizes,
  mentionKey,
  requiresExplicitMemorySize,
  verifyGpuModel,
} from './gpuModelMatch';
import { loadGpuCatalog } from './index';
import type { CatalogGpu } from './types';

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => {
  const found = catalog.find((g) => g.id === id);
  if (!found) throw new Error(`fixture expects catalog id ${id}`);
  return found;
};

describe('findGpuMentions', () => {
  it('reads family, number and variant suffixes from a real Newegg title', () => {
    expect(findGpuMentions('ASUS TUF Gaming GeForce RTX 4070 Ti SUPER OC Edition 16GB')).toEqual([
      { family: 'rtx', number: '4070', suffixes: ['ti', 'super'] },
    ]);
  });

  it('reads AMD and Intel families', () => {
    expect(findGpuMentions('SAPPHIRE NITRO+ Radeon RX 7900 XTX 24GB').map(mentionKey)).toEqual(['rx 7900 xtx']);
    expect(findGpuMentions('Intel Arc B580 Limited Edition 12GB').map(mentionKey)).toEqual(['arc b580']);
    expect(findGpuMentions('Radeon RX 7900 GRE 16GB').map(mentionKey)).toEqual(['rx 7900 gre']);
  });

  it('ignores run-together vendor part numbers, which drop or abbreviate the suffix', () => {
    // The part number would otherwise read as a second, contradictory model and
    // make almost every real title self-ambiguous.
    const mentions = findGpuMentions('GIGABYTE GeForce RTX 4070 SUPER WINDFORCE OC 12G, GV-N407SWF3OC-12GD, RTX4070S');
    expect(mentions.map(mentionKey)).toEqual(['rtx 4070 super']);
  });

  it('deduplicates a model repeated in the same title', () => {
    expect(findGpuMentions('MSI GeForce RTX 5070 Ti, RTX 5070 Ti Gaming Trio').map(mentionKey)).toEqual(['rtx 5070 ti']);
  });

  it('reports two genuinely different models separately', () => {
    expect(findGpuMentions('Cable for RTX 4070 / RX 7800 XT').map(mentionKey)).toEqual(['rtx 4070', 'rx 7800 xt']);
  });

  it('finds nothing in a title that names no GPU', () => {
    expect(findGpuMentions('CORSAIR RM850x Power Supply')).toEqual([]);
  });
});

describe('findMemorySizes', () => {
  it('reads GB sizes and ignores non-GB size shorthand', () => {
    expect(findMemorySizes('GIGABYTE RTX 4070 WINDFORCE 12GB GDDR6X, 12G model')).toEqual([12]);
    expect(findMemorySizes('RTX 4060 Ti 16 GB GDDR6')).toEqual([16]);
    expect(findMemorySizes('ASUS Dual RTX 4060 Ti OC')).toEqual([]);
  });
});

describe('every catalog GPU names exactly one model', () => {
  it.each(catalog.map((g) => [g.id, g.name]))('%s (%s)', (id) => {
    expect(() => catalogMention(gpu(id as string))).not.toThrow();
  });
});

describe('requiresExplicitMemorySize', () => {
  it('is true exactly for the catalog parts that ship in two sizes', () => {
    const required = catalog.filter((g) => requiresExplicitMemorySize(g, catalog)).map((g) => g.id).sort();
    expect(required).toEqual(
      ['arca770-16', 'arca770-8', 'rtx3080', 'rtx308012', 'rtx4060ti', 'rtx4060ti16', 'rx9060xt16', 'rx9060xt8'].sort(),
    );
  });
});

describe('verifyGpuModel', () => {
  const ok = (title: string, id: string) => verifyGpuModel(title, gpu(id), catalog);

  it('accepts the exact card', () => {
    expect(ok('GIGABYTE GeForce RTX 4070 WINDFORCE OC V2 12GB GDDR6X Desktop Graphics Card', 'rtx4070')).toEqual({ ok: true });
  });

  it('accepts when the title states no memory size and the part ships in only one', () => {
    expect(ok('ASUS Dual GeForce RTX 4070 OC Edition', 'rtx4070')).toEqual({ ok: true });
  });

  it('rejects a Ti when the base card was asked for', () => {
    expect(ok('ZOTAC GAMING GeForce RTX 4070 Ti Trinity OC 12GB', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'variant-suffix-mismatch',
    });
  });

  it('rejects a base card when the Ti was asked for', () => {
    expect(ok('ASUS Dual GeForce RTX 4070 OC 12GB', 'rtx4070ti')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects a Super when the base card was asked for, and vice versa', () => {
    expect(ok('MSI Ventus GeForce RTX 4070 SUPER 12G OC', 'rtx4070')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
    expect(ok('MSI Ventus GeForce RTX 4070 12G OC', 'rtx4070s')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects a Ti Super when the plain Ti was asked for', () => {
    expect(ok('ASUS TUF GeForce RTX 4070 Ti SUPER OC 16GB', 'rtx4070ti')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects an XT when the non-XT was asked for', () => {
    expect(ok('SAPPHIRE PULSE Radeon RX 7600 XT 16GB', 'rx7600')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects XTX against XT', () => {
    expect(ok('SAPPHIRE NITRO+ Radeon RX 7900 XTX 24GB', 'rx7900xt')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects a different model number outright', () => {
    expect(ok('GIGABYTE GeForce RTX 4060 EAGLE OC 8GB', 'rtx4070')).toMatchObject({ ok: false, reason: 'model-mismatch' });
  });

  it('rejects a title naming two models as ambiguous', () => {
    expect(ok('Power Cable for GeForce RTX 4070 / RTX 4080 Graphics Cards', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'model-ambiguous',
    });
  });

  it('rejects a title naming no model at all', () => {
    expect(ok('CORSAIR RM850x Power Supply', 'rtx4070')).toMatchObject({ ok: false, reason: 'model-not-found' });
  });

  it('rejects the wrong memory size', () => {
    expect(ok('MSI GAMING X SLIM GeForce RTX 4060 Ti 16GB GDDR6', 'rtx4060ti')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
    expect(ok('GIGABYTE WINDFORCE OC GeForce RTX 4060 Ti 8GB GDDR6', 'rtx4060ti16')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('accepts each size-split sibling against its own listing', () => {
    expect(ok('MSI GAMING X SLIM GeForce RTX 4060 Ti 16GB GDDR6', 'rtx4060ti16')).toEqual({ ok: true });
    expect(ok('GIGABYTE WINDFORCE OC GeForce RTX 4060 Ti 8GB GDDR6', 'rtx4060ti')).toEqual({ ok: true });
  });

  it('refuses a size-split part whose listing states no size at all', () => {
    // ASUS Dual RTX 4060 Ti exists in both 8GB and 16GB; the title says which
    // one it is, or the offer is not usable.
    expect(ok('ASUS Dual GeForce RTX 4060 Ti OC Edition Graphics Card', 'rtx4060ti')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
    expect(ok('ASUS Dual GeForce RTX 4060 Ti OC Edition Graphics Card', 'rtx4060ti16')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('refuses a title stating two different memory sizes', () => {
    expect(ok('GeForce RTX 4070 12GB / 16GB Graphics Card', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('does not confuse Intel Arc A580 with an AMD RX 580 — different families never match', () => {
    expect(ok('Intel Arc A580 8GB Graphics Card', 'arca580')).toEqual({ ok: true });
    expect(ok('AMD Radeon RX 580 8GB Graphics Card', 'arca580')).toMatchObject({ ok: false, reason: 'model-mismatch' });
  });
});
