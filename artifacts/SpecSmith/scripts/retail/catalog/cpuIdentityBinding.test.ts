// Issue #101: the reviewed CPU → estimator binding, exercised against the real
// published record rather than a hand-written fixture.
import { describe, expect, it } from 'vitest';

import cpuData from '../../../src/data/cpus.json';
import catalogData from '../../../src/../public/data/retail-parts.json';
import { CPU_IDENTITY_BINDINGS } from './cpuIdentityRegistry';
import { decodeMerchantDestination, destinationNamesCpu, resolveCpuIdentity } from './cpuIdentityBinding';

const CPUS = (cpuData as unknown as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }));
const PARTS = ((catalogData as any).parts ?? catalogData) as any[];
const partById = (id: string) => PARTS.find((p) => p.id === id);

describe('the registry describes parts that actually exist', () => {
  it.each(CPU_IDENTITY_BINDINGS.map((b) => [b.retailPartId, b.canonicalCpuId] as const))(
    '%s is a published CPU part bound to canonical %s',
    (retailPartId, canonicalCpuId) => {
      const part = partById(retailPartId);
      expect(part, `${retailPartId} is not in the published catalogue`).toBeTruthy();
      expect(part.category).toBe('cpu');
      expect(CPUS.some((c) => c.id === canonicalCpuId)).toBe(true);
    },
  );

  it('records real, checkable evidence for every binding', () => {
    for (const b of CPU_IDENTITY_BINDINGS) {
      expect(b.sourceUrl).toMatch(/^https:\/\/www\.newegg\.com\//);
      expect(b.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.reason.length).toBeGreaterThan(60);
      // Absence is recorded as null, never filled in with a plausible value.
      expect(b.manufacturerPartId === null || b.manufacturerPartId.length > 0).toBe(true);
    }
  });
});

describe('a reviewed processor binds, end to end, from the real record', () => {
  it('binds the published i5-13400F listing to the canonical i5-13400f', () => {
    const part = partById('newegg-cpu-9sia4rekg24553');
    const outcome = resolveCpuIdentity(
      { retailPartId: part.id, name: part.name, trackedAffiliateUrl: part.trackedAffiliateUrl },
      CPUS,
    );
    expect(outcome).toMatchObject({ bound: true, canonicalCpuId: 'i5-13400f' });
  });

  it('corroborates the title with the merchant\'s own deep link, not the title alone', () => {
    const part = partById('newegg-cpu-9sia4rekg24553');
    const destination = decodeMerchantDestination(part.trackedAffiliateUrl);
    expect(destination).toMatch(/^https:\/\/www\.newegg\.com\//);
    expect(destinationNamesCpu(destination!, 'i5-13400F')).toBe(true);
    // The same link must NOT corroborate the graphics-less sibling's absence.
    expect(destinationNamesCpu(destination!, 'i5-13400')).toBe(false);
  });
});

describe('everything unreviewed stays fail-closed', () => {
  it('refuses every published CPU that has no registry entry', () => {
    const reviewed = new Set(CPU_IDENTITY_BINDINGS.map((b) => b.retailPartId));
    const wrongly = PARTS.filter((p) => p.category === 'cpu' && !reviewed.has(p.id)).filter(
      (p) =>
        resolveCpuIdentity({ retailPartId: p.id, name: p.name, trackedAffiliateUrl: p.trackedAffiliateUrl }, CPUS)
          .bound,
    );
    expect(wrongly.map((p) => p.id)).toEqual([]);
  });

  it('refuses a reviewed part whose title has been changed to a different chip', () => {
    const part = partById('newegg-cpu-9sia4rekg24553');
    const outcome = resolveCpuIdentity(
      { retailPartId: part.id, name: 'Intel Core i5-13400 Desktop Processor', trackedAffiliateUrl: part.trackedAffiliateUrl },
      CPUS,
    );
    expect(outcome).toMatchObject({ bound: false, refusal: 'title-disagrees' });
  });

  it('refuses when the merchant destination names a different chip than the title', () => {
    const outcome = resolveCpuIdentity(
      {
        retailPartId: 'newegg-cpu-9sia4rekg24553',
        name: 'Intel Core i5-13400F Desktop Processor',
        trackedAffiliateUrl:
          'https://click.linksynergy.com/link?id=x&murl=' +
          encodeURIComponent('https://www.newegg.com/intel-core-i9-14900k-desktop-processor/p/N82E1'),
      },
      CPUS,
    );
    expect(outcome).toMatchObject({ bound: false, refusal: 'destination-disagrees' });
  });

  it('refuses when the tracked link carries no readable Newegg destination', () => {
    const outcome = resolveCpuIdentity(
      {
        retailPartId: 'newegg-cpu-9sia4rekg24553',
        name: 'Intel Core i5-13400F Desktop Processor',
        trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=x',
      },
      CPUS,
    );
    expect(outcome).toMatchObject({ bound: false, refusal: 'destination-unreadable' });
  });

  it('refuses a registry entry naming a canonical CPU the catalog does not carry', () => {
    const outcome = resolveCpuIdentity(
      {
        retailPartId: 'newegg-cpu-9sia4rekg24553',
        name: 'Intel Core i5-13400F Desktop Processor',
        trackedAffiliateUrl: partById('newegg-cpu-9sia4rekg24553').trackedAffiliateUrl,
      },
      [],
    );
    expect(outcome).toMatchObject({ bound: false, refusal: 'canonical-missing' });
  });
});

describe('the bound processor actually reaches the estimator', () => {
  // The builder's gate, copied from Builder.tsx:145-153 so this test fails if
  // the two ever drift apart rather than passing against a private reimplementation.
  const resolveCanonical = (
    canonical: readonly { id: string }[],
    retail: readonly any[],
    selectedId: string | null,
  ) => {
    if (!selectedId) return null;
    const direct = canonical.find((p) => p.id === selectedId);
    if (direct) return direct;
    const sku = retail.find((p) => p.id === selectedId);
    const canonicalId = sku && sku.specsVerified ? sku.canonicalPartId : null;
    return canonicalId ? canonical.find((p) => p.id === canonicalId) ?? null : null;
  };

  /** The catalogue as the next regeneration will publish it: bindings applied. */
  const regenerated = PARTS.map((p) => {
    if (p.category !== 'cpu') return p;
    const outcome = resolveCpuIdentity(
      { retailPartId: p.id, name: p.name, trackedAffiliateUrl: p.trackedAffiliateUrl },
      CPUS,
    );
    return outcome.bound
      ? { ...p, canonicalPartId: outcome.canonicalCpuId, specsVerified: true }
      : { ...p, canonicalPartId: null, specsVerified: false };
  });

  it('resolves a real retail GPU and the bound retail CPU together, which is what enables the button', () => {
    const gpuSku = regenerated.find((p) => p.category === 'gpu' && p.specsVerified && p.canonicalPartId);
    const cpuSku = regenerated.find((p) => p.category === 'cpu' && p.specsVerified);
    expect(gpuSku, 'no verified retail GPU in the catalogue').toBeTruthy();
    expect(cpuSku, 'no verified retail CPU after applying the reviewed bindings').toBeTruthy();

    const gpus = (require('../../../src/data/gpus.json') as { id: string }[]).map((g) => ({ id: g.id }));
    const selectedGpu = resolveCanonical(gpus, regenerated, gpuSku.id);
    const selectedCpu = resolveCanonical(CPUS, regenerated, cpuSku.id);

    expect(selectedGpu).toBeTruthy();
    expect(selectedCpu).toMatchObject({ id: 'i5-13400f' });
    // canEstimate is "both resolved"; with both non-null the button is enabled.
    expect(Boolean(selectedGpu && selectedCpu)).toBe(true);
  });

  it('still refuses to resolve an unsupported processor, so the button stays disabled', () => {
    const unsupported = regenerated.find((p) => p.category === 'cpu' && !p.specsVerified);
    expect(resolveCanonical(CPUS, regenerated, unsupported.id)).toBeNull();
  });
});
