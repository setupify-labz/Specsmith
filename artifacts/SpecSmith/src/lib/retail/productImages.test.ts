import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';
import { dedupeImageUrls, imageAltText, isRenderableImageUrl, verifiedImages } from './productImages';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;

describe('an image URL is validated before it is rendered', () => {
  it('accepts https and refuses everything else', () => {
    expect(isRenderableImageUrl('https://c1.neweggimages.com/a.jpg')).toBe(true);
    for (const bad of [
      'http://c1.neweggimages.com/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//c1.neweggimages.com/a.jpg',
      'not a url',
      '',
      '   ',
      null,
      undefined,
      42,
    ]) {
      expect(isRenderableImageUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe('duplicates are removed without merging distinct pictures', () => {
  it('keeps the first occurrence and drops exact repeats', () => {
    const urls = dedupeImageUrls([
      'https://cdn.test/a.jpg',
      'https://cdn.test/b.jpg',
      'https://cdn.test/a.jpg',
      '  https://cdn.test/b.jpg  ',
    ]);
    expect(urls).toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg']);
  });

  it('drops invalid entries rather than rendering a broken image', () => {
    expect(dedupeImageUrls(['https://cdn.test/a.jpg', 'http://cdn.test/b.jpg', ''])).toEqual([
      'https://cdn.test/a.jpg',
    ]);
  });

  it('does not treat two different URLs as the same picture', () => {
    // Same file name, different path. Guessing they are the same image is how
    // a real second photograph gets thrown away.
    const urls = dedupeImageUrls(['https://cdn.test/640/a.jpg', 'https://cdn.test/1280/a.jpg']);
    expect(urls).toHaveLength(2);
  });
});

describe('the catalogue supplies exactly one verified image per SKU', () => {
  it('returns that one image for every part in the real catalogue', () => {
    for (const part of catalog.parts) {
      const images = verifiedImages(part);
      expect(images, part.id).toEqual([part.imageUrl]);
    }
  });

  it('the schema carries no images collection, because the feed has no data for one', () => {
    // The rule the review set: add the collection only when it is backed by
    // real data. A Rakuten item has one <imageurl> and no gallery field, so
    // there is nothing to back it, and inventing one would mean scraping,
    // guessing CDN patterns, or repeating the same picture.
    for (const part of catalog.parts.slice(0, 20)) {
      expect(Object.keys(part)).not.toContain('images');
    }
    const serialized = JSON.stringify(catalog.parts.slice(0, 50));
    expect(serialized).not.toContain('"images"');
  });

  it('the feed itself has one image element per item — checked, not assumed', () => {
    // If a future feed grows a second image field this fails, which is the
    // moment to revisit the decision above.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtures = path.join(here, '..', '..', '..', 'scripts', 'retail', 'rakuten', '__fixtures__');
    const xml = fs
      .readdirSync(fixtures)
      .filter((name) => name.endsWith('.xml'))
      .map((name) => fs.readFileSync(path.join(fixtures, name), 'utf-8'))
      .join('\n');
    const items = (xml.match(/<item>/g) ?? []).length;
    const imageUrls = (xml.match(/<imageurl>/g) ?? []).length;
    expect(items).toBeGreaterThan(0);
    expect(imageUrls).toBeLessThanOrEqual(items);
    // No plural or alternate image element anywhere in the feed vocabulary.
    for (const absent of ['<imageurls>', '<images>', '<altimage', '<additionalimage']) {
      expect(xml.toLowerCase().includes(absent), absent).toBe(false);
    }
  });
});

describe('alt text describes the picture without inventing anything', () => {
  it('is the merchant title alone when there is one image', () => {
    expect(imageAltText('ASUS PRIME RTX 5070', 0, 1)).toBe('ASUS PRIME RTX 5070');
  });

  it('adds the position only when there is more than one', () => {
    expect(imageAltText('ASUS PRIME RTX 5070', 1, 4)).toBe('ASUS PRIME RTX 5070 — image 2 of 4');
  });
});
