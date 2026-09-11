// @vitest-environment jsdom
//
// End to end: a batch run, a promotion, and the real Builder page.
//
// Every other test in this pipeline checks one hop. This one checks that the
// bytes a batch produced, the manifest a promotion published, the parser the
// browser runs and the card a shopper sees all agree — using the real functions
// at each step rather than a hand-written manifest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import publishedCatalog from '../../../public/data/retail-parts.json';
import { EMPTY_FILTERS, filterAndSort } from '../../../src/lib/retail/retailShopping';
import { AuthProvider } from '../../../src/context/AuthContext';
import { ToastProvider } from '../../../src/context/ToastContext';
import Builder from '../../../src/pages/Builder';
import { processOne, type Manifest } from './processProductImages';
import { promote } from './promoteProductImages';
import * as fx from './testFixtures';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
/** The first GPU the default view renders — the grid paginates. */
const gpu = filterAndSort(parts.filter((p) => p.category === 'gpu') as any, EMPTY_FILTERS)[0] as any;

const scratchDirs: string[] = [];
const scratch = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-images-'));
  scratchDirs.push(d);
  return d;
};

/** Runs the real batch and the real promotion; returns what was published. */
function batchAndPromote(over: Record<string, unknown> = {}) {
  const run = scratch();
  const images = path.join(run, 'images', 'products');
  const entry = processOne(
    { partId: gpu.id, category: 'gpu', sourceUrl: gpu.imageUrl, bytes: fx.darkGpuOnWhite() },
    images,
    '2026-09-10',
  );
  if (entry.outcome !== 'processed') throw new Error('the fixture should have been processed');

  const manifest: Manifest = {
    generatedAt: '2026-09-10',
    source: 'catalogue',
    entries: [{ ...entry, approved: true, rightsBasis: 'reviewed: clause 4.2', ...over } as any],
  };
  const app = scratch();
  const result = promote(manifest, images, app);
  const file = path.join(app, 'public', 'data', 'product-images.json');
  return {
    result,
    entry,
    published: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
  };
}

/** The catalogue as a build that recorded image hashes would publish it. */
const catalogueWithHash = (sourceSha256: string) => ({
  ...published,
  parts: parts.map((p) => (p.id === gpu.id ? { ...p, imageSha256: sourceSha256 } : p)),
});

function stubFetch(catalogue: unknown, imageManifest: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        if (!imageManifest) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => imageManifest };
      }
      return { ok: true, json: async () => catalogue };
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
  for (const d of scratchDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
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

const cardImage = () =>
  document.querySelector(`[data-part-id="${gpu.id}"]`)?.querySelector('img') as HTMLImageElement | null;

describe('a promoted cut-out reaches the card', () => {
  it('renders the promoted file, named after its own bytes', async () => {
    const { entry, published: manifest } = batchAndPromote();
    stubFetch(catalogueWithHash(entry.sourceSha256), manifest);
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    await waitFor(() => expect(cardImage()!.getAttribute('src')).toBe(`/images/products/${entry.processedSha256}.png`));
    expect(cardImage()!.getAttribute('data-image-source')).toBe('processed');
  }, 30000);

  it('renders the merchant image when the promotion refused everything', async () => {
    // Nothing approved: no manifest is written, so the site is unchanged.
    const { result, published: manifest, entry } = batchAndPromote({ approved: false });
    expect(result.published).toBe(0);
    expect(manifest).toBeNull();

    stubFetch(catalogueWithHash(entry.sourceSha256), null);
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    expect(cardImage()!.getAttribute('src')).toBe(gpu.imageUrl);
  }, 30000);

  it('renders the merchant image when the merchant has since replaced the photograph', async () => {
    const { published: manifest } = batchAndPromote();
    // The catalogue now hashes to something else at the same URL.
    stubFetch(catalogueWithHash('9'.repeat(64)), manifest);
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(cardImage()).toBeTruthy());
    expect(cardImage()!.getAttribute('src')).toBe(gpu.imageUrl);
  }, 30000);
});

describe('regenerating a cut-out changes the URL a browser asks for', () => {
  it('publishes a different file name when the output bytes differ', () => {
    // Two different cut-outs of the same source: the source hash is shared, so
    // a name derived from it would collide and a CDN would keep serving the
    // first. Named after the output, they cannot.
    const a = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://x.test/a.png', bytes: fx.darkGpuOnWhite() },
      scratch(),
      '2026-09-10',
    );
    const b = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://x.test/a.png', bytes: fx.blackCase() },
      scratch(),
      '2026-09-10',
    );
    expect(a.outcome).toBe('processed');
    expect(b.outcome).toBe('processed');
    expect(a.processedSha256).not.toBe(b.processedSha256);
    expect(a.processedPath).not.toBe(b.processedPath);
  });
});
