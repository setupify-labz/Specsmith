// Recommendation eligibility over a catalogLifecycle.json payload. Kept free
// of the JSON import so the Builder can load the payload lazily (see
// hooks/useCatalogLifecycle.ts) while prerendered guide pages import it
// directly (lib/catalogLifecycle.ts). The rules are documented there.

export type CatalogLabel = 'legacy' | 'invalid' | 'needs-review' | 'unsuitable';

export interface CatalogLifecycleData {
  eligible: string[];
  labels: Record<string, string>;
}

export interface CatalogLifecycle {
  /** True only for a part the audit ledger lists as eligible. Fails closed. */
  isRecommendable(id: string): boolean;
  /** The subset of `parts` that may appear in a recommendation. */
  recommendable<T extends { id: string }>(parts: readonly T[]): T[];
  catalogLabel(id: string): CatalogLabel | null;
  /** Short user-facing label for a part, or null when there is nothing to say. */
  catalogLabelText(id: string): string | null;
}

const LABEL_TEXT: Record<CatalogLabel, string> = {
  legacy: 'Older generation',
  invalid: 'Not a retail desktop part',
  'needs-review': 'Exact variant unconfirmed',
  unsuitable: 'Below our gaming-build baseline',
};

export function createCatalogLifecycle(data: CatalogLifecycleData): CatalogLifecycle {
  const eligible = new Set(data.eligible);
  const labels = data.labels as Record<string, CatalogLabel>;
  const isRecommendable = (id: string) => eligible.has(id);
  const catalogLabel = (id: string): CatalogLabel | null => labels[id] ?? null;
  return {
    isRecommendable,
    recommendable: (parts) => parts.filter((part) => isRecommendable(part.id)),
    catalogLabel,
    catalogLabelText: (id) => {
      const label = catalogLabel(id);
      return label ? LABEL_TEXT[label] : null;
    },
  };
}

/**
 * Keeps only recommendations for eligible canonical parts. With no lifecycle
 * loaded yet (null) nothing is eligible, so nothing is recommended.
 */
export function eligibleRecommendations<T extends { canonicalId: string }>(
  items: readonly T[],
  lifecycle: CatalogLifecycle | null,
): T[] {
  return lifecycle ? items.filter((item) => lifecycle.isRecommendable(item.canonicalId)) : [];
}
