import { useEffect } from 'react';
import { applyClientMeta, type RouteMeta } from '../lib/seo';

export function useSeo(meta: RouteMeta) {
  useEffect(() => {
    applyClientMeta(meta);
  }, [meta.path, meta.title, meta.description, meta.image]);
}
