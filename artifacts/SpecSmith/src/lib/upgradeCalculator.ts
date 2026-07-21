import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from './fps';

export interface UpgradeGpu {
  id: string;
  name: string;
  price_usd: number;
  tier: number;
  gpu_multiplier: number;
  [key: string]: unknown;
}

interface Game {
  id: string;
  name: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

const gpus = gpuData as UpgradeGpu[];
const games = gamesData as Game[];

// Fixed reference CPU, same one the /vs GPU matchup pages use, so a GPU's
// FPS numbers here line up with what's shown elsewhere on the site.
const REFERENCE_CPU_ID = 'r7-9800x3d';
const referenceCpu = (cpuData as { id: string; name: string; cpu_multiplier: number; [key: string]: unknown }[])
  .find(c => c.id === REFERENCE_CPU_ID)!;

export function getUpgradeGpus(): UpgradeGpu[] {
  return gpus;
}

export function getUpgradeGpu(id: string): UpgradeGpu | undefined {
  return gpus.find(g => g.id === id);
}

/** Rough street resale value for a used card — no live market data behind
 * this, just a flat percentage of listed price rounded to a clean number.
 * Framed as an estimate everywhere it's shown, same as the FPS numbers. */
export function estimateResaleValue(price: number): number {
  return Math.round((price * 0.65) / 5) * 5;
}

export function averageFps(gpu: UpgradeGpu, resolution = '1440p', preset = 'high'): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, referenceCpu, g, resolution, preset).estimated, 0);
  return Math.round(total / games.length);
}

export type UpgradeVerdict = 'strong' | 'moderate' | 'marginal';

export interface UpgradeCandidate {
  gpu: UpgradeGpu;
  netCost: number;
  avgFpsCurrent: number;
  avgFpsNew: number;
  fpsGainPct: number;
  verdict: UpgradeVerdict;
}

/** GPUs worth considering as an upgrade from the given card. Picks the
 * cheapest option in each tier above the current one (one per tier, tier
 * ascending) rather than just the N cheapest overall — the latter tends to
 * cluster every result right at the next tier boundary, which for a budget
 * card means showing six "marginal gain" options and never surfacing the
 * bigger jump that'd actually be worth it. Net cost accounts for reselling
 * the old card at the flat estimate above. */
export function getUpgradeCandidates(currentId: string, limit = 6): UpgradeCandidate[] {
  const current = getUpgradeGpu(currentId);
  if (!current) return [];

  const resale = estimateResaleValue(current.price_usd);
  const avgFpsCurrent = averageFps(current);

  const cheapestPerTier = new Map<number, UpgradeGpu>();
  for (const g of gpus) {
    if (g.tier <= current.tier) continue;
    const existing = cheapestPerTier.get(g.tier);
    if (!existing || g.price_usd < existing.price_usd) cheapestPerTier.set(g.tier, g);
  }

  return [...cheapestPerTier.values()]
    .sort((a, b) => a.tier - b.tier)
    .slice(0, limit)
    .map(gpu => {
      const avgFpsNew = averageFps(gpu);
      const netCost = Math.max(0, gpu.price_usd - resale);
      const fpsGainPct = Math.round(((avgFpsNew - avgFpsCurrent) / avgFpsCurrent) * 100);
      const verdict: UpgradeVerdict = fpsGainPct >= 30 ? 'strong' : fpsGainPct >= 15 ? 'moderate' : 'marginal';
      return { gpu, netCost, avgFpsCurrent, avgFpsNew, fpsGainPct, verdict };
    });
}
