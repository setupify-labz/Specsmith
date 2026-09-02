import { describe, expect, it } from 'vitest';

import { auditCoreSelectorCatalog, auditCoreSelectorEntry, type CoreSelectorCatalogEntry } from './coreSelectorLinkAudit';

const ENTRY: CoreSelectorCatalogEntry = { id: 'rtx5090', name: 'RTX 5090', brand: 'NVIDIA', category: 'gpu' };

describe('auditCoreSelectorEntry', () => {
  it('produces one Amazon row and one Newegg row per part', () => {
    const rows = auditCoreSelectorEntry(ENTRY);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.retailer).sort()).toEqual(['Amazon', 'Newegg']);
  });

  it('classifies the ACTUAL getAffiliateUrl()/getNeweggUrl() output as fallback-search, never exact — this is the audit finding', () => {
    const rows = auditCoreSelectorEntry(ENTRY);
    for (const row of rows) {
      expect(row.urlType).toBe('fallback-search');
      expect(row.status).toBe('fail');
      expect(row.source).toBe('core-selector');
      expect(row.partId).toBe('rtx5090');
      expect(row.intendedProduct).toBe('RTX 5090');
    }
  });

  it('marks an entry with no usable identity as unverifiable rather than building a link for it', () => {
    const rows = auditCoreSelectorEntry({ id: '', name: '', category: 'gpu' });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ urlType: 'unverifiable', status: 'fail' });
  });
});

describe('auditCoreSelectorCatalog', () => {
  it('produces two rows for every entry', () => {
    const rows = auditCoreSelectorCatalog([ENTRY, { id: 'r9950x3d', name: 'Ryzen 9 9950X3D', brand: 'AMD', category: 'cpu' }]);
    expect(rows).toHaveLength(4);
  });
});
