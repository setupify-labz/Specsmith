import { describe, expect, it } from 'vitest';
import highlights from './homePrebuiltHighlights.json';
import { getPrebuiltTotal, prebuilts } from '../lib/prebuilts';

describe('homepage build highlights', () => {
  it('stay synchronized with the canonical build catalogue and part prices', () => {
    expect(highlights).toEqual(prebuilts.map(prebuilt => ({
      id: prebuilt.id,
      name: prebuilt.name,
      tagline: prebuilt.tagline,
      price: getPrebuiltTotal(prebuilt),
    })));
  });
});
