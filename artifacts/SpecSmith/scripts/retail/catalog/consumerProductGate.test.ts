// The consumer-product gate, and the property that makes it worth having:
// a rejected listing never reaches selection, so it cannot take a slot.
//
// FIXTURE PROVENANCE. Ten of the offending titles are VERBATIM from the
// committed capture at public/data/retail-parts.json — seven monitor
// multipacks, two server boards, one Threadripper PRO. They are the real
// listings, character for character.
//
// The rest are CONSTRUCTED to the defect as described, because the listings
// they stand for are in the proposed catalogue from run 35171930097, whose
// artifact this environment's egress policy will not serve. A constructed
// fixture proves the RULE fires on the shape; it does not prove it fires on
// the listing actually published. Replace them when the real titles are to
// hand.

import { describe, expect, it } from 'vitest';

import { AVAILABILITY_UNKNOWN } from '../../../src/lib/retail/offerSnapshot';
import type { AffiliatePart, RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { planCatalogSelection } from './affiliateCatalog';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';
import { consumerProductVerdict, screenConsumerProducts } from './consumerProductGate';

const generatedAt = '2026-09-17T12:00:00.000Z';

const part = (category: RetailPartCategory, name: string, over: Partial<AffiliatePart> = {}): AffiliatePart => ({
  id: `newegg-${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
  category,
  merchant: 'Newegg',
  name,
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=site&offerid=${encodeURIComponent(name.slice(0, 24))}`,
  fetchedAt: generatedAt,
  availability: AVAILABILITY_UNKNOWN,
  retailPrice: 100,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: category === 'gpu' ? 'rtx4070' : null,
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
  sku: null,
  unitSpecs: null,
  ...over,
});

/** VERBATIM from the committed capture. */
const MULTIPACKS = [
  'MSI Optix G321CU 32-inch Curved 2160P 4K Ultra HD 144 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, Less Blue Light, Night...',
  'Asus TUF VG289Q1A 28 3840 x 2160 4K UHD 5 ms LCD Gaming Monitor 2-Pack Bundle with Low Motion Blur, Eye Care, FreeSync Premium, DisplayPort, HDMI,...',
  'Asus TUF VG32VQ1B 32-inch 2560 x 1440 2K WQHD 165 Hz 1 ms LCD Gaming Monitor, 2-Pack Bundle with Extreme Low Motion Blur, Eye Care, FreeSync...',
  'MSI MAG 274UPF 27-inch 2160P 4K Ultra HD 144 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, FreeSync, HDMI, DisplayPort, USB-C,...',
  'Asus TUF VG27VH1B 27-inch 1920 x 1080 FHD 165 Hz 1 ms LCD Gaming Monitor, 2-Pack Bundle with Extreme Low Motion Blur, Eye Care, FreeSync Premium,...',
  'ViewSonic OMNI VX2428 24-inch 1080P 0.5ms 180Hz FHD IPS Gaming Monitor, 2-Pack Bundle with AMD FreeSync, Eye-Care, HDMI, DisplayPort, Speakers,...',
  'MSI G274CV 27-inch Curved 1080P Full HD 75 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, Less Blue Light, FreeSync, HDMI,...',
] as const;

/** VERBATIM from the committed capture. */
const SERVER_BOARDS = [
  'HUANANZHI X99 AD4 V2.0 X99 Motherboard with Intel XEON E5 LGA 2011-3 All Series DDR4 RECC128GB M.2 PCI-E NVME NGFF ATX Server Mainboard',
  'ASRock Rack Server Motherboard W880D4U Micro-ATX Single Socket LGA 1851 Intel Core Ultra Desktop Processors (Series 2)',
] as const;

/** VERBATIM from the committed capture. */
const THREADRIPPER_PRO =
  'AMD Ryzen Threadripper PRO 5955WX - Chagall PRO (Zen 3) 16-Core 4.0 GHz Socket sWRX8 280W Desktop Processor - 100-100000447WOF';

describe('the gate names why a listing is not a consumer PC part', () => {
  it.each(MULTIPACKS)('rejects the published multipack: %s', (name) => {
    expect(consumerProductVerdict('monitor', name)).toEqual({ ok: false, reason: 'multipack' });
  });

  it.each(SERVER_BOARDS)('rejects the published server board: %s', (name) => {
    expect(consumerProductVerdict('motherboard', name)).toEqual({ ok: false, reason: 'server-board' });
  });

  it('rejects the published Threadripper PRO', () => {
    expect(consumerProductVerdict('cpu', THREADRIPPER_PRO)).toEqual({ ok: false, reason: 'server-class-processor' });
  });

  // CONSTRUCTED.
  it.each([
    ['motherboard', 'Supermicro H13SSL-N ATX Server Motherboard Socket SP5 DDR5', 'server-board'],
    ['motherboard', 'ASRock Rack GENOAD8X-2T/BCM SP5 EPYC 9004 Motherboard', 'server-board'],
    ['motherboard', 'AMD SP6 Socket Siena Server Motherboard Micro-ATX', 'server-board'],
    ['cpu', 'Intel Xeon W-2495X 24-Core 2.5 GHz LGA 4677 225W Workstation Processor', 'server-class-processor'],
    ['cpu', 'Intel Xeon E-2488 8-Core 3.2 GHz LGA 1700 Server Processor', 'server-class-processor'],
    ['cpu', 'AMD Ryzen 7 5700X + ASUS PRIME B550M-A AC Motherboard Combo Kit', 'cpu-board-bundle'],
    ['cpu', 'Intel Core i5-12400F Processor with MSI PRO H610M-B Motherboard', 'cpu-board-bundle'],
    ['cpu', 'Intel Core i9-14900K Desktop Processor / Z790 Mainboard Bundle', 'cpu-board-bundle'],
    ['case', 'Open Air Computer Case Test Bench Frame ATX Motherboard Tray DIY Chassis', 'open-bench-chassis'],
    ['case', 'Streacom BC1 Open Benchtable Computer Case Aluminium', 'open-bench-chassis'],
    ['case', 'DIY Open Frame PC Case Vertical Motherboard Tray ATX Test Bench', 'open-bench-chassis'],
  ] as const)('rejects a %s as %s: %s', (category, name, reason) => {
    expect(consumerProductVerdict(category, name)).toEqual({ ok: false, reason });
  });

  it('screens a GPU multipack, which admission never looked at', () => {
    // isSelectableBuilderPart returns true for 'gpu' on its first line, so a
    // two-card box reached selection unexamined. The model matcher verifies
    // WHICH CHIP a listing is; it says nothing about how many are in the box.
    expect(consumerProductVerdict('gpu', 'GeForce RTX 4060 Graphics Card 2-Pack Bundle for Mining Rigs')).toEqual({
      ok: false,
      reason: 'multipack',
    });
  });
});

describe('ordinary consumer products pass', () => {
  it.each([
    ['gpu', 'ASUS ROG Astral GeForce RTX 5090 32GB GDDR7 OC Edition ROG-ASTRAL-RTX5090-O32G-GAMING'],
    ['gpu', 'GIGABYTE AORUS GeForce RTX 5090 MASTER 32G Graphics Card'],
    ['gpu', 'MSI GeForce RTX 5090 32G SUPRIM LIQUID SOC Graphics Card'],
    ['cpu', 'AMD Ryzen 9 7950X 16-Core 32-Thread Socket AM5 170W Desktop Processor for Gaming Workstation Server Build'],
    ['cpu', 'AMD Ryzen 7 9800X3D - Ryzen 7 9000 Series Granite Ridge (Zen 5) 8-Core 4.7 GHz Socket AM5 120W Desktop Processor'],
    ['cpu', 'Intel Core Ultra 9 285K - Core Ultra 9 Arrow Lake 24-Core LGA 1851 125W Desktop Processor'],
    ['cpu', 'AMD Ryzen Threadripper 7980X 64-Core Socket sTR5 350W Desktop Processor'],
    ['motherboard', 'ASRock B650M PG Riptide WiFi AM5 AMD B650 SATA 6Gb/s Micro ATX Motherboard'],
    ['motherboard', 'ASUS ROG STRIX B650E-F GAMING WIFI Socket AM5 ATX Motherboard'],
    ['motherboard', 'ASUS ROG MAXIMUS Z890 HERO LGA 1851 DDR5 ATX Gaming Motherboard'],
    ['monitor', "Z-EDGE 34' Ultra Wide 2K Curved Gaming Monitor, 21:9 UWQHD 3440x1440, 165Hz, 1ms, FreeSync Compatible, HDMI x2, DisplayPort"],
    ['monitor', 'Samsung Odyssey G9 49-inch DQHD 240Hz Curved Gaming Monitor'],
    ['case', 'Fractal Design North Charcoal Black Mid Tower Computer Case'],
    ['case', 'Lian Li O11 Dynamic EVO XL Full Tower Computer Case'],
    ['case', 'Corsair 4000D AIRFLOW Tempered Glass Mid-Tower ATX PC Case'],
    ['ram', 'Corsair Vengeance RGB 32GB (2x16GB) DDR5 6000 Desktop Memory'],
    ['storage', 'Samsung 990 PRO 2TB PCIe 4.0 NVMe M.2 Internal SSD'],
    ['psu', 'Corsair RM1000x 1000W 80+ Gold ATX Power Supply'],
    ['cooler', 'Noctua NH-D15 chromax.black CPU Cooler'],
    ['keyboard', 'Keychron Q3 QMK Wired Mechanical Keyboard'],
    ['mouse', 'Logitech G Pro X Superlight 2 Wireless Gaming Mouse'],
    ['headset', 'SteelSeries Arctis Nova Pro Wireless Gaming Headset'],
  ] as const)('keeps a real %s: %s', (category, name) => {
    expect(consumerProductVerdict(category, name)).toEqual({ ok: true });
  });

  it('keeps a consumer CPU whose seller copy says workstation and server', () => {
    // The words are not read as bare tokens. Only the model family is.
    const title = 'AMD Ryzen 9 7950X 16-Core 32-Thread Socket AM5 170W Desktop Processor for Gaming Workstation Server Build';
    expect(consumerProductVerdict('cpu', title)).toEqual({ ok: true });
  });

  it('keeps an RTX 5090 at any price the feed puts on it', () => {
    // The gate reads product KIND. Price is categoryScope.ts, and neither
    // consults the other.
    const dear = part('gpu', 'ASUS ROG Astral GeForce RTX 5090 32GB GDDR7 OC Edition', { retailPrice: 5399.99 });
    expect(consumerProductVerdict(dear.category, dear.name)).toEqual({ ok: true });
    expect(screenConsumerProducts([dear]).kept).toHaveLength(1);
  });
});

describe('a rejected listing cannot consume a slot', () => {
  /** Exactly quota per category, so one wasted slot causes a shortfall. */
  const candidates = (extra: readonly AffiliatePart[] = []) =>
    new Map<RetailPartCategory, AffiliatePart[]>(
      RETAIL_CATEGORY_CONFIG.map((config) => [
        config.category,
        [
          ...extra.filter((p) => p.category === config.category),
          ...Array.from({ length: config.quota }, (_, index) =>
            part(config.category, `${config.category} filler ${index}`, { retailPrice: 100 + index }),
          ),
        ],
      ]),
    );

  it('fills every quota when the bad listings are the cheapest candidates', () => {
    // Priced BELOW every filler, so the ranking would take them first. If the
    // gate ran after selection they would each have occupied a slot and the
    // category would finish short.
    const intruders = [
      ...MULTIPACKS.map((name) => part('monitor', name, { retailPrice: 70 })),
      ...SERVER_BOARDS.map((name) => part('motherboard', name, { retailPrice: 70 })),
      part('cpu', THREADRIPPER_PRO, { retailPrice: 70 }),
      part('case', 'Open Air Computer Case Test Bench Frame ATX Motherboard Tray', { retailPrice: 70 }),
    ];
    const { selected, report } = planCatalogSelection(candidates(intruders), generatedAt);

    expect(selected).toHaveLength(500);
    for (const row of report) expect(row.published, row.category).toBe(row.quota);

    const published = new Set(selected.map((p) => p.name));
    for (const name of [...MULTIPACKS, ...SERVER_BOARDS, THREADRIPPER_PRO]) {
      expect(published.has(name), name).toBe(false);
    }
  });

  it('reports what the gate refused, per category, with real titles', () => {
    const intruders = MULTIPACKS.map((name) => part('monitor', name, { retailPrice: 70 }));
    const { report } = planCatalogSelection(candidates(intruders), generatedAt);
    const monitor = report.find((row) => row.category === 'monitor');
    expect(monitor?.notConsumerProduct).toEqual({ multipack: 7 });
    expect(monitor?.notConsumerProductTitles).toHaveLength(3);
    expect(monitor?.notConsumerProductTitles[0].reason).toBe('multipack');
  });

  it('screens the candidates before the freshness and scope gates see them', () => {
    // `considered` counts what reached selection. A gated listing is not in it.
    const intruders = [part('cpu', THREADRIPPER_PRO, { retailPrice: 70 })];
    const { report } = planCatalogSelection(candidates(intruders), generatedAt);
    const cpu = report.find((row) => row.category === 'cpu');
    expect(cpu?.notConsumerProduct).toEqual({ 'server-class-processor': 1 });
    expect(cpu?.considered).toBe(cpu?.quota);
  });
});
