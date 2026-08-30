import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  AFFILIATE_PART_CATEGORY_TARGETS,
  AFFILIATE_PART_TARGET,
  RETAIL_PART_CATEGORIES,
  parseAffiliatePartCatalog,
} from './partCatalog';

describe('published affiliate part catalog', () => {
  it('ships the complete validated 500-part image-and-link catalog', async () => {
    const file = new URL('../../../public/data/retail-parts.json', import.meta.url);
    const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
    const parsed = parseAffiliatePartCatalog(raw);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.catalog.parts).toHaveLength(AFFILIATE_PART_TARGET);
    for (const category of RETAIL_PART_CATEGORIES) {
      expect(parsed.catalog.parts.filter((part) => part.category === category)).toHaveLength(
        AFFILIATE_PART_CATEGORY_TARGETS[category],
      );
    }
    expect(JSON.stringify(parsed.catalog)).not.toMatch(/"(?:price|stock|inStock)"\s*:/i);
  });
});
