import { getUpgradeGpu, getUpgradeComparisons, averageFps, type UpgradeGpu } from './upgradeCalculator';
import type { RouteMeta } from './seo';

export interface UpgradePage {
  slug: string;
  gpuId: string;
}

// "What should you upgrade your <GPU> to?" SEO landing pages at
// /upgrade/<slug> — one per GPU we track. Slugs are indexed URLs, kept
// stable once published, same convention as MATCHUPS/GAME_PAGES.
export const UPGRADE_PAGES: UpgradePage[] = [
  { slug: 'rtx-5090', gpuId: 'rtx5090' },
  { slug: 'rtx-5080', gpuId: 'rtx5080' },
  { slug: 'rtx-5070-ti', gpuId: 'rtx5070ti' },
  { slug: 'rtx-5070', gpuId: 'rtx5070' },
  { slug: 'rtx-5060-ti', gpuId: 'rtx5060ti' },
  { slug: 'rtx-5060', gpuId: 'rtx5060' },
  { slug: 'rtx-5050', gpuId: 'rtx5050' },
  { slug: 'rtx-4090', gpuId: 'rtx4090' },
  { slug: 'rtx-4080-super', gpuId: 'rtx4080s' },
  { slug: 'rtx-4080', gpuId: 'rtx4080' },
  { slug: 'rtx-4070-ti-super', gpuId: 'rtx4070tis' },
  { slug: 'rtx-4070-ti', gpuId: 'rtx4070ti' },
  { slug: 'rtx-4070-super', gpuId: 'rtx4070s' },
  { slug: 'rtx-4070', gpuId: 'rtx4070' },
  { slug: 'rtx-4060-ti-16gb', gpuId: 'rtx4060ti16' },
  { slug: 'rtx-4060-ti', gpuId: 'rtx4060ti' },
  { slug: 'rtx-4060', gpuId: 'rtx4060' },
  { slug: 'rtx-4050', gpuId: 'rtx4050' },
  { slug: 'rtx-3090-ti', gpuId: 'rtx3090ti' },
  { slug: 'rtx-3090', gpuId: 'rtx3090' },
  { slug: 'rtx-3080-ti', gpuId: 'rtx3080ti' },
  { slug: 'rtx-3080-12gb', gpuId: 'rtx308012' },
  { slug: 'rtx-3080', gpuId: 'rtx3080' },
  { slug: 'rtx-3070-ti', gpuId: 'rtx3070ti' },
  { slug: 'rtx-3070', gpuId: 'rtx3070' },
  { slug: 'rtx-3060-ti', gpuId: 'rtx3060ti' },
  { slug: 'rtx-3060', gpuId: 'rtx3060' },
  { slug: 'rtx-3050', gpuId: 'rtx3050' },
  { slug: 'rx-9070-xt', gpuId: 'rx9070xt' },
  { slug: 'rx-9070', gpuId: 'rx9070' },
  { slug: 'rx-9060-xt', gpuId: 'rx9060xt16' },
  { slug: 'rx-9060-xt-8gb', gpuId: 'rx9060xt8' },
  { slug: 'rx-7900-xtx', gpuId: 'rx7900xtx' },
  { slug: 'rx-7900-xt', gpuId: 'rx7900xt' },
  { slug: 'rx-7900-gre', gpuId: 'rx7900gre' },
  { slug: 'rx-7800-xt', gpuId: 'rx7800xt' },
  { slug: 'rx-7700-xt', gpuId: 'rx7700xt' },
  { slug: 'rx-7600-xt', gpuId: 'rx7600xt' },
  { slug: 'rx-7600', gpuId: 'rx7600' },
  { slug: 'rx-6950-xt', gpuId: 'rx6950xt' },
  { slug: 'rx-6900-xt', gpuId: 'rx6900xt' },
  { slug: 'rx-6800-xt', gpuId: 'rx6800xt' },
  { slug: 'rx-6800', gpuId: 'rx6800' },
  { slug: 'rx-6750-xt', gpuId: 'rx6750xt' },
  { slug: 'rx-6700-xt', gpuId: 'rx6700xt' },
  { slug: 'rx-6700', gpuId: 'rx6700' },
  { slug: 'rx-6650-xt', gpuId: 'rx6650xt' },
  { slug: 'rx-6600-xt', gpuId: 'rx6600xt' },
  { slug: 'rx-6600', gpuId: 'rx6600' },
  { slug: 'rx-6500-xt', gpuId: 'rx6500xt' },
  { slug: 'rx-6400', gpuId: 'rx6400' },
  { slug: 'arc-a770-16gb', gpuId: 'arca770-16' },
  { slug: 'arc-a770-8gb', gpuId: 'arca770-8' },
  { slug: 'arc-a750', gpuId: 'arca750' },
  { slug: 'arc-a580', gpuId: 'arca580' },
  { slug: 'arc-b570', gpuId: 'arcb570' },
  { slug: 'arc-b580', gpuId: 'arcb580' },
];

export function getUpgradePage(slug: string): UpgradePage | undefined {
  return UPGRADE_PAGES.find(p => p.slug === slug);
}

/**
 * Intro paragraph — derived from the same computed figures the page shows.
 *
 * It used to open "The best upgrade in our data is the X", where X was
 * `getUpgradeCandidates(id, 1)[0]` — the CHEAPEST card one tier up, which for
 * an RX 6600 is a +3% step the page's own badge called marginal. It named a
 * best, it named it on price, and it was wrong on both counts. The page makes
 * no recommendation now, so neither does its first sentence.
 */
export function getUpgradeIntro(gpu: UpgradeGpu): string {
  const comparisons = getUpgradeComparisons(gpu.id);
  if (comparisons.length === 0) {
    return `No GPU SpecSmith tracks produces a higher modelled average than the ${gpu.name}. The figures below are model estimates, not benchmark results.`;
  }
  const top = comparisons[0];
  return `SpecSmith models ${comparisons.length} tracked GPU${comparisons.length === 1 ? '' : 's'} as faster than the ${gpu.name}, from about +${comparisons[comparisons.length - 1].fpsDiffPct}% up to about +${top.fpsDiffPct}% average FPS. Those are estimates from SpecSmith's model rather than benchmark results, and this page carries no prices — check a retailer for current pricing before buying anything.`;
}

/** Other upgrade pages to cross-link — nearby tiers first, same as the
 * matchup/game pages' "related" pickers. */
export function getRelatedUpgradePages(page: UpgradePage, limit = 4): UpgradePage[] {
  const gpu = getUpgradeGpu(page.gpuId);
  const others = UPGRADE_PAGES.filter(p => p.slug !== page.slug);
  if (!gpu) return others.slice(0, limit);
  return others
    .map(p => ({ page: p, gpu: getUpgradeGpu(p.gpuId) }))
    .filter((x): x is { page: UpgradePage; gpu: UpgradeGpu } => !!x.gpu)
    .sort((a, b) => Math.abs(a.gpu.tier - gpu.tier) - Math.abs(b.gpu.tier - gpu.tier))
    .slice(0, limit)
    .map(x => x.page);
}

export function getUpgradePageMeta(page: UpgradePage): RouteMeta {
  const gpu = getUpgradeGpu(page.gpuId);
  const name = gpu?.name ?? page.gpuId;
  return {
    path: `/upgrade/${page.slug}`,
    title: `${name} Upgrade Guide | SpecSmith`,
    // Describes what the page contains. The previous copy promised a resale
    // value and a net cost, both of which the page no longer computes.
    description: `Every GPU SpecSmith models as faster than the ${name}, ordered by estimated FPS difference across 20 games at 1440p High. Model estimates, not benchmark results.`,
  };
}

export { averageFps };
