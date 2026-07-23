import type { CrateRarity } from './buildCrate';

const KEY = 'specsmith-crate-best';
const RARITY_RANK: Record<CrateRarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

export interface BestPull {
  rarity: CrateRarity;
  gpuName: string;
  cpuName: string;
  totalCost: number;
  avgFps: number;
  date: string;
}

export function getBestPull(): BestPull | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

/** Records a pull as the new personal best only if it out-ranks whatever's
 * currently stored. A local (not cross-visitor) leaderboard-of-one — same
 * localStorage-only pattern as the rest of the site's account data. */
export function recordPullIfBest(pull: Omit<BestPull, 'date'>): BestPull {
  const current = getBestPull();
  if (!current || RARITY_RANK[pull.rarity] > RARITY_RANK[current.rarity]) {
    const updated: BestPull = { ...pull, date: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch { /* ignore */ }
    return updated;
  }
  return current;
}
