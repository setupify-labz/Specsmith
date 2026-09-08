// Issue #101: a retailer CPU listing may bind to a canonical processor only
// when the listing names that processor and no other.
//
// The negative cases matter more than the positive one. A wrong binding here
// does not fail loudly — it produces a confident FPS estimate for a product the
// shopper is about to buy, attached to the wrong chip.
import { describe, expect, it } from 'vitest';

import cpuData from '../../../src/data/cpus.json';
import { findCpuMentions, mentionKey, verifyCpuModel } from './cpuModelMatch';

interface CanonicalCpu { id: string; name: string; brand: string }
const CPUS = cpuData as unknown as CanonicalCpu[];

const nameOf = (id: string) => {
  const found = CPUS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture drift: no canonical CPU "${id}"`);
  return found.name;
};

describe('a listing verifies only the processor it actually names', () => {
  it('accepts a real Newegg title for the part it names', () => {
    const listing =
      'Intel Core i5-13400F Desktop Processor 10 cores (6 P-cores + 4 E-cores) 20MB Cache, up to 4.6 GHz - Box';
    expect(verifyCpuModel(listing, nameOf('i5-13400f'))).toEqual({ ok: true });
  });

  it('reads the model out of a title that separates family and number with a space', () => {
    expect(verifyCpuModel('Intel Core i5 13400F Processor', nameOf('i5-13400f'))).toEqual({ ok: true });
  });

  it('refuses a title that names no processor at all', () => {
    const verdict = verifyCpuModel('Corsair Vengeance 32GB DDR5-6000 Memory Kit', nameOf('i5-13400f'));
    expect(verdict).toMatchObject({ ok: false, reason: 'model-not-found' });
  });
});

describe('designators are product identity, never a spelling difference', () => {
  // Each row: a listing title, the canonical part it must NOT bind to, and why.
  const crossMappings: ReadonlyArray<[string, string, string]> = [
    ['Intel Core i5-13400 Desktop Processor', 'i5-13400f', 'F vs non-F — no integrated graphics'],
    ['Intel Core i9-14900K Desktop Processor', 'i9-14900kf', 'K vs KF'],
    ['Intel Core i9-14900KF Desktop Processor', 'i9-14900k', 'KF vs K'],
    ['Intel Core i9-14900KS Desktop Processor', 'i9-14900k', 'KS vs K'],
    ['AMD Ryzen 9 9950X 16-Core Processor', 'r9-9950x3d', 'X vs X3D — the stacked cache'],
    ['AMD Ryzen 9 9950X3D 16-Core Processor', 'r9-9950x', 'X3D vs X'],
    ['AMD Ryzen 7 7700 8-Core Processor', 'r7-7700x', 'non-X vs X'],
    ['AMD Ryzen 5 5600G Processor with Radeon Graphics', 'r5-5600', 'G APU vs non-G'],
  ];

  it.each(crossMappings)('refuses %s against %s (%s)', (listing, canonicalId, _why) => {
    const verdict = verifyCpuModel(listing, nameOf(canonicalId));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('variant-suffix-mismatch');
  });

  it('refuses an adjacent model number outright', () => {
    const verdict = verifyCpuModel('Intel Core i5-13500 Desktop Processor', nameOf('i5-13400f'));
    expect(verdict).toMatchObject({ ok: false, reason: 'model-mismatch' });
  });

  it('refuses AMD PRO against the consumer part', () => {
    const verdict = verifyCpuModel('AMD Ryzen 5 PRO 5600 Processor', nameOf('r5-5600'));
    expect(verdict).toMatchObject({ ok: false, reason: 'professional-line-mismatch' });
  });

  it('refuses a mobile chip against a desktop catalog entry', () => {
    for (const listing of [
      'Intel Core i7-13700HX Mobile Processor',
      'Intel Core i7-13700H Laptop Processor',
      'AMD Ryzen 7 7700U Mobile Processor',
    ]) {
      const verdict = verifyCpuModel(listing, nameOf('i7-13700k'));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(['mobile-part', 'model-mismatch']).toContain(verdict.reason);
    }
  });
});

describe('a listing that names more than one processor is refused, not resolved', () => {
  it('refuses a title naming two different processors', () => {
    const verdict = verifyCpuModel(
      'Motherboard Combo Kit — supports Intel Core i5-13400F and Core i9-14900K',
      nameOf('i5-13400f'),
    );
    expect(verdict).toMatchObject({ ok: false, reason: 'model-ambiguous' });
  });

  it('reads X3D as one designator rather than an X part plus stray characters', () => {
    const mentions = findCpuMentions('AMD Ryzen 7 9800X3D 8-Core Processor');
    expect(mentions.map(mentionKey)).toEqual(['ryzen7 9800X3D']);
  });

  it('does not read a vendor part number as a model claim', () => {
    // The bare SKU carries no standalone family token, so it states nothing.
    expect(findCpuMentions('BX8071513400F Boxed Processor')).toEqual([]);
  });
});

describe('no canonical processor can be mistaken for another', () => {
  it('verifies every canonical CPU against its own name', () => {
    const unverifiable = CPUS.filter((c) => !verifyCpuModel(c.name, c.name).ok).map((c) => c.id);
    expect(unverifiable).toEqual([]);
  });

  it('never verifies one canonical CPU against a different one', () => {
    // 51 x 51: the exhaustive form of "must not cross-map". Any pair the
    // matcher confuses shows up here by id, rather than only in whichever
    // handful of cases someone thought to write down.
    const collisions: string[] = [];
    for (const listing of CPUS) {
      for (const target of CPUS) {
        if (listing.id === target.id) continue;
        if (verifyCpuModel(listing.name, target.name).ok) {
          collisions.push(`${listing.id} ("${listing.name}") wrongly verified as ${target.id}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });
});
