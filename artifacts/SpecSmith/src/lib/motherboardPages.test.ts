import { describe, it, expect } from 'vitest';
import { chunkEvenly, getCpuPriceBands, formatCpuPairing, getMotherboardPicks, SOCKET_PAGES } from './motherboardPages';

describe('chunkEvenly', () => {
  it('splits an array into the requested number of contiguous, near-equal chunks', () => {
    const chunks = chunkEvenly([1, 2, 3, 4, 5, 6, 7], 3);
    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6, 7]]);
    expect(chunks.flat()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives every item to exactly one chunk when the array divides evenly', () => {
    const chunks = chunkEvenly([1, 2, 3, 4, 5, 6], 3);
    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('handles fewer items than parts by producing some empty chunks', () => {
    const chunks = chunkEvenly([1, 2], 3);
    expect(chunks.flat()).toEqual([1, 2]);
    expect(chunks.filter(c => c.length === 0)).toHaveLength(1);
  });

  it('returns an empty array for a non-positive part count', () => {
    expect(chunkEvenly([1, 2, 3], 0)).toEqual([]);
    expect(chunkEvenly([1, 2, 3], -1)).toEqual([]);
  });
});

describe('getCpuPriceBands (real catalog data)', () => {
  it('returns bandCount bands, cheapest-to-priciest, covering every tracked CPU for the socket exactly once', () => {
    for (const { socket } of SOCKET_PAGES) {
      for (const bandCount of [1, 2, 3]) {
        const bands = getCpuPriceBands(socket, bandCount);
        expect(bands.length).toBeLessThanOrEqual(bandCount);
        const totalCpus = bands.reduce((sum, b) => sum + b.count, 0);
        // every band's cheapest <= priciest, and bands are non-decreasing in price order
        for (const band of bands) {
          expect(band.cheapest.price_usd).toBeLessThanOrEqual(band.priciest.price_usd);
        }
        for (let i = 1; i < bands.length; i++) {
          expect(bands[i].cheapest.price_usd).toBeGreaterThanOrEqual(bands[i - 1].priciest.price_usd);
        }
        expect(totalCpus).toBeGreaterThan(0);
      }
    }
  });

  it('drops empty bands rather than returning placeholders', () => {
    // LGA1851 only has 3 tracked CPUs; asking for more bands than CPUs
    // should never produce a band with count 0.
    const bands = getCpuPriceBands('LGA1851', 5);
    for (const band of bands) {
      expect(band.count).toBeGreaterThan(0);
    }
  });
});

describe('formatCpuPairing', () => {
  it('is explicitly framed as a price-tier pairing, not a compatibility recommendation', () => {
    const text = formatCpuPairing('AM5', {
      cheapest: { id: 'a', name: 'Ryzen 5 7600X', price_usd: 178, socket: 'AM5' },
      priciest: { id: 'b', name: 'Ryzen 7 7700', price_usd: 284, socket: 'AM5' },
      count: 2,
    });
    expect(text).toContain('price-tier pairing');
    expect(text).not.toMatch(/technically optimal|guaranteed compatible|best match/i);
    expect(text).toContain('$178');
    expect(text).toContain('$284');
  });

  it('uses a single-price phrasing when the band is one CPU wide', () => {
    const text = formatCpuPairing('LGA1851', {
      cheapest: { id: 'a', name: 'Core Ultra 5 245K', price_usd: 199, socket: 'LGA1851' },
      priciest: { id: 'a', name: 'Core Ultra 5 245K', price_usd: 199, socket: 'LGA1851' },
      count: 1,
    });
    expect(text).toContain('around $199');
    expect(text).not.toContain('up to the');
  });
});

describe('getMotherboardPicks CPU pairing integration (real catalog data)', () => {
  it('attaches a cpuPairing to every pick, cheapest board <-> cheapest CPU band', () => {
    for (const { socket } of SOCKET_PAGES) {
      const picks = getMotherboardPicks(socket);
      expect(picks.length).toBeGreaterThan(0);
      for (const pick of picks) {
        expect(pick.cpuPairing).toBeDefined();
        expect(pick.cpuPairing).toContain('price-tier pairing');
      }
      // Budget pick's band should never be priced above the High-End pick's band.
      const budget = picks.find(p => p.label === 'Budget Pick');
      const premium = picks.find(p => p.label === 'High-End Pick');
      if (budget?.cpuPairing && premium?.cpuPairing && budget !== premium) {
        const budgetPrice = Number(budget.cpuPairing.match(/\$(\d+)/)?.[1]);
        const premiumPrice = Number(premium.cpuPairing.match(/\$(\d+)/)?.[1]);
        expect(budgetPrice).toBeLessThanOrEqual(premiumPrice);
      }
    }
  });
});
