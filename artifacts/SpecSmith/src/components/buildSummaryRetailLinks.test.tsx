// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import BuildSummary from './BuildSummary';
import { ToastProvider } from '../context/ToastContext';
import { AuthProvider } from '../context/AuthContext';
import { catalogueEstimatePrice } from '../lib/partPrice';

afterEach(cleanup);

const price = (category: string, amount: number) => ({ kind: 'catalogue' as const, price: catalogueEstimatePrice(category, amount) });

function renderSummary(parts: Parameters<typeof BuildSummary>[0]['parts']) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <BuildSummary parts={parts} totalCost={0} onEstimateFps={() => {}} canEstimate={false} compatibilityOk buildState={{}} />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

// Retailer links on a catalogue row are purchase recommendations, so a row the
// catalog audit does not list as eligible gets none (Codex review, PR #191).
describe('BuildSummary retailer links', () => {
  it('links an eligible row and leaves an ineligible row unlinked', () => {
    renderSummary([
      { label: 'GPU', name: 'RTX 5070', price: price('gpu', 599), retailLinks: true },
      { label: 'Cooler', name: 'Cooler Master Hyper 212', price: price('cooler', 39), retailLinks: false },
    ]);
    const links = screen.getAllByRole('link').map((a) => decodeURIComponent(a.getAttribute('href') ?? ''));
    expect(links.some((href) => /RTX 5070/i.test(href))).toBe(true);
    expect(links.some((href) => /Hyper 212/i.test(href))).toBe(false);
    expect(within(document.body).getByText('Cooler Master Hyper 212')).toBeTruthy();
  });
});
