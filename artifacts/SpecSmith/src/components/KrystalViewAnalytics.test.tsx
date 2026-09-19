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
