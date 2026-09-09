// Issue #101: the published-catalogue reader must accept a verified CPU.
//
// The generator can now emit a CPU carrying a canonical mapping. Before this,
// `parsePart` allowed a canonicalPartId on GPUs only, so a legitimately
// regenerated catalogue would have had that part silently dropped by the
// reader and the estimator would never have enabled in production. These pin
// the extension, and pin that it did not widen to anything else.
import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';

const published = catalogData as any;
const parts = (published.parts ?? published) as any[];
const cpu = parts.find((p) => p.category === 'cpu');
const withPart = (part: unknown) => ({
  ...published,
  parts: parts.map((p) => (p.id === (part as any).id ? part : p)),
});
const idsIn = (result: ReturnType<typeof parseAffiliatePartCatalog>) =>
  result.ok ? result.catalog.parts.map((p) => p.id) : null;

describe('a verified CPU survives the reader', () => {
  it('parses a CPU carrying a canonical mapping', () => {
    const mapped = { ...cpu, canonicalPartId: 'i5-13400f', specsVerified: true };
    const parsed = parseAffiliatePartCatalog(withPart(mapped));
    expect(parsed.ok).toBe(true);
    expect(idsIn(parsed)).toContain(cpu.id);
  });

  it('still parses an unmapped CPU, so existing files are unaffected', () => {
    const parsed = parseAffiliatePartCatalog(published);
    expect(parsed.ok).toBe(true);
    expect(idsIn(parsed)).toContain(cpu.id);
  });

  it('refuses a CPU that is half-mapped in either direction', () => {
    for (const broken of [
      { ...cpu, canonicalPartId: 'i5-13400f', specsVerified: false },
      { ...cpu, canonicalPartId: null, specsVerified: true },
    ]) {
      const parsed = parseAffiliatePartCatalog(withPart(broken));
      // The part is dropped rather than trusted; a half-claim is not a claim.
      expect(parsed.ok ? idsIn(parsed) : []).not.toContain(cpu.id);
    }
  });
});

describe('no other category gained the ability to claim a mapping', () => {
  it.each(['motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset'])(
    'drops a %s that claims a canonical mapping',
    (category) => {
      const part = parts.find((p) => p.category === category);
      expect(part, `no ${category} in the published catalogue`).toBeTruthy();
      const claiming = { ...part, canonicalPartId: 'something', specsVerified: true };
      const parsed = parseAffiliatePartCatalog(withPart(claiming));
      expect(parsed.ok ? idsIn(parsed) : []).not.toContain(part.id);
    },
  );
});
