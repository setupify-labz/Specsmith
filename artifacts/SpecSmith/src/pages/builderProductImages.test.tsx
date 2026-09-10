// @vitest-environment jsdom
//
// Does an approved cut-out actually reach a card on the real Builder page?
//
// This exists because it did not. `Builder.tsx` fetched the manifest and then
// dropped it: the prop was never passed to RetailBuilder, so every card loaded
// the merchant image no matter what the manifest said. Every unit test passed
// throughout, because each layer was correct in isolation. Only the page
// proves the wire is connected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from './Builder';
import { EMPTY_FILTERS, filterAndSort } from '../lib/retail/retailShopping';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
// The first GPU the default view actually renders — the grid paginates, so
// picking by array order can choose a card that is not on screen.
const gpu = filterAndSort(
  parts.filter((p) => p.category === 'gpu') as any,
  EMPTY_FILTERS,
)[0] as any;
const SHA = 'c'.repeat(64);          // the SOURCE bytes
const PROCESSED = 'e'.repeat(64);    // the OUTPUT bytes, which name the file
const LOCAL = `/images/products/${PROCESSED}.png`;

/** The catalogue as a build that recorded image hashes would publish it. */
const catalogWithHashes = () => ({
  ...published,
  parts: parts.map((p) => (p.id === gpu.id ? { ...p, imageSha256: SHA } : p)),
});

const manifest = (over: Record<string, unknown> = {}) => ({
  generatedAt: '2026-09-09',
  source: 'catalogue',
  entries: [
    {
      partId: gpu.id,
      sourceUrl: gpu.imageUrl,
      sourceSha256: SHA,
      processedSha256: PROCESSED,
      outcome: 'processed',
      processedPath: LOCAL,
      approved: true,
      rightsBasis: 'test fixture: pretend clause',
      ...over,
    },
  ],
});

function stubFetch(catalog: unknown, imageManifest: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        if (!imageManifest) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => imageManifest };
      }
      return { ok: true, json: async () => catalog };
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const renderBuilder = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Builder />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

const cardImage = () => {
  const card = document.querySelector(`[data-part-id="${gpu.id}"]`);
  return card?.querySelector('img') as HTMLImageElement | null;
};

describe('an approved cut-out reaches a card on the Builder page', () => {
  it('renders the local file, not the merchant URL', async () => {
    stubFetch(catalogWithHashes(), manifest());
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    await waitFor(() => expect(cardImage()!.getAttribute('src')).toBe(LOCAL));
    expect(cardImage()!.getAttribute('data-image-source')).toBe('processed');
  }, 30000);

  it('renders the merchant URL when no manifest is published', async () => {
    stubFetch(catalogWithHashes(), null);
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    expect(cardImage()!.getAttribute('src')).toBe(gpu.imageUrl);
  }, 30000);

  it('renders the merchant URL when the bytes behind the URL have changed', async () => {
    // Same URL, different picture: the catalogue's hash no longer matches the
    // one the cut-out was made from.
    stubFetch(catalogWithHashes(), manifest({ sourceSha256: 'd'.repeat(64) }));
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    expect(cardImage()!.getAttribute('src')).toBe(gpu.imageUrl);
  }, 30000);

  it('renders the merchant URL when the catalogue records no image version', async () => {
    stubFetch(published, manifest()); // published file has no imageSha256
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    expect(cardImage()!.getAttribute('src')).toBe(gpu.imageUrl);
  }, 30000);
});
