// Issue #101: the reviewed CPU → estimator binding, exercised against the real
// published record rather than a hand-written fixture.
import { describe, expect, it } from 'vitest';

import cpuData from '../../../src/data/cpus.json';
import catalogData from '../../../public/data/retail-parts.json';
import { CPU_IDENTITY_BINDINGS, admittedBindings, type CpuIdentityBinding } from './cpuIdentityRegistry';
import { decodeMerchantDestination, destinationNamesCpu, resolveCpuIdentity } from './cpuIdentityBinding';

const CPUS = (cpuData as unknown as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }));
const PARTS = ((catalogData as any).parts ?? catalogData) as any[];
const partById = (id: string) => PARTS.find((p) => p.id === id);
const TARGET = 'newegg-cpu-9sia4rekg24553';

const inputFor = (id: string) => {
  const p = partById(id);
  return { retailPartId: p.id, name: p.name, trackedAffiliateUrl: p.trackedAffiliateUrl };
};

describe('every entry records two independently-falsifiable sources', () => {
  it.each(CPU_IDENTITY_BINDINGS.map((b) => [b.retailPartId, b] as const))(
    '%s names a real part, a real canonical CPU, and both evidence sources',
    (retailPartId, binding: CpuIdentityBinding) => {
      const part = partById(retailPartId);
      expect(part, `${retailPartId} is not in the published catalogue`).toBeTruthy();
      expect(part.category).toBe('cpu');
      expect(CPUS.some((c) => c.id === binding.canonicalCpuId)).toBe(true);

      // Retailer: what is on sale.
      expect(binding.retailer.productUrl).toMatch(/^https:\/\/www\.newegg\.com\//);
      expect(binding.retailer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(binding.retailer.productUrl).toContain(binding.retailer.merchantItemId);

      // Manufacturer: what the part is. A different party, a different host.
      expect(binding.manufacturer.mpn.length).toBeGreaterThan(4);
      expect(new URL(binding.manufacturer.sourceUrl).host).not.toContain('newegg');
    },
  );

  it('never records findings for a source it has not read', () => {
    for (const b of CPU_IDENTITY_BINDINGS) {
      if (b.manufacturer.status === 'confirmed') {
        expect(b.manufacturer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(b.manufacturer.statedProcessor).toBeTruthy();
      } else {
        // An unread source has no findings and no observation date.
        expect(b.manufacturer.statedProcessor).toBeNull();
        expect(b.manufacturer.observedAt).toBeNull();
      }
      if (b.manufacturer.status === 'blocked') {
        expect(b.manufacturer.blockedReason).toBeTruthy();
      }
    }
  });
});

describe('a binding is refused until the manufacturer record is actually read', () => {
  it('refuses the i5-13400F entry today, because Intel is unreachable from here', () => {
    const outcome = resolveCpuIdentity(inputFor(TARGET), CPUS);
    expect(outcome).toMatchObject({ bound: false, refusal: 'manufacturer-unconfirmed' });
  });

  it('admits nothing to the catalogue generator while that is true', () => {
    expect(admittedBindings()).toEqual([]);
  });

  it('checks the independent source before any merchant self-consistency check', () => {
    // Even with a title and destination that flatly contradict each other, the
    // refusal is the missing independent source — proving the merchant's own
    // fields are never what admits a binding.
    const outcome = resolveCpuIdentity(
      { retailPartId: TARGET, name: 'AMD Ryzen 9 9950X3D', trackedAffiliateUrl: 'not-a-url' },
      CPUS,
    );
    expect(outcome).toMatchObject({ bound: false, refusal: 'manufacturer-unconfirmed' });
  });
});

describe('with the manufacturer record read, the remaining checks still bite', () => {
  // Constructs the confirmed state to exercise the wiring beyond the current
  // blocker. This proves the CODE PATH, never the evidence: the real entry
  // stays 'blocked' until Intel's record is genuinely retrieved.
  const withConfirmed = (statedProcessor: string): CpuIdentityBinding[] => [
    {
      ...CPU_IDENTITY_BINDINGS[0],
      manufacturer: {
        ...CPU_IDENTITY_BINDINGS[0].manufacturer,
        status: 'confirmed',
        observedAt: '2026-09-08',
        statedProcessor,
      },
    },
  ];

  // Drives the REAL resolveCpuIdentity through its injectable lookup, so these
  // cases cannot pass against a reimplementation that has drifted from it.
  const resolveWith = (
    bindings: CpuIdentityBinding[],
    input: { retailPartId: string; name: string; trackedAffiliateUrl: string },
  ) => resolveCpuIdentity(input, CPUS, (id) => bindings.find((b) => b.retailPartId === id) ?? null);

  it('binds when Intel states the same processor the listing sells', () => {
    expect(resolveWith(withConfirmed('Intel Core i5-13400F'), inputFor(TARGET))).toMatchObject({
      bound: true,
      canonicalCpuId: 'i5-13400f',
    });
  });

  it('refuses when Intel states a DIFFERENT processor than the merchant claims', () => {
    // The case the whole two-source structure exists for: the merchant's own
    // fields all agree, and the vendor contradicts them.
    expect(resolveWith(withConfirmed('Intel Core i5-13400'), inputFor(TARGET))).toMatchObject({
      refusal: 'manufacturer-disagrees',
    });
  });

  it('still refuses a re-titled listing even with the manufacturer confirmed', () => {
    expect(
      resolveWith(withConfirmed('Intel Core i5-13400F'), {
        ...inputFor(TARGET),
        name: 'Intel Core i5-13400 Desktop Processor',
      }),
    ).toMatchObject({ refusal: 'title-disagrees' });
  });

  it('still refuses when the tracked link points at a different chip', () => {
    expect(
      resolveWith(withConfirmed('Intel Core i5-13400F'), {
        ...inputFor(TARGET),
        trackedAffiliateUrl:
          'https://click.linksynergy.com/link?id=x&murl=' +
          encodeURIComponent('https://www.newegg.com/intel-core-i9-14900k-desktop-processor/p/N82E1'),
      }),
    ).toMatchObject({ refusal: 'destination-disagrees' });
  });
});

describe('everything unreviewed stays fail-closed', () => {
  it('refuses every published CPU, reviewed or not, in the current state', () => {
    const bound = PARTS.filter((p) => p.category === 'cpu').filter(
      (p) => resolveCpuIdentity(inputFor(p.id), CPUS).bound,
    );
    expect(bound.map((p) => p.id)).toEqual([]);
  });

  it('leaves the published catalogue with no verified CPU', () => {
    const verified = PARTS.filter((p) => p.category === 'cpu' && (p.specsVerified || p.canonicalPartId));
    expect(verified.map((p) => p.id)).toEqual([]);
  });

  it('corroborates the retailer URL against the record it came from', () => {
    const destination = decodeMerchantDestination(partById(TARGET).trackedAffiliateUrl);
    expect(destination).toBe(CPU_IDENTITY_BINDINGS[0].retailer.productUrl);
    expect(destinationNamesCpu(destination!, 'i5-13400F')).toBe(true);
    expect(destinationNamesCpu(destination!, 'i5-13400')).toBe(false);
  });
});
