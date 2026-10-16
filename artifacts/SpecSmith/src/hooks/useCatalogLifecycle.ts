import { useEffect, useState } from 'react';
import { createCatalogLifecycle, type CatalogLifecycle } from '../lib/catalogLifecycleCore';

// Loads the catalog eligibility list after first paint so it stays out of the
// Builder's initial JavaScript. Until it arrives the hook returns null, and
// callers treat null as "nothing is eligible yet": no accolade badges and no
// recommended highlights. That is the fail-closed direction, and the labels
// simply appear a moment later.

let pending: Promise<CatalogLifecycle> | null = null;
let loaded: CatalogLifecycle | null = null;

/**
 * Starts (or reuses) the load. Once it resolves, every later mount of the hook
 * starts with the list already in hand, so it renders synchronously. Tests
 * await this before rendering the Builder.
 */
export function preloadCatalogLifecycle(): Promise<CatalogLifecycle> {
  return load();
}

function load(): Promise<CatalogLifecycle> {
  pending ??= import('../data/catalogLifecycle.json').then((module) => {
    loaded = createCatalogLifecycle(module.default);
    return loaded;
  });
  return pending;
}

export function useCatalogLifecycle(): CatalogLifecycle | null {
  const [lifecycle, setLifecycle] = useState<CatalogLifecycle | null>(loaded);
  useEffect(() => {
    if (lifecycle) return;
    let active = true;
    load().then((value) => { if (active) setLifecycle(value); }, () => { /* stay fail-closed */ });
    return () => { active = false; };
  }, [lifecycle]);
  return lifecycle;
}
