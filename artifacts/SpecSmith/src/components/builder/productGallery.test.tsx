// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// THE MULTI-IMAGE PATH, DRIVEN FOR REAL.
//
// The live feed publishes one image per listing, so the gallery's second,
// third and fourth images are unreachable from the catalogue — but the code
// that handles them is real, and untested code that waits for a data change is
// code that will be broken when the data changes. Mocking the image source is
// the only honest way to exercise it: it substitutes the DATA, not the
// component, so what runs below is exactly the gallery that ships.
vi.mock('../../lib/retail/productImages', async () => {
  const actual = await vi.importActual<typeof import('../../lib/retail/productImages')>(
    '../../lib/retail/productImages',
  );
  return {
    ...actual,
    verifiedImages: () => [
      'https://c1.neweggimages.com/a.jpg',
      'https://c1.neweggimages.com/b.jpg',
      'https://c1.neweggimages.com/c.jpg',
    ],
  };
});

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from '../../lib/retail/partCatalog';
import ProductDetailDrawer from './ProductDetailDrawer';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const part = parsed.catalog.parts.find((candidate) => candidate.category === 'gpu')!;
const NOW = Date.parse(part.fetchedAt) + 60_000;

afterEach(cleanup);

const open = () =>
  render(<ProductDetailDrawer part={part} now={NOW} selected={false} onClose={vi.fn()} onToggle={vi.fn()} />);

describe('a listing with several verified images gets a real gallery', () => {
  it('shows the controls, the strip and the position', () => {
    open();
    expect(screen.getByTestId('detail-prev')).toBeDefined();
    expect(screen.getByTestId('detail-next')).toBeDefined();
    expect(screen.getByTestId('detail-position').textContent).toBe('1 of 3');
    expect(screen.getAllByTestId(/^detail-thumb-\d$/)).toHaveLength(3);
    // And drops the single-image note, which would now be false.
    expect(screen.queryByTestId('detail-single-image-note')).toBeNull();
  });

  it('steps forward and back, and wraps at both ends', () => {
    open();
    fireEvent.click(screen.getByTestId('detail-next'));
    expect(screen.getByTestId('detail-position').textContent).toBe('2 of 3');
    expect(screen.getByTestId('detail-image').getAttribute('src')).toBe('https://c1.neweggimages.com/b.jpg');

    fireEvent.click(screen.getByTestId('detail-prev'));
    expect(screen.getByTestId('detail-position').textContent).toBe('1 of 3');
    fireEvent.click(screen.getByTestId('detail-prev'));
    expect(screen.getByTestId('detail-position').textContent).toBe('3 of 3');
  });

  it('moves with the arrow keys', () => {
    open();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByTestId('detail-position').textContent).toBe('2 of 3');
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('detail-position').textContent).toBe('1 of 3');
  });

  it('jumps from a thumbnail and marks the current one', () => {
    open();
    fireEvent.click(screen.getByTestId('detail-thumb-2'));
    expect(screen.getByTestId('detail-position').textContent).toBe('3 of 3');
    expect(screen.getByTestId('detail-thumb-2').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('detail-thumb-0').getAttribute('aria-current')).toBeNull();
  });

  it('numbers the alt text so each image is distinguishable', () => {
    open();
    expect(screen.getByTestId('detail-image').getAttribute('alt')).toBe(`${part.name} — image 1 of 3`);
    fireEvent.click(screen.getByTestId('detail-next'));
    expect(screen.getByTestId('detail-image').getAttribute('alt')).toBe(`${part.name} — image 2 of 3`);
  });

  it('announces the position change to a screen reader', () => {
    open();
    expect(screen.getByTestId('detail-position').getAttribute('aria-live')).toBe('polite');
  });

  it('names every control it adds', () => {
    open();
    expect(screen.getByLabelText('Previous image')).toBeDefined();
    expect(screen.getByLabelText('Next image')).toBeDefined();
    expect(screen.getByLabelText('Show image 2 of 3')).toBeDefined();
  });

  it('swipes between images on a touch screen', () => {
    open();
    const dialog = screen.getByTestId('product-detail');
    fireEvent.touchStart(dialog, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 200 }] });
    expect(screen.getByTestId('detail-position').textContent).toBe('2 of 3');
  });

  it('ignores a tap that barely moved', () => {
    open();
    const dialog = screen.getByTestId('product-detail');
    fireEvent.touchStart(dialog, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 295 }] });
    expect(screen.getByTestId('detail-position').textContent).toBe('1 of 3');
  });
});
