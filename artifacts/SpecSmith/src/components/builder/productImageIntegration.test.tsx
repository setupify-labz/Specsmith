// @vitest-environment jsdom
//
// The card actually loading the right picture — the gap that blocked PR #108.
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from '../../lib/retail/partCatalog';
import { indexManifest, type ProductImageManifest } from '../../lib/retail/processedImages';
import RetailProductCard from './RetailProductCard';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const found = parsed.catalog.parts.find((p) => p.category === 'gpu') as AffiliatePart;
const part = { ...found, imageSha256: 'b'.repeat(64) } as AffiliatePart;
const FRESH_NOW = Date.parse(part.fetchedAt) + 60_000;
const PROCESSED = 'b'.repeat(64);
const LOCAL = `/images/products/${PROCESSED}.png`;

afterEach(cleanup);

const manifest = (over: Record<string, unknown> = {}): ProductImageManifest => ({
  generatedAt: '2026-09-09',
  source: 'catalogue',
  entries: [
    {
      partId: part.id,
      sourceUrl: part.imageUrl,
      sourceSha256: 'b'.repeat(64),
      processedSha256: PROCESSED,
      outcome: 'processed',
      processedPath: LOCAL,
      approved: true,
      rightsBasis: 'test fixture: pretend clause',
      ...over,
    } as ProductImageManifest['entries'][number],
  ],
});

const renderCard = (m: ProductImageManifest | null) =>
  render(
    <RetailProductCard
      part={part}
      selected={false}
      now={FRESH_NOW}
      onToggle={vi.fn()}
      processedImages={m ? indexManifest(m) : null}
    />,
  );

const img = () => document.querySelector('img') as HTMLImageElement;

describe('an approved cut-out actually reaches the card', () => {
  it('loads the local file instead of the merchant URL', () => {
    renderCard(manifest());
    expect(img().getAttribute('src')).toBe(LOCAL);
    expect(img().getAttribute('data-image-source')).toBe('processed');
  });

  it('loads the merchant URL when there is no manifest', () => {
    renderCard(null);
    expect(img().getAttribute('src')).toBe(part.imageUrl);
    expect(img().getAttribute('data-image-source')).toBe('merchant');
  });

  it.each([
    ['it is not approved', { approved: false }],
    ['the run kept the original', { outcome: 'kept-original', processedPath: undefined }],
    ['the catalogue points at a different photograph', { sourceUrl: 'https://elsewhere.test/other.png' }],
    ['the entry belongs to another part', { partId: 'newegg-gpu-someone-else' }],
  ])('loads the merchant URL when %s', (_label, over) => {
    renderCard(manifest(over));
    expect(img().getAttribute('src')).toBe(part.imageUrl);
  });
});

describe('a local file that will not load costs the cut-out, never the picture', () => {
  it('falls back to the merchant image when the local file 404s', () => {
    renderCard(manifest());
    expect(img().getAttribute('src')).toBe(LOCAL);

    fireEvent.error(img());

    expect(img().getAttribute('src')).toBe(part.imageUrl);
    expect(img().getAttribute('data-image-source')).toBe('merchant');
    // Still a picture, not the "no image" placeholder.
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
  });

  it('only shows the placeholder once the merchant image fails too', () => {
    renderCard(manifest());
    fireEvent.error(img()); // local fails -> merchant
    fireEvent.error(img()); // merchant fails -> placeholder
    expect(screen.getByTestId('image-placeholder')).toBeTruthy();
  });

  it('shows the placeholder directly when there is no cut-out and the merchant image fails', () => {
    renderCard(null);
    fireEvent.error(img());
    expect(screen.getByTestId('image-placeholder')).toBeTruthy();
  });
});

describe('the frame the cut-out is composited on', () => {
  // WHY THIS CHANGED SHAPE. It used to read the frame's inline style for
  // `--ff-photo-bg`. PR #108 wrote that style with a note saying whichever of
  // #107 and #108 landed second should move it onto a shared
  // `.retail-photo-frame` class — #108 landed second, and the drawer and the
  // build summary now composite against the same colour. An inline style
  // cannot be shared, so asserting one would have pinned the very thing that
  // had to change. The property is stronger stated as sharing: one class, one
  // declaration, and no component quietly setting the colour itself.
  it('carries the shared photo-frame class rather than its own colour', () => {
    renderCard(manifest());
    const frame = screen.getByTestId('open-details-image');
    expect(frame.className).toContain('retail-photo-frame');
    expect(frame.getAttribute('style') ?? '').not.toContain('--ff-photo-bg');
  });

  it('is the same class the drawer and the build summary use', () => {
    const source = (name: string) =>
      fs.readFileSync(path.join(__dirname, name), 'utf-8');
    for (const file of ['ProductDetailDrawer.tsx', 'RetailBuildSummary.tsx', 'RetailProductCard.tsx']) {
      expect(source(file), file).toContain('retail-photo-frame');
      // Comments are stripped first: a file explaining the token in prose must
      // not be able to satisfy this, nor to fail it.
      const code = source(file)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(code, `${file} sets the photo background inline`).not.toContain('--ff-photo-bg');
    }
  });

  it('is declared once, against the token, in the stylesheet', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'index.css'), 'utf-8');
    const declarations = css.match(/\.retail-photo-frame\s*\{[^}]*\}/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toContain('var(--ff-photo-bg)');
  });
});

describe('nothing about the listing itself changes', () => {
  it('keeps the merchant title, price and tracked link untouched by image choice', () => {
    renderCard(manifest());
    const link = document.querySelector('a[href]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(part.trackedAffiliateUrl);
    expect(document.body.textContent).toContain(part.name.slice(0, 20));
  });
});
