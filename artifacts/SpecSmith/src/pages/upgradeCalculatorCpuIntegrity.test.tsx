// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UpgradeCalculatorCpu from './UpgradeCalculatorCpu';
import { ToastProvider } from '../context/ToastContext';
import {
  getClosestCpuUpgradeComparisons,
  CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT,
  CPU_UPGRADE_REFERENCE_GPU,
} from '../lib/cpuUpgradeCalculator';

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

function open(cpu = 'r5-5500') {
  return render(
    <MemoryRouter initialEntries={[`/upgrade-calculator-cpu?cpu=${cpu}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade-calculator-cpu" element={<UpgradeCalculatorCpu />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('/upgrade-calculator-cpu evidence boundaries', () => {
  it('contains no price, resale, net-cost, value badge or retailer-shopping UI', () => {
    const { container } = open();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\$[\d,]+/);
    expect(container.innerHTML).not.toMatch(/\$[\d,]+/);
    for (const claim of ['Estimated Resale Value', 'Net Cost', 'Cost / FPS', 'Best value', 'Strong upgrade', 'Moderate upgrade']) {
      expect(text).not.toContain(claim);
    }
    expect(screen.queryByLabelText('Sort parts by')).toBeNull();
    expect(container.querySelector('a[href*="amazon.com"]')).toBeNull();
    expect(container.querySelector('a[href*="newegg.com"]')).toBeNull();
  });

  it('renders the price-independent CPU comparison used by CPU comparison pages', () => {
    open();
    const expected = getClosestCpuUpgradeComparisons('r5-5500');
    const rows = screen.getAllByTestId('comparison-row');
    expect(rows.map(row => row.getAttribute('data-cpu-id'))).toEqual(expected.map(row => row.cpu.id));
    expect(rows.length).toBeLessThanOrEqual(CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT);
    expect(screen.getByTestId('selection-basis').textContent).toMatch(/price does not affect selection/i);
    for (const [index, row] of rows.entries()) {
      expect(within(row).getByText('Estimated Difference')).toBeTruthy();
      expect(within(row).getByText('Estimated Average')).toBeTruthy();
      const link = within(row).getByRole('link', { name: `Open ${expected[index].cpu.name} in Builder` });
      expect(link.getAttribute('href')).toBe(`/builder?cpu=${expected[index].cpu.id}`);
    }
  });

  it('states the model basis and does not present output as measured benchmarks', () => {
    open();
    expect(screen.getByText(CPU_UPGRADE_REFERENCE_GPU.name)).toBeTruthy();
    expect(screen.getByText('20 games')).toBeTruthy();
    expect(screen.getByText('1440p High settings.')).toBeTruthy();
    expect(screen.getByTestId('comparison-limit').textContent).toMatch(/not measured benchmarks/i);
    expect(screen.getByText(/A model estimate, not a benchmark of your PC/i)).toBeTruthy();
  });
});
