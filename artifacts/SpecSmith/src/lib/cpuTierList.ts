import cpuData from '../data/cpus.json';
import { fpsPer100, type MatchupCpu } from './matchups';

const cpus = cpuData as MatchupCpu[];

export type TierId = 'S' | 'A' | 'B' | 'C' | 'D';

export const TIER_INFO: Record<TierId, { label: string; blurb: string; color: string }> = {
  S: { label: 'S — Flagship',      blurb: 'The fastest gaming chips available. No compromises.',              color: '#FFB300' },
  A: { label: 'A — High-End',      blurb: 'Excellent for pairing with a flagship GPU — won\'t hold it back.',  color: '#6C63FF' },
  B: { label: 'B — Upper-Mid',     blurb: 'The sweet spot for most serious gaming builds.',                    color: '#00D4FF' },
  C: { label: 'C — Mainstream',    blurb: 'Reliable everyday gaming performance at a fair price.',              color: '#00E676' },
  D: { label: 'D — Entry-Level',   blurb: 'Budget or older chips. Fine for esports, limited elsewhere.',        color: '#8888AA' },
};

const TIER_ORDER: TierId[] = ['S', 'A', 'B', 'C', 'D'];

// CPU benchmark_score spans a narrower, differently-shaped range than GPUs
// (~90-310 vs GPUs' ~60-355, with CPUs clustering much more densely near
// the top) — these thresholds are calibrated against the actual dataset
// distribution, not reused from the GPU tier list.
function tierFor(score: number): TierId {
  if (score >= 270) return 'S';
  if (score >= 230) return 'A';
  if (score >= 195) return 'B';
  if (score >= 150) return 'C';
  return 'D';
}

export interface TierCpu {
  cpu: MatchupCpu;
  valuePer100: number;
  isBestValueInTier: boolean;
}

export interface Tier {
  id: TierId;
  label: string;
  blurb: string;
  color: string;
  cpus: TierCpu[];
}

/**
 * Same approach as the GPU tier list: tiers are assigned purely by raw
 * benchmark score, independent of price. Value — FPS per $100 — is
 * calculated separately and the best-value chip in each tier is flagged.
 */
export function getCpuTiers(): Tier[] {
  const withValue = cpus.map(cpu => ({
    cpu,
    valuePer100: fpsPer100(cpu.benchmark_score, cpu.price_usd),
  }));

  return TIER_ORDER.map(id => {
    const members = withValue
      .filter(c => tierFor(c.cpu.benchmark_score) === id)
      .sort((a, b) => b.cpu.price_usd - a.cpu.price_usd);
    const bestValueId = members.length
      ? members.reduce((best, c) => (c.valuePer100 > best.valuePer100 ? c : best), members[0]).cpu.id
      : null;
    return {
      id,
      label: TIER_INFO[id].label,
      blurb: TIER_INFO[id].blurb,
      color: TIER_INFO[id].color,
      cpus: members.map(c => ({ ...c, isBestValueInTier: c.cpu.id === bestValueId })),
    };
  });
}
