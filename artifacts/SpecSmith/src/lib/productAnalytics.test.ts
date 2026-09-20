// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_CONSENT_RESET_EVENT,
  PRODUCT_EVENT_NAME,
  resetAnalyticsConsent,
  trackProductEvent,
  type ProductEventDetail,
} from './productAnalytics';

describe('consent-aware product analytics', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/builder?gpu=private-selection');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits nothing until analytics is explicitly accepted', () => {
    const listener = vi.fn();
    window.addEventListener(PRODUCT_EVENT_NAME, listener);
    expect(trackProductEvent({ name: 'builder_started', metadata: { entry: 'blank' } })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(PRODUCT_EVENT_NAME, listener);
  });

  it('emits a closed, query-free payload after consent', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'accepted');
    let detail: ProductEventDetail | null = null;
    const listener = (event: Event) => { detail = (event as CustomEvent<ProductEventDetail>).detail; };
    window.addEventListener(PRODUCT_EVENT_NAME, listener);

    expect(trackProductEvent({
      name: 'fps_estimate_viewed',
      metadata: { source: 'builder', resolution: '1440p', preset: 'high' },
    })).toBe(true);

    expect(detail).toMatchObject({
      name: 'fps_estimate_viewed',
      path: '/builder',
      metadata: { source: 'builder', resolution: '1440p', preset: 'high' },
    });
    expect(JSON.stringify(detail)).not.toContain('private-selection');
    window.removeEventListener(PRODUCT_EVENT_NAME, listener);
  });

  it('clears stored consent and notifies the active adapter', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'accepted');
    const listener = vi.fn();
    window.addEventListener(ANALYTICS_CONSENT_RESET_EVENT, listener);
    resetAnalyticsConsent();
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(ANALYTICS_CONSENT_RESET_EVENT, listener);
  });
});
