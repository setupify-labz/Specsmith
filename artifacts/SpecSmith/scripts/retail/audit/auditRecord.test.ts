import { describe, expect, it } from 'vitest';

import type { CatalogGpu, NeweggOffer } from '../rakuten/types';
import {
  AUDIT_ROW_KEYS,
  REFUSED_TITLE,
  buildAcceptedOfferAudit,
  buildAuditRow,
  describeAudit,
  sanitizeAuditTitle,
} from './auditRecord';

const gpu: CatalogGpu = {
  id: 'rtx5070',
  name: 'RTX 5070',
  brand: 'NVIDIA',
  vram_gb: 12,
};

const accepted = (overrides: Partial<NeweggOffer> = {}): NeweggOffer => ({
  status: 'accepted',
  sku: 'N82E16814932761',
  upc: '751492793949',
  productName: 'PNY GeForce RTX 5070 12GB GDDR7 Triple Fan Graphics Card',
  categoryPrimary: 'Computers',
  categorySecondary: 'Components~~Video Cards & Adapters',
  categorySecondaryLeaf: 'Video Cards & Adapters',
  retailPrice: 599.99,
  salePrice: 579.99,
  currency: 'USD',
  imageUrl: 'https://images.example.invalid/card.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/deeplink?id=private-offer-id',
  canonicalGpuId: gpu.id,
  mid: '44583',
  fetchedAt: '2026-08-29T00:00:00.000Z',
  adapterVersion: 2,
  ...overrides,
});

describe('the accepted-offer review record', () => {
  it('keeps only the title and closed matcher evidence needed for review', () => {
    const row = buildAuditRow(gpu, accepted());
    expect(Object.keys(row)).toEqual(AUDIT_ROW_KEYS);
    expect(row).toEqual({
      gpuId: 'rtx5070',
      catalogName: 'RTX 5070',
      title: 'PNY GeForce RTX 5070 12GB GDDR7 Triple Fan Graphics Card',
      titleRefused: false,
      detectedModel: 'rtx 5070',
      detectedSuffixes: [],
      modelMentionCount: 1,
      expectedMemoryGb: 12,
      titleMemoryGb: [12],
      memoryFromDescriptionOnly: false,
    });
  });

  it('marks capacity evidence that came only from the short description', () => {
    const row = buildAuditRow(
      gpu,
      accepted({ productName: 'ZOTAC SOLID OC GeForce RTX 5070 Graphics Card RTX 5070 SOLID OC' }),
    );
    expect(row.titleMemoryGb).toEqual([]);
    expect(row.memoryFromDescriptionOnly).toBe(true);
  });

  it('removes URLs and exact retailer identifiers without changing model evidence', () => {
    const offer = accepted({
      productName:
        'PNY RTX 5070 12GB N82E16814932761 UPC 751492793949 https://www.newegg.com/private?id=offer-42',
    });
    const row = buildAuditRow(gpu, offer);
    expect(row.title).toBe('PNY RTX 5070 12GB [identifier removed] UPC [identifier removed] [url removed]');
    expect(row.detectedModel).toBe('rtx 5070');
    expect(JSON.stringify(row)).not.toContain(offer.sku);
    expect(JSON.stringify(row)).not.toContain(offer.upc);
    expect(JSON.stringify(row)).not.toContain('newegg.com');
  });

  it('removes price-shaped title text and scheme-less web links', () => {
    const result = sanitizeAuditTitle('RTX 5070 12GB now $599.99 or 579.99 USD at www.example.invalid/deal');
    expect(result).toEqual({
      title: 'RTX 5070 12GB now [price removed] or [price removed] at [url removed]',
      refused: false,
    });
    expect(result.title).not.toContain('599');
    expect(result.title).not.toContain('579');
    expect(result.title).not.toContain('example.invalid');
  });

  it.each([
    ['a control character', 'RTX 5070 12GB\n::notice::payload'],
    ['a workflow command', 'RTX 5070 12GB ::add-mask::payload'],
    ['a spreadsheet formula', '=HYPERLINK("https://evil.invalid","RTX 5070 12GB")'],
    ['a leading plus formula', '+cmd|\' /C calc\'!A0 RTX 5070 12GB'],
    ['an empty title', '   '],
    ['an overlong title', `RTX 5070 12GB ${'x'.repeat(301)}`],
  ])('refuses the whole title when it contains %s', (_label, raw) => {
    expect(sanitizeAuditTitle(raw)).toEqual({ title: REFUSED_TITLE, refused: true });
  });

  it('does not put the refused payload into either output field', () => {
    const payload = 'RTX 5070 12GB\r::set-output name=x::pwned';
    const result = sanitizeAuditTitle(payload);
    expect(JSON.stringify(result)).not.toContain('pwned');
    expect(JSON.stringify(result)).not.toContain('set-output');
  });

  it('refuses an accepted offer that no longer has exact matcher evidence', () => {
    expect(() =>
      buildAcceptedOfferAudit(
        [gpu],
        [accepted({ productName: 'PNY GeForce RTX 5070 Ti 12GB', canonicalGpuId: gpu.id })],
        '2026-08-29T00:00:00.000Z',
      ),
    ).toThrow('no longer satisfies model evidence');
  });

  it('refuses an accepted offer assigned to a GPU outside the catalogue', () => {
    expect(() =>
      buildAcceptedOfferAudit(
        [gpu],
        [accepted({ canonicalGpuId: 'unexpected-gpu' })],
        '2026-08-29T00:00:00.000Z',
      ),
    ).toThrow('unexpected catalogue GPU');
  });

  it('sorts the review deterministically and reports counts only', () => {
    const other = { ...gpu, id: 'rtx5080', name: 'RTX 5080', vram_gb: 16 };
    const file = buildAcceptedOfferAudit(
      [gpu, other],
      [
        accepted({ canonicalGpuId: other.id, productName: 'ZOTAC GeForce RTX 5080 16GB SOLID OC' }),
        accepted({ productName: 'ASUS GeForce RTX 5070 12GB PRIME OC' }),
      ],
      '2026-08-29T00:00:00.000Z',
    );
    expect(file.rows.map((row) => row.gpuId)).toEqual(['rtx5070', 'rtx5080']);
    const description = describeAudit(file);
    expect(description).toBe('Audit artifact prepared: 2 catalogue GPU(s), 2 accepted offer(s), 0 refused title(s).');
    expect(description).not.toContain('ASUS');
    expect(description).not.toContain('ZOTAC');
  });

  it('never serializes prices, URLs, SKUs, UPCs or merchant ids', () => {
    const offer = accepted();
    const text = JSON.stringify(buildAcceptedOfferAudit([gpu], [offer], offer.fetchedAt));
    for (const forbidden of [
      String(offer.retailPrice),
      String(offer.salePrice),
      offer.imageUrl,
      offer.trackedAffiliateUrl,
      offer.sku,
      offer.upc!,
      offer.mid,
      'retailPrice',
      'salePrice',
      'trackedAffiliateUrl',
      'imageUrl',
      'sku',
      'upc',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
