export const ANALYTICS_CONSENT_KEY = 'specsmith-krystalview-consent';
export const PRODUCT_EVENT_NAME = 'specsmith:product-event';
export const ANALYTICS_CONSENT_RESET_EVENT = 'specsmith:analytics-consent-reset';

export type ProductEvent =
  | { name: 'builder_started'; metadata: { entry: 'blank' | 'preloaded' } }
  | { name: 'build_completed'; metadata: { selectedCoreParts: number } }
  | { name: 'fps_estimate_viewed'; metadata: { source: 'builder'; resolution: string; preset: string } }
  | { name: 'upgrade_comparison_viewed'; metadata: { component: 'gpu' | 'cpu'; resultCount: number } }
  | { name: 'retailer_link_clicked'; metadata: { retailer: string; placement: string } }
  | { name: 'build_shared'; metadata: { method: 'native' | 'clipboard' } }
  | { name: 'signup_completed'; metadata: { confirmationRequired: boolean } };

export type ProductEventDetail = ProductEvent & {
  path: string;
  timestamp: number;
};

export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'accepted';
  } catch {
    return false;
  }
}

/**
 * Sends a deliberately small product event into the consented analytics
 * adapter. Event payloads are closed over the union above: no email address,
 * account id, selected component id, build payload, retailer URL, or FPS value
 * can be added by an unreviewed call site.
 */
export function trackProductEvent(event: ProductEvent): boolean {
  if (!hasAnalyticsConsent()) return false;
  window.dispatchEvent(new CustomEvent<ProductEventDetail>(PRODUCT_EVENT_NAME, {
    detail: {
      ...event,
      path: window.location.pathname,
      timestamp: Date.now(),
    },
  }));
  return true;
}

export function resetAnalyticsConsent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    // The in-page reset still takes effect when storage is unavailable.
  }
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_RESET_EVENT));
}
