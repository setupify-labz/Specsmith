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

export const gpuTierListFaqs = [
  {
    title: 'How are tiers assigned — is price a factor?',
    content: 'No — tiers are based purely on raw benchmark score (S is 245+, A is 195-244, B is 150-194, C is 110-149, D is under 110), the same "if money were no object" ranking a classic tier list uses. Price is deliberately kept separate so the ranking answers "how fast is it," not "is it worth it."',
  },
  {
    title: 'What does the 💰 icon mean?',
    content: 'It marks the best-value card within that specific tier — the one with the highest FPS-per-$100 among cards that landed in the same performance tier. It\'s not necessarily the cheapest card in the tier, just the one giving you the most performance for your money once you\'ve already decided that tier\'s performance level is what you want.',
  },
  {
    title: 'Why is a card in tier B sometimes more expensive than one in tier A?',
    content: 'Pricing and performance don\'t move in lockstep — an older or less efficient architecture can cost more than a newer card that outperforms it, which is exactly the kind of gap this tier list is built to expose. Check the Higher or Lower game or the GPU comparisons page for more of these head-to-head surprises.',
  },
];

export function gpuTierListFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: gpuTierListFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
