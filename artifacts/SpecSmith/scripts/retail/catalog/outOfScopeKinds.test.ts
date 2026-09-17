// Five kinds of listing a human reviewer found in a proposed catalogue, each
// of which the kind rules admitted.
//
// PROVENANCE OF THE FIXTURES. Two sources, and they are not equally strong:
//
//   VERBATIM — copied character for character out of the committed catalogue
//   at public/data/retail-parts.json, which is a real Rakuten/Newegg capture.
//   The monitor multipacks, both server boards and the Threadripper PRO are
//   these. They are the actual listings, not a paraphrase of them.
//
//   CONSTRUCTED — written to the defect as the reviewer described it, because
//   the listing lives in the proposed catalogue from run 35171930097, whose
//   artifact this environment's egress policy will not serve. They are marked
//   below. A constructed fixture proves the RULE fires on the shape; it does
//   not prove the rule fires on the listing that was actually published, and
//   the two are only the same if the shape was described accurately. Replace
//   them with the real titles when those are to hand.

import { describe, expect, it } from 'vitest';

import {
  isMultipack,
  isOpenBenchChassis,
  isSelectableBuilderPart,
  isServerBoard,
  isServerClassProcessor,
} from './affiliateCatalog';

describe('a multipack is not one monitor', () => {
  // VERBATIM, all seven, from the committed catalogue.
  it.each([
    'MSI Optix G321CU 32-inch Curved 2160P 4K Ultra HD 144 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, Less Blue Light, Night...',
    'Asus TUF VG289Q1A 28 3840 x 2160 4K UHD 5 ms LCD Gaming Monitor 2-Pack Bundle with Low Motion Blur, Eye Care, FreeSync Premium, DisplayPort, HDMI,...',
    'Asus TUF VG32VQ1B 32-inch 2560 x 1440 2K WQHD 165 Hz 1 ms LCD Gaming Monitor, 2-Pack Bundle with Extreme Low Motion Blur, Eye Care, FreeSync...',
    'MSI MAG 274UPF 27-inch 2160P 4K Ultra HD 144 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, FreeSync, HDMI, DisplayPort, USB-C,...',
    'Asus TUF VG27VH1B 27-inch 1920 x 1080 FHD 165 Hz 1 ms LCD Gaming Monitor, 2-Pack Bundle with Extreme Low Motion Blur, Eye Care, FreeSync Premium,...',
    'ViewSonic OMNI VX2428 24-inch 1080P 0.5ms 180Hz FHD IPS Gaming Monitor, 2-Pack Bundle with AMD FreeSync, Eye-Care, HDMI, DisplayPort, Speakers,...',
    'MSI G274CV 27-inch Curved 1080P Full HD 75 Hz 1ms LED Backlit LCD Gaming Monitor, 2-Pack bundle, Frameless, Less Blue Light, FreeSync, HDMI,...',
  ])('refuses the published multipack: %s', (title) => {
    expect(isSelectableBuilderPart('monitor', title)).toBe(false);
  });

  it('keeps a single monitor whose ports are listed as x2', () => {
    // VERBATIM, and the reason there is no bare "x2" rule: this display says
    // "HDMI x2" about its ports and is one monitor.
    expect(isSelectableBuilderPart('monitor', "Z-EDGE 34' Ultra Wide 2K Curved Gaming Monitor, 21:9 UWQHD 3440x1440, 165Hz, 1ms, FreeSync Compatible, HDMI x2, DisplayPort")).toBe(true);
    expect(isMultipack('gaming monitor hdmi x2 displayport x1')).toBe(false);
    expect(isMultipack('27 inch 2 x hdmi 144hz monitor')).toBe(false);
  });

  it('counts a pack however the title spells it', () => {
    for (const title of ['2-pack bundle', '4 pack', 'pack of 2', 'twin-pack', 'dual pack', '2pcs bundle']) {
      expect(isMultipack(title)).toBe(true);
    }
  });
});

describe('a server board is not a gaming motherboard', () => {
  // VERBATIM, both, from the committed catalogue.
  it('refuses a board built around Xeon and calling itself a server mainboard', () => {
    expect(isSelectableBuilderPart('motherboard', 'HUANANZHI X99 AD4 V2.0 X99 Motherboard with Intel XEON E5 LGA 2011-3 All Series DDR4 RECC128GB M.2 PCI-E NVME NGFF ATX Server Mainboard')).toBe(false);
  });

  it('refuses an ASRock Rack server board', () => {
    expect(isSelectableBuilderPart('motherboard', 'ASRock Rack Server Motherboard W880D4U Micro-ATX Single Socket LGA 1851 Intel Core Ultra Desktop Processors (Series 2)')).toBe(false);
  });

  // CONSTRUCTED to the reviewer's description — Supermicro and the EPYC
  // sockets were named but their titles are in the unreachable artifact.
  it.each([
    'Supermicro H13SSL-N ATX Server Motherboard Socket SP5 DDR5',
    'ASRock Rack GENOAD8X-2T/BCM SP5 EPYC 9004 Motherboard',
    'Supermicro M12SWA-TF sWRX8 Workstation Motherboard',
    'AMD SP6 Socket Siena Server Motherboard Micro-ATX',
  ])('refuses a server board by vendor line or socket: %s', (title) => {
    expect(isSelectableBuilderPart('motherboard', title)).toBe(false);
  });

  it('keeps ordinary consumer boards, ASRock among them', () => {
    // "ASRock Rack" is the server division. Bare "ASRock" is not, and a rule
    // that could not tell them apart would cost the catalogue a real brand.
    for (const title of [
      'ASRock B650M PG Riptide WiFi AM5 AMD B650 SATA 6Gb/s Micro ATX Motherboard',
      'ASUS ROG STRIX B650E-F GAMING WIFI Socket AM5 ATX Motherboard',
      'MSI MAG B850 TOMAHAWK MAX WIFI AM5 DDR5 ATX Gaming Motherboard',
      'GIGABYTE Z890 AORUS ELITE WIFI7 LGA 1851 DDR5 ATX Motherboard',
    ]) {
      expect(isSelectableBuilderPart('motherboard', title), title).toBe(true);
    }
    expect(isServerBoard('asrock b650m pg riptide wifi am5 motherboard')).toBe(false);
  });
});

describe('workstation and server processors are not the consumer catalogue', () => {
  it('refuses the published Threadripper PRO', () => {
    // VERBATIM, from the committed catalogue.
    expect(isSelectableBuilderPart('cpu', 'AMD Ryzen Threadripper PRO 5955WX - Chagall PRO (Zen 3) 16-Core 4.0 GHz Socket sWRX8 280W Desktop Processor - 100-100000447WOF')).toBe(false);
  });

  // CONSTRUCTED: Xeon titles were named by the reviewer but are in the
  // unreachable artifact. The family name is what the rule reads.
  it.each([
    'Intel Xeon W-2495X 24-Core 2.5 GHz LGA 4677 225W Workstation Processor',
    'Intel Xeon E-2488 8-Core 3.2 GHz LGA 1700 Server Processor',
    'AMD Ryzen Threadripper PRO 7995WX 96-Core sTR5 350W Processor',
  ])('refuses a server-class processor: %s', (title) => {
    expect(isSelectableBuilderPart('cpu', title)).toBe(false);
  });

  it('DOES NOT refuse a consumer CPU whose seller copy says workstation or server', () => {
    // The explicit instruction, and the reason isServerClassProcessor reads
    // the MODEL and not the marketing: who a seller says might buy a part is
    // not what the part is. A 7950X is a consumer desktop processor.
    const title = 'AMD Ryzen 9 7950X 16-Core 32-Thread Socket AM5 170W Desktop Processor for Gaming Workstation Server Build';
    expect(isServerClassProcessor(title.toLowerCase())).toBe(false);
    expect(isSelectableBuilderPart('cpu', title)).toBe(true);
  });

  it('leaves plain Threadripper alone; only the PRO line was asked for', () => {
    expect(isServerClassProcessor('amd ryzen threadripper 7980x 64 core str5 processor')).toBe(false);
    expect(isServerClassProcessor('amd ryzen threadripper pro 5955wx processor')).toBe(true);
  });
});

describe('a processor listing that names a board is selling both', () => {
  // CONSTRUCTED: the reviewer found mixed bundles in the proposed catalogue;
  // these are the shapes the older rule missed, which needed "and" between
  // the parts.
  it.each([
    'AMD Ryzen 7 5700X + ASUS PRIME B550M-A AC Motherboard Combo Kit',
    'Intel Core i5-12400F Processor with MSI PRO H610M-B Motherboard',
    'AMD Ryzen 5 5600 Desktop Processor, B550M Motherboard, 16GB DDR4 Set',
    'Intel Core i9-14900K Desktop Processor / Z790 Mainboard Bundle',
  ])('refuses a CPU-plus-board bundle: %s', (title) => {
    expect(isSelectableBuilderPart('cpu', title)).toBe(false);
  });

  it('keeps a plain processor listing', () => {
    for (const title of [
      'AMD Ryzen 7 9800X3D - Ryzen 7 9000 Series Granite Ridge (Zen 5) 8-Core 4.7 GHz Socket AM5 120W Desktop Processor',
      'Intel Core Ultra 9 285K - Core Ultra 9 Arrow Lake 24-Core LGA 1851 125W Desktop Processor',
      'AMD Ryzen 5 9600X - Ryzen 5 9000 Series 6-Core Socket AM5 65W Desktop Processor',
    ]) {
      expect(isSelectableBuilderPart('cpu', title), title).toBe(true);
    }
  });
});

describe('an open frame is not a case', () => {
  // CONSTRUCTED: named by the reviewer, titles in the unreachable artifact.
  it.each([
    'Open Air Computer Case Test Bench Frame ATX Motherboard Tray DIY Chassis',
    'Streacom BC1 Open Benchtable Computer Case Aluminium',
    'DIY Open Frame PC Case Vertical Motherboard Tray ATX Test Bench',
  ])('refuses an open bench or tray: %s', (title) => {
    expect(isSelectableBuilderPart('case', title)).toBe(false);
  });

  it('keeps open-frame cases, which are a styling and not a bench', () => {
    // Narrowed after review: "open-frame"/"open-air" describe a panel-less
    // case vendors sell as a finished product — COUGAR's line (Newegg
    // 9SIB7VEJWV5569, 9SIB7VEJWV7807) among them. Only the equipment words
    // reject now. See consumerProductGate.ts.
    for (const title of [
      'Thermaltake Core P3 TG Pro Open-Air Computer Case',
      'COUGAR Conquer 2 Open-Frame Mid Tower Computer Case ATX Gaming',
    ]) {
      expect(isSelectableBuilderPart('case', title), title).toBe(true);
    }
  });

  it('keeps ordinary enclosed cases', () => {
    for (const title of [
      'Fractal Design North Charcoal Black Mid Tower Computer Case',
      'Lian Li O11 Dynamic EVO Black Tempered Glass ATX Gaming Case',
      'NZXT H7 Flow RGB ATX Mid Tower Computer Case White',
      'Corsair 4000D AIRFLOW Tempered Glass Mid-Tower ATX PC Case',
    ]) {
      expect(isSelectableBuilderPart('case', title), title).toBe(true);
    }
    expect(isOpenBenchChassis('fractal design north mid tower computer case')).toBe(false);
  });
});

describe('nothing here rejects a part for being expensive', () => {
  it('keeps the RTX 5090, whatever it costs', () => {
    // The explicit instruction. These rules read the product KIND only; price
    // is decided by categoryScope.ts, on bounds derived from the editorial
    // catalogue, and neither gate consults the other.
    for (const title of [
      'ASUS ROG Astral GeForce RTX 5090 32GB GDDR7 OC Edition ROG-ASTRAL-RTX5090-O32G-GAMING',
      'GIGABYTE AORUS GeForce RTX 5090 MASTER 32G Graphics Card',
      'MSI GeForce RTX 5090 32G SUPRIM LIQUID SOC Graphics Card',
    ]) {
      expect(isSelectableBuilderPart('gpu', title), title).toBe(true);
    }
  });

  it('keeps expensive consumer parts in every category these rules touch', () => {
    expect(isSelectableBuilderPart('monitor', 'Samsung Odyssey G9 49-inch DQHD 240Hz Curved Gaming Monitor')).toBe(true);
    expect(isSelectableBuilderPart('cpu', 'AMD Ryzen 9 9950X3D 16-Core Socket AM5 170W Desktop Processor')).toBe(true);
    expect(isSelectableBuilderPart('motherboard', 'ASUS ROG MAXIMUS Z890 HERO LGA 1851 DDR5 ATX Gaming Motherboard')).toBe(true);
    expect(isSelectableBuilderPart('case', 'Lian Li O11 Dynamic EVO XL Full Tower Computer Case')).toBe(true);
  });
});
