// IS THIS THE WHOLE PRODUCT, OR A PIECE OF ONE?
//
// A companion to consumerProductGate.ts, applied at the same point — before
// selection — and for the same reason: a listing rejected after selection
// leaves a hole in a filled quota, so the question has to be asked while there
// are still candidates left to take the slot.
//
// WHERE THESE RULES COME FROM
// ---------------------------
// Every one of them was written against a listing the 2026-09-17 dry run
// (GitHub Actions run 35275594594, artifact 10519804365) actually PROPOSED TO
// PUBLISH. Not a hypothetical, not a title invented to exercise a regex: the
// exact SKU and the exact merchant title are in the fixture beside this file,
// and the tests assert on those rows.
//
// The existing gate asks whether a listing is a CONSUMER product. These ask
// whether it is a COMPLETE one. Both questions have to be asked, because the
// defects below were consumer products: a TPM module is sold to consumers, a
// mouse switch is sold to consumers, a smartwatch case is sold to consumers.
// None of them is the thing the category claims to hold.
//
// THE TRAP THAT RUNS THROUGH ALL OF THIS
// ---------------------------------------
// Every one of these listings contains the category's own keyword, which is
// exactly why it survived the category search and the kind gate. The rules
// therefore cannot key on the keyword being present; they have to find the
// evidence that something ELSE is being sold. The worst example is a
// smartwatch case whose title reads "Hard PC Case" — where PC is the plastic,
// polycarbonate, not the computer.

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';

/** Why a listing is not a complete product. A closed set, so each is testable. */
export type IncompleteRejection =
  /** A tool or add-in card sold for a board, not a board. */
  | 'board-accessory'
  /** A board sold together with a processor or other major component. */
  | 'board-component-bundle'
  /** A board for two processors, or one that calls itself a server board. */
  | 'multi-socket-server-board'
  /** A protective case for a watch, phone or earbuds, not a PC chassis. */
  | 'wearable-device-case'
  /** A small panel that reports sensor readings, not a display to work on. */
  | 'hardware-monitor-screen'
  /** Switches, feet, cable holders — parts for a mouse, not a mouse. */
  | 'mouse-component';

export type CompleteVerdict = { ok: true } | { ok: false; reason: IncompleteRejection };

/**
 * Lowercase, punctuation collapsed — except `+`, kept for the same reason the
 * consumer gate keeps it: a plus between two products is how a seller writes
 * a bundle, and collapsing it discards the only evidence.
 */
const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

/**
 * A tool or add-in card sold FOR a motherboard.
 *
 * Both kinds put "motherboard" in the title because that is what they attach
 * to, and both passed every existing rule.
 *
 *   9SIBZT2KJN8869  "2pcs/lot XTW100 Programmer USB Motherboard
 *                    Multifunctional BIOS SPI FLASH 2425 Read / write Burner"
 *   9SIC6E1M4J4236  "TPM 2.0 Security Module Supports Windows 11 For ASUS
 *                    Motherboard 14 Pin LPC Card"
 *   9SIC6E1M4J4239  "TPM 2.0 Module 14-1 Pin Safety Block For SPI Card 14pin
 *                    Motherboard Windows 11"
 *
 * A TPM header is a feature real boards advertise, so "tpm" alone would reject
 * ordinary boards. What identifies the module is that TPM is what is being
 * SOLD — it leads the title, or it is followed by the module noun.
 *
 * A PIN-COUNT CLAUSE WAS TRIED AND REMOVED. `14 Pin LPC Card` reads like the
 * product, and it caught both TPM rows — but redundantly, since the module
 * noun already catches them, and a board listing its own `TPM header (14-1
 * pin LPC)` would have been rejected by it. A second signal that adds no
 * rejections and one false-positive shape is worse than no second signal.
 */
export function isBoardAccessory(title: string): boolean {
  // A flash programmer: the tool that writes a BIOS chip.
  if (/\b(bios|spi|eeprom|flash)\b/.test(title) && /\b(programmer|burner)\b/.test(title)) return true;
  // A discrete TPM / security module on its pin header.
  if (/\btpm\s*(?:2\s*0|1\s*2)?\s*(?:security\s+)?module\b/.test(title)) return true;
  if (/^tpm\b/.test(title)) return true;
  return false;
}

/**
 * A board sold with a processor, memory or another major component.
 *
 *   9SIB66RK6A9763  "X99H Motherboard+E5 2666 V3 CPU+Switch Cable+SATA Cable
 *                    Kit LGA2011-V3 DDR3X4 RAM Slot ..."
 *   9SIC6E1M4K6972  "ASUS TUF GAMING B550M-E WIFI Socket AM4 AMD B550 DDR4
 *                    Micro ATX Motherboard and AMD Ryzen 7 5700X - Ryzen 7
 *                    5000 Serie..."
 *
 * THE WORD "CPU" IS NOT THE SIGNAL, and this is the mirror of the mistake
 * already corrected on the processor side. Boards legitimately name the chips
 * they take, and three selected boards in the same run do exactly that:
 *
 *   "Supports CPUs 285K/265K/270K/250K"        (MSI MEG Z890 ACE)
 *   "CPU & memory overclocking ready"          (ASUS Pro WS TRX50-SAGE)
 *   "for Intel Core i9 and i7 X-Series CPU"    (ASUS PRIME X299-A)
 *
 * None of those ships a processor. So a bundling construction is required: a
 * `+` joining the two, a bundling noun, or "and" followed by a NAMED PART
 * NUMBER — "and AMD Ryzen 7 5700X" is a chip in the box; "and i7 X-Series" is
 * a family the socket accepts.
 */
export function isBoardComponentBundle(title: string): boolean {
  const cpuModel = /\b(?:ryzen|core|xeon|epyc|athlon|pentium|celeron)\b[^+]{0,40}?\b(?:[0-9]{3,5}[a-z0-9]{0,3}|i[3579][- ]?[0-9]{4,5}[a-z]{0,2})\b/;
  // "Motherboard+...CPU" or "...CPU+Motherboard": a plus joining two products.
  if (/\+/.test(title) && /\b(motherboard|mainboard)\b/.test(title) && /\bcpu\b/.test(title)) return true;
  // An explicit bundling noun beside the board.
  if (/\b(motherboard|mainboard)\b/.test(title) && /\b(combo|bundle|kit|set)\b/.test(title)
      && /\b(cpu|processor|ryzen|core i[3579]|xeon)\b/.test(title)) return true;
  // "Motherboard and <named chip>" — a specific part number, not a family.
  if (/\b(motherboard|mainboard)\b[\s\S]{0,60}?\band\b/.test(title) && cpuModel.test(title)
      && !/\bsupports?\b[\s\S]{0,20}\bcpus?\b/.test(title)) return true;
  return false;
}

/**
 * A board for two processors, or one that says it is a server board.
 *
 *   9SIB66RK6B0037  "X99 Dual CPU Motherboard F8D PLUS Intel X99 LGA 2011-3
 *                    E5 V3 DDR4 RECC 512GB M.2 NVME NGFF USB3.0 E-ATX Server"
 *
 * WORD ORDER IS THE WHOLE POINT. `isServerBoard` in the consumer gate matches
 * `server motherboard` and nothing else, so this title — where "Server" is the
 * LAST word and "Motherboard" the third — walked straight past it. It also
 * says "Dual CPU", which `\bdual socket\b` does not match either.
 *
 * Kept deliberately narrow so single-socket workstation boards survive. Two
 * were selected in the same run and are legitimate DIY purchases:
 *
 *   9SIC70UKZA6987  ASUS Pro WS TRX50-SAGE WIFI A ... workstation motherboard
 *   9SIC6E1M4K7626  ASUS WS X299 Pro/SE LGA 2066 CEB Intel Motherboard
 *
 * Neither takes two processors, and "workstation" is not consulted here.
 */
export function isMultiSocketServerBoard(title: string): boolean {
  if (/\bdual\s*[- ]?\s*(?:cpu|processor)s?\b/.test(title)) return true;
  if (/\b(?:2|two|dual)\s*[- ]?\s*socket\b/.test(title)) return true;
  // "server" and a board noun in EITHER order, anywhere in the title.
  if (/\bserver\b/.test(title) && /\b(motherboard|mainboard)\b/.test(title)) return true;
  return false;
}

/**
 * A protective case for something you wear or carry.
 *
 *   9SIC84RM3W9827  "Compatible for Amazfit Bip Max Case, Hard PC Case with
 *                    Tempered Glass Screen Protector Compatible with Amazfit B"
 *
 * "HARD PC CASE" MEANS POLYCARBONATE. The two letters that make this listing
 * look like a computer chassis are a plastic, and no rule that keys on "pc
 * case" can tell the difference. Two signals do:
 *
 *   - the device it is FOR is a watch, phone or earbud;
 *   - a screen protector, which a chassis has no screen to protect. A PC case
 *     has a "tempered glass side panel"; it never has a screen protector.
 *
 * Both are then required to be unaccompanied by chassis evidence, so a real
 * case that happens to mention a phone mount is not lost.
 */
export function isWearableDeviceCase(title: string): boolean {
  const chassis = /\b(atx|matx|m atx|micro atx|itx|mini itx|e atx|eatx|tower|chassis|motherboard|psu|gpu|radiator|drive bay|expansion slot)\b/;
  if (chassis.test(title)) return false;

  const wornDevice = /\b(amazfit|fitbit|garmin|apple watch|galaxy watch|smartwatch|smart watch|airpods|earbuds?|iphone|ipad|airtag|pixel watch|band \d)\b/;
  if (wornDevice.test(title)) return true;
  // A screen to protect means a device with a screen, not a chassis.
  if (/\bscreen protector\b/.test(title)) return true;
  return false;
}

/**
 * A small panel that reports sensor readings.
 *
 *   9SIBVHXKPK5189  "Thermalright Trofeo Vision LCD AIO Display 9.16 PC
 *                    Monitor, USB Type-C Screen for Real-Time Hardware
 *                    Monitoring, ..."
 *   9SIA4REJYD1812  "CORN Secondary IPS Screen, 5 inch 800*400 On-Screen
 *                    Display Data Monitoring for Gaming Computer Personal PC"
 *   9SIA4REJYD1813  (the same product, second SKU)
 *
 * These are accessories that sit in a case and show temperatures. They are not
 * displays anyone works on, and at 5 and 9.16 inches they cannot be.
 *
 * THE DISCRIMINATOR IS "MONITORING", NOT "MONITOR". A portable display is a
 * real product this catalogue should carry, and two were selected in the same
 * run — they must survive:
 *
 *   9SIBJBBJNN7651  UPERFECT Portable Monitor 15.6'' 1080P FHD VESA ...
 *   9SIBJBBJU76117  UPERFECT 13.3 Inch Portable Monitor, 1080 FHD Ultra-thin
 *
 * Neither says "monitoring", and neither is a secondary panel.
 */
export function isHardwareMonitorScreen(title: string): boolean {
  if (/\b(hardware|system|temperature|data|sensor|cpu)\s+monitoring\b/.test(title)) return true;
  if (/\bsecondary\s+(?:ips\s+)?(?:screen|display|monitor)\b/.test(title)) return true;
  // NOT evidenced by this run — the same product under another vendor's name.
  if (/\bsub\s*[- ]?screen\b/.test(title)) return true;
  // An AIO cooler's pump-head display, sold as a "monitor".
  if (/\baio\s+display\b/.test(title)) return true;
  return false;
}

/**
 * A part for a mouse, or a thing that sits next to one.
 *
 *   9SIC6T1M085452  "NoirVogel TTC Dustproof Gold Micro Mouse Switch
 *                    (4Pcs-Dustproof Gold), 0.74N, 80 Million Clicks for
 *                    Gaming Mouse"
 *   9SIC2ZPKRA0778  "ROCCAT Apuri Raw Gaming Mouse Bungee ROC15340"
 *
 * The switch listing survived the multipack rule because "(4Pcs-Dustproof
 * Gold)" has no space before "Pcs" and no "pack" anywhere — it is four
 * switches, priced as though it were a mouse.
 *
 * A bungee is a cable holder. It is not a component of a mouse, but it is not
 * a mouse either, and the category is meant to hold pointing devices.
 *
 * Every real mouse in the run survives, including the cheapest — $15.23
 * BLOODBAT GM02, $15.27 YINDIAO, $15.49 Zelotes — because none of them sells
 * a switch, a foot or a bungee.
 *
 * A CLICK-ENDURANCE CLAUSE WAS TRIED AND REMOVED, and it is the near miss
 * worth recording. `switch` plus `N million clicks` matched the defect, but
 * an endurance rating is how ORDINARY gaming mice advertise their switches —
 * "optical-mechanical switches rated for 100 million clicks" is a feature
 * line, not a parts listing. It rejected nothing the product noun had not
 * already rejected, and it would have thrown away real mice.
 *
 * `mouse pad` and `mouse grips` went the same way: both appear inside bundle
 * titles for complete mice, and neither was needed for anything in this run.
 */
export function isMouseComponent(title: string): boolean {
  // The product noun. Evidenced by 9SIC6T1M085452.
  if (/\b(?:micro\s+)?mouse\s+switch(?:es)?\b/.test(title)) return true;
  // Evidenced by 9SIC2ZPKRA0778.
  if (/\bbungee\b/.test(title)) return true;
  // NOT evidenced by this run: no selected listing is a set of glide pads.
  // Kept because "mouse feet" and "mouse skates" are product nouns no complete
  // mouse uses, so the extrapolation carries no false-positive shape.
  if (/\bmouse\s+(?:feet|skates)\b/.test(title)) return true;
  return false;
}

/**
 * The gate. Category-aware, like the consumer gate beside it, because the same
 * word carries different weight in different aisles.
 */
export function completeProductVerdict(category: RetailPartCategory, name: string): CompleteVerdict {
  const title = normalize(name);

  switch (category) {
    case 'motherboard':
      if (isBoardAccessory(title)) return { ok: false, reason: 'board-accessory' };
      if (isBoardComponentBundle(title)) return { ok: false, reason: 'board-component-bundle' };
      if (isMultiSocketServerBoard(title)) return { ok: false, reason: 'multi-socket-server-board' };
      break;
    case 'case':
      if (isWearableDeviceCase(title)) return { ok: false, reason: 'wearable-device-case' };
      break;
    case 'monitor':
      if (isHardwareMonitorScreen(title)) return { ok: false, reason: 'hardware-monitor-screen' };
      break;
    case 'mouse':
      if (isMouseComponent(title)) return { ok: false, reason: 'mouse-component' };
      break;
    default:
      break;
  }
  return { ok: true };
}

/**
 * Screens a candidate set, returning what survives and a tally of what did not.
 *
 * Pure and total, and shaped like `screenConsumerProducts` so the two report
 * the same way.
 */
export function screenCompleteProducts<T extends { category: RetailPartCategory; name: string }>(
  candidates: readonly T[],
): { kept: T[]; rejected: Record<string, number>; rejectedTitles: { reason: IncompleteRejection; name: string }[] } {
  const kept: T[] = [];
  const rejected: Record<string, number> = {};
  const rejectedTitles: { reason: IncompleteRejection; name: string }[] = [];
  for (const candidate of candidates) {
    const verdict = completeProductVerdict(candidate.category, candidate.name);
    if (verdict.ok) {
      kept.push(candidate);
      continue;
    }
    rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1;
    if (rejectedTitles.filter((entry) => entry.reason === verdict.reason).length < 3) {
      rejectedTitles.push({ reason: verdict.reason, name: candidate.name.slice(0, 120) });
    }
  }
  return { kept, rejected, rejectedTitles };
}
