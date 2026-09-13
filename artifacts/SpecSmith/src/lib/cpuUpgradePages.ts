import { getUpgradeCpu, getCpuUpgradeComparisons, averageCpuFps, type UpgradeCpu } from './cpuUpgradeCalculator';
import type { RouteMeta } from './seo';

export interface CpuUpgradePage {
  slug: string;
  cpuId: string;
}

// "What should you upgrade your <CPU> to?" SEO landing pages at
// /upgrade-cpu/<slug> — one per CPU we track, mirroring the GPU version.
// Slugs are indexed URLs, kept stable once published.
export const CPU_UPGRADE_PAGES: CpuUpgradePage[] = [
  { slug: 'core-ultra-9-285k', cpuId: 'cu9-285k' },
  { slug: 'core-ultra-7-265k', cpuId: 'cu7-265k' },
  { slug: 'core-ultra-5-245k', cpuId: 'cu5-245k' },
  { slug: 'i9-14900ks', cpuId: 'i9-14900ks' },
  { slug: 'i9-14900k', cpuId: 'i9-14900k' },
  { slug: 'i9-14900kf', cpuId: 'i9-14900kf' },
  { slug: 'i7-14700k', cpuId: 'i7-14700k' },
  { slug: 'i7-14700kf', cpuId: 'i7-14700kf' },
  { slug: 'i5-14600k', cpuId: 'i5-14600k' },
  { slug: 'i5-14600kf', cpuId: 'i5-14600kf' },
  { slug: 'i5-14500', cpuId: 'i5-14500' },
  { slug: 'i5-14400f', cpuId: 'i5-14400f' },
  { slug: 'i3-14100f', cpuId: 'i3-14100f' },
  { slug: 'i9-13900ks', cpuId: 'i9-13900ks' },
  { slug: 'i9-13900k', cpuId: 'i9-13900k' },
  { slug: 'i7-13700k', cpuId: 'i7-13700k' },
  { slug: 'i5-13600k', cpuId: 'i5-13600k' },
  { slug: 'i5-13400f', cpuId: 'i5-13400f' },
  { slug: 'i3-13100f', cpuId: 'i3-13100f' },
  { slug: 'i9-12900k', cpuId: 'i9-12900k' },
  { slug: 'i7-12700k', cpuId: 'i7-12700k' },
  { slug: 'i5-12600k', cpuId: 'i5-12600k' },
  { slug: 'i5-12400f', cpuId: 'i5-12400f' },
  { slug: 'ryzen-9-9950x3d', cpuId: 'r9-9950x3d' },
  { slug: 'ryzen-9-9900x3d', cpuId: 'r9-9900x3d' },
  { slug: 'ryzen-7-9800x3d', cpuId: 'r7-9800x3d' },
  { slug: 'ryzen-7-9850x3d', cpuId: 'r7-9850x3d' },
  { slug: 'ryzen-9-9950x', cpuId: 'r9-9950x' },
  { slug: 'ryzen-9-9900x', cpuId: 'r9-9900x' },
  { slug: 'ryzen-7-9700x', cpuId: 'r7-9700x' },
  { slug: 'ryzen-5-9600x', cpuId: 'r5-9600x' },
  { slug: 'ryzen-9-7950x3d', cpuId: 'r9-7950x3d' },
  { slug: 'ryzen-9-7950x', cpuId: 'r9-7950x' },
  { slug: 'ryzen-9-7900x3d', cpuId: 'r9-7900x3d' },
  { slug: 'ryzen-9-7900x', cpuId: 'r9-7900x' },
  { slug: 'ryzen-7-7800x3d', cpuId: 'r7-7800x3d' },
  { slug: 'ryzen-7-7700x', cpuId: 'r7-7700x' },
  { slug: 'ryzen-7-7700', cpuId: 'r7-7700' },
  { slug: 'ryzen-5-7600x', cpuId: 'r5-7600x' },
  { slug: 'ryzen-5-7600', cpuId: 'r5-7600' },
  { slug: 'ryzen-9-5950x', cpuId: 'r9-5950x' },
  { slug: 'ryzen-9-5900x', cpuId: 'r9-5900x' },
  { slug: 'ryzen-7-5800x3d', cpuId: 'r7-5800x3d' },
  { slug: 'ryzen-7-5800x', cpuId: 'r7-5800x' },
  { slug: 'ryzen-7-5700x', cpuId: 'r7-5700x' },
  { slug: 'ryzen-5-5600x', cpuId: 'r5-5600x' },
  { slug: 'ryzen-5-5600', cpuId: 'r5-5600' },
  { slug: 'ryzen-5-5500', cpuId: 'r5-5500' },
  { slug: 'ryzen-9-3900x', cpuId: 'r9-3900x' },
  { slug: 'ryzen-7-3700x', cpuId: 'r7-3700x' },
  { slug: 'ryzen-5-3600', cpuId: 'r5-3600' },
];

export function getCpuUpgradePage(slug: string): CpuUpgradePage | undefined {
  return CPU_UPGRADE_PAGES.find(p => p.slug === slug);
}

/** Intro paragraph — entirely derived from the same computed numbers the
 * page's stat cards show, never a hand-written claim about a specific chip. */
/**
 * Intro paragraph — derived from the same figures the page shows.
 *
 * It used to open "The best upgrade in our data is the X", where X was
 * `getCpuUpgradeCandidates(id, 1)[0]` — the CHEAPEST chip one tier up. It
 * named a best, it named it on an editorial price, and it quoted a resale
 * figure that is a flat percentage of another editorial price. The page makes
 * no recommendation now, so neither does its first sentence.
 */
export function getCpuUpgradeIntro(cpu: UpgradeCpu): string {
  const comparisons = getCpuUpgradeComparisons(cpu.id);
  if (comparisons.length === 0) {
    return `No CPU SpecSmith tracks produces a higher modelled average than the ${cpu.name}. The figures below are model estimates, not benchmark results.`;
  }
  const top = comparisons[0];
  const closest = comparisons[comparisons.length - 1];
  return `SpecSmith models ${comparisons.length} tracked CPU${comparisons.length === 1 ? '' : 's'} as faster than the ${cpu.name}, from about +${closest.fpsDiffPct}% up to about +${top.fpsDiffPct}% average FPS when each is paired with the same reference GPU. Those are estimates from SpecSmith's model rather than benchmark results, and this page carries no prices — check a retailer for current pricing before buying anything.`;
}

/** Other upgrade pages to cross-link — nearby tiers first. */
export function getRelatedCpuUpgradePages(page: CpuUpgradePage, limit = 4): CpuUpgradePage[] {
  const cpu = getUpgradeCpu(page.cpuId);
  const others = CPU_UPGRADE_PAGES.filter(p => p.slug !== page.slug);
  if (!cpu) return others.slice(0, limit);
  return others
    .map(p => ({ page: p, cpu: getUpgradeCpu(p.cpuId) }))
    .filter((x): x is { page: CpuUpgradePage; cpu: UpgradeCpu } => !!x.cpu)
    .sort((a, b) => Math.abs(a.cpu.tier - cpu.tier) - Math.abs(b.cpu.tier - cpu.tier))
    .slice(0, limit)
    .map(x => x.page);
}

export function getCpuUpgradePageMeta(page: CpuUpgradePage): RouteMeta {
  const cpu = getUpgradeCpu(page.cpuId);
  const name = cpu?.name ?? page.cpuId;
  return {
    path: `/upgrade-cpu/${page.slug}`,
    // "Comparisons", not "Guide": the page compares and does not advise.
    title: `${name} Upgrade Comparisons | SpecSmith`,
    // The previous copy promised a resale value and a net cost the page no
    // longer computes.
    description: `Every CPU SpecSmith models as faster than the ${name}, ordered by estimated FPS difference across 20 games at 1440p High. Model estimates, not benchmark results.`,
  };
}

export { averageCpuFps };
