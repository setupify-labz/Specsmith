// @vitest-environment jsdom
//
// ONE BUILD, FOUR PLACES THAT DESCRIBE IT.
//
// The header counter, the "View build" cart, the desktop category rail and the
// mobile category chips all answer the same question: which of the eight core
// slots is filled. They were derived three different ways, so a saved draft
// naming a listing that had dropped out of the catalogue produced a build that
// was 8 of 8 in the header, seven rows in the cart, and ticked in both navs.
//
// These tests pin all four to the same answer, and pin what the page may say
// before the catalogue has answered at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import canonicalGpus from '../data/gpus.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from './Builder';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
const first = (category: string) => parts.find((p) => p.category === category)!;

const CORE = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'] as const;

/** An id no catalogue has ever carried, so its slot can only be unavailable. */
const GONE = (category: string) => `retail-${category}-that-no-longer-exists`;

/** The catalogue answers immediately and completely. */
function stubCatalog() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, json: async () => published } as unknown as Response;
    }) as unknown as typeof fetch,
  );
}

/**
 * The catalogue never answers.
 *
 * A pending promise rather than a delay: the page stays in its loading state
 * for as long as the test looks at it, with no timer to lose a race against.
 */
function stubNeverAnswers() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch);
}

/** The catalogue request answers, and answers 503. */
function stubCatalogFails() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => {
          throw new Error('no body');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch,
  );
}

const saveBuild = (build: Record<string, string>) =>
  window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(build));

beforeEach(() => {
  // The builder persists its draft, so without this each test inherits the
  // previous one's selection.
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

const counter = () => screen.getByTestId('core-progress').textContent ?? '';
const progressBar = () => document.querySelector('[role="progressbar"]')!;
const cartCount = () => screen.getByTestId('view-build').textContent ?? '';
/** Whether a nav row shows its "slot is done" tick. */
const railTicked = (category: string) =>
  screen.getByTestId(`category-rail-${category}`).querySelector('svg.lucide-check') !== null;
const chipTicked = (category: string) =>
  screen.getByTestId(`category-chip-${category}`).querySelector('svg.lucide-check') !== null;

async function openBuilder() {
  stubCatalog();
  renderBuilder();
  await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
}

describe('while the catalogue is still loading', () => {
  it('states no number for a saved draft it has not checked', async () => {
    // Eight saved ids and nothing yet able to say whether any still exists.
    // "8 of 8" here is a guess that is usually right, which is not the same
    // as being true.
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    saveBuild(build);
    stubNeverAnswers();
    renderBuilder();

    await screen.findByTestId('builder-skeleton', {}, { timeout: 10000 });
    expect(counter()).toBe('Checking your saved parts…');
    expect(counter()).not.toMatch(/\d/);
  }, 30000);

  it('marks the progress bar busy rather than giving it a value', async () => {
    saveBuild({ gpu: first('gpu').id });
    stubNeverAnswers();
    renderBuilder();

    await screen.findByTestId('builder-skeleton', {}, { timeout: 10000 });
    expect(progressBar().getAttribute('aria-busy')).toBe('true');
    expect(progressBar().hasAttribute('aria-valuenow')).toBe(false);
    // The accessible name matches what is on screen, so both say "checking".
    expect(progressBar().getAttribute('aria-label')).toBe('Checking your saved parts…');
  }, 30000);

  it('offers no next part, because it does not know which one', async () => {
    saveBuild({ gpu: first('gpu').id });
    stubNeverAnswers();
    renderBuilder();

    await screen.findByTestId('builder-skeleton', {}, { timeout: 10000 });
    expect(screen.queryByTestId('next-core-part')).toBeNull();
  }, 30000);

  it('does not claim anything is missing either', async () => {
    // "Not known yet" is not evidence of absence. A notice here would tell
    // the shopper their parts are gone while the page is still loading them.
    saveBuild({ gpu: GONE('gpu'), cpu: GONE('cpu') });
    stubNeverAnswers();
    renderBuilder();

    await screen.findByTestId('builder-skeleton', {}, { timeout: 10000 });
    expect(screen.queryByTestId('stale-core-parts')).toBeNull();
  }, 30000);

  it('still says 0 of 8 for an empty draft, which needs no catalogue', async () => {
    stubNeverAnswers();
    renderBuilder();

    await screen.findByTestId('builder-skeleton', {}, { timeout: 10000 });
    expect(counter()).toContain('0 of 8');
    expect(progressBar().getAttribute('aria-valuenow')).toBe('0');
  }, 30000);
});

describe('once the catalogue has answered, all four surfaces agree', () => {
  it('counts, carts and ticks a current saved part', async () => {
    saveBuild({ gpu: first('gpu').id, cpu: first('cpu').id, motherboard: first('motherboard').id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('3 of 8'));
    expect(cartCount()).toContain('(3)');
    for (const category of ['gpu', 'cpu', 'motherboard']) {
      expect(railTicked(category), `rail ${category}`).toBe(true);
      expect(chipTicked(category), `chip ${category}`).toBe(true);
    }
  }, 30000);

  it('does none of those four things for a missing SKU', async () => {
    // The whole defect, in one build: a current GPU beside a delisted CPU.
    saveBuild({ gpu: first('gpu').id, cpu: GONE('cpu') });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
    expect(counter()).not.toContain('2 of 8');
    expect(cartCount()).toContain('(1)');
    expect(railTicked('cpu'), 'the rail ticked a missing SKU').toBe(false);
    expect(chipTicked('cpu'), 'the chip ticked a missing SKU').toBe(false);
    // The one that IS current keeps its tick.
    expect(railTicked('gpu')).toBe(true);
    expect(chipTicked('gpu')).toBe(true);
  }, 30000);

  it('never reads as complete while a saved slot is missing', async () => {
    // Eight ids saved, one delisted: the header must not say 8 of 8 and hide
    // the next-part action over a cart showing seven.
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    build.psu = GONE('psu');
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('7 of 8'));
    expect(counter()).not.toContain('8 of 8');
    expect(cartCount()).toContain('(7)');
    expect(railTicked('psu')).toBe(false);
    expect(chipTicked('psu')).toBe(false);
    expect(progressBar().getAttribute('aria-valuenow')).toBe('7');

    const action = await screen.findByTestId('next-core-part');
    expect(action.getAttribute('data-category')).toBe('psu');
    expect(action.getAttribute('data-slot')).toBe('unavailable');
    expect(action.textContent).toContain('replacement');
  }, 30000);

  it('agrees on a complete build, with nothing outstanding', async () => {
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('8 of 8'));
    expect(cartCount()).toContain('(8)');
    for (const category of CORE) {
      expect(railTicked(category), `rail ${category}`).toBe(true);
      expect(chipTicked(category), `chip ${category}`).toBe(true);
    }
    expect(screen.queryByTestId('next-core-part')).toBeNull();
    expect(screen.queryByTestId('stale-core-parts')).toBeNull();
  }, 30000);

  it.each(CORE)('validates a missing %s the same way as every other category', async (category) => {
    // Named one by one rather than sampled: the rule must not have a hole in
    // a category nobody thought to check.
    saveBuild({ [category]: GONE(category) });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('0 of 8'));
    expect(cartCount()).toContain('(0)');
    expect(railTicked(category)).toBe(false);
    expect(chipTicked(category)).toBe(false);
  }, 30000);
});

describe('the shopper gets one clear notice, not a pile', () => {
  it('names the category when a single saved part has gone', async () => {
    saveBuild({ gpu: first('gpu').id, cpu: GONE('cpu') });
    await openBuilder();

    const notices = await screen.findAllByTestId('stale-core-parts');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toMatch(/not present in the current SpecSmith catalogue/i);
    expect(notices[0].textContent).toMatch(/processor/i);
  }, 30000);

  it('is still ONE notice when three categories have gone', async () => {
    saveBuild({ gpu: first('gpu').id, cpu: GONE('cpu'), psu: GONE('psu'), case: GONE('case') });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
    const notices = screen.getAllByTestId('stale-core-parts');
    expect(notices).toHaveLength(1);
    const text = notices[0].textContent!.toLowerCase();
    for (const category of ['processor', 'power supply', 'case']) {
      expect(text, category).toContain(category);
    }
    // One sentence about it, not three.
    expect(notices[0].textContent!.match(/not present in the current SpecSmith catalogue/gi))
      .toHaveLength(1);
  }, 30000);

  it('invents no reason for the part being gone', async () => {
    saveBuild({ cpu: GONE('cpu') });
    await openBuilder();

    const notice = await screen.findByTestId('stale-core-parts');
    const text = notice.textContent!.toLowerCase();
    for (const guess of ['out of stock', 'discontinued', 'sold out', 'recalled']) {
      expect(text, guess).not.toContain(guess);
    }
  }, 30000);

  it('says nothing when every saved part is current', async () => {
    saveBuild({ gpu: first('gpu').id, cpu: first('cpu').id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('2 of 8'));
    expect(screen.queryByTestId('stale-core-parts')).toBeNull();
  }, 30000);

  it('is announced to a screen reader rather than only drawn', async () => {
    saveBuild({ cpu: GONE('cpu') });
    await openBuilder();

    const notice = await screen.findByTestId('stale-core-parts');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent?.trim()).toBeTruthy();
  }, 30000);
});

describe('validation is not a claim about verification or compatibility', () => {
  it('counts an unverified listing and still refuses to model it', async () => {
    // Seven core categories publish unverified specs. They count toward the
    // eight, and the estimator still declines — which is the point of keeping
    // the two questions apart.
    const cpu = first('cpu');
    expect(cpu.specsVerified).toBe(false);
    saveBuild({ gpu: first('gpu').id, cpu: cpu.id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('2 of 8'));
    const estimate = screen.getByTestId('summary-estimate');
    const button = within(estimate).getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  }, 30000);
});

describe('when the catalogue request fails', () => {
  // A FAILED DOWNLOAD PROVES NOTHING ABOUT A PRODUCT. Classifying saved
  // retailer SKUs as missing here showed the shopper two things at once:
  // "live retailer listings could not be loaded", and "your processor is no
  // longer available". Only the first is something we actually established.
  const savedSku = () => first('cpu').id;

  it('shows the catalogue-failure message, as it always did', async () => {
    saveBuild({ cpu: savedSku() });
    stubCatalogFails();
    renderBuilder();

    const notice = await screen.findByTestId('catalog-failure-notice', {}, { timeout: 10000 });
    expect(notice.textContent).toMatch(/could not be loaded/i);
  }, 30000);

  it('does not also claim the saved retailer SKU is missing', async () => {
    saveBuild({ cpu: savedSku() });
    stubCatalogFails();
    renderBuilder();

    await screen.findByTestId('catalog-failure-notice', {}, { timeout: 10000 });
    expect(screen.queryByTestId('stale-core-parts')).toBeNull();
    expect(document.body.textContent).not.toMatch(/not present in the current SpecSmith catalogue/i);
    expect(document.body.textContent).not.toMatch(/no longer available/i);
  }, 30000);

  it('withholds the completion claim for the unverified slot', async () => {
    saveBuild({ cpu: savedSku() });
    stubCatalogFails();
    renderBuilder();

    await screen.findByTestId('catalog-failure-notice', {}, { timeout: 10000 });
    expect(counter()).toBe('Some saved parts could not be checked');
    expect(counter()).not.toMatch(/\d/);
    expect(progressBar().hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.queryByTestId('next-core-part')).toBeNull();
  }, 30000);

  it('does not mark the bar busy, because nothing is still loading', async () => {
    // A spinner that never resolves is its own small lie.
    saveBuild({ cpu: savedSku() });
    stubCatalogFails();
    renderBuilder();

    await screen.findByTestId('catalog-failure-notice', {}, { timeout: 10000 });
    expect(progressBar().hasAttribute('aria-busy')).toBe(false);
  }, 30000);

  it('still counts a canonical part, which ships with the app', async () => {
    // The offline fallback can show these, so they are genuinely known and
    // the counter is entitled to state a number.
    const gpu = (canonicalGpus as { id: string }[])[0];
    saveBuild({ gpu: gpu.id });
    stubCatalogFails();
    renderBuilder();

    await screen.findByTestId('catalog-failure-notice', {}, { timeout: 10000 });
    await waitFor(() => expect(counter()).toContain('1 of 8'));
    expect(screen.queryByTestId('stale-core-parts')).toBeNull();
  }, 30000);
});

describe('an id is matched exactly, in every surface', () => {
  // coreSlotState used to compare `id.trim()` while the cart, the rail, the
  // chips and the imported-model resolver all look the raw string up. So a
  // draft holding `" rx6600 "` counted in the header and vanished from the
  // cart — the disagreement this whole change set exists to remove.
  const padded = (id: string) => ` ${id} `;

  it('does not let a whitespace-wrapped canonical id count in the header', async () => {
    const gpu = (canonicalGpus as { id: string }[])[0];
    saveBuild({ gpu: padded(gpu.id) });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('0 of 8'));
    expect(counter()).not.toContain('1 of 8');
  }, 30000);

  it('rejects it in the cart, the rail and the chips too', async () => {
    const gpu = (canonicalGpus as { id: string }[])[0];
    saveBuild({ gpu: padded(gpu.id) });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('0 of 8'));
    expect(cartCount()).toContain('(0)');
    expect(railTicked('gpu'), 'the rail ticked a padded id').toBe(false);
    expect(chipTicked('gpu'), 'the chip ticked a padded id').toBe(false);
  }, 30000);

  it('rejects a whitespace-wrapped retailer SKU the same way', async () => {
    saveBuild({ cpu: padded(first('cpu').id) });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('0 of 8'));
    expect(cartCount()).toContain('(0)');
    expect(railTicked('cpu')).toBe(false);
    expect(chipTicked('cpu')).toBe(false);
  }, 30000);

  it('accepts the very same id once it is not padded', async () => {
    // Proves the rejection is about the whitespace and nothing else.
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
    expect(cartCount()).toContain('(1)');
    expect(railTicked('gpu')).toBe(true);
  }, 30000);
});
