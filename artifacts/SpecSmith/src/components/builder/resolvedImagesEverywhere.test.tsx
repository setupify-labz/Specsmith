// @vitest-environment jsdom
//
// The resolver reaching the OTHER two places a product is pictured.
//
// PR #108 wired it into the card. A shopper sees the same listing three times
// — in the grid, in the detail drawer, and as a tile in their build — and a
// cut-out that reaches only the first is worse than none at all: the same
// product then appears twice with two different backdrops, which reads as two
// different photographs. These drive the drawer and the summary directly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from '../../lib/retail/partCatalog';
import { indexManifest, type ProductImageManifest } from '../../lib/retail/processedImages';
import ProductDetailDrawer from './ProductDetailDrawer';
import RetailBuildSummary from './RetailBuildSummary';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const found = parsed.catalog.parts.find((candidate) => candidate.category === 'gpu')!;
const SOURCE_SHA = 'c'.repeat(64);
const PROCESSED_SHA = 'd'.repeat(64);
const LOCAL = `/images/products/${PROCESSED_SHA}.png`;
const part = { ...found, imageSha256: SOURCE_SHA } as AffiliatePart;
const NOW = Date.parse(part.fetchedAt) + 60_000;

afterEach(cleanup);

const manifest = (over: Record<string, unknown> = {}): ProductImageManifest => ({
  generatedAt: '2026-09-10',
  source: 'catalogue',
  entries: [
    {
      partId: part.id,
      sourceUrl: part.imageUrl,
      sourceSha256: SOURCE_SHA,
      processedSha256: PROCESSED_SHA,
      outcome: 'processed',
      processedPath: LOCAL,
      approved: true,
      rightsBasis: 'test fixture: pretend clause',
      ...over,
    } as ProductImageManifest['entries'][number],
  ],
});

const indexed = (m: ProductImageManifest | null) => (m ? indexManifest(m) : null);

const openDrawer = (m: ProductImageManifest | null) =>
  render(
    <ProductDetailDrawer
      part={part}
      now={NOW}
      selected={false}
      onClose={vi.fn()}
      onToggle={vi.fn()}
      processedImages={indexed(m)}
    />,
  );

const renderSummary = (m: ProductImageManifest | null) =>
  render(
    <RetailBuildSummary
      selectedParts={[{ category: 'gpu', part }]}
      now={NOW}
      collapsed={false}
      onToggleCollapsed={vi.fn()}
      onRemove={vi.fn()}
      processedImages={indexed(m)}
    />,
  );

describe('the detail drawer', () => {
  it('shows the approved cut-out rather than the merchant image', () => {
    openDrawer(manifest());
    const image = screen.getByTestId('detail-image');
    expect(image.getAttribute('src')).toBe(LOCAL);
    expect(image.getAttribute('data-image-source')).toBe('processed');
  });

  it('shows the merchant image when the manifest does not clear the cut-out', () => {
    // Not approved is the ordinary case, not an error: nothing is published
    // until a person has looked at it.
    openDrawer(manifest({ approved: false }));
    const image = screen.getByTestId('detail-image');
    expect(image.getAttribute('src')).toBe(part.imageUrl);
    expect(image.getAttribute('data-image-source')).toBe('merchant');
  });

  it('falls back to the merchant image when the local file will not load', () => {
    // A missing or corrupt cut-out costs the shopper the improvement, never
    // the product photograph.
    openDrawer(manifest());
    fireEvent.error(screen.getByTestId('detail-image'));
    const image = screen.getByTestId('detail-image');
    expect(image.getAttribute('src')).toBe(part.imageUrl);
    expect(screen.queryByTestId('detail-image-placeholder')).toBeNull();
  });

  it('only then gives up and shows the placeholder', () => {
    openDrawer(manifest());
    fireEvent.error(screen.getByTestId('detail-image'));
    fireEvent.error(screen.getByTestId('detail-image'));
    expect(screen.getByTestId('detail-image-placeholder')).toBeTruthy();
  });

  it('composites on the shared frame rather than a colour of its own', () => {
    openDrawer(manifest());
    const frame = screen.getByTestId('detail-image-frame');
    expect(frame.className).toContain('retail-photo-frame');
    expect(frame.getAttribute('style') ?? '').not.toContain('--ff-surface');
  });
});

describe('the build summary tile', () => {
  it('shows the approved cut-out rather than the merchant image', () => {
    renderSummary(manifest());
    const image = screen.getByTestId('summary-thumb').querySelector('img')!;
    expect(image.getAttribute('src')).toBe(LOCAL);
    expect(image.getAttribute('data-image-source')).toBe('processed');
  });

  it('shows the merchant image when the manifest does not clear the cut-out', () => {
    renderSummary(manifest({ rightsBasis: '   ' }));
    const image = screen.getByTestId('summary-thumb').querySelector('img')!;
    expect(image.getAttribute('src')).toBe(part.imageUrl);
  });

  it('falls back to the merchant image, then to the icon', () => {
    renderSummary(manifest());
    const image = () => screen.getByTestId('summary-thumb').querySelector('img');
    fireEvent.error(image()!);
    expect(image()!.getAttribute('src')).toBe(part.imageUrl);
    expect(screen.queryByTestId('summary-thumb-fallback')).toBeNull();
    fireEvent.error(image()!);
    expect(screen.getByTestId('summary-thumb-fallback')).toBeTruthy();
  });

  it('composites on the shared frame rather than a colour of its own', () => {
    renderSummary(manifest());
    const tile = screen.getByTestId('summary-thumb');
    expect(tile.className).toContain('retail-photo-frame');
    expect(tile.getAttribute('style') ?? '').not.toContain('--ff-surface');
  });
});

describe('all three places agree', () => {
  it('resolves to the same URL for the same part and manifest', () => {
    // The property that matters is not "each one works" but that they cannot
    // disagree: one shared hook, one shared decision.
    openDrawer(manifest());
    const inDrawer = screen.getByTestId('detail-image').getAttribute('src');
    cleanup();
    renderSummary(manifest());
    const inSummary = screen.getByTestId('summary-thumb').querySelector('img')!.getAttribute('src');
    expect(inDrawer).toBe(LOCAL);
    expect(inSummary).toBe(inDrawer);
  });

  it('agrees on the merchant image too, when the cut-out is refused', () => {
    openDrawer(manifest({ outcome: 'kept-original', processedPath: undefined, processedSha256: undefined }));
    const inDrawer = screen.getByTestId('detail-image').getAttribute('src');
    cleanup();
    renderSummary(manifest({ outcome: 'kept-original', processedPath: undefined, processedSha256: undefined }));
    const inSummary = screen.getByTestId('summary-thumb').querySelector('img')!.getAttribute('src');
    expect(inDrawer).toBe(part.imageUrl);
    expect(inSummary).toBe(inDrawer);
  });
});
