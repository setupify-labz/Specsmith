import gpuData from '../data/gpus.json';
import { fpsPer100, type MatchupGpu } from './matchups';

const gpus = gpuData as MatchupGpu[];

export type TierId = 'S' | 'A' | 'B' | 'C' | 'D';

export const TIER_INFO: Record<TierId, { label: string; blurb: string; color: string }> = {
  S: { label: 'S — Flagship',      blurb: 'The best money can buy. No compromises, no excuses.',            color: '#FFB300' },
  A: { label: 'A — High-End',      blurb: 'Excellent 1440p/4K performance for enthusiasts.',                 color: '#6C63FF' },
  B: { label: 'B — Upper-Mid',     blurb: 'The 1440p sweet spot for most serious gamers.',                   color: '#00D4FF' },
  C: { label: 'C — Mainstream',    blurb: 'Reliable 1080p performance at a fair price.',                     color: '#00E676' },
  D: { label: 'D — Entry-Level',   blurb: 'Budget or older cards. Fine for esports, limited elsewhere.',     color: '#8888AA' },
};

const TIER_ORDER: TierId[] = ['S', 'A', 'B', 'C', 'D'];

function tierFor(score: number): TierId {
  if (score >= 245) return 'S';
  if (score >= 195) return 'A';
  if (score >= 150) return 'B';
  if (score >= 110) return 'C';
  return 'D';
}

export interface TierGpu {
  gpu: MatchupGpu;
  valuePer100: number;
  isBestValueInTier: boolean;
}

export interface Tier {
  id: TierId;
  label: string;
  blurb: string;
  color: string;
  gpus: TierGpu[];
}

/**
 * Tiers are assigned purely by raw benchmark score (the classic "if money
 * were no object" tier-list ranking), independent of price. Value — FPS per
 * $100 — is calculated separately and the best-value card in each tier is
 * flagged, so a browsing user can see both "how fast" and "worth it" without
 * the two signals fighting each other.
 */
export function getGpuTiers(): Tier[] {
  const withValue = gpus.map(gpu => ({
    gpu,
    valuePer100: fpsPer100(gpu.benchmark_score, gpu.price_usd),
  }));

  return TIER_ORDER.map(id => {
    const members = withValue
      .filter(g => tierFor(g.gpu.benchmark_score) === id)
      .sort((a, b) => b.gpu.price_usd - a.gpu.price_usd);
    const bestValueId = members.length
      ? members.reduce((best, g) => (g.valuePer100 > best.valuePer100 ? g : best), members[0]).gpu.id
      : null;
    return {
      id,
      label: TIER_INFO[id].label,
      blurb: TIER_INFO[id].blurb,
      color: TIER_INFO[id].color,
      gpus: members.map(g => ({ ...g, isBestValueInTier: g.gpu.id === bestValueId })),
    };
  });
}
