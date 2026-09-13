// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Compare from './Compare';
import { ToastProvider } from '../context/ToastContext';
import { getRouteMeta } from '../lib/seo';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  LabelList: () => null,
}));

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

function open() {
  return render(
    <MemoryRouter initialEntries={['/compare']}>
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
    expect(meta.description).toMatch(/estimated|model/i);
    expect(meta.description).not.toMatch(/price chart|performance per dollar|before you buy|better value/i);
  });
});
