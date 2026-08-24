import { getUpgradeCpu, getCpuUpgradeCandidates, estimateCpuResaleValue, averageCpuFps, type UpgradeCpu } from './cpuUpgradeCalculator';
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
export function getCpuUpgradeIntro(cpu: UpgradeCpu): string {
  const resale = estimateCpuResaleValue(cpu.price_usd);
  const candidates = getCpuUpgradeCandidates(cpu.id, 1);
  if (candidates.length === 0) {
    return `The ${cpu.name} is the fastest CPU we track — there's nothing meaningfully faster to upgrade to right now. If you ever do sell it, expect roughly $${resale.toLocaleString()} on the used market.`;
  }
  const top = candidates[0];
  const verdictPhrase = top.verdict === 'strong' ? 'a big jump' : top.verdict === 'moderate' ? 'a solid step up' : 'a modest gain';
  return `If you're running a ${cpu.name}, it's currently worth an estimated $${resale.toLocaleString()} used. The best upgrade in our data is the ${top.cpu.name} — ${verdictPhrase} at about ${top.fpsGainPct >= 0 ? '+' : ''}${top.fpsGainPct}% average estimated FPS (paired with a high-end GPU so the model can better isolate the CPU's effect) for a net cost of roughly $${top.netCost.toLocaleString()} after reselling your old chip.`;
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
    title: `${name} Upgrade Guide | SpecSmith`,
    description: `Thinking about upgrading from a ${name}? See its resale value, upgrade options ranked by FPS gain, and the net cost after trading up.`,
  };
}

export { averageCpuFps };
