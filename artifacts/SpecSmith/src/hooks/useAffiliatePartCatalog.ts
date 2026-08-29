import { useEffect, useState } from 'react';

import { loadAffiliatePartCatalog, type AffiliateCatalogView } from '../lib/retail/partCatalogLoader';

const initial: AffiliateCatalogView = { status: 'absent' };

export function useAffiliatePartCatalog(): AffiliateCatalogView {
  const [view, setView] = useState<AffiliateCatalogView>(initial);
  useEffect(() => {
    const controller = new AbortController();
    void loadAffiliatePartCatalog({ signal: controller.signal }).then(setView);
    return () => controller.abort();
  }, []);
  return view;
}
