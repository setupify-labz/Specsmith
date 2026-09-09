// The rule that decides between a local cut-out and the merchant's own image.
import { describe, expect, it } from 'vitest';

import { chooseProductImage, indexManifest, type ProductImageManifest } from './processedImages';

const SOURCE = 'https://c1.neweggimages.test/ProductImageCompressAll640/14-126-744-02.png';
const SHA = 'a'.repeat(64);
const part = { id: 'newegg-gpu-a', imageUrl: SOURCE, imageSha256: SHA };

const manifest = (over: Partial<ProductImageManifest['entries'][number]> = {}): ProductImageManifest => ({
  generatedAt: '2026-09-09',
  source: 'catalogue',
  entries: [
    {
      partId: 'newegg-gpu-a',
      sourceUrl: SOURCE,
      sourceSha256: 'a'.repeat(64),
      outcome: 'processed',
      processedPath: `/images/products/${'a'.repeat(64)}.png`,
      approved: true,
      rightsBasis: 'test fixture: pretend clause',
      ...over,
    },
  ],
});

const choose = (m: ProductImageManifest | null, subject = part) => chooseProductImage(subject, indexManifest(m));

describe('a cut-out is used only when everything matches', () => {
  it('uses the approved local file, and keeps the merchant URL as its fallback', () => {
    const choice = choose(manifest());
    expect(choice.kind).toBe('processed');
    if (choice.kind !== 'processed') return;
    expect(choice.src).toBe(`/images/products/${'a'.repeat(64)}.png`);
    expect(choice.fallbackSrc).toBe(SOURCE);
    // Same-origin: no merchant host survives into the src we load.
    expect(choice.src.startsWith('/images/')).toBe(true);
  });
});

describe('anything less than an exact match falls back to the merchant image', () => {
  it.each([
    ['there is no manifest at all', null, part, 'no-manifest'],
    ['no entry names this part', manifest({ partId: 'newegg-gpu-other' }), part, 'no-entry-for-part'],
    [
      'the catalogue now points at a different photograph',
      manifest(),
      { id: 'newegg-gpu-a', imageUrl: `${SOURCE}?v=2`, imageSha256: SHA },
      'source-image-changed',
    ],
    ['the run kept the original', manifest({ outcome: 'kept-original', processedPath: undefined }), part, 'not-processed'],
    // A processed entry naming no file is now rejected by the manifest parser
    // rather than reaching this decision, so the map is empty.
    ['a processed entry records no file', manifest({ processedPath: undefined }), part, 'no-manifest'],
    ['nobody has approved it', manifest({ approved: false }), part, 'not-approved'],
    ['approval is simply absent', manifest({ approved: undefined }), part, 'not-approved'],
  ])('uses the merchant image when %s', (_label, m, subject, reason) => {
    const choice = choose(m as ProductImageManifest | null, subject);
    expect(choice.kind).toBe('original');
    if (choice.kind !== 'original') return;
    expect(choice.src).toBe(subject.imageUrl);
    expect(choice.reason).toBe(reason);
  });

  it('will not accept a cut-out made from a DIFFERENT part with the same picture', () => {
    // Same source URL, wrong part id: the entry does not describe this card.
    const choice = choose(manifest({ partId: 'newegg-gpu-b' }));
    expect(choice).toMatchObject({ kind: 'original', reason: 'no-entry-for-part' });
  });
});

describe('a malformed manifest cannot change which picture is shown', () => {
  it('ignores duplicate part ids deterministically, taking the first', () => {
    const m = manifest();
    m.entries.push({ ...m.entries[0], processedPath: '/images/products/second.png' });
    const choice = choose(m);
    expect(choice.kind === 'processed' && choice.src).toBe(`/images/products/${'a'.repeat(64)}.png`);
  });

  it('treats an empty or absent entry list as no cut-outs', () => {
    expect(indexManifest({ generatedAt: '', source: 'catalogue', entries: [] }).size).toBe(0);
    expect(indexManifest(null).size).toBe(0);
    expect(indexManifest(undefined).size).toBe(0);
  });
});

describe('a cut-out cannot display without a recorded licence basis', () => {
  it.each([
    ['none is recorded', undefined],
    ['it is blank', '   '],
  ])('falls back to the merchant image when %s', (_label, rightsBasis) => {
    const m = manifest({ rightsBasis: rightsBasis as string | undefined });
    const choice = chooseProductImage(part, indexManifest(m));
    expect(choice).toMatchObject({ kind: 'original', reason: 'no-rights-basis' });
  });
});

describe('a URL is a location, not a version', () => {
  it('refuses when the bytes behind an unchanged URL have changed', () => {
    // Same URL, same part, approved — but the catalogue now hashes to
    // something else, so the cut-out is of a photograph that is no longer
    // there. This is the case URL equality alone cannot see.
    const choice = chooseProductImage(
      { id: 'newegg-gpu-a', imageUrl: SOURCE, imageSha256: 'f'.repeat(64) },
      indexManifest(manifest()),
    );
    expect(choice).toMatchObject({ kind: 'original', reason: 'source-bytes-changed' });
  });

  it('refuses when the catalogue does not record which version it is serving', () => {
    for (const imageSha256 of [undefined, null]) {
      const choice = chooseProductImage(
        { id: 'newegg-gpu-a', imageUrl: SOURCE, imageSha256 },
        indexManifest(manifest()),
      );
      expect(choice).toMatchObject({ kind: 'original', reason: 'source-version-unknown' });
    }
  });
});
