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

const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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
    || /\bserver\s+(motherboard|mainboard|board)\b/.test(title)
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
 * Bare, not "and a motherboard": the bundles that reached a proposed
 * catalogue wrote it as "+", as "with", and as a second clause that a rule
 * requiring the word "and" never reached. A CPU listing has no reason to name
 * a motherboard except to sell one alongside.
 */
export function isCpuBoardBundle(title: string): boolean {
  return /\b(motherboard|mainboard)\b/.test(title);
}

/**
 * An open frame or tray, which is not a case.
 *
 * It encloses nothing, ships without panels, and answers none of the
 * questions a case answers for someone building their first PC — will the
 * card fit, will the air move, is it quiet.
 */
export function isOpenBenchChassis(title: string): boolean {
  return /\b(test\s*bench|bench\s*table|benchtable)\b/.test(title)
    || /\bmotherboard\s+tray\b/.test(title)
    || /\bopen[- ]?(air|frame)\b/.test(title)
    || /\bdiy\s+(open\s+)?frame\b/.test(title);
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
