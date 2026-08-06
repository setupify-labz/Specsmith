import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import type { RouteMeta } from './seo';
import { SITE_URL } from './seo';

export interface BudgetPart {
  id: string;
  name: string;
  brand: string;
  price_usd: number;
  benchmark_score: number;
  [key: string]: unknown;
}

export interface BudgetTier {
  slug: string;
  maxPrice: number;
  label: string;
}

export const GPU_BUDGET_TIERS: BudgetTier[] = [
  { slug: 'under-200', maxPrice: 200, label: 'Under $200' },
  { slug: 'under-300', maxPrice: 300, label: 'Under $300' },
  { slug: 'under-500', maxPrice: 500, label: 'Under $500' },
  { slug: 'under-800', maxPrice: 800, label: 'Under $800' },
  { slug: 'under-1500', maxPrice: 1500, label: 'Under $1,500' },
];

export const CPU_BUDGET_TIERS: BudgetTier[] = [
  { slug: 'under-150', maxPrice: 150, label: 'Under $150' },
  { slug: 'under-250', maxPrice: 250, label: 'Under $250' },
  { slug: 'under-400', maxPrice: 400, label: 'Under $400' },
  { slug: 'under-600', maxPrice: 600, label: 'Under $600' },
  { slug: 'under-1000', maxPrice: 1000, label: 'Under $1,000' },
];

function partsFor(category: 'gpu' | 'cpu'): BudgetPart[] {
  return (category === 'gpu' ? gpuData : cpuData) as BudgetPart[];
}

export function getBudgetTier(category: 'gpu' | 'cpu', slug: string): BudgetTier | undefined {
  return (category === 'gpu' ? GPU_BUDGET_TIERS : CPU_BUDGET_TIERS).find(t => t.slug === slug);
}

// Highest benchmark score first — the natural "best you can get for this
// money" ordering, same ranking basis as the Tier List pages.
export function getPartsUnderBudget(category: 'gpu' | 'cpu', maxPrice: number): BudgetPart[] {
  return partsFor(category)
    .filter(p => p.price_usd <= maxPrice)
    .sort((a, b) => b.benchmark_score - a.benchmark_score);
}

export interface BudgetPick {
  emoji: string;
  label: string;
  part: BudgetPart;
  detail: string;
}

export function getBudgetPicks(category: 'gpu' | 'cpu', tier: BudgetTier): BudgetPick[] {
  const parts = getPartsUnderBudget(category, tier.maxPrice);
  if (parts.length === 0) return [];

  const kind = category === 'gpu' ? 'GPU' : 'CPU';
  const picks: BudgetPick[] = [];
  const best = parts[0];
  picks.push({
    emoji: '🏆', label: 'Best Performance', part: best,
    detail: `The strongest ${kind} we track ${tier.label.toLowerCase()}, at $${best.price_usd}.`,
  });

  const byValue = [...parts].sort((a, b) => (b.benchmark_score / b.price_usd) - (a.benchmark_score / a.price_usd));
  const value = byValue[0];
  if (value.id !== best.id) {
    picks.push({
      emoji: '⚖️', label: 'Best Value', part: value,
      detail: `The most benchmark performance per dollar ${tier.label.toLowerCase()} — $${value.price_usd} for a score of ${value.benchmark_score}.`,
    });
  }

  const cheapest = [...parts].sort((a, b) => a.price_usd - b.price_usd)[0];
  if (cheapest.id !== best.id && cheapest.id !== value.id) {
    picks.push({
      emoji: '💰', label: 'Cheapest Option', part: cheapest,
      detail: `The least expensive ${kind} we track that still fits ${tier.label.toLowerCase()}, at $${cheapest.price_usd}.`,
    });
  }

  return picks;
}

export function getBudgetPageMeta(category: 'gpu' | 'cpu', tier: BudgetTier): RouteMeta {
  const kind = category === 'gpu' ? 'GPU' : 'CPU';
  const base = category === 'gpu' ? '/best-gpu-budget' : '/best-cpu-budget';
  return {
    path: `${base}/${tier.slug}`,
    title: `Best ${kind} ${tier.label} | SpecSmith`,
    description: `Every ${kind} we track priced ${tier.label.toLowerCase()}, ranked by benchmark performance — with the best-value and cheapest picks flagged.`,
  };
}

export function budgetItemListJsonLd(category: 'gpu' | 'cpu', tier: BudgetTier, parts: BudgetPart[]) {
  const kind = category === 'gpu' ? 'GPU' : 'CPU';
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Best ${kind} ${tier.label}`,
    itemListElement: parts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: `${SITE_URL}/builder?${category}=${p.id}`,
    })),
  };
}
