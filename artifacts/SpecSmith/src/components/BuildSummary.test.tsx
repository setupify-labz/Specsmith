// @vitest-environment jsdom
//
// BuildSummary always mounts SaveBuildModal (even while closed), which
// unconditionally calls useNavigate() and useAuth(); it also calls
// useToast() itself. Every render needs Router + Auth + Toast ancestors,
// same as it would in the app. No Supabase env vars are set in this test
// run, so AuthProvider takes its no-backend-configured branch — no network
// calls, no Supabase client.
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import BuildSummary from './BuildSummary';

afterEach(cleanup);

const baseProps = {
  totalCost: 1999,
  onEstimateFps: vi.fn(),
  canEstimate: false,
  compatibilityOk: true,
  buildState: {},
};

function renderSummary(props: Partial<ComponentProps<typeof BuildSummary>>) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <BuildSummary {...baseProps} parts={[]} {...props} />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('BuildSummary — parts with no tracked affiliate URL', () => {
  it('labels each retailer CTA as a search, never Buy/View deal/In stock', () => {
    renderSummary({ parts: [{ label: 'GPU', name: 'NVIDIA GeForce RTX 4090', price: 1599 }] });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const texts = links.map((a) => a.textContent);
    expect(texts.some((t) => t?.includes('Search Amazon'))).toBe(true);
    expect(texts.some((t) => t?.includes('Search Newegg'))).toBe(true);
    for (const a of links) {
      expect(a.textContent).not.toMatch(/\bBuy\b|View deal|In stock/i);
      expect(a.getAttribute('data-link-state')).toBe('fallback-search');
    }
  });

  it('shows the search-vs-exact disclosure note', () => {
    renderSummary({ parts: [{ label: 'GPU', name: 'NVIDIA GeForce RTX 4090', price: 1599 }] });
    expect(screen.getByText(/open a retailer search, not the exact product/i)).not.toBeNull();
  });

  it('renders the exact part name beside its CTAs and never truncates it out of the DOM', () => {
    renderSummary({ parts: [{ label: 'GPU', name: 'NVIDIA GeForce RTX 4090 Founders Edition', price: 1599 }] });
    expect(screen.getByText('NVIDIA GeForce RTX 4090 Founders Edition')).not.toBeNull();
  });

  it('never renders a retailer CTA for a custom (unlisted) part', () => {
    renderSummary({
      parts: [{ label: 'Custom', name: 'Used case fan', price: 5, customId: 'c1' }],
      onRemoveCustomPart: vi.fn(),
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Remove')).not.toBeNull();
  });
});

describe('BuildSummary — a part with a real, structurally exact Newegg product URL', () => {
  const trackedUrl = 'https://www.newegg.com/p/N82E16819113476';

  it('renders only the exact Newegg link for that part, without claiming unverified sponsorship', () => {
    renderSummary({ parts: [{ label: 'CPU', name: 'AMD Ryzen 5 5600', price: 129, affiliateUrl: trackedUrl }] });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(trackedUrl);
    expect(links[0].getAttribute('data-link-state')).toBe('exact');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('BuildSummary — an untrustworthy affiliateUrl override never becomes exact', () => {
  it('falls back to search for a wrong-domain URL, exactly as when no override is supplied', () => {
    renderSummary({ parts: [{ label: 'CPU', name: 'AMD Ryzen 5 5600', price: 129, affiliateUrl: 'https://example.com/not-newegg' }] });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('data-link-state')).toBe('fallback-search');
    }
  });
});
