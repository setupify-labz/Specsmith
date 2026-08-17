import componentData from '../data/components.json';
import peripheralData from '../data/peripherals.json';
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

export type GuideCategory = 'ram' | 'storage' | 'psu' | 'case' | 'cooler' | 'monitor' | 'keyboard' | 'mouse' | 'headset';

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

// Enriched with a computed $/unit field so the comparison table can show
// it as a normal column and a "Best $/unit" pick can reference the exact
// same number — capacity-per-dollar is the standard way RAM/storage
// shoppers actually compare kits, unlike the other guide categories here
// which don't have a clean continuous spec to divide price by.
const ramEnriched = ram.map(r => ({ ...r, cost_per_gb: Math.round((r.price_usd / r.capacity_gb) * 100) / 100 }));
const storageEnriched = storage.map(s => ({ ...s, cost_per_tb: Math.round((s.price_usd / s.capacity_tb) * 100) / 100 }));

const ddr5 = ramEnriched.filter(r => r.type === 'DDR5');
const ddr4 = ramEnriched.filter(r => r.type === 'DDR4');
const ramBudget = cheapest(ramEnriched);
const ramDdr5Pick = ddr5.length > 0 ? cheapest(ddr5) : ramEnriched[0];
const ramPremium = priciest(ramEnriched);
const ramBestValue = ramEnriched.reduce((best, r) => (r.cost_per_gb < best.cost_per_gb ? r : best), ramEnriched[0]);

const storageBudget = cheapest(storageEnriched);
const nvme = storageEnriched.filter(s => s.type.startsWith('NVMe'));
const storageFastest = nvme.length > 0 ? nvme.reduce((max, s) => (s.speed_mbs > max.speed_mbs ? s : max), nvme[0]) : priciest(storageEnriched);
const storageBestValue = storageEnriched.reduce((best, s) => (s.cost_per_tb < best.cost_per_tb ? s : best), storageEnriched[0]);

const psuSorted = [...psus].sort((a, b) => a.wattage - b.wattage);
const psuBudget = psuSorted[0];
const psuMid = psuSorted[Math.floor(psuSorted.length / 2)];
const psuHigh = psuSorted[psuSorted.length - 1];

const casesSorted = [...cases].sort((a, b) => a.price_usd - b.price_usd);
const caseBudget = casesSorted[0];
const caseMid = casesSorted[Math.floor(casesSorted.length / 2)];
const casePremium = casesSorted[casesSorted.length - 1];

const monitors = peripheralData.monitors as (GuideItem & { size_inches: number; resolution: string; refresh_rate_hz: number; panel_type: string })[];
const keyboards = peripheralData.keyboards as (GuideItem & { switch_type: string; form_factor: string; wireless: boolean })[];
const mice = peripheralData.mice as (GuideItem & { dpi_max: number; weight_grams: number; wireless: boolean })[];
const headsets = peripheralData.headsets as (GuideItem & { wireless: boolean; noise_cancelling: boolean; surround_sound: string })[];

const monitorBudget = cheapest(monitors);
const monitorFastest = monitors.reduce((max, m) => (m.refresh_rate_hz > max.refresh_rate_hz ? m : max), monitors[0]);
const fourK = monitors.filter(m => m.resolution === '4K');
const monitor4k = fourK.length > 0 ? cheapest(fourK) : priciest(monitors);

const keyboardBudget = cheapest(keyboards);
const wirelessKeyboards = keyboards.filter(k => k.wireless);
const keyboardWireless = wirelessKeyboards.length > 0 ? cheapest(wirelessKeyboards) : priciest(keyboards);

const mouseBudget = cheapest(mice);
const mouseLight = mice.reduce((min, m) => (m.weight_grams < min.weight_grams ? m : min), mice[0]);
const mousePremium = priciest(mice);

const headsetBudget = cheapest(headsets);
const wirelessHeadsets = headsets.filter(h => h.wireless);
const headsetWireless = wirelessHeadsets.length > 0 ? cheapest(wirelessHeadsets) : priciest(headsets);
const headsetPremium = priciest(headsets);

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
    items: ramEnriched,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: ramBudget, detail: `The least expensive kit we track at $${ramBudget.price_usd} — ${ramBudget.capacity_gb}GB ${ramBudget.type}-${ramBudget.speed_mhz}.` },
      { emoji: '⚡', label: 'DDR5 Pick', item: ramDdr5Pick, detail: `Cheapest DDR5 kit at $${ramDdr5Pick.price_usd} — ${ramDdr5Pick.capacity_gb}GB at ${ramDdr5Pick.speed_mhz}MHz.` },
      { emoji: '👑', label: 'High-End Pick', item: ramPremium, detail: `The top kit we track at $${ramPremium.price_usd} — ${ramPremium.capacity_gb}GB ${ramPremium.type}-${ramPremium.speed_mhz}.` },
      ...(ramBestValue.id !== ramBudget.id && ramBestValue.id !== ramDdr5Pick.id && ramBestValue.id !== ramPremium.id ? [{
        emoji: '💵', label: 'Best $/GB', item: ramBestValue,
        detail: `$${ramBestValue.cost_per_gb.toFixed(2)}/GB — the most capacity per dollar, ${ramBestValue.capacity_gb}GB ${ramBestValue.type}-${ramBestValue.speed_mhz} for $${ramBestValue.price_usd}. Still check your motherboard supports this type.`,
      }] : []),
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'capacity_gb', label: 'Capacity', format: v => `${v}GB` },
      { key: 'speed_mhz', label: 'Speed', format: v => `${v}MHz` },
      { key: 'cost_per_gb', label: '$/GB', format: v => `$${(v as number).toFixed(2)}` },
    ],
  },
  {
    slug: 'storage', category: 'storage', categoryLabel: 'Storage',
    title: 'Best Storage for Gaming',
    blurb: 'NVMe Gen4 is the sweet spot for gaming right now — Gen5 drives are faster on paper but rarely translate to noticeably faster load times in actual games. SATA SSDs and HDDs are fine for bulk storage of a large game library.',
    items: storageEnriched,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: storageBudget, detail: `The least expensive drive we track at $${storageBudget.price_usd} — ${storageBudget.capacity_tb}TB ${storageBudget.type}.` },
      { emoji: '⚡', label: 'Fastest Pick', item: storageFastest, detail: `${storageFastest.speed_mbs.toLocaleString()} MB/s — the quickest drive we track, for the shortest load times.` },
      ...(storageBestValue.id !== storageBudget.id && storageBestValue.id !== storageFastest.id ? [{
        emoji: '💵', label: 'Best $/TB', item: storageBestValue,
        detail: `$${storageBestValue.cost_per_tb.toFixed(2)}/TB — the most capacity per dollar, ${storageBestValue.capacity_tb}TB ${storageBestValue.type} for $${storageBestValue.price_usd}. Cheapest-per-TB storage tends to be HDD — slower than SSD/NVMe, but fine for bulk game library storage.`,
      }] : []),
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'capacity_tb', label: 'Capacity', format: v => `${v}TB` },
      { key: 'speed_mbs', label: 'Speed', format: v => `${(v as number).toLocaleString()} MB/s` },
      { key: 'cost_per_tb', label: '$/TB', format: v => `$${(v as number).toFixed(2)}` },
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
  {
    slug: 'monitor', category: 'monitor', categoryLabel: 'Monitor',
    title: 'Best Gaming Monitor',
    blurb: 'Match your monitor to your GPU, not the other way around — a 240Hz+ panel is wasted if your card can’t push those frame rates, and a 4K screen needs serious GPU horsepower to actually run games at native resolution.',
    items: monitors,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: monitorBudget, detail: `$${monitorBudget.price_usd} — ${monitorBudget.size_inches}" ${monitorBudget.resolution} at ${monitorBudget.refresh_rate_hz}Hz.` },
      { emoji: '⚡', label: 'Highest Refresh', item: monitorFastest, detail: `${monitorFastest.refresh_rate_hz}Hz — the fastest panel we track, for competitive/esports titles.` },
      { emoji: '🖥️', label: '4K Pick', item: monitor4k, detail: `$${monitor4k.price_usd} — ${monitor4k.size_inches}" ${monitor4k.resolution} at ${monitor4k.refresh_rate_hz}Hz.` },
    ],
    columns: [
      { key: 'resolution', label: 'Resolution' },
      { key: 'refresh_rate_hz', label: 'Refresh Rate', format: v => `${v}Hz` },
      { key: 'panel_type', label: 'Panel' },
    ],
  },
  {
    slug: 'keyboard', category: 'keyboard', categoryLabel: 'Keyboard',
    title: 'Best Gaming Keyboard',
    blurb: 'Mechanical switches are the standard for gaming keyboards — the difference between switch types (linear, tactile, clicky) is mostly feel and noise, not a performance advantage in-game.',
    items: keyboards,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: keyboardBudget, detail: `$${keyboardBudget.price_usd} — ${keyboardBudget.form_factor}, ${keyboardBudget.switch_type}.` },
      { emoji: '📡', label: 'Wireless Pick', item: keyboardWireless, detail: `$${keyboardWireless.price_usd} — ${keyboardWireless.form_factor}, wireless.` },
    ],
    columns: [
      { key: 'switch_type', label: 'Switches' },
      { key: 'form_factor', label: 'Form Factor' },
      { key: 'wireless', label: 'Wireless', format: v => v ? 'Yes' : 'No' },
    ],
  },
  {
    slug: 'mouse', category: 'mouse', categoryLabel: 'Mouse',
    title: 'Best Gaming Mouse',
    blurb: 'Weight and shape matter more than max DPI for most players — nearly every gaming mouse today has more sensitivity than anyone actually uses. Pick based on grip style and weight, not the DPI number on the box.',
    items: mice,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: mouseBudget, detail: `$${mouseBudget.price_usd} — ${mouseBudget.dpi_max.toLocaleString()} DPI max.` },
      { emoji: '🪶', label: 'Lightest Pick', item: mouseLight, detail: `${mouseLight.weight_grams}g — the lightest mouse we track.` },
      { emoji: '👑', label: 'High-End Pick', item: mousePremium, detail: `$${mousePremium.price_usd} — ${mousePremium.buttons} buttons, ${mousePremium.dpi_max.toLocaleString()} DPI max.` },
    ],
    columns: [
      { key: 'dpi_max', label: 'Max DPI', format: v => (v as number).toLocaleString() },
      { key: 'weight_grams', label: 'Weight', format: v => `${v}g` },
      { key: 'wireless', label: 'Wireless', format: v => v ? 'Yes' : 'No' },
    ],
  },
  {
    slug: 'headset', category: 'headset', categoryLabel: 'Headset',
    title: 'Best Gaming Headset',
    blurb: 'Wireless headsets have closed most of the latency/quality gap with wired for gaming, but check battery life if you play long sessions. A good microphone matters as much as sound quality if you play with a team.',
    items: headsets,
    picks: [
      { emoji: '💰', label: 'Budget Pick', item: headsetBudget, detail: `$${headsetBudget.price_usd}${headsetBudget.wireless ? ' — wireless' : ' — wired'}.` },
      { emoji: '📡', label: 'Wireless Pick', item: headsetWireless, detail: `$${headsetWireless.price_usd} — wireless${headsetWireless.noise_cancelling ? ', noise cancelling' : ''}.` },
      { emoji: '👑', label: 'High-End Pick', item: headsetPremium, detail: `$${headsetPremium.price_usd} — ${headsetPremium.surround_sound}.` },
    ],
    columns: [
      { key: 'wireless', label: 'Wireless', format: v => v ? 'Yes' : 'No' },
      { key: 'noise_cancelling', label: 'ANC', format: v => v ? 'Yes' : 'No' },
      { key: 'surround_sound', label: 'Surround' },
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
