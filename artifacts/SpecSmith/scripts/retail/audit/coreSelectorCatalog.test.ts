import { describe, expect, it } from 'vitest';

import { RETAIL_PART_CATEGORIES } from '../../../src/lib/retail/partCatalog';
import { loadCoreSelectorCatalog } from './coreSelectorCatalog';

describe('loadCoreSelectorCatalog', () => {
  it('reads every real category the core builder selectors expose, with a usable id and name', () => {
    const entries = loadCoreSelectorCatalog();
    expect(entries.length).toBeGreaterThan(0);

    const present = new Set(entries.map((e) => e.category));
    for (const category of RETAIL_PART_CATEGORIES) {
      expect(present.has(category)).toBe(true);
    }

    for (const entry of entries) {
      expect(entry.id.trim()).not.toBe('');
      expect(entry.name.trim()).not.toBe('');
    }
  });

  it('has no duplicate ids within a category', () => {
    const entries = loadCoreSelectorCatalog();
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.category}:${entry.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
