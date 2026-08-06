import { useState, useCallback, useEffect } from 'react';

export interface BuildState {
  gpu: string | null;
  cpu: string | null;
  motherboard: string | null;
  ram: string | null;
  storage: string | null;
  psu: string | null;
  case: string | null;
  cooler: string | null;
}

const EMPTY_BUILD: BuildState = {
  gpu: null,
  cpu: null,
  motherboard: null,
  ram: null,
  storage: null,
  psu: null,
  case: null,
  cooler: null,
};

const STORAGE_KEY = 'specsmith-builder-draft';

function readStoredBuild(): Partial<BuildState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useBuilder(initial?: Partial<BuildState>) {
  const [build, setBuild] = useState<BuildState>({ ...EMPTY_BUILD, ...initial });

  // Restoring a saved draft has to happen after mount, not in the initial
  // render — reading localStorage during render would make the server's
  // HTML (always empty) disagree with the client's first paint whenever a
  // draft exists, which React treats as a hydration mismatch. Skipped
  // entirely when the page already loaded with explicit state (a shared
  // link or a prebuilt via the URL) — that should win over a stale draft.
  useEffect(() => {
    if (initial && Object.keys(initial).length > 0) return;
    const stored = readStoredBuild();
    if (stored) setBuild(prev => ({ ...prev, ...stored }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const hasAnyPart = Object.values(build).some(v => v !== null);
      if (hasAnyPart) localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private browsing, storage quota, etc. — persistence is a nicety, not required */
    }
  }, [build]);

  const selectPart = useCallback((category: keyof BuildState, id: string | null) => {
    setBuild(prev => ({ ...prev, [category]: id }));
  }, []);

  const loadBuild = useCallback((newBuild: Partial<BuildState>) => {
    setBuild({ ...EMPTY_BUILD, ...newBuild });
  }, []);

  const clearBuild = useCallback(() => {
    setBuild({ ...EMPTY_BUILD });
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return { build, selectPart, loadBuild, clearBuild };
}
