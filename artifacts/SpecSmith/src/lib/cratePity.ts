import type { CrateRarity } from './buildCrate';

const KEY = 'specsmith-crate-pity';
const RARE_OR_BETTER: Set<CrateRarity> = new Set(['rare', 'epic', 'legendary']);

/** After this many consecutive sub-Rare crate runs, the next run is
 * guaranteed Rare or better — a standard gacha "soft pity" mechanic so a bad
 * luck streak has a visible, honest end point instead of feeling endless. */
export const PITY_THRESHOLD = 4;

function getCount(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function isPityActive(): boolean {
  return getCount() >= PITY_THRESHOLD;
}

export function pullsUntilPity(): number {
  return Math.max(0, PITY_THRESHOLD - getCount());
}

/** Called once a crate run finishes — resets the streak on a Rare+ pull,
 * otherwise counts it toward the next guaranteed one. */
export function recordPullResult(rarity: CrateRarity): void {
  try {
    const next = RARE_OR_BETTER.has(rarity) ? 0 : getCount() + 1;
    localStorage.setItem(KEY, String(next));
  } catch { /* ignore */ }
}
