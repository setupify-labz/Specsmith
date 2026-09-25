// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import KrystalViewAnalytics from './KrystalViewAnalytics';
import { ANALYTICS_CONSENT_KEY, trackProductEvent } from '../lib/productAnalytics';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/builder');
  document.head.querySelector('#krystalview-analytics-script')?.remove();
});

afterEach(cleanup);

it('keeps structured events off before consent', async () => {
  render(<KrystalViewAnalytics />);
  expect(await screen.findByRole('dialog', { name: 'Analytics privacy choice' })).toBeTruthy();
  expect(trackProductEvent({ name: 'builder_started', metadata: { entry: 'blank' } })).toBe(false);
  expect(document.querySelector('[data-specsmith-product-event]')).toBeNull();
});

it('records only a coarse retailer and placement after consent', async () => {
  localStorage.setItem(ANALYTICS_CONSENT_KEY, 'accepted');
  render(<KrystalViewAnalytics />);
  const link = document.createElement('a');
  link.href = 'https://www.newegg.com/p/example?secret=affiliate-token';
  link.rel = 'sponsored noopener';
  link.dataset.analyticsPlacement = 'test-card';
  link.textContent = 'View retailer';
  link.addEventListener('click', event => event.preventDefault());
  document.body.appendChild(link);
  fireEvent.click(link);

  await waitFor(() => {
    const marker = document.querySelector<HTMLElement>('[data-specsmith-product-event]');
    expect(marker?.dataset.specsmithProductEvent).toBe('retailer_link_clicked');
    expect(marker?.dataset.specsmithProductPath).toBe('/builder');
    expect(marker?.outerHTML).not.toContain('affiliate-token');
  });
  link.remove();
});

// The choice panel covers the bottom of the viewport. It publishes how much,
// so the mobile Builder's fixed "View build" bar and sheet can stand above it.
it('publishes the space it covers while visible, and clears it once a choice is made', async () => {
  render(<KrystalViewAnalytics />);
  await screen.findByRole('dialog', { name: 'Analytics privacy choice' });
  // jsdom has no layout, so the panel measures 0px: what remains is its 16px
  // offset and 8px gap. A real browser adds the panel's rendered height.
  expect(document.documentElement.style.getPropertyValue('--ff-bottom-overlay-height')).toBe('24px');
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Analytics privacy choice' })).toBeNull());
  expect(document.documentElement.style.getPropertyValue('--ff-bottom-overlay-height')).toBe('');
});

it('never reserves space when a choice was already stored', async () => {
  localStorage.setItem(ANALYTICS_CONSENT_KEY, 'declined');
  render(<KrystalViewAnalytics />);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Analytics privacy choice' })).toBeNull());
  expect(document.documentElement.style.getPropertyValue('--ff-bottom-overlay-height')).toBe('');
});
