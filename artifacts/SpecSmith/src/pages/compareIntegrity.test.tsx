// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Compare from './Compare';
import { ToastProvider } from '../context/ToastContext';
import { getRouteMeta } from '../lib/seo';

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

afterEach(cleanup);

function open(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/compare${search}`]}>
      <ToastProvider>
        <Compare />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * Two same-price catalog builds whose estimates tie on several games at
 * 1440p/High. Chosen because the tie count is what this suite is about; a pair
 * with no ties would pass a broken tally.
 */
const TYING_PAIR = '?gpuA=rtx5060ti&cpuA=i3-13100f&gpuB=rtx4060ti&cpuB=r5-9600x&res=1440p&preset=high';

function leadCounts(container: HTMLElement): number[] {
  return [...container.querySelectorAll('.text-3xl.font-black')].map((node) =>
    Number((node.textContent ?? '').trim()),
  );
}

describe('/compare evidence boundaries', () => {
  it('does not turn editorial part prices into value or shopping guidance', () => {
    const { container } = open();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\$[\d,]+/);
    for (const claim of ['Better Value', '/avg FPS', 'performance per dollar', 'GPU+CPU: $']) {
      expect(text).not.toContain(claim);
    }
    expect(screen.queryAllByLabelText('Sort parts by')).toHaveLength(0);
    expect(container.querySelector('a[href*="amazon.com"]')).toBeNull();
    expect(container.querySelector('a[href*="newegg.com"]')).toBeNull();
  });

  it('labels the comparison as modeled estimates rather than measured benchmark results', () => {
    open();
    expect(screen.getByTestId('comparison-evidence-note').textContent).toMatch(/model estimates, not measured benchmarks/i);
    expect(screen.getAllByText('Modelled Game Leads')).toHaveLength(2);
    expect(screen.getByText('Build A Est. FPS')).toBeTruthy();
    expect(screen.getByText('Build B Est. FPS')).toBeTruthy();
    expect(screen.getByText('Higher Estimate')).toBeTruthy();
  });

  it('keeps visible FAQ claims aligned with the model boundary', () => {
    const { container } = open();
    const schema = JSON.parse(container.querySelector('script[type="application/ld+json"]')?.innerHTML ?? '{}');
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const entry of schema.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>) {
      expect(text).toContain(entry.name);
      expect(text).toContain(entry.acceptedAnswer.text);
    }
    expect(text).not.toMatch(/currently about \$|similarly-priced/i);
  });

  it('uses search metadata that promises modeled comparison, not price/value advice', () => {
    const meta = getRouteMeta('/compare');
    expect(meta.description).toMatch(/estimate|model/i);
    expect(meta.description).not.toMatch(/price chart|performance per dollar|before you buy|better value/i);
  });
});

describe('/compare lead tally counts leads, not ties', () => {
  it('never awards a tied game to either build', () => {
    const { container } = open(TYING_PAIR);

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);

    let tiedRows = 0;
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim());
      const [, a, b, verdict] = cells;
      if (a === b) {
        tiedRows += 1;
        // The regression: this used to read "Build A".
        expect(verdict).toBe('Tie');
      } else {
        expect(verdict).toBe(Number(a) > Number(b) ? 'Build A' : 'Build B');
      }
    }
    // Guards the fixture itself: if the catalog drifts so nothing ties, this
    // suite would pass while testing nothing.
    expect(tiedRows).toBeGreaterThan(0);
  });

  it('reports A leads, B leads and ties as three separate figures that account for every game', () => {
    const { container } = open(TYING_PAIR);

    const [aLeads, bLeads] = leadCounts(container);
    const tieText = container.querySelector('[data-testid="comparison-tie-count"]')?.textContent ?? '';
    const tieCount = Number(tieText.replace(/[^\d]/g, ''));
    const rows = container.querySelectorAll('tbody tr').length;

    expect(Number.isFinite(tieCount)).toBe(true);
    expect(tieCount).toBeGreaterThan(0);
    expect(aLeads + bLeads + tieCount).toBe(rows);
  });

  it('agrees with the per-game verdicts it is summarising', () => {
    const { container } = open(TYING_PAIR);

    const verdicts = [...container.querySelectorAll('tbody tr')].map(
      (row) => ([...row.querySelectorAll('td')].at(-1)?.textContent ?? '').trim(),
    );
    const [aLeads, bLeads] = leadCounts(container);
    const tieCount = Number(
      (container.querySelector('[data-testid="comparison-tie-count"]')?.textContent ?? '').replace(/[^\d]/g, ''),
    );

    expect(aLeads).toBe(verdicts.filter((v) => v === 'Build A').length);
    expect(bLeads).toBe(verdicts.filter((v) => v === 'Build B').length);
    expect(tieCount).toBe(verdicts.filter((v) => v === 'Tie').length);
  });

  it('labels the tie figure in words, so a bare number cannot be read as a third score', () => {
    const { container } = open(TYING_PAIR);
    const tieText = (container.querySelector('[data-testid="comparison-tie-count"]')?.textContent ?? '').trim();
    expect(tieText).toMatch(/^\d+ (tie|ties)$/);
  });
});
