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
 * WHAT THIS ACTUALLY KEYS ON IS THE SOCKET COUNT, and only that. The title
 * above says "Dual CPU", which is a statement about the board's hardware. The
 * word "Server" in it is not consulted.
 *
 * A `server` + board-noun clause WAS here, added because `isServerBoard` in
 * the consumer gate matches `server motherboard` in that word order only, and
 * this title puts "Server" last. IT IS GONE, because run 35284766312 showed
 * what it costs: the ASUS Pro WS W790-ACE — a complete, single-socket,
 * buildable workstation board — was rejected for the phrase "SERVER-GRADE",
 * where "server" is an adjective describing a feature's quality and no part of
 * what is in the box.
 *
 * That is the same mistake, in a new place, that this codebase has now made
 * three times: reading a word as a product claim when it is describing
 * something else. "PC" in "Hard PC Case" was polycarbonate. "CPU" in "Supports
 * CPUs 285K" was a socket list. "Server" in "server-grade" is an adjective.
 * A bare keyword is not evidence of what is being sold.
 *
 * Dropping the clause loses nothing real. The defect above is still rejected,
 * on "Dual CPU"; the consumer gate still catches `server motherboard` in the
 * forward order, plus Xeon, EPYC, SP5/SP6 and `dual socket`. What a
 * reverse-order server board with ONE socket and no server-class chip would
 * slip through on is a gap this leaves open on purpose — an over-broad rule
 * that eats real workstation boards is the worse of the two errors.
 *
 * Single-socket workstation boards must survive. Three are now on record:
 *
 *   9SIC70UKZA6987  ASUS Pro WS TRX50-SAGE WIFI A ... workstation motherboard
 *   9SIC6E1M4K7626  ASUS WS X299 Pro/SE LGA 2066 CEB Intel Motherboard
 *   (run 35284766312) ASUS Pro WS W790-ACE, on "server-grade"
 */
export function isMultiSocketServerBoard(title: string): boolean {
  if (/\bdual\s*[- ]?\s*(?:cpu|processor)s?\b/.test(title)) return true;
  if (/\b(?:2|two|dual)\s*[- ]?\s*socket\b/.test(title)) return true;
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
 *
 * BUT "SECONDARY SCREEN" WAS NOT ENOUGH EITHER, and run 35284766312 proved
 * it: a Unew 15.6-inch portable gaming monitor was rejected on that phrase.
 * A portable monitor is a secondary screen — that is its entire purpose — so
 * the phrase cannot carry the decision on its own. Size now decides first,
 * and the phrase only applies to panels too small to work on.
 */
/**
 * The smallest diagonal SpecSmith treats as a display someone works on.
 *
 * A SPECSMITH CHOICE, not a standard, and the margin is wide rather than
 * thin: the accessory panels in run 35275594594 state 5 inches and the
 * smallest real portable monitor in the same run is 13.3 inches. Nothing sits
 * between 5 and 13.3, so the threshold is not close to any real product.
 */
export const MIN_WORKABLE_DISPLAY_INCHES = 13;

/**
 * The screen diagonal the title states, in inches, or null.
 *
 * TAKES THE RAW MERCHANT TITLE, NOT THE NORMALIZED ONE, and that is the whole
 * subtlety. `normalize` collapses every non-alphanumeric run to a space, which
 * destroys exactly the two characters a size is written with: `UPERFECT 13.3
 * Inch` becomes `uperfect 13 3 inch`, where a decimal-blind parser reads THREE
 * INCHES and condemns a real portable monitor, and `15.6''` loses its quotes
 * entirely and parses as nothing. The first draft of this function did both.
 *
 * AN EXPLICIT UNIT IS REQUIRED — `inch`, `inches`, `"` or `''`. Not fussiness:
 * `Thermalright Trofeo Vision LCD AIO Display 9.16 PC Monitor` writes its 9.16
 * with no unit at all, and a parser that guessed at bare numbers would read
 * `1080P`, `800*400` or a model number as a size somewhere else. A title that
 * does not state its size gets none, and is then judged on what it does say.
 *
 * A bare `in` is deliberately not accepted: it is an ordinary English word and
 * `Display Data Monitoring for Gaming Computer` has no shortage of places for
 * it to appear next to a number.
 */
export function statedDiagonalInches(rawName: string): number | null {
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*-?\s*(?:inch(?:es)?\b|''|")/i.exec(rawName);
  return match === null ? null : Number(match[1]);
}

/**
 * A panel that exists to report sensor readings, said unambiguously.
 *
 * AUTHORITATIVE. Size does not override any of these, because each names what
 * the product IS FOR rather than how big it is. A 14-inch panel bolted inside
 * a case to show core temperatures is still not a display anyone works on:
 *
 *   14 Inch PC Sensor Panel Secondary Screen for Hardware Monitoring,
 *   USB Display Inside Case
 *
 * An earlier draft let every diagonal of 13 inches or more short-circuit the
 * whole function, so that title passed. The size check has a job, but it is a
 * much smaller one than it was given — see below.
 */
export function showsSensorReadings(title: string): boolean {
  if (/\b(hardware|system|temperature|data|sensor|cpu)\s+monitoring\b/.test(title)) return true;
  if (/\bsensor\s+(?:panel|screen|display)\b/.test(title)) return true;
  // An AIO cooler's pump-head display, sold as a "monitor".
  if (/\baio\s+(?:display|screen)\b/.test(title)) return true;
  // A screen that mounts INSIDE the chassis is not one you sit in front of.
  if (/\b(?:inside|in)\s+(?:the\s+)?case\b/.test(title)) return true;
  if (/\bcase\s+mounted\b/.test(title)) return true;
  return false;
}

/**
 * Evidence that this is a display someone actually works in front of.
 *
 * Used ONLY to resolve the `secondary screen` ambiguity, never on its own. A
 * portable monitor is a secondary screen — that is its whole purpose — so the
 * phrase cannot decide alone; but neither can size, because a sensor panel
 * can be 14 inches. Both are required, and neither outranks the accessory
 * evidence above.
 */
export function describesWorkableMonitor(title: string): boolean {
  if (/\b(?:portable|external|travel)\s+(?:gaming\s+)?(?:monitor|display)\b/.test(title)) return true;
  if (/\b(?:gaming|computer|desktop)\s+monitor\b/.test(title)) return true;
  if (/\b\d{2,3}\s*hz\b/.test(title)) return true;
  if (/\b(?:1080p|1440p|2160p|fhd|qhd|uhd|4k|wqhd)\b/.test(title)) return true;
  return false;
}

export function isHardwareMonitorScreen(title: string, rawName: string): boolean {
  // WHAT IT IS FOR, BEFORE HOW BIG IT IS.
  if (showsSensorReadings(title)) return true;

  // `secondary screen` and `sub-screen` are the ambiguous phrases: a sensor
  // panel is one, and so is every portable monitor ever sold. Neutralised
  // only when the title ALSO states a workable size AND reads like a monitor
  // — and only here, where the authoritative evidence above has already had
  // its say.
  if (/\bsecondary\s+(?:ips\s+)?(?:screen|display|monitor)\b/.test(title)
      || /\bsub\s*[- ]?screen\b/.test(title)) {
    const diagonal = statedDiagonalInches(rawName);
    const workableSize = diagonal !== null && diagonal >= MIN_WORKABLE_DISPLAY_INCHES;
    return !(workableSize && describesWorkableMonitor(title));
  }
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
 *
 * AND THE CLICK-ENDURANCE CLAUSE CAME BACK TO BITE ANYWAY, from the other
 * direction. Removing it was not enough: run 35284766312 showed the plain
 * `mouse switch` noun rejecting the iRocks M31R, a complete wireless mouse
 * that simply says which switch is fitted. `describesCompleteMouse` above is
 * the fix, and it is a guard rather than a narrowing — the switch rules are
 * untouched, they just no longer get to decide when the title has already
 * established that a whole mouse is being sold.
 */
/**
 * Whether the title describes a COMPLETE POINTING DEVICE.
 *
 * Read off the things a mouse has and a bag of switches does not: a tracking
 * resolution, a wireless radio, a sensor, a programmable button count, a
 * battery. None of them appears in the switch four-pack's title —
 *
 *   NoirVogel TTC Dustproof Gold Micro Mouse Switch (4Pcs-Dustproof Gold),
 *   0.74N, 80 Million Clicks for Gaming Mouse
 *
 * — which states an actuation force, a click endurance and a quantity, and
 * whose only "gaming mouse" is the thing the switches go INTO. Nor in the
 * bungee's, which is a cable holder and says nothing about tracking.
 */
export function describesCompleteMouse(title: string): boolean {
  if (/\b\d{3,6}\s*dpi\b/.test(title)) return true;
  if (/\b\d{1,3}\s*[k]\s*dpi\b/.test(title)) return true;
  if (/\b(?:wireless|tri\s*mode|dual\s*mode|bluetooth|2\s*4\s*g(?:hz)?)\b/.test(title)) return true;
  if (/\b(?:optical|laser|hero|paw\d+|pixart)\s+sensor\b/.test(title)) return true;
  if (/\bsensor\b/.test(title) && /\bmouse\b/.test(title)) return true;
  if (/\b\d{1,2}\s+(?:programmable\s+)?buttons?\b/.test(title)) return true;
  if (/\b(?:rechargeable|battery\s+life|mah)\b/.test(title)) return true;
  return false;
}

/**
 * A part being SOLD, said in a way a complete product never says it.
 *
 * AUTHORITATIVE. Nothing below overrides these, because each one is a
 * statement about what is in the box rather than about what the thing in the
 * box contains:
 *
 *   - `replacement` or `spare` beside a switch. A mouse is not a replacement
 *     switch, whatever else its copy mentions.
 *   - a COUNT of switches. `(4Pcs-Dustproof Gold)` is four components; no
 *     mouse ships as four of itself.
 *   - `bungee`, `mouse feet`, `mouse skates`. These name a product that is
 *     categorically not a pointing device — a cable holder, a set of glides —
 *     so no amount of mouse vocabulary in the same title can redeem them.
 *
 * That last point is the one an earlier draft got wrong. `Wireless Gaming
 * Mouse Bungee Charging Dock with 2.4G Receiver` is a bungee: the words
 * "wireless", "gaming mouse" and "2.4G" all describe the mouse it HOLDS.
 */
export function sellsMousePart(title: string): boolean {
  if (/\b(?:replacement|spare)\b[\s\S]{0,40}?\bswitch(?:es)?\b/.test(title)) return true;
  if (/\bswitch(?:es)?\b[\s\S]{0,40}?\b(?:replacement|spare)\b/.test(title)) return true;
  if (/\b\d+\s*(?:pcs?|pack|pieces?)\b/.test(title) && /\bswitch(?:es)?\b/.test(title)) return true;
  if (/\bbungee\b/.test(title)) return true;
  if (/\bmouse\s+(?:feet|skates)\b/.test(title)) return true;
  return false;
}

export function isMouseComponent(title: string): boolean {
  // ACCESSORY NOUNS DECIDE FIRST. This order is the correction Codex asked
  // for on 0d73e39, and the ordering WAS the defect — not the evidence.
  //
  // `describesCompleteMouse` used to run here as an unconditional early
  // return, which made any mention of wireless, Bluetooth, 2.4G, DPI or a
  // battery conclusive proof that a mouse was being sold. Two titles show why
  // that is wrong, and in both the mouse vocabulary describes the mouse the
  // PART IS FOR:
  //
  //   Replacement Huano Mouse Switch for Wireless Gaming Mouse,
  //   Bluetooth 2.4G Compatible
  //
  //   Wireless Gaming Mouse Bungee Charging Dock with 2.4G Receiver
  //
  // A listing that says it is a replacement, sells switches by the piece, or
  // names a bungee is a part, full stop.
  if (sellsMousePart(title)) return true;

  // ONLY NOW is there anything to resolve. What is left is the genuinely
  // ambiguous shape: a bare `mouse switch` with no part-sale signal, which is
  // how a complete mouse names the switch fitted inside it —
  //
  //   iRocks M31R Wireless Gaming Mouse, 26000 DPI ... Huano mouse switch
  //   rated 80 million clicks, 6 programmable buttons, rechargeable
  //
  // — and also how a bare switch listing might read. Positive evidence breaks
  // the tie, and ONLY the tie.
  if (/\b(?:micro\s+)?mouse\s+switch(?:es)?\b/.test(title)) {
    return !describesCompleteMouse(title);
  }
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
      if (isHardwareMonitorScreen(title, name)) return { ok: false, reason: 'hardware-monitor-screen' };
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
 * One refusal, in the form a reviewer can act on.
 *
 * SKU AND THE FULL TITLE, both of them, because the previous shape had
 * neither and that cost a whole dry run. It recorded at most three titles per
 * reason, truncated to 120 characters and with no identifier at all — so when
 * run 35284766312 rejected three legitimate products, the report named them
 * only as clipped strings that could not be looked up, priced, or traced back
 * to a listing. Checking a rule against reality needs the exact row.
 */
export interface IncompleteRejectionRecord {
  reason: IncompleteRejection;
  /** The merchant SKU, or null when the candidate carries none. */
  sku: string | null;
  /** The merchant title, COMPLETE. Never truncated. */
  name: string;
}

/**
 * Screens a candidate set, returning what survives and every refusal in full.
 *
 * Pure and total. It reports EVERY rejection, not a sample: a sampled report
 * can only ever show that a rule fired, never that it fired on the right
 * things, and a false positive outside the sample is invisible.
 */
export function screenCompleteProducts<
  T extends { category: RetailPartCategory; name: string; sku?: string | null },
>(
  candidates: readonly T[],
): { kept: T[]; rejected: Record<string, number>; rejections: IncompleteRejectionRecord[] } {
  const kept: T[] = [];
  const rejected: Record<string, number> = {};
  const rejections: IncompleteRejectionRecord[] = [];
  for (const candidate of candidates) {
    const verdict = completeProductVerdict(candidate.category, candidate.name);
    if (verdict.ok) {
      kept.push(candidate);
      continue;
    }
    rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1;
    rejections.push({ reason: verdict.reason, sku: candidate.sku ?? null, name: candidate.name });
  }
  return { kept, rejected, rejections };
}
