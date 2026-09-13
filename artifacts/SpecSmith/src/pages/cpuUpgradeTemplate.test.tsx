// @vitest-environment jsdom
//
// The CPU upgrade template, rendered — all 51 pages share it, so these tests
// run representative low-, mid- and high-end chips plus the top of the stack.
//
// Mirrors the GPU template suite, because the defect and the fix are the same:
// no sentence may recommend a purchase, no figure may appear unlabelled, no
// money may appear at all, and every Builder link must open the chip being
// COMPARED rather than the chip being replaced.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CpuUpgradePage from './CpuUpgradePage';
import { getCpuUpgradeComparisons, getClosestCpuUpgradeComparisons, CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT } from '../lib/cpuUpgradeCalculator';

/** slug → cpu id, spanning the catalogue. */
const PAGES: ReadonlyArray<readonly [string, string, string]> = [
  ['i3-13100f', 'i3-13100f', 'low-end'],
  ['ryzen-5-5500', 'r5-5500', 'low-end'],
  ['i5-12400f', 'i5-12400f', 'mid-range'],
  ['ryzen-7-7800x3d', 'r7-7800x3d', 'high-end'],
];

beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
});

// After EVERY test, pass or fail: a cleanup() at the end of a test body is
// skipped when an assertion throws, and the leftover DOM then makes the next
// test's queries find the previous page's nodes.
afterEach(cleanup);

let container: HTMLElement;

const open = (slug: string) => {
  ({ container } = render(
    <MemoryRouter initialEntries={[`/upgrade-cpu/${slug}`]}>
      <Routes>
        <Route path="/upgrade-cpu/:slug" element={<CpuUpgradePage />} />
      </Routes>
    </MemoryRouter>,
  ));
  return container.textContent ?? '';
};

describe.each(PAGES)('/upgrade-cpu/%s (%s)', (slug, cpuId, _band) => {
  it('recommends nothing', () => {
    const text = open(slug).toLowerCase();
    for (const banned of [
      'best upgrade', 'worth it', 'we recommend', 'you should upgrade', 'top pick',
      'best value', 'strong upgrade', 'moderate upgrade', 'marginal gain',
    ]) {
      expect(text, `page still says "${banned}"`).not.toContain(banned);
    }
  });

  it('shows no money of any kind', () => {
    const text = open(slug);
    expect(text.match(/\$[\d,]+/g) ?? []).toEqual([]);
    const note = screen.getByTestId('no-prices-note').textContent ?? '';
    for (const banned of [/net cost/i, /resale/i, /cost\s*\/\s*fps/i, /price/i]) {
      // "price" is allowed only inside the note that explains why there are none.
      const hits = text.match(new RegExp(banned.source, 'gi')) ?? [];
      expect(hits.filter((h) => !note.includes(h)), `"${banned.source}" appears outside the no-prices note`).toEqual([]);
    }
  });

  it('labels every FPS figure and percentage as modelled', () => {
    open(slug);
    expect(screen.getByText(/Estimated Average FPS/)).toBeTruthy();
    expect(screen.getByText(/an estimate, not a benchmark/i)).toBeTruthy();
    const basis = screen.getByTestId('estimate-basis').textContent ?? '';
    expect(basis).toMatch(/estimates, not benchmark results/i);
    expect(basis).toMatch(/fixed reference GPU/i);
    // The model reads a performance FACTOR, not the catalogue tier. The GPU
    // template briefly claimed otherwise; that claim must not reappear here.
    expect(basis).toMatch(/performance factor/i);
    expect(basis.toLowerCase()).not.toContain('performance tier');
    // WHY THE COLUMN OF +1%s. The model pairs every chip with the same
    // high-end GPU at 1440p High, and the full modelled range across the
    // whole CPU catalogue is only a few percent. A reader looking at eight
    // near-identical rows is owed that, or the page looks broken.
    expect(basis).toMatch(/keeps the modelled differences small/i);

    for (const row of screen.queryAllByTestId('comparison-row')) {
      expect(within(row).getByText(/Estimated difference/i)).toBeTruthy();
      expect(within(row).getByText(/Estimated average/i)).toBeTruthy();
    }
  });

  it('describes the preview as a subset, not a ranking of everything', () => {
    open(slug);
    const basis = screen.getByTestId('selection-basis').textContent ?? '';
    expect(basis).toMatch(new RegExp(`up to ${CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT}`, 'i'));
    expect(basis).toMatch(/not a recommendation/i);
    expect(basis).toMatch(/price does not affect which chips appear/i);
  });

  it('keeps a self-referential canonical and its own URL', () => {
    open(slug);
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toBe(`https://specsmithpc.com/upgrade-cpu/${slug}`);
  });

  it('opens the COMPARED chip in Builder, never the chip being replaced', () => {
    open(slug);
    const links = Array.from(container.querySelectorAll('a[href^="/builder"]'));
    const preview = getClosestCpuUpgradeComparisons(cpuId);
    expect(links).toHaveLength(preview.length);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toBe(`/builder?cpu=${cpuId}`);
      const target = href.replace('/builder?cpu=', '');
      expect(preview.some((c) => c.cpu.id === target), `${href} is not a compared chip`).toBe(true);
      // Every link needs its own accessible name; "Open in Builder" repeated
      // eight times tells a screen-reader user nothing about which chip.
      expect(link.getAttribute('aria-label')).toMatch(/^Open .+ in Builder$/);
    }
    expect(new Set(links.map((l) => l.getAttribute('aria-label'))).size).toBe(links.length);
  });

  it('renders the preview rows, in the order the library returned', () => {
    open(slug);
    const rendered = screen.queryAllByTestId('comparison-row').map((row) => row.getAttribute('data-cpu-id'));
    expect(rendered).toEqual(getClosestCpuUpgradeComparisons(cpuId).map((c) => c.cpu.id));
    expect(rendered.length).toBeLessThanOrEqual(CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT);
  });

  it('states the complete count even though it previews a subset', () => {
    open(slug);
    expect(screen.getByTestId('comparison-count').textContent).toBe(String(getCpuUpgradeComparisons(cpuId).length));
  });

  it('puts nothing in the FAQ schema that is not visible on the page', () => {
    open(slug);
    // Scoped to the page root: useSeo injects a site-wide JSON-LD block into
    // <head>, and a document-wide query finds that one first.
    const ld = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(ld?.innerHTML ?? '{}');
    expect(Array.isArray(parsed.mainEntity), 'no FAQ schema on the page').toBe(true);
    const pageText = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const entry of parsed.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>) {
      expect(pageText, `question not visible: ${entry.name}`).toContain(entry.name);
      expect(pageText, `answer not visible: ${entry.name}`).toContain(entry.acceptedAnswer.text.replace(/\s+/g, ' '));
    }
    const ldText = JSON.stringify(parsed).toLowerCase();
    for (const banned of ['best upgrade', 'best value', 'worth it', 'we recommend']) {
      expect(ldText, `schema still claims "${banned}"`).not.toContain(banned);
    }
    // Money words only where the answer explains there are none.
    for (const answer of (parsed.mainEntity as Array<{ acceptedAnswer: { text: string } }>)
      .map((e) => e.acceptedAnswer.text.toLowerCase())
      .filter((t) => !t.includes('does not show prices'))) {
      for (const banned of ['net cost', 'resale', 'cost per frame']) {
        expect(answer, `an answer still claims "${banned}"`).not.toContain(banned);
      }
      expect(answer).not.toMatch(/\$\s?\d/);
    }
  });
});

describe('the top of the stack degrades without a recommendation', () => {
  it('says nothing is faster rather than inventing a next step', () => {
    // The fastest chip SpecSmith models has no faster sibling to compare.
    const fastest = PAGES.map(([slug, id]) => ({ slug, id, n: getCpuUpgradeComparisons(id).length }))
      .reduce((min, p) => (p.n < min.n ? p : min));
    const text = open(fastest.slug);
    if (fastest.n === 0) {
      expect(text).toMatch(/No CPU SpecSmith tracks produces a higher modelled average/i);
      expect(screen.queryAllByTestId('comparison-row')).toHaveLength(0);
    } else {
      expect(screen.queryAllByTestId('comparison-row').length).toBeGreaterThan(0);
    }
  });
});

describe('an unknown slug still degrades safely', () => {
  it('shows the not-found state rather than crashing', () => {
    expect(open('not-a-real-chip')).toContain('CPU not found');
  });
});
