import { describe, it, expect } from 'vitest';

import { catalogMention, findGpuMentions, findMemorySizes, mentionKey, verifyGpuModel } from './gpuModelMatch';
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

describe('verifyGpuModel', () => {
  const ok = (title: string, id: string, shortDescription?: string) =>
    verifyGpuModel({ productName: title, shortDescription }, gpu(id));

  it('accepts the exact card', () => {
    expect(ok('GIGABYTE GeForce RTX 4070 WINDFORCE OC V2 12GB GDDR6X Desktop Graphics Card', 'rtx4070')).toEqual({ ok: true });
  });

  it('refuses a listing that states no memory size in either field, for every part', () => {
    // Unconditional, and independent of the catalog. See the doc comment on
    // the memory-size rule for the RTX 5060 Ti case that settled this.
    expect(ok('ASUS Dual GeForce RTX 4070 OC Edition', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-unstated',
    });
    expect(ok('GIGABYTE GeForce RTX 4090 GAMING OC', 'rtx4090')).toMatchObject({ ok: false, reason: 'memory-capacity-unstated' });
  });

  it('an unspecified RTX 5060 Ti is never accepted as the 16GB model', () => {
    // The catalog carries only the 16GB rtx5060ti, so a rule that asked
    // "does a sibling SKU exist?" found none and let this through — publishing
    // an 8GB card's price as the 16GB card's. The part ships in both sizes
    // regardless of what SpecSmith tracks.
    expect(ok('ASUS Dual GeForce RTX 5060 Ti OC Edition Graphics Card', 'rtx5060ti')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-unstated',
    });
    expect(catalog.filter((g) => g.name.startsWith('RTX 5060 Ti'))).toHaveLength(1);
    // Stated, and correct: accepted.
    expect(ok('ASUS PRIME GeForce RTX 5060 Ti 16GB GDDR7 OC', 'rtx5060ti')).toEqual({ ok: true });
    // Stated, and the other size: refused as a mismatch, not silently taken.
    expect(ok('ASUS PRIME GeForce RTX 5060 Ti 8GB GDDR7 OC', 'rtx5060ti')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('rejects a Ti when the base card was asked for', () => {
    expect(ok('ZOTAC GAMING GeForce RTX 4070 Ti Trinity OC 12GB GDDR6X', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'variant-suffix-mismatch',
    });
  });

  it('rejects a base card when the Ti was asked for', () => {
    expect(ok('ASUS Dual GeForce RTX 4070 OC 12GB', 'rtx4070ti')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
  });

  it('rejects a Super when the base card was asked for, and vice versa', () => {
    expect(ok('MSI Ventus GeForce RTX 4070 SUPER 12GB OC', 'rtx4070')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
    expect(ok('MSI Ventus GeForce RTX 4070 12GB OC', 'rtx4070s')).toMatchObject({ ok: false, reason: 'variant-suffix-mismatch' });
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
    // Model is decided before capacity, so a different card is reported as a
    // different card rather than as a capacity problem.
    expect(ok('GIGABYTE GeForce RTX 4060 EAGLE OC', 'rtx4070')).toMatchObject({ ok: false, reason: 'model-mismatch' });
  });

  it('rejects a title naming two models as ambiguous', () => {
    expect(ok('Power Cable for GeForce RTX 4070 12GB / RTX 4080 16GB Graphics Cards', 'rtx4070')).toMatchObject({
      ok: false,
      reason: 'model-ambiguous',
    });
  });

  it('rejects a title naming no model at all', () => {
    expect(ok('CORSAIR RM850x Power Supply', 'rtx4070')).toMatchObject({ ok: false, reason: 'model-not-found' });
  });

  it('does not consult the rest of the catalog — the same title and part always answer the same', () => {
    // The verdict is a function of (title, entry) only. Nothing about which
    // other SKUs SpecSmith tracks can change it.
    const evidence = { productName: 'MSI GAMING X SLIM GeForce RTX 4060 Ti 16GB GDDR6' };
    expect(verifyGpuModel(evidence, gpu('rtx4060ti16'))).toEqual({ ok: true });
    expect(verifyGpuModel(evidence, { ...gpu('rtx4060ti16'), id: 'unrelated' })).toEqual({ ok: true });
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

  it('refuses a listing that states no size, whichever sibling was asked for', () => {
    for (const id of ['rtx4060ti', 'rtx4060ti16']) {
      expect(ok('ASUS Dual GeForce RTX 4060 Ti OC Edition Graphics Card', id)).toMatchObject({
        ok: false,
        reason: 'memory-capacity-unstated',
      });
    }
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

describe('capacity evidence comes from the title AND the short description', () => {
  const verify = (productName: string, shortDescription: string | null, id: string) =>
    verifyGpuModel({ productName, shortDescription }, gpu(id));

  // The exact field values from a real Newegg listing: the title repeats the
  // model and never says a capacity; the short description says it plainly.
  const ZOTAC_TITLE = 'ZOTAC SOLID OC GeForce RTX 5070 Graphics Card RTX 5070 SOLID OC';
  const ZOTAC_SHORT = 'ZOTAC SOLID OC GeForce RTX 5070 12GB GDDR7 256-bit PCIe 5.0 Graphics Card, IceStorm 3.0 cooling.';

  it('accepts a listing whose capacity appears only in the short description', () => {
    expect(verify(ZOTAC_TITLE, ZOTAC_SHORT, 'rtx5070')).toEqual({ ok: true });
  });

  it('the same title without the description is still refused as unstated', () => {
    // Proves the acceptance above comes from the description, not from having
    // quietly stopped requiring a capacity.
    expect(verify(ZOTAC_TITLE, null, 'rtx5070')).toMatchObject({ ok: false, reason: 'memory-capacity-unstated' });
  });

  it('rejects a 12GB title with a 16GB short description rather than preferring one', () => {
    const verdict = verify(
      'PNY GeForce RTX 5070 12GB OC Triple Fan Graphics Card',
      'PNY GeForce RTX 5070 16GB GDDR7 triple-fan graphics card.',
      'rtx5070',
    );
    expect(verdict).toMatchObject({ ok: false, reason: 'memory-capacity-mismatch' });
    expect((verdict as { detail: string }).detail).toContain('contradicts itself');
  });

  it('rejects when one field alone names several capacities', () => {
    expect(verify('GeForce RTX 5070 Graphics Card', 'Available in 12GB and 16GB configurations.', 'rtx5070')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('accepts when both fields agree', () => {
    expect(verify('ASUS PRIME GeForce RTX 5070 12GB GDDR7 OC Edition', 'ASUS PRIME OC Edition 12GB GDDR7.', 'rtx5070')).toEqual({
      ok: true,
    });
  });

  it('rejects when both fields agree on the WRONG capacity', () => {
    expect(verify('GeForce RTX 5070 16GB Graphics Card', 'GeForce RTX 5070 16GB GDDR7.', 'rtx5070')).toMatchObject({
      ok: false,
      reason: 'memory-capacity-mismatch',
    });
  });

  it('an RTX 5070 Ti stays a variant-suffix-mismatch for rtx5070, description or not', () => {
    // The description widening must not become a back door for the variant
    // gate: this is a different product at a different price.
    expect(verify('MSI GeForce RTX 5070 Ti GAMING TRIO OC Graphics Card RTX 5070 Ti', 'MSI GeForce RTX 5070 Ti 16GB GDDR7.', 'rtx5070')).toMatchObject({
      ok: false,
      reason: 'variant-suffix-mismatch',
    });
    expect(verify('MSI GeForce RTX 5070 Ti GAMING TRIO OC', null, 'rtx5070')).toMatchObject({
      ok: false,
      reason: 'variant-suffix-mismatch',
    });
  });

  it('never reads the model from the description — only the capacity', () => {
    // Descriptions routinely name other cards. Admitting that text would make
    // half the catalogue ambiguous, so the model gates ignore it entirely.
    expect(verify('ASUS PRIME GeForce RTX 5070 12GB OC', 'Up to 40% faster than an RTX 4070 Ti in modern titles.', 'rtx5070')).toEqual({
      ok: true,
    });
    // ...and a description naming the right card cannot rescue a wrong title.
    expect(verify('ASUS PRIME GeForce RTX 4060 8GB OC', 'This is really an RTX 5070 12GB.', 'rtx5070')).toMatchObject({
      ok: false,
      reason: 'model-mismatch',
    });
  });
});
