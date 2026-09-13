// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PartCard from './PartCard';

afterEach(cleanup);

const baseProps = {
  id: 'rtx4090',
  name: 'NVIDIA GeForce RTX 4090',
  selected: false,
  specs: [{ label: 'VRAM', value: '24GB' }],
  onSelect: vi.fn(),
};

describe('PartCard — no tracked affiliate URL (every canonical GPU/CPU/component today)', () => {
  it('shows both retailers as an explicit search, never an exact/buy implication', () => {
    render(<PartCard {...baseProps} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const labels = links.map((a) => a.textContent);
    expect(labels.some((t) => t?.includes('Search Amazon'))).toBe(true);
    expect(labels.some((t) => t?.includes('Search Newegg'))).toBe(true);
    for (const a of links) {
      expect(a.getAttribute('data-link-state')).toBe('fallback-search');
      expect(a.textContent).not.toMatch(/\bBuy\b/i);
      expect(a.textContent).not.toMatch(/View deal|In stock/i);
    }
  });

  it('keeps the exact part name visible next to the fallback CTAs', () => {
    render(<PartCard {...baseProps} />);
    expect(screen.getByText('NVIDIA GeForce RTX 4090')).not.toBeNull();
  });

  it('labels catalog prices as estimated rather than implying a current retailer price', () => {
    render(<PartCard {...baseProps} price_usd={1599} />);
    const price = screen.getByText('Est. $1,599');
    expect(price).not.toBeNull();
    expect(price.getAttribute('title')).toMatch(/Estimated catalog price/i);
    expect(screen.queryByText('$1,599')).toBeNull();
    expect(screen.getByRole('button', { name: /estimated \$1,599/i })).not.toBeNull();
  });


  it('builds the Amazon/Newegg search from the given searchQuery, not the raw name', () => {
    render(<PartCard {...baseProps} searchQuery="NVIDIA GeForce RTX 4090 graphics card" />);
    const amazon = screen.getByRole('link', { name: /Search Amazon/i });
    expect(amazon.getAttribute('href')).toContain(encodeURIComponent('NVIDIA GeForce RTX 4090 graphics card'));
  });
});

describe('PartCard — a well-shaped affiliateUrl override still fails closed to search', () => {
  // #88's round-2 independent review: a URL whose shape unambiguously
  // names a Newegg product page is still not evidence it names the
  // *intended* part, since this component tier has no independently
  // verified part-to-item-id binding to check it against. So even a
  // structurally exact tracked URL renders as a fallback-search CTA today,
  // not as "View at Newegg" — identical to no override being supplied.
  const trackedUrl = 'https://www.newegg.com/p/N82E16819113476';

  it('renders both retailers as fallback-search, the same as no override at all', () => {
    render(<PartCard {...baseProps} affiliateUrl={trackedUrl} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('data-link-state')).toBe('fallback-search');
    }
    const newegg = links.find((a) => a.textContent?.includes('Newegg'));
    expect(newegg?.getAttribute('href')).not.toBe(trackedUrl);
  });

  it('does not claim sponsorship it cannot verify', () => {
    render(<PartCard {...baseProps} affiliateUrl={trackedUrl} />);
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('aria-label')).not.toMatch(/affiliate link/i);
    }
  });
});

describe('PartCard — an untrustworthy affiliateUrl override falls back to search, same as any other', () => {
  it.each([
    ['a search-results URL', 'https://www.newegg.com/p/pl?d=rtx+4090'],
    ['a wrong-domain URL', 'https://example.com/not-newegg'],
    ['a malformed URL string', 'not a url at all'],
    ['a path/query id disagreement', 'https://www.newegg.com/p/N82E16819113476?item=N82E16814932765'],
  ])('falls back to search for %s', (_label, badUrl) => {
    render(<PartCard {...baseProps} affiliateUrl={badUrl} />);
    const links = screen.getAllByRole('link');
    // Both retailers render, exactly as when no override is supplied at all.
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('data-link-state')).toBe('fallback-search');
    }
  });
});
