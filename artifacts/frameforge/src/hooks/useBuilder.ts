import { useState, useCallback } from 'react';

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

export function useBuilder(initial?: Partial<BuildState>) {
  const [build, setBuild] = useState<BuildState>({ ...EMPTY_BUILD, ...initial });

  const selectPart = useCallback((category: keyof BuildState, id: string | null) => {
    setBuild(prev => ({ ...prev, [category]: id }));
  }, []);

  const loadBuild = useCallback((newBuild: Partial<BuildState>) => {
    setBuild({ ...EMPTY_BUILD, ...newBuild });
  }, []);

  const clearBuild = useCallback(() => {
    setBuild({ ...EMPTY_BUILD });
  }, []);

  return { build, selectPart, loadBuild, clearBuild };
}
