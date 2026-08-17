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
  /** Dollars spent per average FPS gained (netCost / FPS gained), rounded.
   * Null when there's no meaningful FPS gain to divide by (zero/negative),
   * or when netCost is 0 — in either case a $/FPS ratio would be
   * undefined or misleading rather than a real number. */
  costPerFps: number | null;
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
      const fpsGained = avgFpsNew - avgFpsCurrent;
      const costPerFps = netCost > 0 && fpsGained > 0 ? Math.round(netCost / fpsGained) : null;
      return { gpu, netCost, avgFpsCurrent, avgFpsNew, fpsGainPct, verdict, costPerFps };
    });
}

/** The candidate with the lowest $/FPS — the best-value pick, which isn't
 * always the one with the biggest raw FPS gain. Undefined when no
 * candidate has a computable costPerFps (see UpgradeCandidate.costPerFps). */
export function getBestValueCandidate(candidates: UpgradeCandidate[]): UpgradeCandidate | undefined {
  return candidates
    .filter((c): c is UpgradeCandidate & { costPerFps: number } => c.costPerFps !== null)
    .reduce<UpgradeCandidate | undefined>((best, c) => (!best || c.costPerFps! < best.costPerFps!) ? c : best, undefined);
}

export const upgradeCalculatorFaqs = [
  {
    title: 'How is the resale value calculated?',
    content: 'It\'s a flat 65% of the card\'s current listed price, rounded to a clean number — a rough estimate to plan around, not a live market quote. Actual used prices vary by condition, region, and demand, so treat it as a starting point, not gospel.',
  },
  {
    title: 'What counts as a "strong", "moderate", or "marginal" upgrade?',
    content: 'It\'s based on the average FPS gain across all 20 tracked games at 1440p High: 30%+ is a strong upgrade, 15-29% is moderate, and under 15% is marginal — worth knowing before spending money on a card that won\'t feel meaningfully faster.',
  },
  {
    title: 'Why does "Net Cost" matter more than the new card\'s price?',
    content: 'Net cost subtracts your current card\'s estimated resale value from the new card\'s price — it\'s what the upgrade actually costs you out of pocket if you sell your old GPU, which is usually the number that matters when deciding whether it\'s worth it.',
  },
];

export function upgradeCalculatorFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: upgradeCalculatorFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
