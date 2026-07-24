import componentData from '../data/components.json';
import type { RouteMeta } from './seo';

export interface GuideItem {
  id: string;
  name: string;
  brand: string;
  price_usd: number;
  [key: string]: unknown;
}

export interface GuidePick {
  emoji: string;
  label: string;
  item: GuideItem;
  detail: string;
}

export interface GuideColumn {
  key: string;
  label: string;
  format?: (v: unknown) => string;
}

export type GuideCategory = 'ram' | 'storage' | 'psu' | 'case' | 'cooler';

export interface ComponentGuide {
  slug: string;
  category: GuideCategory;
  categoryLabel: string;
  title: string;
  blurb: string;
  items: GuideItem[];
  picks: GuidePick[];
  columns: GuideColumn[];
}

const ram = componentData.ram as (GuideItem & { type: string; capacity_gb: number; speed_mhz: number })[];
const storage = componentData.storage as (GuideItem & { type: string; capacity_tb: number; speed_mbs: number })[];
const psus = componentData.psus as (GuideItem & { wattage: number; rating: string })[];
const cases = componentData.cases as (GuideItem & { form_factor: string })[];
const coolers = componentData.coolers as (GuideItem & { type: string })[];

function cheapest<T extends GuideItem>(items: T[]): T {
  return items.reduce((min, i) => (i.price_usd < min.price_usd ? i : min), items[0]);
}
function priciest<T extends GuideItem>(items: T[]): T {
  return items.reduce((max, i) => (i.price_usd > max.price_usd ? i : max), items[0]);
}

const ddr5 = ram.filter(r => r.type === 'DDR5');
const ddr4 = ram.filter(r => r.type === 'DDR4');
const ramBudget = cheapest(ram);
const ramDdr5Pick = ddr5.length > 0 ? cheapest(ddr5) : ram[0];
const ramPremium = priciest(ram);

const storageBudget = cheapest(storage);
const nvme = storage.filter(s => s.type.startsWith('NVMe'));
const storageFastest = nvme.length > 0 ? nvme.reduce((max, s) => (s.speed_mbs > max.speed_mbs ? s : max), nvme[0]) : priciest(storage);

const psuSorted = [...psus].sort((a, b) => a.wattage - b.wattage);
const psuBudget = psuSorted[0];
const psuMid = psuSorted[Math.floor(psuSorted.length / 2)];
const psuHigh = psuSorted[psuSorted.length - 1];

const casesSorted = [...cases].sort((a, b) => a.price_usd - b.price_usd);
const caseBudget = casesSorted[0];
const caseMid = casesSorted[Math.floor(casesSorted.length / 2)];
const casePremium = casesSorted[casesSorted.length - 1];

const airCoolers = coolers.filter(c => c.type === 'Air');
const aioCoolers = coolers.filter(c => c.type.includes('AIO'));
const coolerAirBudget = airCoolers.length > 0 ? cheapest(airCoolers) : cheapest(coolers);
const coolerAioBudget = aioCoolers.length > 0 ? cheapest(aioCoolers) : priciest(coolers);
const coolerAioPremium = aioCoolers.length > 0 ? priciest(aioCoolers) : priciest(coolers);

export const COMPONENT_GUIDES: ComponentGuide[] = [
  {
    slug: 'ram', category: 'ram', categoryLabel: 'RAM',
    title: 'Best RAM for Gaming',
    blurb: 'DDR5 is the current standard for AM5 and LGA1851 builds; DDR4 remains the right (and cheaper) choice for AM4 and older LGA1700 boards. Check your motherboard’s supported type before buying — the two are not interchangeable.',
    items: ram,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: ramBudget, detail: `The least expensive kit we track at $${ramBudget.price_usd} — ${ramBudget.capacity_gb}GB ${ramBudget.type}-${ramBudget.speed_mhz}.` },
      { emoji: '⚡', label: 'DDR5 Pick', item: ramDdr5Pick, detail: `Cheapest DDR5 kit at $${ramDdr5Pick.price_usd} — ${ramDdr5Pick.capacity_gb}GB at ${ramDdr5Pick.speed_mhz}MHz.` },
      { emoji: '👑', label: 'High-End Pick', item: ramPremium, detail: `The top kit we track at $${ramPremium.price_usd} — ${ramPremium.capacity_gb}GB ${ramPremium.type}-${ramPremium.speed_mhz}.` },
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'capacity_gb', label: 'Capacity', format: v => `${v}GB` },
      { key: 'speed_mhz', label: 'Speed', format: v => `${v}MHz` },
    ],
  },
  {
    slug: 'storage', category: 'storage', categoryLabel: 'Storage',
    title: 'Best Storage for Gaming',
    blurb: 'NVMe Gen4 is the sweet spot for gaming right now — Gen5 drives are faster on paper but rarely translate to noticeably faster load times in actual games. SATA SSDs and HDDs are fine for bulk storage of a large game library.',
    items: storage,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: storageBudget, detail: `The least expensive drive we track at $${storageBudget.price_usd} — ${storageBudget.capacity_tb}TB ${storageBudget.type}.` },
      { emoji: '⚡', label: 'Fastest Pick', item: storageFastest, detail: `${storageFastest.speed_mbs.toLocaleString()} MB/s — the quickest drive we track, for the shortest load times.` },
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'capacity_tb', label: 'Capacity', format: v => `${v}TB` },
      { key: 'speed_mbs', label: 'Speed', format: v => `${(v as number).toLocaleString()} MB/s` },
    ],
  },
  {
    slug: 'psu', category: 'psu', categoryLabel: 'PSU',
    title: 'Best Power Supply for Gaming',
    blurb: 'Buy based on what your GPU + CPU actually need, not the biggest number on the shelf — the Builder’s compatibility check tells you the minimum wattage for your exact parts. More headroom means quieter, cooler, more efficient operation, but paying for far more than you’ll use is just wasted money.',
    items: psus,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: psuBudget, detail: `${psuBudget.wattage}W at $${psuBudget.price_usd} — fine for budget/mid builds without a flagship GPU.` },
      { emoji: '⚖️', label: 'Sweet Spot', item: psuMid, detail: `${psuMid.wattage}W at $${psuMid.price_usd} — covers most mid-to-high-end single-GPU builds with headroom.` },
      { emoji: '👑', label: 'High-End Pick', item: psuHigh, detail: `${psuHigh.wattage}W at $${psuHigh.price_usd} — for flagship GPU + overclocked CPU builds.` },
    ],
    columns: [
      { key: 'wattage', label: 'Wattage', format: v => `${v}W` },
      { key: 'rating', label: 'Efficiency' },
    ],
  },
  {
    slug: 'case', category: 'case', categoryLabel: 'Case',
    title: 'Best PC Case for Gaming',
    blurb: 'Case choice is mostly about fit and airflow, not performance — check GPU and cooler clearance against your other parts before buying (the Builder’s compatibility check does this automatically).',
    items: cases,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: caseBudget, detail: `The least expensive case we track at $${caseBudget.price_usd} — ${caseBudget.form_factor}.` },
      { emoji: '⚖️', label: 'Sweet Spot', item: caseMid, detail: `Middle of the price range at $${caseMid.price_usd} — a ${caseMid.form_factor} case with solid airflow.` },
      { emoji: '👑', label: 'High-End Pick', item: casePremium, detail: `The top case we track at $${casePremium.price_usd} — ${casePremium.form_factor}.` },
    ],
    columns: [
      { key: 'form_factor', label: 'Form Factor' },
      { key: 'gpu_clearance_mm', label: 'GPU Clearance', format: v => v ? `${v}mm` : '—' },
    ],
  },
  {
    slug: 'cooler', category: 'cooler', categoryLabel: 'CPU Cooler',
    title: 'Best CPU Cooler for Gaming',
    blurb: 'A good air cooler handles the vast majority of gaming CPUs fine and is simpler, cheaper, and more reliable than liquid cooling. AIOs mainly earn their price on high-TDP flagship chips or in cases where a tall air cooler won’t fit.',
    items: coolers,
    picks: [
      { emoji: '💨', label: 'Best Air Cooler', item: coolerAirBudget, detail: `$${coolerAirBudget.price_usd} — rated for up to ${coolerAirBudget.max_tdp_watts}W.` },
      { emoji: '💧', label: 'Budget AIO', item: coolerAioBudget, detail: `$${coolerAioBudget.price_usd} — ${coolerAioBudget.type}, rated for up to ${coolerAioBudget.max_tdp_watts}W.` },
      { emoji: '👑', label: 'High-End AIO', item: coolerAioPremium, detail: `$${coolerAioPremium.price_usd} — ${coolerAioPremium.type}, rated for up to ${coolerAioPremium.max_tdp_watts}W.` },
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'max_tdp_watts', label: 'Max TDP', format: v => v ? `${v}W` : '—' },
    ],
  },
];

export function getComponentGuide(slug: string): ComponentGuide | undefined {
  return COMPONENT_GUIDES.find(g => g.slug === slug);
}

export function getComponentGuideMeta(guide: ComponentGuide): RouteMeta {
  return {
    path: `/best-${guide.slug}`,
    title: `${guide.title} (2026) | SpecSmith`,
    description: `Every ${guide.categoryLabel.toLowerCase()} we track, compared by price and specs — with budget and high-end picks for your gaming PC build.`,
  };
}
