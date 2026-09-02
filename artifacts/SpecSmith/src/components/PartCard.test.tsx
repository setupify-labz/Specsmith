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

  it('builds the Amazon/Newegg search from the given searchQuery, not the raw name', () => {
    render(<PartCard {...baseProps} searchQuery="NVIDIA GeForce RTX 4090 graphics card" />);
    const amazon = screen.getByRole('link', { name: /Search Amazon/i });
    expect(amazon.getAttribute('href')).toContain(encodeURIComponent('NVIDIA GeForce RTX 4090 graphics card'));
  });
});

describe('PartCard — a real, structurally exact Newegg product URL is supplied', () => {
  const trackedUrl = 'https://www.newegg.com/p/N82E16819113476';

  it('renders only the exact Newegg link and hides the Amazon search CTA', () => {
    render(<PartCard {...baseProps} affiliateUrl={trackedUrl} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(trackedUrl);
    expect(links[0].getAttribute('data-link-state')).toBe('exact');
    expect(links[0].textContent).toContain('View at Newegg');
    expect(screen.queryByRole('link', { name: /Amazon/i })).toBeNull();
  });

  it('does not claim sponsorship it cannot verify for an untracked direct URL', () => {
    render(<PartCard {...baseProps} affiliateUrl={trackedUrl} />);
    const link = screen.getAllByRole('link')[0];
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).not.toMatch(/affiliate link/i);
  });
});

describe('PartCard — an untrustworthy affiliateUrl override never becomes exact', () => {
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
