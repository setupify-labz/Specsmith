// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart, type RetailPartCategory } from '../../lib/retail/partCatalog';
import { whiteParts } from '../../lib/retail/whiteBuild';
import ProductDetailDrawer from './ProductDetailDrawer';
import RetailBuildSummary from './RetailBuildSummary';
import RetailBuilder from './RetailBuilder';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;
const FRESH_NOW = Math.max(...catalog.parts.map((part) => Date.parse(part.fetchedAt))) + 60_000;
const gpuParts = catalog.parts.filter((part) => part.category === 'gpu');

afterEach(cleanup);

const renderBuilder = (selection: Partial<Record<RetailPartCategory, string | null>> = {}) =>
  render(<RetailBuilder parts={catalog.parts} selection={selection} onSelect={vi.fn()} now={FRESH_NOW} />);

// ---------------------------------------------------------------------------

describe('the build summary shows the picture of the exact selected SKU', () => {
  const summaryFor = (parts: { category: RetailPartCategory; part: AffiliatePart }[]) =>
    render(
      <RetailBuildSummary
        selectedParts={parts}
        now={FRESH_NOW}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

  it('uses that listing\'s own imageUrl, never a canonical or sibling image', () => {
    // The failure this rules out: two SKUs of one model, and the summary
    // showing a picture of the model instead of the variant that was chosen.
    const chosen = gpuParts[3];
    const { container } = summaryFor([{ category: 'gpu', part: chosen }]);
    const thumb = within(container).getByTestId('summary-thumb');
    expect(thumb.getAttribute('data-part-id')).toBe(chosen.id);
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(chosen.imageUrl);

    // And it is not any OTHER listing's image, including its siblings.
    const others = catalog.parts.filter((part) => part.id !== chosen.id).map((part) => part.imageUrl);
    expect(others).not.toContain(thumb.querySelector('img')?.getAttribute('src'));
  });

  it('is a small thumbnail, in the 48-64px band the review asked for', () => {
    const { container } = summaryFor([{ category: 'gpu', part: gpuParts[0] }]);
    const thumb = within(container).getByTestId('summary-thumb');
    expect(thumb.className).toContain('h-14');
    expect(thumb.className).toContain('w-14');
  });

  it('keeps the item when its image fails, rather than collapsing the row', () => {
    const chosen = gpuParts[0];
    const { container } = summaryFor([{ category: 'gpu', part: chosen }]);
    fireEvent.error(within(container).getByTestId('summary-thumb').querySelector('img')!);

    expect(within(container).getByTestId('summary-thumb-fallback')).toBeDefined();
    // Everything else about the line survives: title, price and the control.
    expect(within(container).getByTestId('summary-item-gpu')).toBeDefined();
    expect(within(container).getByTestId('summary-price-gpu')).toBeDefined();
    expect(within(container).getByLabelText(/^Remove /)).toBeDefined();
    // The tile keeps its footprint, so the row does not reflow around it.
    const thumb = within(container).getByTestId('summary-thumb');
    expect(thumb.className).toContain('h-14');
  });

  it('carries the shortened title, the full title and the selected price', () => {
    const chosen = catalog.parts.find((part) => part.category === 'gpu' && part.name.length > 80) ?? gpuParts[0];
    const { container } = summaryFor([{ category: 'gpu', part: chosen }]);
    const title = within(container).getByTestId('summary-title-gpu');
    expect(title.getAttribute('aria-label')).toBe(chosen.name);
    expect(title.textContent!.length).toBeLessThan(chosen.name.length + 1);
    expect(within(container).getByTestId('summary-price-gpu').textContent).toContain(
      (chosen.salePrice ?? chosen.retailPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
  });
});

// ---------------------------------------------------------------------------

describe('the White build collection', () => {
  it('is discoverable, off by default, and keeps the normal categories', () => {
    renderBuilder();
    const toggle = screen.getByTestId('white-build-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // All twelve categories are still there before and after switching it on.
    expect(screen.getByTestId('category-rail-gpu')).toBeDefined();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('category-rail-gpu')).toBeDefined();
    expect(screen.getByTestId('category-rail-keyboard')).toBeDefined();
  });

  it('shows only verified white SKUs, with their own prices and links', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('white-build-toggle'));
    const whiteGpuIds = new Set(whiteParts(catalog.parts).filter((part) => part.category === 'gpu').map((part) => part.id));
    expect(whiteGpuIds.size).toBeGreaterThan(0);

    const shown = screen.getAllByTestId('retail-product-card').map((card) => card.getAttribute('data-part-id'));
    expect(shown.length).toBe(whiteGpuIds.size);
    for (const id of shown) expect(whiteGpuIds.has(id!)).toBe(true);

    // Each keeps its own price and link — the collection filtered, it did not
    // rewrite anything.
    for (const id of shown) {
      const part = catalog.parts.find((candidate) => candidate.id === id)!;
      const card = screen.getAllByTestId('retail-product-card').find((element) => element.getAttribute('data-part-id') === id)!;
      expect(within(card).getByTestId('view-at-newegg').getAttribute('href')).toBe(part.trackedAffiliateUrl);
      expect(within(card).getByTestId('price-primary').textContent).toContain(
        (part.salePrice ?? part.retailPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      );
    }
  });

  it('shows a per-category count that matches what it will display', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('white-build-toggle'));
    const counts = new Map<string, number>();
    for (const part of whiteParts(catalog.parts)) counts.set(part.category, (counts.get(part.category) ?? 0) + 1);
    expect(screen.getByTestId('category-rail-gpu').textContent).toContain(String(counts.get('gpu')));
  });

  it('is honest when a category has no verified white product', () => {
    // Keyboards mention white in three titles and none of them is a white
    // keyboard, so this is the case that must not be padded.
    renderBuilder();
    fireEvent.click(screen.getByTestId('white-build-toggle'));
    fireEvent.click(screen.getByTestId('category-rail-keyboard'));

    expect(screen.queryAllByTestId('retail-product-card')).toHaveLength(0);
    const empty = screen.getByTestId('catalog-empty');
    expect(empty.textContent).toContain('white finish');
    expect(empty.textContent!.toLowerCase()).not.toContain('out of stock');
  });

  it('explains what the collection is, where it is switched on', () => {
    renderBuilder();
    expect(screen.queryByTestId('white-build-note')).toBeNull();
    fireEvent.click(screen.getByTestId('white-build-toggle'));
    expect(screen.getByTestId('white-build-note').textContent).toContain('merchant title');
  });
});

// ---------------------------------------------------------------------------

describe('the product detail view', () => {
  const openDetail = (part: AffiliatePart, selected = false) =>
    render(<ProductDetailDrawer part={part} now={FRESH_NOW} selected={selected} onClose={vi.fn()} onToggle={vi.fn()} />);

  it('opens from the card image, the title and a View details control', () => {
    renderBuilder();
    const card = screen.getAllByTestId('retail-product-card')[0];
    expect(within(card).getByTestId('open-details-image')).toBeDefined();
    expect(within(card).getByTestId('open-details-title')).toBeDefined();
    fireEvent.click(within(card).getByTestId('view-details'));
    expect(screen.getByTestId('product-detail')).toBeDefined();
  });

  it('is a labelled modal dialog', () => {
    const part = gpuParts[0];
    openDetail(part);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(part.name);
  });

  it('shows this SKU\'s own image with the merchant title as alt text', () => {
    const part = gpuParts[2];
    openDetail(part);
    const image = screen.getByTestId('detail-image');
    expect(image.getAttribute('src')).toBe(part.imageUrl);
    expect(image.getAttribute('alt')).toBe(part.name);
  });

  it('shows no carousel chrome for a listing with one verified image', () => {
    // The catalogue publishes one image per SKU. Previous/next controls, a
    // thumbnail strip and an "of 4" counter would all be claims about data
    // that does not exist.
    openDetail(gpuParts[0]);
    expect(screen.queryByTestId('detail-prev')).toBeNull();
    expect(screen.queryByTestId('detail-next')).toBeNull();
    expect(screen.queryByTestId('detail-thumbnails')).toBeNull();
    expect(screen.queryByTestId('detail-position')).toBeNull();
    // A count, not a description of the retailer's feed. The old copy
    // ("The retailer feed publishes one image for this listing") explained our
    // plumbing to a shopper; this asserts the replacement stays a bare count
    // and never grows back into an explanation or an apology.
    const note = screen.getByTestId('detail-single-image-note').textContent ?? '';
    expect(note.trim()).toBe('1 image available');
    expect(note).not.toMatch(/retailer|feed|publishes|listing|only|unfortunately/i);
  });

  it('falls back safely when the image fails, keeping price and actions', () => {
    openDetail(gpuParts[0]);
    fireEvent.error(screen.getByTestId('detail-image'));
    expect(screen.getByTestId('detail-image-placeholder')).toBeDefined();
    expect(screen.getByTestId('detail-price')).toBeDefined();
    expect(screen.getByTestId('detail-add-to-build')).toBeDefined();
    expect(screen.getByTestId('detail-view-at-newegg')).toBeDefined();
  });

  it('claims nothing about stock', () => {
    openDetail(gpuParts[0]);
    const text = document.body.textContent ?? '';
    for (const forbidden of ['In stock', 'Out of stock', 'Available now', 'Sold out']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ProductDetailDrawer part={gpuParts[0]} now={FRESH_NOW} selected={false} onClose={onClose} onToggle={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('no Amazon action is offered, because no Amazon offer data exists', () => {
  const builderSources = () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return fs
      .readdirSync(here)
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
      .map((name) => ({ name, body: fs.readFileSync(path.join(here, name), 'utf-8') }));
  };

  it('the retail builder renders no Amazon button anywhere', () => {
    renderBuilder({ gpu: gpuParts[0].id });
    expect(screen.queryByText(/amazon/i)).toBeNull();
  });

  it('the detail view offers only the retailer the listing actually came from', () => {
    render(<ProductDetailDrawer part={gpuParts[0]} now={FRESH_NOW} selected={false} onClose={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByTestId('detail-view-at-newegg')).toBeDefined();
    expect(screen.queryByText(/amazon/i)).toBeNull();
  });

  it('no builder component links to amazon or reaches for the placeholder tag', () => {
    // getAffiliateUrl() in lib/fps.ts builds an amazon.com/s?k= SEARCH link
    // with a placeholder associates tag. A search link is not a product link,
    // and presenting one as this SKU's offer would be a fabrication. Until
    // verified Amazon offer data exists, nothing here may use it.
    for (const { name, body } of builderSources()) {
      expect(body.toLowerCase().includes('amazon'), `${name} mentions Amazon`).toBe(false);
      expect(body.includes('getAffiliateUrl'), `${name} builds an Amazon search link`).toBe(false);
      expect(body.includes('AMAZON_AFFILIATE_TAG'), `${name} uses the placeholder tag`).toBe(false);
    }
  });

  it('every retailer link on a card belongs to that exact listing', () => {
    renderBuilder();
    for (const card of screen.getAllByTestId('retail-product-card')) {
      const id = card.getAttribute('data-part-id')!;
      const part = catalog.parts.find((candidate) => candidate.id === id)!;
      const link = within(card).getByTestId('view-at-newegg');
      expect(link.getAttribute('href')).toBe(part.trackedAffiliateUrl);
      expect(link.textContent).toContain('Newegg');
    }
  });
});
