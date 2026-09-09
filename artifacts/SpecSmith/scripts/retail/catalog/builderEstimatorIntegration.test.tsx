// @vitest-environment jsdom
//
// Issue #101, requirement 6: prove the whole path, not a prop.
//
// This renders the real Builder page against a catalogue whose verified CPU
// part was produced by the GENERATOR's own admission function, selects that CPU
// and a supported GPU through the real shopping UI, and checks that the
// Builder's own resolution gate enables the estimator and produces a result
// labelled "Estimated — not measured".
//
// Nothing here passes `canEstimate` by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../../src/context/AuthContext';
import { ToastProvider } from '../../../src/context/ToastContext';

import publishedCatalog from '../../../public/data/retail-parts.json';
import { findItems, parseProductSearchXml } from '../rakuten/parseProductSearchXml';
import { admitAffiliatePart } from './affiliateCatalog';
import Builder from '../../../src/pages/Builder';

const TARGET_CPU = 'newegg-cpu-9sic7vbm1r3247';
const published = publishedCatalog as any;
const publishedParts = (published.parts ?? published) as any[];
const realCpu = publishedParts.find((p) => p.id === TARGET_CPU);
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The reviewed CPU, admitted through the generator rather than hand-written. */
function generatedCpuPart() {
  const item = findItems(
    parseProductSearchXml(`<result><item>
      <mid>44583</mid>
      <sku>9SIC7VBM1R3247</sku>
      <productname>${xmlEscape(realCpu.name)}</productname>
      <category><primary>Electronics</primary><secondary>Components~~Computer Processors</secondary></category>
      <imageurl>${xmlEscape(realCpu.imageUrl)}</imageurl>
      <linkurl>${xmlEscape(realCpu.trackedAffiliateUrl)}</linkurl>
      <price currency="USD">199.99</price>
      <saleprice currency="USD">0.00</saleprice>
    </item></result>`),
  )[0];
  const outcome: any = admitAffiliatePart(item, 'cpu', 'Computer Processors', realCpu.fetchedAt);
  if (outcome.status !== 'accepted') throw new Error('generator refused the reviewed CPU');
  return outcome.part;
}

/** The catalogue as the next real regeneration would publish it. */
function regeneratedCatalog() {
  const generated = generatedCpuPart();
  return { ...published, parts: publishedParts.map((p) => (p.id === TARGET_CPU ? generated : p)) };
}

const supportedGpu = () => publishedParts.find((p) => p.category === 'gpu' && p.specsVerified && p.canonicalPartId);

function stubCatalog(catalog: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => catalog })) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  // The builder persists the selected build, so without this the second test
  // starts with the first test's CPU already chosen and its card offers
  // "Remove" rather than "Add to build".
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

/**
 * Select a product the way a shopper does: open its category, search for it,
 * then press Add to build. The grid paginates, so a part is not necessarily on
 * the first page — searching is how a person reaches it.
 */
async function selectProduct(category: 'gpu' | 'cpu', part: { id: string; name: string }) {
  const chip = document.querySelector(`[data-testid="category-chip-${category}"]`) as HTMLElement | null;
  const rail = document.querySelector(`[data-testid="category-rail-${category}"]`) as HTMLElement | null;
  fireEvent.click((chip ?? rail)!);
  await waitFor(() => expect(screen.getByTestId('catalog-search')).toBeTruthy());

  fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: part.name } });
  await waitFor(() => expect(document.querySelector(`[data-part-id="${part.id}"]`)).toBeTruthy());

  const card = document.querySelector(`[data-part-id="${part.id}"]`) as HTMLElement;
  fireEvent.click(within(card).getByRole('button', { name: /add to build/i }));
}

const estimateButton = () =>
  screen.getByRole('button', { name: /estimate fps/i }) as HTMLButtonElement;

describe('the generator-admitted CPU passes the Builder\'s own gate', () => {
  it('enables the estimator and produces an Estimated result, without touching canEstimate', async () => {
    stubCatalog(regeneratedCatalog());
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    // Before anything is selected the estimator is present and refusing.
    expect(estimateButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('we will not guess their performance');

    await selectProduct('gpu', supportedGpu());
    await selectProduct('cpu', { id: TARGET_CPU, name: realCpu.name });

    // The Builder resolved both retail SKUs to canonical parts on its own.
    await waitFor(() => expect(estimateButton().disabled).toBe(false));
    expect(document.body.textContent).toContain('supported specifications');

    fireEvent.click(estimateButton());
    await waitFor(() =>
      expect(within(screen.getByTestId('builder-estimator')).getByText(/Estimated — not measured/)).toBeTruthy(),
    );
  }, 30000);

  it('leaves the estimator disabled for an unsupported CPU', async () => {
    stubCatalog(regeneratedCatalog());
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await selectProduct('gpu', supportedGpu());
    const unsupported = publishedParts.find((p) => p.category === 'cpu' && p.id !== TARGET_CPU);
    await selectProduct('cpu', unsupported);

    expect(estimateButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('we will not guess their performance');
  }, 30000);
});

describe('the estimator sits with the build summary, exactly once', () => {
  it('renders one estimator, in the in-flow slot beneath the summary on narrow layouts', async () => {
    stubCatalog(regeneratedCatalog());
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    expect(screen.getAllByTestId('builder-estimator')).toHaveLength(1);
    expect(screen.getByTestId('estimator-slot-mobile')).toBeTruthy();
    expect(screen.queryByTestId('estimator-slot-desktop')).toBeNull();
    // It belongs to the shopping interface, not the page footer.
    expect(screen.getByTestId('retail-builder').contains(screen.getByTestId('builder-estimator'))).toBe(true);
  }, 30000);

  it('moves into the desktop column beneath the summary, still exactly once', async () => {
    vi.stubGlobal('matchMedia', ((query: string) => ({
      matches: query.includes('1280'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia);
    stubCatalog(regeneratedCatalog());
    renderBuilder();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(screen.getByTestId('estimator-slot-desktop')).toBeTruthy());
    expect(screen.queryByTestId('estimator-slot-mobile')).toBeNull();
    expect(screen.getAllByTestId('builder-estimator')).toHaveLength(1);
  }, 30000);
});
