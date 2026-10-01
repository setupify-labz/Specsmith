// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Compare from './Compare';
import { ToastProvider } from '../context/ToastContext';
import { getRouteMeta } from '../lib/seo';
import { estimateFpsForBuild } from '../lib/fps';
import { tallyModelledLeads } from '../lib/compareTally';
import { getAverageFps } from '../lib/compareValue';
import gpus from '../data/gpus.json';
import cpus from '../data/cpus.json';
import games from '../data/games.json';

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

function open(path = '/compare') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Compare />
      </ToastProvider>
    </MemoryRouter>,
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

  it('counts ties separately, and the rendered tally matches the current model', () => {
    // The pairing used by the MASTER #6 demo. Before this fix the page showed
    // 13 "leads" for Build A: its 10 real leads plus the 3 tied games.
    const pair = { gpuA: 'rtx5060ti', cpuA: 'i3-13100f', gpuB: 'rtx4060ti', cpuB: 'r5-9600x' };
    const { container } = open(`/compare?gpuA=${pair.gpuA}&cpuA=${pair.cpuA}&gpuB=${pair.gpuB}&cpuB=${pair.cpuB}&res=1440p&preset=high`);
    const find = <T extends { id: string }>(list: T[], id: string) => list.find((entry) => entry.id === id)!;
    const rows = (games as Parameters<typeof estimateFpsForBuild>[2][]).map((game) => ({
      fpsA: estimateFpsForBuild(find(gpus as never[], pair.gpuA), find(cpus as never[], pair.cpuA), game, '1440p', 'high').estimated,
      fpsB: estimateFpsForBuild(find(gpus as never[], pair.gpuB), find(cpus as never[], pair.cpuB), game, '1440p', 'high').estimated,
    }));
    const tally = tallyModelledLeads(rows);
    expect(tally).toEqual({ leadsA: 10, leadsB: 7, ties: 3 });
    expect([getAverageFps(rows.map((row) => row.fpsA)), getAverageFps(rows.map((row) => row.fpsB))]).toEqual([121, 123]);

    const leadCounts = Array.from(container.querySelectorAll('.text-3xl.font-black')).map((node) => node.textContent);
    expect(leadCounts).toEqual(['10', '7']);
    expect(screen.getByTestId('compare-ties').textContent).toBe('3 ties');
    const text = container.textContent ?? '';
    expect(text).toContain('Est. Avg FPS: 121');
    expect(text).toContain('Est. Avg FPS: 123');
    // Tied games are labelled as ties in the per-game table, not as Build A.
    expect(screen.getAllByText('Tie')).toHaveLength(3);
  });
});
