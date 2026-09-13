// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UpgradeCalculator from './UpgradeCalculator';
import { ToastProvider } from '../context/ToastContext';
import {
  getClosestUpgradeComparisons,
  UPGRADE_COMPARISON_PREVIEW_LIMIT,
  UPGRADE_REFERENCE_CPU,
} from '../lib/upgradeCalculator';
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

function open(gpu = 'rx6600') {
  return render(
    <MemoryRouter initialEntries={[`/upgrade-calculator?gpu=${gpu}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade-calculator" element={<UpgradeCalculator />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('/upgrade-calculator evidence boundaries', () => {
  it('contains no price, resale, net-cost, value badge or retailer-shopping UI', () => {
    const { container } = open();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\$[\d,]+/);
    expect(container.innerHTML).not.toMatch(/\$[\d,]+/);
    for (const claim of ['Estimated Resale Value', 'Net Cost', 'Cost / FPS', 'Best value']) {
      expect(text).not.toContain(claim);
    }
    expect(screen.queryByLabelText('Sort parts by')).toBeNull();
    expect(container.querySelector('a[href*="amazon.com"]')).toBeNull();
    expect(container.querySelector('a[href*="newegg.com"]')).toBeNull();
  });

  it('renders the same compact price-independent comparison used by the guide pages', () => {
    open();
    const expected = getClosestUpgradeComparisons('rx6600');
    const rows = screen.getAllByTestId('comparison-row');
    expect(rows.map(row => row.getAttribute('data-gpu-id'))).toEqual(expected.map(row => row.gpu.id));
    expect(rows.length).toBeLessThanOrEqual(UPGRADE_COMPARISON_PREVIEW_LIMIT);
    expect(screen.getByTestId('selection-basis').textContent).toMatch(/price does not affect selection/i);

    for (const [index, row] of rows.entries()) {
      expect(within(row).getByText('Estimated Difference')).toBeTruthy();
      expect(within(row).getByText('Estimated Average')).toBeTruthy();
      const link = within(row).getByRole('link', { name: `Open ${expected[index].gpu.name} in Builder` });
      expect(link.getAttribute('href')).toBe(`/builder?gpu=${expected[index].gpu.id}`);
    }
  });

  it('states the estimate basis and does not present model output as a benchmark', () => {
    open();
    expect(screen.getByText(UPGRADE_REFERENCE_CPU.name)).toBeTruthy();
    expect(screen.getByText('20 games')).toBeTruthy();
    expect(screen.getByText('1440p High settings.')).toBeTruthy();
    expect(screen.getByTestId('comparison-limit').textContent).toMatch(/not measured benchmarks/i);
    expect(screen.getByText(/A model estimate, not a benchmark of your PC/i)).toBeTruthy();
  });

  it('keeps FAQ schema exactly aligned with visible FAQs', () => {
    const { container } = open();
    const schema = JSON.parse(container.querySelector('script[type="application/ld+json"]')?.innerHTML ?? '{}');
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const entry of schema.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>) {
      expect(text).toContain(entry.name);
      expect(text).toContain(entry.acceptedAnswer.text);
    }
  });

  it('uses accurate search metadata rather than a trade-up or real-FPS promise', () => {
    const meta = getRouteMeta('/upgrade-calculator');
    expect(meta.title).toBe('GPU Upgrade Comparison Calculator | SpecSmith');
    expect(meta.description).toMatch(/estimates/i);
    expect(meta.description).not.toMatch(/resale|worth used|real fps|trade.up/i);
  });
});

describe('/upgrade-calculator top-of-stack state', () => {
  it('does not invent a comparison above the fastest model', () => {
    open('rtx5090');
    expect(screen.queryAllByTestId('comparison-row')).toHaveLength(0);
    expect(screen.getByText(/No GPU SpecSmith tracks produces a higher modelled average/i)).toBeTruthy();
  });
});
