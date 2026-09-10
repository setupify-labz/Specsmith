import { useCallback, useEffect, useState } from 'react';

import { loadAffiliatePartCatalog, type AffiliateCatalogView } from '../lib/retail/partCatalogLoader';

export interface AffiliateCatalogState {
  view: AffiliateCatalogView;
  /** Re-runs the fetch. Returns the view to `loading` first. */
  retry: () => void;
}

/**
 * The retailer catalogue, with loading told apart from failure.
 *
 * WHY IT STARTS AT `loading` (issue #104). It used to start at `absent`, the
 * same value a confirmed failure produces, so `/builder` could not distinguish
 * "no answer yet" from "no catalogue" and painted the legacy builder on every
 * single visit before swapping it out. One state, and the page can show a
 * skeleton while waiting and keep the honest fallback for a real failure.
 *
 * RETRY IS A REAL RE-FETCH, not a re-render. `attempt` is the dependency the
 * effect keys off, so a retry tears down the in-flight request, returns the
 * view to `loading` — the shopper sees the skeleton again, which is the honest
 * description of what is happening — and starts a new one.
 *
 * A resolved value from a superseded attempt is dropped rather than stored: an
 * aborted request that answers late must not overwrite the state of the
 * attempt that replaced it, which is how a retry ends up displaying the very
 * failure it was meant to clear.
 */
export function useAffiliatePartCatalog(): AffiliateCatalogState {
  const [view, setView] = useState<AffiliateCatalogView>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setView({ status: 'loading' });
    void loadAffiliatePartCatalog({ signal: controller.signal }).then((next) => {
      if (current) setView(next);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { view, retry };
}
