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

export const cpuTierListFaqs = [
  {
    title: 'How are tiers assigned — is price a factor?',
    content: 'No — tiers are based purely on raw gaming benchmark score (S is 270+, A is 230-269, B is 195-229, C is 150-194, D is under 150), independent of price. The thresholds are calibrated to how CPU scores actually cluster in the dataset, not copy-pasted from the GPU tier list — CPUs bunch up much more densely near the top than GPUs do.',
  },
  {
    title: 'What does the 💰 icon mean?',
    content: 'It marks the best-value chip within that specific tier — the one with the highest FPS-per-$100 among CPUs that landed in the same performance tier, not necessarily the cheapest one overall.',
  },
  {
    title: 'My CPU is tier A — will it bottleneck a flagship (S-tier) GPU?',
    content: 'Not meaningfully in most games — tier A chips are built to keep pace with high-end GPUs. If you want to check a specific CPU/GPU pairing directly, load both into the Builder and its compatibility/bottleneck checker will flag it if there\'s a real mismatch.',
  },
];

export function cpuTierListFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: cpuTierListFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
