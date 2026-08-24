import { useEffect, useState } from 'react';

const CONSENT_KEY = 'specsmith-krystalview-consent';
const SCRIPT_ID = 'krystalview-analytics-script';
const SITE_KEY = 'site_b9f3ba4454244538adfbbc147334d354';
const COLLECTOR_BASE_URL = 'https://krystalview.com/api';

type Consent = 'accepted' | 'declined' | null;

type KrystalViewInstance = {
  enableRecording?: () => void;
};

type KrystalViewWindow = Window & {
  KUAnalytics?: {
    init: (config: {
      collectorBaseUrl: string;
      siteKey: string;
      consentRequired: boolean;
      maskAllInputs: boolean;
      sampleRate: number;
    }) => KrystalViewInstance;
  };
  __krystalView?: KrystalViewInstance;
  __KU_SESSION_ID?: string;
};

function sendTrackedError(payload: Record<string, unknown>) {
  const kvWindow = window as KrystalViewWindow;
  if (!kvWindow.__KU_SESSION_ID) return;

  try {
    navigator.sendBeacon(
      `${COLLECTOR_BASE_URL}/v1/ingest/error`,
      JSON.stringify({
        sid: kvWindow.__KU_SESSION_ID,
        pk: SITE_KEY,
        ...payload,
        ts: Date.now(),
      }),
    );
  } catch {
    // Analytics must never interfere with the site if the collector is unavailable.
  }
}

export default function KrystalViewAnalytics() {
  const [consent, setConsent] = useState<Consent | 'loading'>('loading');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONSENT_KEY);
      setConsent(saved === 'accepted' || saved === 'declined' ? saved : null);
    } catch {
      setConsent(null);
    }
  }, []);

  useEffect(() => {
    if (consent !== 'accepted') return;

    const kvWindow = window as KrystalViewWindow;

    const initialize = () => {
      if (kvWindow.__krystalView) {
        kvWindow.__krystalView.enableRecording?.();
        return;
      }
      if (!kvWindow.KUAnalytics) return;

      kvWindow.__krystalView = kvWindow.KUAnalytics.init({
        collectorBaseUrl: COLLECTOR_BASE_URL,
        siteKey: SITE_KEY,
        consentRequired: true,
        maskAllInputs: true,
        sampleRate: 1,
      });
      kvWindow.__krystalView?.enableRecording?.();
    };

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      if (kvWindow.KUAnalytics) initialize();
      else existingScript.addEventListener('load', initialize, { once: true });
    } else {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://krystalview.com/t/kv.js';
      script.async = true;
      script.addEventListener('load', initialize, { once: true });
      document.head.appendChild(script);
    }

    const onError = (event: ErrorEvent) => {
      sendTrackedError({
        msg: event.message,
        src: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error instanceof Error ? event.error.stack : null,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      sendTrackedError({
        msg: `Unhandled Promise: ${reason instanceof Error ? reason.message : String(reason ?? 'Unknown')}`,
        stack: reason instanceof Error ? reason.stack : null,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      existingScript?.removeEventListener('load', initialize);
    };
  }, [consent]);

  const choose = (next: Exclude<Consent, null>) => {
    try {
      localStorage.setItem(CONSENT_KEY, next);
    } catch {
      // Consent still applies for this page load even if storage is unavailable.
    }
    setConsent(next);
  };

  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Analytics privacy choice"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl p-4 shadow-2xl sm:flex-row sm:items-center sm:justify-between"
      style={{
        backgroundColor: 'var(--ff-surface)',
        border: '1px solid var(--ff-border)',
        color: 'var(--ff-text)',
      }}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">Help improve SpecSmith</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
          We use privacy-conscious session analytics to understand what works and fix problems. Inputs are masked, and recording only starts if you accept.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => choose('declined')}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            border: '1px solid var(--ff-border)',
            color: 'var(--ff-text-2)',
            backgroundColor: 'transparent',
          }}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => choose('accepted')}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
        >
          Accept analytics
        </button>
      </div>
    </div>
  );
}
