// @vitest-environment jsdom
//
// The header progress counter, and the two numbers that disagreed.
//
// REPRODUCTION. Choose a GPU, a CPU and a motherboard from the retailer
// catalogue: the build summary says three parts, and the header says one.
//
// WHY. The header counted RESOLVED CANONICAL parts — each selected id mapped
// back to a reference part, and mapped only when the listing's specs are
// verified. In the published catalogue exactly one core category is verified,
// GPUs; the other seven are not. So for a motherboard, RAM, storage, a PSU, a
// case or a cooler the counter could not move at all, no matter what the
// shopper chose. It was reporting how much of the build the FPS estimator
// understands, under a label that says how much of the build exists.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from './Builder';
import { EMPTY_FILTERS, filterAndSort } from '../lib/retail/retailShopping';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
const first = (category: string) => parts.find((p) => p.category === category)!;
/**
 * The first card the default view actually RENDERS for a category.
 *
 * The grid sorts and paginates, so the first entry in the JSON is often not on
 * screen — a removal test that clicks it is clicking nothing.
 */
const onScreen = (category: string) =>
  filterAndSort(parts.filter((p) => p.category === category) as any, EMPTY_FILTERS)[0] as any;

const CORE = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'] as const;
/** A real canonical id — what the fallback builder, and a legacy draft, name. */
const CANONICAL_GPU = 'rtx5090';

function stubFetch() {
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

const saveBuild = (build: Record<string, string>) =>
  window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(build));

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

const counter = () => screen.getByTestId('core-progress').textContent ?? '';

async function openBuilder() {
  stubFetch();
  renderBuilder();
  await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
}

describe('the defect', () => {
  it('counts a GPU, a CPU and a motherboard as three, not one', async () => {
    // The exact reproduction from the report. Only the GPU has verified specs
    // in the published catalogue, so the old counter said "1 of 8".
    saveBuild({ gpu: first('gpu').id, cpu: first('cpu').id, motherboard: first('motherboard').id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('3 of 8'));
    expect(counter()).not.toContain('1 of 8');
  }, 30000);

  it('agrees with the build summary', async () => {
    // Two numbers describing one build must not disagree. This is the
    // assertion the bug report is actually about.
    saveBuild({ gpu: first('gpu').id, cpu: first('cpu').id, motherboard: first('motherboard').id });
    await openBuilder();

    await waitFor(() => expect(screen.getByTestId('view-build').textContent).toContain('(3)'));
    expect(counter()).toContain('3 of 8');
  }, 30000);
});

describe('every core category counts, verified or not', () => {
  it.each(CORE)('counts a selected %s', async (category) => {
    // Seven of these eight are unverified in the published catalogue, which is
    // precisely why each one is named here rather than trusting a sample.
    saveBuild({ [category]: first(category).id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
  }, 30000);

  it('counts all eight at once', async () => {
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('8 of 8'));
  }, 30000);

  it('does not count peripherals toward the eight', async () => {
    // "Core build" means the parts that make a computer. A headset is a fine
    // thing to own and does not make the machine any more complete.
    saveBuild({
      gpu: first('gpu').id,
      monitor: first('monitor').id,
      keyboard: first('keyboard').id,
      mouse: first('mouse').id,
      headset: first('headset').id,
    });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
  }, 30000);
});

describe('the label says what it counts', () => {
  it('reads "Core build: X of 8 parts selected"', async () => {
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();
    await waitFor(() => expect(counter()).toMatch(/Core build:\s*1 of 8 parts selected/));
  }, 30000);
});

describe('removing a part', () => {
  it('counts back down', async () => {
    const gpu = onScreen('gpu');
    saveBuild({ gpu: gpu.id, cpu: first('cpu').id });
    await openBuilder();
    await waitFor(() => expect(counter()).toContain('2 of 8'));

    // Removed the way a shopper removes it: the same control that added it.
    const card = document.querySelector(`[data-part-id="${gpu.id}"]`);
    expect(card, 'the chosen GPU is not on screen').toBeTruthy();
    fireEvent.click(card!.querySelector('[data-testid="add-to-build"]')!);

    await waitFor(() => expect(counter()).toContain('1 of 8'));
  }, 30000);

  it('goes back to zero when the last part goes', async () => {
    const gpu = onScreen('gpu');
    saveBuild({ gpu: gpu.id });
    await openBuilder();
    await waitFor(() => expect(counter()).toContain('1 of 8'));

    const card = document.querySelector(`[data-part-id="${gpu.id}"]`);
    expect(card, 'the chosen GPU is not on screen').toBeTruthy();
    fireEvent.click(card!.querySelector('[data-testid="add-to-build"]')!);

    await waitFor(() => expect(counter()).toContain('0 of 8'));
  }, 30000);
});

describe('the next missing core part', () => {
  it('offers the first unchosen category, in assembly order', async () => {
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();

    const action = await screen.findByTestId('next-core-part');
    expect(action.getAttribute('data-category')).toBe('cpu');
    expect(action.textContent).toContain('Choose a processor');
  }, 30000);

  it('opens that category when clicked', async () => {
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();

    fireEvent.click(await screen.findByTestId('next-core-part'));
    // The catalogue heading names the category that is now open.
    await waitFor(() => {
      expect(screen.getByTestId('category-rail-cpu').getAttribute('data-active')).toBe('true');
    });
  }, 30000);

  it('moves on as parts are chosen, and disappears at eight', async () => {
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('8 of 8'));
    expect(screen.queryByTestId('next-core-part')).toBeNull();
  }, 30000);

  it('offers a graphics card first on an empty build', async () => {
    await openBuilder();
    const action = await screen.findByTestId('next-core-part');
    expect(action.getAttribute('data-category')).toBe('gpu');
  }, 30000);
});

describe('counting is not a claim about verification or compatibility', () => {
  it('counts unverified retailer parts without saying their specs are known', async () => {
    // Seven core categories are unverified in the published catalogue. They
    // count toward the build, and the estimator still refuses to model them —
    // which is the whole point of keeping the two numbers apart.
    const cpu = first('cpu');
    expect(cpu.specsVerified).toBe(false);
    saveBuild({ gpu: first('gpu').id, cpu: cpu.id });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('2 of 8'));
    // The estimate stays closed: an unverified CPU cannot be modelled, so the
    // FPS action must not offer to model it.
    const estimate = screen.getByTestId('summary-estimate');
    const button = estimate.querySelector('button');
    expect(button, 'no estimate control').toBeTruthy();
    expect(button!.hasAttribute('disabled')).toBe(true);
  }, 30000);

  it('does not turn the compatibility banner green just because parts exist', async () => {
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('8 of 8'));
    // Eight parts chosen, and compatibility still says it has not been able to
    // check them. A full build is not a checked build.
    expect(document.body.textContent).toMatch(/not checked|cannot be checked|unsupported/i);
  }, 30000);
});

describe('a saved build', () => {
  it('is counted on arrival, before anything is clicked', async () => {
    saveBuild({ gpu: first('gpu').id, cpu: first('cpu').id, psu: first('psu').id });
    await openBuilder();
    await waitFor(() => expect(counter()).toContain('3 of 8'));
  }, 30000);

  it('does NOT count a saved id whose listing has been delisted', async () => {
    // REVIEW BLOCKER. Counting every saved id produced "8 of 8" over a summary
    // listing seven — the same contradiction this change set exists to remove,
    // arriving from the other direction. A slot counts when the builder can
    // actually put something in it.
    saveBuild({ gpu: onScreen('gpu').id, cpu: 'retail-cpu-that-no-longer-exists' });
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
    expect(screen.getByTestId('view-build').textContent).toContain('(1)');
  }, 30000);

  it('never shows eight of eight while the summary lists seven', async () => {
    // The exact shape the reviewer named, with a full build minus one delisted
    // cooler. The two numbers are asserted against each other, so neither can
    // drift without the other.
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    build.cooler = 'retail-cooler-that-no-longer-exists';
    saveBuild(build);
    await openBuilder();

    await waitFor(() => expect(counter()).toContain('7 of 8'));
    expect(counter()).not.toContain('8 of 8');
    expect(screen.getByTestId('view-build').textContent).toContain('(7)');
  }, 30000);

  it('offers the delisted slot as the next part to choose', async () => {
    const build: Record<string, string> = {};
    for (const category of CORE) build[category] = first(category).id;
    build.cooler = 'retail-cooler-that-no-longer-exists';
    saveBuild(build);
    await openBuilder();

    const action = await screen.findByTestId('next-core-part');
    expect(action.getAttribute('data-category')).toBe('cooler');
  }, 30000);
});

describe('the counter is reachable', () => {
  it('exposes the progress to a screen reader once, not twice', async () => {
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();

    const bar = document.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
    expect(bar.getAttribute('aria-label')).toMatch(/Core build:\s*1 of 8 parts selected/);
    // The visible text repeats the accessible name, so it is hidden rather
    // than read out a second time.
    expect(screen.getByTestId('core-progress').getAttribute('aria-hidden')).toBe('true');
  }, 30000);

  it('offers the next part as a real button, not a decoration', async () => {
    saveBuild({ gpu: first('gpu').id });
    await openBuilder();

    const action = await screen.findByTestId('next-core-part');
    expect(action.tagName).toBe('BUTTON');
    expect(action.getAttribute('type')).toBe('button');
    // Reachable by keyboard, and it says what it does without relying on the icon.
    expect(action.textContent?.trim()).toBeTruthy();
    expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  }, 30000);
});

describe('when the catalogue has failed', () => {
  // REVIEW BLOCKER. "Choose a processor" scrolled to the top of the fallback
  // builder and stopped, leaving a shopper who asked for a processor looking
  // at graphics cards with no sign that anything had happened.
  const renderFailed = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch,
    );
    renderBuilder();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
  };

  const scrolled: Element[] = [];
  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(this: Element) {
      scrolled.push(this);
    };
    // The scroll happens in an effect, after React commits the open state —
    // deliberately not in the click handler, where the selector would still be
    // collapsed and at its old position.
  });

  it('scrolls to the requested category section', async () => {
    // A saved GPU means the next missing core part is the processor.
    saveBuild({ gpu: CANONICAL_GPU });
    await renderFailed();

    const action = await screen.findByTestId('next-core-part');
    const category = action.getAttribute('data-category')!;
    fireEvent.click(action);

    const section = document.querySelector(`[data-part-section="${category}"]`);
    expect(section, `no fallback selector for ${category}`).toBeTruthy();
    await waitFor(() => expect(scrolled).not.toHaveLength(0));
    // The section itself, rather than the builder region wrapping everything.
    expect(scrolled[scrolled.length - 1]).toBe(section);
    // And it is open by then: scrolling to a collapsed panel lands on where it
    // used to be, and it moves once it expands.
    expect(section!.querySelectorAll('button').length).toBeGreaterThan(1);
  }, 30000);

  it('opens that selector so its parts are actually reachable', async () => {
    saveBuild({ gpu: CANONICAL_GPU });
    await renderFailed();

    const action = await screen.findByTestId('next-core-part');
    const category = action.getAttribute('data-category')!;
    const section = document.querySelector(`[data-part-section="${category}"]`)!;
    const before = section.querySelectorAll('button').length;

    fireEvent.click(action);

    await waitFor(() => {
      expect(section.querySelectorAll('button').length).toBeGreaterThan(before);
    });
  }, 30000);

  it('counts only parts the fallback can actually show', async () => {
    // The fallback draws from the canonical parts, so a retail SKU id saved in
    // the draft is not something it can put on screen.
    saveBuild({ gpu: CANONICAL_GPU, cpu: first('cpu').id });
    await renderFailed();

    await waitFor(() => expect(counter()).toContain('1 of 8'));
  }, 30000);
});
