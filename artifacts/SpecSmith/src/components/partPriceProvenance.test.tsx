// @vitest-environment jsdom
//
// #156. PartCard and PartSelector printed whatever `price_usd` they were given
// as a bare "$669". The Builder's offline fallback is the one caller that
// shows prices, and it feeds them SpecSmith's canonical catalogue, whose
// prices the rest of the codebase already treats as editorial estimates. So a
// catalogue estimate reached shoppers looking like a retailer's price.
//
// A card now takes a PartPrice, which says where the figure came from, and
// its wording is decided in one place (describePartPrice). These tests pin
// every state, in both components and through real callers:
//  - an explicit estimate reads "Est." in text and accessible name;
//  - an explicit retailer observation reads as that merchant's price, with
//    its "Price checked" time and NO "Est.";
//  - stale, future-dated and unreadable observations show no figure;
//  - unknown provenance and malformed data show no figure;
//  - a caller that does not declare a source shows no figure.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PartCard from './PartCard';
import PartSelector from './PartSelector';
import {
  catalogueEstimatePrice,
  describePartPrice,
  describeSummaryPrice,
  editorialEstimatePrice,
  summarizeSummaryPrices,
  NO_PRICE_LABEL,
  retailerObservationPrice,
  UNKNOWN_PART_PRICE,
  type PartPrice,
} from '../lib/partPrice';
import { CATALOGUE_PRICE_DATE, PRICES_UPDATED, catalogueSourceOf } from '../lib/prices';
import publishedCatalog from '../../public/data/retail-parts.json';
import gpuData from '../data/gpus.json';
import componentData from '../data/components.json';
import peripheralData from '../data/peripherals.json';
import { PRICE_FRESHNESS_MS, STALE_PRICE_LABEL } from '../lib/retail/partPricing';
import { rtx5070Listing } from '../lib/retail/__fixtures__/catalogFixture';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from '../pages/Builder';
import UpgradeCalculator from '../pages/UpgradeCalculator';
import UpgradeCalculatorCpu from '../pages/UpgradeCalculatorCpu';

const LISTING = rtx5070Listing(false);
const CHECKED = Date.parse(LISTING.fetchedAt);
const HOUR = 60 * 60 * 1000;

const ESTIMATE = editorialEstimatePrice(669, PRICES_UPDATED);
const FRESH = retailerObservationPrice(LISTING, CHECKED + HOUR);
const ON_SALE = retailerObservationPrice({ ...LISTING, salePrice: 599.99 }, CHECKED + HOUR);
const EXPIRED = retailerObservationPrice(LISTING, CHECKED + PRICE_FRESHNESS_MS + HOUR);
const FUTURE = retailerObservationPrice(LISTING, CHECKED - 2 * 24 * HOUR);
const UNREADABLE = retailerObservationPrice({ ...LISTING, fetchedAt: 'not a date' }, CHECKED);

const hasFigure = (text: string) => /\$\s?\d|\d+\.\d\d\s?[A-Z]{3}/.test(text);

afterEach(cleanup);

describe('describePartPrice: wording comes from provenance alone', () => {
  it('an explicit catalogue estimate says "Est." and where it came from', () => {
    const label = describePartPrice(ESTIMATE);
    expect(label.primary).toBe('Est. $669');
    expect(label.detail).toBe(`SpecSmith estimate · updated ${PRICES_UPDATED}`);
    expect(label.accessible).toMatch(/^estimated \$669, a SpecSmith catalogue estimate updated .+, not a retailer price$/);
    expect(label.showsAmount).toBe(true);
  });

  it('an explicit, fresh retailer observation is that merchant\'s price, never "Est."', () => {
    const label = describePartPrice(FRESH);
    expect(label.primary).toBe('$649.99');
    expect(label.detail).toMatch(/^Newegg · Price checked .+ UTC$/);
    expect(label.accessible).toMatch(/^\$649\.99 at Newegg, price checked .+ UTC$/);
    for (const text of [label.primary, label.detail!, label.accessible]) expect(text).not.toMatch(/\best\b|estimat/i);
  });

  it('a discounted observation says what it was', () => {
    const label = describePartPrice(ON_SALE);
    expect(label.primary).toBe('$599.99');
    expect(label.accessible).toMatch(/^\$599\.99 at Newegg, was \$649\.99, price checked/);
  });

  it.each([
    ['expired', EXPIRED],
    ['future-dated', FUTURE],
    ['unreadable timestamp', UNREADABLE],
  ])('a %s retailer observation shows no figure', (_name, price) => {
    const label = describePartPrice(price);
    expect(label.primary).toBe(STALE_PRICE_LABEL);
    expect(label.showsAmount).toBe(false);
    expect(hasFigure(`${label.primary} ${label.detail ?? ''} ${label.accessible}`)).toBe(false);
  });

  it.each([
    ['no price at all', undefined],
    ['explicitly unknown provenance', UNKNOWN_PART_PRICE],
  ])('%s shows neutral wording and no figure', (_name, price) => {
    const label = describePartPrice(price);
    expect(label.primary).toBe(NO_PRICE_LABEL);
    expect(label.showsAmount).toBe(false);
    expect(hasFigure(`${label.primary} ${label.accessible}`)).toBe(false);
    expect(label.accessible).not.toMatch(/estimat/i);
  });

  it.each([
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -5],
    ['a string', '669'],
    ['missing', undefined],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('a malformed catalogue amount (%s) is unknown, not an estimate', (_name, amount) => {
    expect(editorialEstimatePrice(amount, PRICES_UPDATED)).toEqual(UNKNOWN_PART_PRICE);
  });

  it('an explicitly undated source is still an estimate, with no date claimed', () => {
    const label = describePartPrice(editorialEstimatePrice(669, null));
    expect(label.primary).toBe('Est. $669');
    expect(label.detail).toBe('SpecSmith estimate');
    expect(label.accessible).toBe('estimated $669, a SpecSmith catalogue estimate, not a retailer price');
    for (const text of [label.detail!, label.accessible]) expect(text).not.toMatch(/updated|\d{4}/);
  });

  it('a blank or missing date is a caller bug and shows no figure, not an undated estimate', () => {
    expect(editorialEstimatePrice(669, '')).toEqual(UNKNOWN_PART_PRICE);
    expect(editorialEstimatePrice(669, '   ')).toEqual(UNKNOWN_PART_PRICE);
    expect(editorialEstimatePrice(669, undefined as unknown as null)).toEqual(UNKNOWN_PART_PRICE);
  });
});

function renderCard(price: PartPrice | undefined, showShopping = true) {
  return render(
    <PartCard
      id="rtx5070"
      name="GeForce RTX 5070"
      price={price}
      selected={false}
      specs={[{ label: 'VRAM', value: '12GB' }]}
      showShopping={showShopping}
      onSelect={() => undefined}
    />,
  );
}

const cardButton = () => screen.getByRole('button', { name: /GeForce RTX 5070/ });

describe('PartCard renders each provenance visibly and accessibly', () => {
  it('estimate: "Est." in the text, the source line, and the accessible name', () => {
    renderCard(ESTIMATE);
    const price = screen.getByTestId('part-price');
    expect(price.getAttribute('data-price-provenance')).toBe('editorial-estimate');
    expect(price.textContent).toContain('Est. $669');
    expect(price.textContent).toContain(`SpecSmith estimate · updated ${PRICES_UPDATED}`);
    expect(screen.queryByText('$669')).toBeNull();
    expect(cardButton().getAttribute('aria-label')).toMatch(/GeForce RTX 5070, estimated \$669, a SpecSmith catalogue estimate .*not a retailer price/);
  });

  it('retailer observation: the merchant\'s price and check time, with no estimate wording', () => {
    renderCard(FRESH);
    const price = screen.getByTestId('part-price');
    expect(price.getAttribute('data-price-provenance')).toBe('retailer-observation');
    expect(price.textContent).toMatch(/^\$649\.99Newegg · Price checked .+ UTC$/);
    const name = cardButton().getAttribute('aria-label') ?? '';
    expect(name).toMatch(/\$649\.99 at Newegg, price checked/);
    expect(`${price.textContent} ${name}`).not.toMatch(/\best\b|estimat/i);
  });

  it.each([
    ['expired', EXPIRED],
    ['future-dated', FUTURE],
    ['unreadable', UNREADABLE],
  ])('stale (%s) retailer observation: no figure anywhere on the card', (_name, price) => {
    const { container } = renderCard(price);
    expect(screen.getByTestId('part-price').textContent).toBe(STALE_PRICE_LABEL);
    expect(hasFigure(container.textContent ?? '')).toBe(false);
    expect(hasFigure(cardButton().getAttribute('aria-label') ?? '')).toBe(false);
  });

  it.each([
    ['absent', undefined],
    ['unknown', UNKNOWN_PART_PRICE],
  ])('%s provenance: neutral wording, no figure, no estimate claim', (_name, price) => {
    const { container } = renderCard(price);
    expect(screen.getByTestId('part-price').textContent).toBe(NO_PRICE_LABEL);
    expect(hasFigure(container.textContent ?? '')).toBe(false);
    expect(container.textContent).not.toMatch(/Est\./);
  });

  it('a comparison-only card shows no price block at all', () => {
    const { container } = renderCard(ESTIMATE, false);
    expect(screen.queryByTestId('part-price')).toBeNull();
    expect(hasFigure(container.textContent ?? '')).toBe(false);
    expect(cardButton().getAttribute('aria-label')).toBe('GeForce RTX 5070');
  });
});

const PARTS = [
  { id: 'a', name: 'Card A', price_usd: 669, benchmark_score: 200, tier: 7 },
  { id: 'b', name: 'Card B', price_usd: 399, benchmark_score: 150, tier: 6 },
  { id: 'c', name: 'Card C', price_usd: Number.NaN, benchmark_score: 100, tier: 5 },
];

function renderSelector(opts: { getPrice?: (part: { price_usd?: number }) => PartPrice; showShopping?: boolean; selectedId?: string }) {
  return render(
    <PartSelector
      category="gpu"
      label="GPU"
      parts={PARTS}
      selectedId={opts.selectedId ?? 'a'}
      onSelect={() => undefined}
      getSpecs={() => []}
      defaultOpen
      showShopping={opts.showShopping}
      getPrice={opts.getPrice}
    />,
  );
}

describe('PartSelector passes provenance through and never invents it', () => {
  const estimate = (part: { price_usd?: number }) => editorialEstimatePrice(part.price_usd, PRICES_UPDATED);

  it('declared estimates: every card and the selected header say "Est."; malformed data shows none', () => {
    renderSelector({ getPrice: estimate });
    const prices = screen.getAllByTestId('part-price');
    expect(prices.map((p) => p.getAttribute('data-price-provenance'))).toEqual(['editorial-estimate', 'editorial-estimate', 'unknown']);
    expect(prices.map((p) => p.textContent?.split('SpecSmith')[0])).toEqual(['Est. $669', 'Est. $399', NO_PRICE_LABEL]);
    const header = screen.getByTestId('selected-part-price');
    expect(header.getAttribute('data-price-provenance')).toBe('editorial-estimate');
    expect(header.textContent).toBe(`Est. $669, SpecSmith estimate · updated ${PRICES_UPDATED}`);
    // The source line is for screen readers in the header, not colour alone.
    expect(within(header).getByText(/SpecSmith estimate/).className).toContain('sr-only');
  });

  it('declared retailer observations are shown as retailer prices, not estimates', () => {
    const fresh = () => FRESH;
    const { container } = renderSelector({ getPrice: fresh });
    expect(screen.getByTestId('selected-part-price').textContent).toMatch(/^\$649\.99, Newegg · Price checked/);
    expect(container.textContent).not.toMatch(/Est\./);
  });

  it('no declared source: no figure, no price sort, no value badge', () => {
    const { container } = renderSelector({});
    for (const price of screen.getAllByTestId('part-price')) expect(price.textContent).toBe(NO_PRICE_LABEL);
    expect(screen.getByTestId('selected-part-price').textContent).toBe(NO_PRICE_LABEL);
    expect(hasFigure(container.textContent ?? '')).toBe(false);
    expect(container.textContent).not.toMatch(/BEST VALUE/);
    // Sorting by price has nothing to sort on, so the order is unchanged.
    fireEvent.change(screen.getByLabelText('Sort parts by'), { target: { value: 'price' } });
    const names = screen.getAllByRole('button', { name: /^Card / }).map((b) => b.getAttribute('aria-label')?.split(',')[0]);
    expect(names).toEqual(['Card A', 'Card B', 'Card C']);
  });

  it('stale observations are not sorted or ranked on a number the card hides', () => {
    const stale = () => EXPIRED;
    const { container } = renderSelector({ getPrice: stale });
    expect(container.textContent).not.toMatch(/BEST VALUE/);
    expect(hasFigure(container.textContent ?? '')).toBe(false);
  });

  it('declared estimates are sortable by the figure they show', () => {
    renderSelector({ getPrice: estimate });
    fireEvent.change(screen.getByLabelText('Sort parts by'), { target: { value: 'price' } });
    const names = screen.getAllByRole('button', { name: /^Card / }).map((b) => b.getAttribute('aria-label')?.split(',')[0]);
    expect(names).toEqual(['Card B', 'Card A', 'Card C']);
  });

  it('a comparison-only selector shows no price even with a source declared', () => {
    const { container } = renderSelector({ getPrice: estimate, showShopping: false });
    expect(screen.queryByTestId('part-price')).toBeNull();
    expect(screen.queryByTestId('selected-part-price')).toBeNull();
    expect(hasFigure(container.textContent ?? '')).toBe(false);
  });
});

describe('the real caller: Builder\'s offline fallback', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('scrollTo', vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(catalogue: { ok: boolean; body: unknown } | 'hang') {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) return { ok: false, json: async () => ({}) } as unknown as Response;
      if (catalogue === 'hang') return new Promise<Response>(() => undefined);
      return { ok: catalogue.ok, json: async () => catalogue.body } as unknown as Response;
    }) as unknown as typeof fetch);
  }

  const renderBuilder = () => render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Builder />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

  // Which catalogue each fallback selector reads, and the ONLY revision date
  // that source supports. The July 16 refresh (8586087) repriced gpus.json
  // and cpus.json alone. components.json was last repriced July 13 and gained
  // 48 of its 90 records after July 16; peripherals.json has no documented
  // date. See CATALOGUE_PRICE_DATE in Builder.tsx.
  const SOURCE_OF: Record<string, 'gpus' | 'cpus' | 'components' | 'peripherals'> = {
    gpu: 'gpus', cpu: 'cpus',
    motherboard: 'components', ram: 'components', storage: 'components', psu: 'components', case: 'components', cooler: 'components',
    monitor: 'peripherals', keyboard: 'peripherals', mouse: 'peripherals', headset: 'peripherals',
  };
  const DATED = new Set(['gpus', 'cpus']);
  const expectedDetail = (category: string) =>
    DATED.has(SOURCE_OF[category]) ? `SpecSmith estimate · updated ${PRICES_UPDATED}` : 'SpecSmith estimate';

  it('labels each source correctly: dated where the date is supported, undated elsewhere', async () => {
    stubFetch({ ok: false, body: {} });
    renderBuilder();
    const fallback = await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
    // The four peripheral selectors sit behind a collapsed panel.
    fireEvent.click(within(fallback).getByRole('button', { name: /Peripherals/ }));
    await within(fallback).findByText('Headset');

    const sections = [...fallback.querySelectorAll<HTMLElement>('[data-part-section]')];
    expect(sections.map((section) => section.getAttribute('data-part-section')).sort())
      .toEqual(Object.keys(SOURCE_OF).sort());

    const checked: Record<string, number> = {};
    for (const section of sections) {
      const category = section.getAttribute('data-part-section')!;
      // Only the GPU selector starts open. Open every other one, or its cards
      // are never rendered and never checked.
      if (within(section).queryAllByTestId('part-price').length === 0) {
        fireEvent.click(section.querySelector('button')!);
      }
      const prices = await within(section).findAllByTestId('part-price');
      const detail = expectedDetail(category);
      let estimates = 0;
      for (const price of prices) {
        const provenance = price.getAttribute('data-price-provenance');
        if (provenance === 'unknown') {
          expect(price.textContent).toBe(NO_PRICE_LABEL);
          continue;
        }
        expect(provenance, `${category}`).toBe('editorial-estimate');
        expect(price.textContent, `${category}`).toMatch(/^Est\. \$[\d,.]+SpecSmith estimate/);
        expect(price.textContent!.replace(/^Est\. \$[\d,.]+/, ''), `${category}`).toBe(detail);
        estimates += 1;
      }
      expect(estimates, `${category} shows no estimates at all`).toBeGreaterThan(0);
      checked[category] = estimates;

      // Accessible names say the same thing, with the date only where supported.
      for (const button of within(section).getAllByRole('button', { pressed: false })) {
        const name = button.getAttribute('aria-label') ?? '';
        if (!/\$\d/.test(name)) continue;
        expect(name, `${category}`).toMatch(/estimated \$[\d,.]+, a SpecSmith catalogue estimate/);
        if (DATED.has(SOURCE_OF[category])) expect(name).toContain(`updated ${PRICES_UPDATED}`);
        else expect(name, `${category}`).not.toMatch(/updated/);
      }
      // No bare catalogue figure anywhere in the selector. (BuildSummary's own
      // total, outside the selectors, carries its "Est. street pricing" line.)
      expect(within(section).queryAllByText(/^\$\d[\d,.]*$/)).toHaveLength(0);
    }
    expect(Object.keys(checked).sort()).toEqual(Object.keys(SOURCE_OF).sort());
  }, 60000);

  it('the selected-part header uses the same per-source wording', async () => {
    stubFetch({ ok: false, body: {} });
    renderBuilder();
    const fallback = await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
    fireEvent.click(within(fallback).getByRole('button', { name: /Peripherals/ }));
    await within(fallback).findByText('Headset');
    for (const category of ['gpu', 'motherboard', 'monitor']) {
      const section = fallback.querySelector<HTMLElement>(`[data-part-section="${category}"]`)!;
      if (within(section).queryAllByTestId('part-price').length === 0) fireEvent.click(section.querySelector('button')!);
      const cards = await within(section).findAllByRole('button', { pressed: false });
      const card = cards.find((b) => /estimated \$/.test(b.getAttribute('aria-label') ?? ''))!;
      fireEvent.click(card);
      const header = await within(section).findByTestId('selected-part-price');
      expect(header.textContent, category).toMatch(new RegExp(`^Est\\. \\$[\\d,.]+, ${expectedDetail(category).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    }
  }, 60000);

  it('while the retailer catalogue is loading, no part card claims any price', async () => {
    stubFetch('hang');
    renderBuilder();
    await screen.findByTestId('builder-skeleton');
    expect(screen.queryAllByTestId('part-price')).toHaveLength(0);
    expect(screen.queryAllByTestId('selected-part-price')).toHaveLength(0);
  });
});

describe('the other non-Compare callers stay price-free', () => {
  beforeEach(() => {
    class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
    globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it.each([
    ['GPU Upgrade Calculator', UpgradeCalculator, '/upgrade-calculator'],
    ['CPU Upgrade Calculator', UpgradeCalculatorCpu, '/upgrade-calculator-cpu'],
  ])('%s renders its part selector with no price', (_name, Page, route) => {
    const { container } = render(
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-part-section]').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('part-price')).toHaveLength(0);
    expect(screen.queryAllByTestId('selected-part-price')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Summaries (#156 review): the fallback's BuildSummary and the retail
// builder's imported plan rows read the SAME source-to-date rule as the cards.
// ---------------------------------------------------------------------------

describe('one source-to-date rule for every Builder category', () => {
  it('dates only gpus and cpus, and knows every category\'s source', () => {
    expect(CATALOGUE_PRICE_DATE).toEqual({ gpus: PRICES_UPDATED, cpus: PRICES_UPDATED, components: null, peripherals: null });
    const expected: Record<string, string> = {
      gpu: 'gpus', cpu: 'cpus',
      motherboard: 'components', ram: 'components', storage: 'components', psu: 'components', case: 'components', cooler: 'components',
      monitor: 'peripherals', keyboard: 'peripherals', mouse: 'peripherals', headset: 'peripherals',
    };
    for (const [category, source] of Object.entries(expected)) expect(catalogueSourceOf(category), category).toBe(source);
    expect(catalogueSourceOf('toaster')).toBeNull();
    expect(catalogueSourceOf('constructor')).toBeNull();
  });

  it('catalogueEstimatePrice dates by category, and refuses an unknown one', () => {
    expect(catalogueEstimatePrice('gpu', 500)).toEqual({ provenance: 'editorial-estimate', amount: 500, catalogueDate: PRICES_UPDATED });
    expect(catalogueEstimatePrice('motherboard', 500)).toEqual({ provenance: 'editorial-estimate', amount: 500, catalogueDate: null });
    expect(catalogueEstimatePrice('headset', 500)).toEqual({ provenance: 'editorial-estimate', amount: 500, catalogueDate: null });
    expect(catalogueEstimatePrice('toaster', 500)).toEqual(UNKNOWN_PART_PRICE);
  });
});

describe('summarizeSummaryPrices says what a total contains', () => {
  const est = (category: string, amount: number) => ({ kind: 'catalogue' as const, price: catalogueEstimatePrice(category, amount) });
  const row = (label: string, price: ReturnType<typeof est> | { kind: 'user-entered'; amount: number } | { kind: 'catalogue'; price: PartPrice }) => ({ label, price });

  it('only dated estimates: an estimated total with the date', () => {
    const total = summarizeSummaryPrices([row('GPU', est('gpu', 500)), row('CPU', est('cpu', 300))]);
    expect(total).toMatchObject({ label: 'Estimated total', amountText: 'Est. $800', amount: 800, note: `SpecSmith estimates · updated ${PRICES_UPDATED}` });
  });

  it('a dated and an undated estimate: still an estimate, but no date is claimed', () => {
    const total = summarizeSummaryPrices([row('GPU', est('gpu', 500)), row('Monitor', est('monitor', 299))]);
    expect(total).toMatchObject({ label: 'Estimated total', amountText: 'Est. $799', note: 'SpecSmith estimates' });
    expect(total.note).not.toMatch(/updated|2026/);
  });

  it('only undated estimates: no date', () => {
    const total = summarizeSummaryPrices([row('Motherboard', est('motherboard', 629))]);
    expect(total).toMatchObject({ label: 'Estimated total', amountText: 'Est. $629', note: 'SpecSmith estimate' });
  });

  it('estimates plus an entered price: says both', () => {
    const total = summarizeSummaryPrices([row('GPU', est('gpu', 500)), row('Custom', { kind: 'user-entered', amount: 40 })]);
    expect(total).toMatchObject({ label: 'Estimated total', amountText: 'Est. $540', note: `SpecSmith estimate · updated ${PRICES_UPDATED} + 1 price you entered` });
  });

  it('only entered prices: not an estimate, and says whose prices they are', () => {
    const total = summarizeSummaryPrices([row('Custom', { kind: 'user-entered', amount: 40 }), row('Custom', { kind: 'user-entered', amount: 60 })]);
    expect(total).toMatchObject({ label: 'Total of your prices', amountText: '$100', note: '2 prices you entered', includesEstimates: false });
  });

  it('an item with no figure is excluded, named, and makes it a subtotal', () => {
    const total = summarizeSummaryPrices([row('GPU', est('gpu', 500)), row('Case', { kind: 'catalogue', price: UNKNOWN_PART_PRICE })]);
    expect(total).toMatchObject({ label: 'Known-price subtotal', amountText: 'Est. $500', amount: 500, note: `SpecSmith estimate · updated ${PRICES_UPDATED}; excludes Case (no catalogue price)` });
  });

  it('a retailer observation is never blended into catalogue estimates', () => {
    const total = summarizeSummaryPrices([row('GPU', est('gpu', 500)), row('Monitor', { kind: 'catalogue', price: FRESH })]);
    expect(total.amount).toBe(500);
    expect(total.label).toBe('Known-price subtotal');
    expect(total.note).toContain('excludes Monitor (retailer price, shown separately)');
  });

  it('nothing selected: no note, no estimate claim', () => {
    expect(summarizeSummaryPrices([])).toMatchObject({ label: 'Total', amountText: '$0', note: null, includesEstimates: false });
  });

  it('rows say "Est." for estimates and "your price" for entered figures', () => {
    expect(describeSummaryPrice(est('monitor', 299)).text).toBe('Est. $299');
    expect(describeSummaryPrice(est('monitor', 299)).accessible).toBe('estimated $299, a SpecSmith catalogue estimate, not a retailer price');
    expect(describeSummaryPrice({ kind: 'user-entered', amount: 40 })).toEqual({ text: '$40 (your price)', accessible: '$40, a price you entered' });
    expect(describeSummaryPrice({ kind: 'catalogue', price: UNKNOWN_PART_PRICE }).text).toBe(NO_PRICE_LABEL);
  });
});

describe('the fallback BuildSummary, rendered', () => {
  const gpu = (gpuData as { id: string; price_usd: number }[])[0];
  const board = (componentData as unknown as { motherboards: { id: string; price_usd: number }[] }).motherboards[0];
  const monitor = (peripheralData as unknown as { monitors: { id: string; price_usd: number }[] }).monitors[0];

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('scrollTo', vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const openFallback = async (query: string) => {
    render(
      <MemoryRouter initialEntries={[`/builder?${query}`]}>
        <ToastProvider>
          <AuthProvider>
            <Builder />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    return screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
  };
  const rowFor = (fallback: HTMLElement, label: string) => {
    const tag = within(fallback).getAllByText(label, { selector: 'span' }).find((el) => el.closest('[class*="justify-between"]')?.querySelector('[data-testid="summary-row-price"]'));
    return tag!.closest('[class*="justify-between"]')!.querySelector<HTMLElement>('[data-testid="summary-row-price"]')!;
  };

  it('GPU only: an estimated total, dated, because every figure in it is covered', async () => {
    const fallback = await openFallback(`gpu=${gpu.id}`);
    const price = rowFor(fallback, 'GPU');
    expect(price.textContent).toBe(`Est. $${gpu.price_usd.toLocaleString('en-US')}`);
    expect(price.getAttribute('data-price-kind')).toBe('editorial-estimate');
    expect(within(fallback).getByTestId('summary-total-label').textContent).toBe('Estimated total');
    expect(within(fallback).getByTestId('summary-total-amount').textContent).toBe(`Est. $${gpu.price_usd.toLocaleString('en-US')}`);
    expect(within(fallback).getByTestId('summary-total-note').textContent).toBe(`SpecSmith estimate · updated ${PRICES_UPDATED}`);
  }, 30000);

  it('GPU + component + peripheral + an entered part: every row qualified, no universal date', async () => {
    const fallback = await openFallback(`gpu=${gpu.id}&motherboard=${board.id}&monitor=${monitor.id}`);

    for (const [label, amount] of [['GPU', gpu.price_usd], ['Motherboard', board.price_usd], ['Monitor', monitor.price_usd]] as const) {
      const price = rowFor(fallback, label);
      expect(price.textContent, label).toBe(`Est. $${amount.toLocaleString('en-US')}`);
      expect(price.getAttribute('aria-label'), label).toMatch(/^estimated \$[\d,]+, a SpecSmith catalogue estimate/);
      if (label === 'GPU') expect(price.getAttribute('aria-label')).toContain(`updated ${PRICES_UPDATED}`);
      else expect(price.getAttribute('aria-label'), label).not.toMatch(/updated/);
    }

    // The shopper adds a part of their own.
    fireEvent.click(within(fallback).getByRole('button', { name: /Add custom part/ }));
    fireEvent.change(within(fallback).getByPlaceholderText(/Part name/), { target: { value: 'Fan kit' } });
    fireEvent.change(within(fallback).getByPlaceholderText('Price ($)'), { target: { value: '40' } });
    fireEvent.click(within(fallback).getByRole('button', { name: 'Add' }));
    const custom = await within(fallback).findByText('Fan kit');
    const customPrice = custom.closest('[class*="justify-between"]')!.querySelector('[data-testid="summary-row-price"]')!;
    expect(customPrice.textContent).toBe('$40 (your price)');
    expect(customPrice.getAttribute('data-price-kind')).toBe('user-entered');

    const sum = gpu.price_usd + board.price_usd + monitor.price_usd + 40;
    expect(within(fallback).getByTestId('summary-total-label').textContent).toBe('Estimated total');
    expect(within(fallback).getByTestId('summary-total-amount').textContent).toBe(`Est. $${sum.toLocaleString('en-US')}`);
    const note = within(fallback).getByTestId('summary-total-note').textContent;
    expect(note).toBe('SpecSmith estimates + 1 price you entered');
    expect(note).not.toMatch(/updated|July|2026/);

    // Nowhere in the fallback does the universal date sit beside this total,
    // and no summary row is a bare figure.
    expect(within(fallback).queryByText(/Est\. street pricing/)).toBeNull();
    for (const node of within(fallback).getAllByTestId('summary-row-price')) {
      expect(node.textContent).toMatch(/^Est\. \$|\(your price\)$/);
    }

    // Sales tax keeps the qualifier.
    fireEvent.change(within(fallback).getByRole('textbox', { name: /Sales tax/ }), { target: { value: '10' } });
    expect(within(fallback).getByText(/^With tax:/).textContent).toBe(`With tax: Est. $${Math.round(sum * 1.1).toLocaleString('en-US')}`);
  }, 30000);
});

describe('imported recommendations, rendered in the retail builder', () => {
  const published = publishedCatalog as unknown as { generatedAt: string };

  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(published.generatedAt));
    vi.stubGlobal('scrollTo', vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => published } as unknown as Response)) as unknown as typeof fetch);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('a peripheral recommendation is "Estimated" with no date; a GPU one keeps its date', async () => {
    const gpu = (gpuData as { id: string; price_usd: number }[])[0];
    const monitor = (peripheralData as unknown as { monitors: { id: string; price_usd: number }[] }).monitors[0];
    const keyboard = (peripheralData as unknown as { keyboards: { id: string }[] }).keyboards[0];
    render(
      <MemoryRouter initialEntries={[`/builder?gpu=${gpu.id}&monitor=${monitor.id}&keyboard=${keyboard.id}`]}>
        <ToastProvider>
          <AuthProvider>
            <Builder />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    const summary = screen.getAllByTestId('build-summary')[0];
    const monitorPrice = await within(summary).findByTestId('planned-price-monitor');
    expect(monitorPrice.textContent).toBe(`Estimated $${monitor.price_usd.toFixed(2)}`);
    expect(monitorPrice.textContent).not.toMatch(/July|2026|updated/);
    expect(within(summary).getByTestId('planned-price-keyboard').textContent).toMatch(/^Estimated \$[\d,.]+$/);
    expect(within(summary).getByTestId('planned-price-gpu').textContent)
      .toBe(`Estimated $${gpu.price_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })} · ${PRICES_UPDATED}`);
    // The retailer subtotal is untouched by any of these estimates.
    expect(within(summary).queryByTestId('retailer-subtotal')).toBeNull();
  }, 30000);
});
