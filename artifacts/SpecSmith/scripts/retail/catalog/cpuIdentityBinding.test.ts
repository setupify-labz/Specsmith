// Issue #101: the reviewed CPU → estimator binding, exercised against the real
// published record rather than a hand-written fixture.
import { describe, expect, it } from 'vitest';

import cpuData from '../../../src/data/cpus.json';
import catalogData from '../../../public/data/retail-parts.json';
import { CPU_IDENTITY_BINDINGS, admittedBindings, type CpuIdentityBinding } from './cpuIdentityRegistry';
import {
  decodeMerchantDestination,
  destinationNamesCpu,
  isNeweggHost,
  merchantProductIdFrom,
  resolveCpuIdentity,
} from './cpuIdentityBinding';

const CPUS = (cpuData as unknown as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }));
const PARTS = ((catalogData as any).parts ?? catalogData) as any[];
const partById = (id: string) => PARTS.find((p) => p.id === id);
const TARGET = 'newegg-cpu-9sic7vbm1r3247';
const BASE = CPU_IDENTITY_BINDINGS[0];

const inputFor = (id: string) => {
  const p = partById(id);
  return { retailPartId: p.id, name: p.name, trackedAffiliateUrl: p.trackedAffiliateUrl };
};

/** The real binding with one field altered, to drive a single refusal. */
const mutate = (patch: {
  retailer?: Partial<CpuIdentityBinding['retailer']>;
  manufacturer?: Partial<CpuIdentityBinding['manufacturer']>;
}): CpuIdentityBinding[] => [
  {
    ...BASE,
    retailer: { ...BASE.retailer, ...patch.retailer },
    manufacturer: { ...BASE.manufacturer, ...patch.manufacturer },
  },
];

const resolveWith = (bindings: CpuIdentityBinding[], input = inputFor(TARGET)) =>
  resolveCpuIdentity(input, CPUS, (id) => bindings.find((b) => b.retailer.merchantProductId === id) ?? null);

describe('every entry records two independently-falsifiable sources', () => {
  it.each(CPU_IDENTITY_BINDINGS.map((b) => [b.retailer.merchantProductId, b] as const))(
    'product %s names a real canonical CPU and both parties',
    (merchantProductId, binding) => {
      expect(CPUS.some((c) => c.id === binding.canonicalCpuId)).toBe(true);

      expect(binding.retailer.productUrl).toMatch(/^https:\/\/www\.newegg\.com\//);
      expect(binding.retailer.productUrl).toContain(merchantProductId);
      expect(binding.retailer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // The manufacturer must be a different party on a different host.
      for (const url of [binding.manufacturer.specificationsUrl, binding.manufacturer.orderingUrl]) {
        expect(new URL(url).host).not.toContain('newegg');
      }
      expect(binding.manufacturer.attribution.length).toBeGreaterThan(40);
    },
  );

  it('never records findings for a source it has not read', () => {
    for (const b of CPU_IDENTITY_BINDINGS) {
      if (b.manufacturer.status === 'confirmed') {
        expect(b.manufacturer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(b.manufacturer.statedProcessor).toBeTruthy();
        expect(b.manufacturer.orderingCode).toBeTruthy();
      } else {
        expect(b.manufacturer.observedAt).toBeNull();
        expect(b.manufacturer.statedProcessor).toBeNull();
        expect(b.manufacturer.orderingCode).toBeNull();
      }
    }
  });
});

describe('the reviewed processor binds', () => {
  it('admits the i5-13400F entry', () => {
    expect(admittedBindings().map((b) => b.retailer.merchantProductId)).toEqual(['N82E16819118431']);
    expect(resolveCpuIdentity(inputFor(TARGET), CPUS)).toMatchObject({
      bound: true,
      canonicalCpuId: 'i5-13400f',
    });
  });

  it('joins the two parties on the part number, exactly', () => {
    expect(BASE.retailer.mpn).toBe('BX8071513400F');
    expect(BASE.manufacturer.orderingCode).toBe('BX8071513400F');
  });
});

describe('the part-number join fails closed', () => {
  it('refuses when the retailer states no MPN', () => {
    expect(resolveWith(mutate({ retailer: { mpn: null } }))).toMatchObject({
      bound: false,
      refusal: 'mpn-missing',
    });
  });

  it('refuses when the manufacturer record states no ordering code', () => {
    expect(resolveWith(mutate({ manufacturer: { orderingCode: null } }))).toMatchObject({
      bound: false,
      refusal: 'mpn-missing',
    });
  });

  it('refuses two part numbers that differ at all', () => {
    // One character. A boxed BX807... and a tray CM807... are different products.
    expect(resolveWith(mutate({ retailer: { mpn: 'CM8071505093004' } }))).toMatchObject({
      bound: false,
      refusal: 'mpn-disagrees',
    });
    expect(resolveWith(mutate({ retailer: { mpn: 'BX8071513400' } }))).toMatchObject({
      bound: false,
      refusal: 'mpn-disagrees',
    });
  });

  it('refuses before the join when the manufacturer record was never read', () => {
    expect(resolveWith(mutate({ manufacturer: { status: 'pending' } }))).toMatchObject({
      bound: false,
      refusal: 'manufacturer-unconfirmed',
    });
  });

  it('refuses when the manufacturer names a different processor than the merchant', () => {
    expect(resolveWith(mutate({ manufacturer: { statedProcessor: 'Intel Core i5-13400' } }))).toMatchObject({
      bound: false,
      refusal: 'manufacturer-disagrees',
    });
  });
});

describe('merchant self-consistency alone can never admit a binding', () => {
  it('still refuses a re-titled listing', () => {
    expect(
      resolveWith(mutate({}), { ...inputFor(TARGET), name: 'Intel Core i5-13400 Desktop Processor' }),
    ).toMatchObject({ bound: false, refusal: 'title-disagrees' });
  });

  it('still refuses when the reviewed product page names a different chip', () => {
    // Same reviewed product id, contradictory slug: the merchant's own record
    // disagrees with itself, so the listing is refused.
    const contradictory =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent('https://www.newegg.com/intel-core-i9-14900k-desktop-processor/p/N82E16819118431?item=9SIA1');
    expect(resolveWith(mutate({}), { ...inputFor(TARGET), trackedAffiliateUrl: contradictory })).toMatchObject({
      bound: false,
      refusal: 'destination-disagrees',
    });
  });
});

describe('only Newegg itself counts as Newegg', () => {
  it.each([
    ['newegg.com', true],
    ['www.newegg.com', true],
    ['promotions.newegg.com', true],
    ['NEWEGG.COM', true],
    ['newegg.com.', true],
    // Lookalikes an endsWith() check would have accepted.
    ['evilnewegg.com', false],
    ['xnewegg.com', false],
    ['newegg.com.attacker.test', false],
    ['notnewegg.com', false],
    ['newegg.co', false],
  ])('%s -> %s', (host, expected) => {
    expect(isNeweggHost(host)).toBe(expected);
  });

  it('refuses a tracked link whose destination is a lookalike host', () => {
    const hostile =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent(
        'https://evilnewegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E1',
      );
    expect(decodeMerchantDestination(hostile)).toBeNull();
    expect(resolveWith(mutate({}), { ...inputFor(TARGET), trackedAffiliateUrl: hostile })).toMatchObject({
      bound: false,
      refusal: 'destination-unreadable',
    });
  });
});

describe('everything unreviewed stays fail-closed', () => {
  it('refuses every published CPU except the reviewed one', () => {
    const bound = PARTS.filter((p) => p.category === 'cpu')
      .filter((p) => resolveCpuIdentity(inputFor(p.id), CPUS).bound)
      .map((p) => p.id);
    expect(bound).toEqual([TARGET]);
  });

  it('corroborates the live record against the reviewed product id', () => {
    const destination = decodeMerchantDestination(partById(TARGET).trackedAffiliateUrl)!;
    // The recorded productUrl carries the item id observed at review time,
    // which rotates; the product id is what must still agree.
    expect(merchantProductIdFrom(destination)).toBe(BASE.retailer.merchantProductId);
    expect(merchantProductIdFrom(BASE.retailer.productUrl)).toBe(BASE.retailer.merchantProductId);
    expect(destinationNamesCpu(destination, 'i5-13400F')).toBe(true);
    expect(destinationNamesCpu(destination, 'i5-13400')).toBe(false);
  });
});

describe('a binding survives the merchant re-issuing the same product', () => {
  it('binds the i5-13400F under its NEW offer id, which is why it is keyed on the product', () => {
    // Observed 2026-09-09: Newegg replaced item 9SIA4REKG24553 with
    // 9SIC7VBM1R3247 for this identical listing, changing the published part
    // id with it. Keyed on the part id, the binding died overnight; keyed on
    // the /p/ product id, it holds.
    const part = partById(TARGET);
    expect(part.id).toBe('newegg-cpu-9sic7vbm1r3247');
    expect(part.trackedAffiliateUrl).toContain('9SIC7VBM1R3247');
    expect(CPU_IDENTITY_BINDINGS[0].retailer.observedItemId).toBe('9SIA4REKG24553');

    expect(resolveCpuIdentity(inputFor(TARGET), CPUS)).toMatchObject({
      bound: true,
      canonicalCpuId: 'i5-13400f',
    });
  });

  it('refuses a destination that names no /p/ product at all', () => {
    const noProduct =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent('https://www.newegg.com/some-search-page?d=i5-13400f');
    expect(resolveWith(mutate({}), { ...inputFor(TARGET), trackedAffiliateUrl: noProduct })).toMatchObject({
      bound: false,
      refusal: 'destination-unreadable',
    });
  });

  it('refuses a different Newegg product, even with a matching title', () => {
    const otherProduct =
      'https://click.linksynergy.com/link?id=x&murl=' +
      encodeURIComponent(
        'https://www.newegg.com/intel-core-i5-13th-gen-core-i5-13400f-raptor-lake-lga-1700-desktop-cpu-processor/p/N82E99999999999?item=9SIA1',
      );
    expect(resolveCpuIdentity({ ...inputFor(TARGET), trackedAffiliateUrl: otherProduct }, CPUS)).toMatchObject({
      bound: false,
      refusal: 'not-reviewed',
    });
  });
});
