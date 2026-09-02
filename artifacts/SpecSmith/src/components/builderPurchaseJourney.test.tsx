// @vitest-environment jsdom
//
// Integration coverage for issue #87: the primary builder-to-summary
// journey (PartSelector -> PartCard in the grid, BuildSummary in the
// sidebar) must agree on each part's link-integrity state end to end.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import PartSelector from './PartSelector';
import BuildSummary from './BuildSummary';

afterEach(cleanup);

const trackedNeweggUrl = 'https://www.newegg.com/p/N82E16819113476?item=N82E16819113476';

const parts = [
  { id: 'rtx4090', name: 'NVIDIA GeForce RTX 4090', price_usd: 1599 },
  { id: 'ryzen5600', name: 'AMD Ryzen 5 5600', price_usd: 129, affiliateUrl: trackedNeweggUrl },
];

describe('the primary builder-to-summary journey agrees on link state, both retailers', () => {
  it('the selection grid shows one search pair and one exact link, matching the summary sidebar', () => {
    render(
      <PartSelector
        category="gpu"
        label="GPU — Graphics Card"
        parts={parts}
        selectedId={null}
        onSelect={vi.fn()}
        getSpecs={() => []}
        defaultOpen
      />,
    );

    const rtxCard = screen.getByText('NVIDIA GeForce RTX 4090').closest<HTMLElement>('[class*="relative"]')!;
    expect(within(rtxCard).getByRole('link', { name: /Search Amazon/i })).not.toBeNull();
    expect(within(rtxCard).getByRole('link', { name: /Search Newegg/i })).not.toBeNull();

    const ryzenCard = screen.getByText('AMD Ryzen 5 5600').closest<HTMLElement>('[class*="relative"]')!;
    const ryzenLinks = within(ryzenCard).getAllByRole('link');
    expect(ryzenLinks).toHaveLength(1);
    expect(ryzenLinks[0].getAttribute('href')).toBe(trackedNeweggUrl);
    expect(ryzenLinks[0].getAttribute('data-link-state')).toBe('exact');

    cleanup();

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <BuildSummary
              totalCost={1728}
              onEstimateFps={vi.fn()}
              canEstimate={false}
              compatibilityOk
              buildState={{}}
              parts={[
                { label: 'GPU', name: parts[0].name, price: parts[0].price_usd },
                { label: 'CPU', name: parts[1].name, price: parts[1].price_usd, affiliateUrl: parts[1].affiliateUrl },
              ]}
            />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    const gpuLinks = screen.getAllByRole('link', { name: /Amazon|Newegg/i }).filter((a) =>
      a.getAttribute('aria-label')?.includes('RTX 4090'),
    );
    expect(gpuLinks.length).toBe(2);
    expect(gpuLinks.every((a) => a.getAttribute('data-link-state') === 'fallback-search')).toBe(true);

    const cpuLink = screen.getByRole('link', { name: /Ryzen 5 5600/i });
    expect(cpuLink.getAttribute('data-link-state')).toBe('exact');
    expect(cpuLink.getAttribute('href')).toBe(trackedNeweggUrl);
  });
});
