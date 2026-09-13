// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import RetailerLinkCta from './RetailerLinkCta';
import type { RetailerLink } from '../lib/retailerLinkState';

afterEach(cleanup);

const FORBIDDEN_WORDING = [/\bBuy\b/i, /View deal/i, /In stock/i];

describe('RetailerLinkCta — fallback-search state', () => {
  const link: RetailerLink = { state: 'fallback-search', href: 'https://www.amazon.com/s?k=RTX+4090&tag=specsmithpc-20', sponsored: true };

  it('says "Search <Retailer>", never an exact/live implication', () => {
    render(<RetailerLinkCta retailer="Amazon" partName="RTX 4090" link={link} variant="pill" accentColor="#000" />);
    const anchor = screen.getByRole('link');
    expect(anchor.textContent).toContain('Search Amazon');
    for (const pattern of FORBIDDEN_WORDING) {
      expect(anchor.textContent).not.toMatch(pattern);
      expect(anchor.getAttribute('aria-label')).not.toMatch(pattern);
    }
  });

  it('carries the state and an accessible explanation to confirm the model', () => {
    const unsponsored: RetailerLink = { state: 'fallback-search', href: link.href, sponsored: false };
    render(<RetailerLinkCta retailer="Newegg" partName="RTX 4090" link={unsponsored} variant="text" accentColor="#000" />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('data-link-state')).toBe('fallback-search');
    expect(anchor.getAttribute('aria-label')).toMatch(/confirm the model/i);
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders rel=sponsored only when the link itself says it is sponsored', () => {
    render(<RetailerLinkCta retailer="Amazon" partName="RTX 4090" link={link} variant="pill" accentColor="#000" />);
    expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer sponsored');
  });
});

describe('RetailerLinkCta — exact state', () => {
  it('says "View at <Retailer>" and marks the destination as an exact product page', () => {
    const link: RetailerLink = { state: 'exact', href: 'https://www.newegg.com/p/N82E16819113476', sponsored: false };
    render(<RetailerLinkCta retailer="Newegg" partName="AMD Ryzen 5 5600" link={link} variant="pill" accentColor="#000" />);
    const anchor = screen.getByRole('link');
    expect(anchor.textContent).toContain('View at Newegg');
    expect(anchor.getAttribute('data-link-state')).toBe('exact');
    expect(anchor.getAttribute('href')).toBe(link.href);
    expect(anchor.getAttribute('aria-label')).toMatch(/exact product page/i);
  });

  it('never claims "(affiliate link)" or rel=sponsored for an exact URL that is not verified sponsored', () => {
    const link: RetailerLink = { state: 'exact', href: 'https://www.newegg.com/p/N82E16819113476', sponsored: false };
    render(<RetailerLinkCta retailer="Newegg" partName="AMD Ryzen 5 5600" link={link} variant="pill" accentColor="#000" />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('aria-label')).not.toMatch(/affiliate link/i);
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('claims "(affiliate link)" and rel=sponsored only when the link is verified sponsored', () => {
    const link: RetailerLink = { state: 'exact', href: 'https://www.newegg.com/p/N82E16819113476', sponsored: true };
    render(<RetailerLinkCta retailer="Newegg" partName="AMD Ryzen 5 5600" link={link} variant="pill" accentColor="#000" />);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('aria-label')).toMatch(/affiliate link/i);
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer sponsored');
  });
});

describe('RetailerLinkCta — unavailable state', () => {
  const link: RetailerLink = { state: 'unavailable', href: null, sponsored: false };

  it('renders no link at all — never a clickable destination with nowhere to go', () => {
    render(<RetailerLinkCta retailer="Amazon" partName="" link={link} variant="pill" accentColor="#000" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Amazon unavailable')).not.toBeNull();
  });
});
