// Which canonical parts in src/data/ may be RECOMMENDED for purchase.
//
// The catalog audit ledger (src/data/catalogAudit.json) records, per part id,
// whether the record describes a real product correctly (validity) and whether
// it is still a sensible thing to buy for a new build (lifecycle), with the
// reason for each. Parts are never deleted for being old: legacy GPUs/CPUs
// keep their ids so benchmark records, matchup pages, upgrade calculators and
// saved builds still resolve. They are only kept out of anything that
// recommends a purchase.
//
// The app imports only catalogLifecycle.json — the ids that must not be
// recommended and why — so the ledger's notes never ship in the client bundle.
// catalogLifecycle.test.ts keeps it in step with the ledger and fails if any
// listed part is missing from the audit.

import exclusions from '../data/catalogLifecycle.json';

export type NotRecommendedReason = 'invalid' | 'legacy' | 'needs-review';

const excluded = exclusions as Record<string, NotRecommendedReason>;

export function notRecommendedReason(id: string): NotRecommendedReason | null {
  return excluded[id] ?? null;
}

/** True unless the catalog audit excludes this part from recommendations. */
export function isRecommendable(id: string): boolean {
  return notRecommendedReason(id) === null;
}

/** The subset of `parts` that may appear in a recommendation. */
export function recommendable<T extends { id: string }>(parts: readonly T[]): T[] {
  return parts.filter((part) => isRecommendable(part.id));
}

const LABELS: Record<NotRecommendedReason, string> = {
  invalid: 'Not a retail desktop part',
  legacy: 'Legacy — not recommended for new builds',
  'needs-review': 'Exact variant unconfirmed',
};

/** Short user-facing label for why a part is not recommended, or null. */
export function notRecommendedLabel(id: string): string | null {
  const reason = notRecommendedReason(id);
  return reason ? LABELS[reason] : null;
}
