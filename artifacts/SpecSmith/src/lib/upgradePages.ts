import { getUpgradeGpu, getUpgradeCandidates, estimateResaleValue, averageFps, type UpgradeGpu } from './upgradeCalculator';
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

/** Intro paragraph — entirely derived from the same computed numbers the
 * page's stat cards show, never a hand-written claim about a specific card. */
export function getUpgradeIntro(gpu: UpgradeGpu): string {
  const resale = estimateResaleValue(gpu.price_usd);
  const candidates = getUpgradeCandidates(gpu.id, 1);
  if (candidates.length === 0) {
    return `The ${gpu.name} is the fastest card we track — there's nothing meaningfully faster to upgrade to right now. If you ever do sell it, expect roughly $${resale.toLocaleString()} on the used market.`;
  }
  const top = candidates[0];
  const verdictPhrase = top.verdict === 'strong' ? 'a big jump' : top.verdict === 'moderate' ? 'a solid step up' : 'a modest gain';
  return `If you're running a ${gpu.name}, it's currently worth an estimated $${resale.toLocaleString()} used. The best upgrade in our data is the ${top.gpu.name} — ${verdictPhrase} at about ${top.fpsGainPct >= 0 ? '+' : ''}${top.fpsGainPct}% average FPS for a net cost of roughly $${top.netCost.toLocaleString()} after reselling your old card.`;
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
    title: `What Should You Upgrade Your ${name} To? — Trade-Up Guide | SpecSmith`,
    description: `Thinking about upgrading from a ${name}? See its estimated resale value, real upgrade options ranked by FPS gain, and the actual net cost after trading up.`,
  };
}

export { averageFps };
