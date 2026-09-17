// IS THIS A CONSUMER PC PART AT ALL? Asked of every candidate, before any of
// them competes for a slot.
//
// WHY IT IS ITS OWN GATE, AND WHY IT RUNS HERE
// --------------------------------------------
// These rules already existed, reached only through `admitAffiliatePart` —
// which the non-GPU categories go through and the GPU sweep does not. A GPU
// listing therefore met none of them: `isSelectableBuilderPart` answers
// `true` for 'gpu' on the first line, on the reasoning that the stricter GPU
// model matcher had already run. That matcher verifies WHICH CHIP a listing
// is. It has nothing to say about whether the box contains two of them.
//
// So the gate is lifted out and applied to the whole candidate set, every
// category, in one place — and applied BEFORE selection, which is the part
// that matters most:
//
//   a listing rejected here never enters `selectBestListings`, so it cannot
//   take a slot a real consumer product should have had.
//
// Rejecting after selection would have been strictly worse than useless: the
// quota would already be full, the rejected listing would leave a hole, and
// the category would come up short while hundreds of good candidates sat
// unexamined.
//
// WHAT THESE RULES READ, AND WHAT THEY REFUSE TO READ
// ---------------------------------------------------
// The product KIND, from the merchant's title. Never the price — that is
// `categoryScope.ts`, on bounds derived from the shipped editorial catalogue,
// and neither gate consults the other. An RTX 5090 is a consumer graphics
// card at any price, and nothing here will say otherwise.
//
// Nor the seller's marketing copy about who might buy the thing. A listing
// describing a Ryzen 9 7950X as being "for gaming workstation server build"
// is making a claim about its audience; the part is an ordinary consumer
// desktop processor. The words "workstation" and "server" are consulted only
// in the specific constructions below, never as bare tokens.

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';

/** Why a listing is not a consumer PC part. A closed set, so each is testable. */
export type ConsumerRejection =
  /** A board built for a server: vendor line, socket, or self-description. */
  | 'server-board'
  /** Xeon, EPYC or Threadripper PRO — workstation and server silicon. */
  | 'server-class-processor'
  /** A processor listing that also sells a motherboard. */
  | 'cpu-board-bundle'
  /** Several of one product, where a published part represents one. */
  | 'multipack'
  /** An open frame or tray, which encloses nothing. */
  | 'open-bench-chassis';

export type ConsumerVerdict = { ok: true } | { ok: false; reason: ConsumerRejection };

/**
 * Lowercase, punctuation collapsed to single spaces — except `+`, which is
 * KEPT.
 *
 * A plus sign between a processor and a board is the shortest way a seller
 * writes a bundle ("Ryzen 7 5700X + ASUS PRIME B550M-A"), and collapsing it
 * into whitespace threw away the only evidence that the listing sold two
 * things. Nothing else reads it, so keeping it costs the other rules nothing.
 */
const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

/**
 * Several of one product in a box, where the catalogue represents one.
 *
 * A published part carries ONE price and links to ONE listing, and every
 * figure downstream reads it as a single item. "2-Pack Bundle" at $1,329 is
 * then a $1,329 monitor: wrong by a factor of two, and indistinguishable from
 * an ordinary expensive display.
 *
 * ONLY EXPLICIT PACK COUNTS. Deliberately no bare "x2": a monitor title says
 * "HDMI x2" about its ports, and a rule matching that would reject ordinary
 * displays for describing themselves accurately.
 */
export function isMultipack(title: string): boolean {
  return /\b\d+\s*[- ]?pack\b/.test(title)
    || /\bpack of \d+\b/.test(title)
    || /\b(two|three|four|twin|dual)[- ]?pack\b/.test(title)
    || /\b\d+\s*[- ]?pc?s\s+(?:bundle|set)\b/.test(title);
}

/**
 * A board built for a server, not for the machine this site helps someone
 * build.
 *
 * Three independent signals, because no one of them catches all of it:
 *
 *   - THE VENDOR LINE. Supermicro builds server boards; "ASRock Rack" is
 *     ASRock's server division and is NOT the consumer "ASRock" brand, so the
 *     space carries the meaning and a bare "ASRock" must keep passing.
 *   - THE SOCKET. SP5 and SP6 are EPYC sockets; nothing consumer uses them.
 *   - WHAT THE TITLE CALLS ITSELF. "Server Motherboard"/"Mainboard"/"Board",
 *     a dual-socket layout, or a Xeon/EPYC processor family.
 */
export function isServerBoard(title: string): boolean {
  return /\b(supermicro|asrock rack|tyan|gigabyte server)\b/.test(title)
    || /\bsp[56]\b/.test(title)
    || /\bserver\s+(?:motherboard|mainboard|board)s?\b/.test(title)
    || /\b(xeon|epyc)\b/.test(title)
    || /\bdual\s+socket\b/.test(title);
}

/**
 * A processor sold into workstations and servers rather than desktops.
 *
 * MODEL FAMILY, NOT MARKETING COPY — see the file header for the 7950X that
 * this distinction exists to keep. Plain Threadripper is left alone: the PRO
 * line is the workstation one, and only that was asked for.
 */
export function isServerClassProcessor(title: string): boolean {
  return /\bxeon\b/.test(title)
    || /\bthreadripper\s+pro\b/.test(title)
    || /\bepyc\b/.test(title);
}

/**
 * A processor listing that also sells a board.
 *
 * NAMING A BOARD IS NOT ENOUGH, and the first version of this rule got that
 * wrong. Processor listings legitimately say which boards they run on —
 * "compatible with AM5 motherboards", "supports Z790 motherboards" — and
 * rejecting those loses real CPUs for describing their own socket.
 *
 * So the board word is necessary and never sufficient. Something must also
 * say a second product is in the box:
 *
 *   - a bundling noun: combo, bundle, kit, set;
 *   - a `+` joining the two, which is why `normalize` keeps the character;
 *   - "with" followed by a NAMED BOARD VENDOR. "with ASUS X570-E motherboard"
 *     is a specific board someone is shipping; "with AM5 motherboards" is a
 *     socket, and a socket is not a product.
 */
export function isCpuBoardBundle(title: string): boolean {
  if (!/\b(?:motherboard|mainboard)s?\b/.test(title)) return false;
  if (/\b(combo|bundle|kit|set)\b/.test(title)) return true;
  if (/\+/.test(title)) return true;
  // "with <vendor> ... motherboard" — the vendor must come after "with" and
  // before the board word, so a title that merely mentions a brand elsewhere
  // is not read as shipping that brand's board.
  return /\bwith\s+(?:[a-z0-9]+\s+){0,4}?(?:asus|asrock|msi|gigabyte|biostar|colorful|maxsun|nzxt|evga|supermicro)\b[^.]*?\b(?:motherboard|mainboard)s?\b/.test(title)
    || /\b(?:motherboard|mainboard)s?\b[^.]*?\bwith\s+(?:[a-z0-9]+\s+){0,4}?(?:asus|asrock|msi|gigabyte|biostar|colorful|maxsun|nzxt|evga|supermicro)\b/.test(title);
}


/**
 * A test bench or a bare tray, which is not a case.
 *
 * "OPEN-FRAME" AND "OPEN-AIR" ARE NOT SIGNALS, and the first version of this
 * rule treated them as ones. They describe a panel-less STYLE of case that
 * vendors genuinely sell as cases — COUGAR's open-frame line (Newegg
 * 9SIB7VEJWV5569, 9SIB7VEJWV7807) mounts a full build, takes a standard
 * power supply and ships as a finished product. Rejecting it cost real cases
 * for their styling.
 *
 * What remains is the equipment that is not a case at all: a test bench or
 * bench table, which is laboratory furniture for swapping parts in and out,
 * and a bare motherboard tray, which is a component OF a case sold on its
 * own.
 */
export function isOpenBenchChassis(title: string): boolean {
  return /\b(test\s*bench|bench\s*table|benchtable)\b/.test(title)
    || /\bmotherboard\s+trays?\b/.test(title);
}

/**
 * The gate. Category-aware, because the same word means different things:
 * "motherboard" disqualifies a PROCESSOR listing and is mandatory on a board.
 *
 * Categories with no rule of their own still pass through the checks that
 * apply everywhere — a multipack is a multipack whatever it holds, and that
 * is the check the GPU sweep never ran.
 */
export function consumerProductVerdict(category: RetailPartCategory, name: string): ConsumerVerdict {
  const title = normalize(name);

  // Applies to every category, GPU included.
  if (isMultipack(title)) return { ok: false, reason: 'multipack' };

  switch (category) {
    case 'motherboard':
      if (isServerBoard(title)) return { ok: false, reason: 'server-board' };
      break;
    case 'cpu':
      if (isServerClassProcessor(title)) return { ok: false, reason: 'server-class-processor' };
      if (isCpuBoardBundle(title)) return { ok: false, reason: 'cpu-board-bundle' };
      break;
    case 'case':
      if (isOpenBenchChassis(title)) return { ok: false, reason: 'open-bench-chassis' };
      break;
    default:
      break;
  }
  return { ok: true };
}

/**
 * Screens a category's candidates, returning what survives and a tally of
 * what did not.
 *
 * Pure and total: every input lands in exactly one of the two.
 */
export function screenConsumerProducts<T extends { category: RetailPartCategory; name: string }>(
  candidates: readonly T[],
): { kept: T[]; rejected: Record<string, number>; rejectedTitles: { reason: ConsumerRejection; name: string }[] } {
  const kept: T[] = [];
  const rejected: Record<string, number> = {};
  const rejectedTitles: { reason: ConsumerRejection; name: string }[] = [];
  for (const candidate of candidates) {
    const verdict = consumerProductVerdict(candidate.category, candidate.name);
    if (verdict.ok) {
      kept.push(candidate);
      continue;
    }
    rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1;
    // Up to three per reason, so a reviewer can check a rule rather than
    // trust a count.
    if (rejectedTitles.filter((entry) => entry.reason === verdict.reason).length < 3) {
      rejectedTitles.push({ reason: verdict.reason, name: candidate.name.slice(0, 120) });
    }
  }
  return { kept, rejected, rejectedTitles };
}
