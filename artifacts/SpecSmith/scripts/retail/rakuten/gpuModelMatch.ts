// Does this Newegg listing name the exact catalog part we asked about?
//
// WHY THIS IS NOT research/userbenchmark/lib/hardware-normalize.mjs
// ----------------------------------------------------------------
// That module answers a genuinely different question and, for this job, would
// answer it wrongly. It resolves a hardware name to "whichever catalog entry it
// most plausibly denotes", and to do that it deliberately ERASES the two
// distinctions this file exists to enforce:
//
//   - its SAFE_VARIANTS strips the memory-size designator, on the reasoning
//     that "GTX 1070 8GB" and "GTX 1070" are one product. True of a benchmark
//     row; false of a listing. "RTX 4060 Ti 8GB" and "RTX 4060 Ti 16GB" are two
//     SKUs at two prices, and the catalog carries both (rtx4060ti,
//     rtx4060ti16). Erasing the size here would let a $379 card's price be
//     attached to a $449 one.
//   - it treats "Super"/"S" as interchangeable spellings and accepts a Ti or
//     Super suffix variant as a FUZZY_HIGH match. For a price, a variant
//     suffix is not a spelling: RTX 4070, 4070 Super, 4070 Ti and 4070 Ti
//     Super are four distinct products, four distinct catalog ids and four
//     distinct prices.
//
// It is also research-only by its own header, and lives under research/, which
// Vitest is configured not to run. So this is not a second copy of that
// matcher — it is the opposite rule, applied at a boundary where money is
// involved, and the two must not be merged.
//
// WHAT "EXACT" MEANS HERE
// -----------------------
// The caller already knows which catalog part it is asking about, so this is a
// VERIFICATION, not a search. Nothing is scored, ranked or nearest-matched;
// the listing either names that part and no other, or it is refused with the
// reason it failed.

import type { CatalogGpu, OfferRejectionReason } from './types';

/** Suffixes that distinguish one product from another, per vendor. */
const VARIANT_SUFFIXES = ['ti', 'super', 'xtx', 'xt', 'gre'] as const;
type VariantSuffix = (typeof VARIANT_SUFFIXES)[number];

export interface GpuModelMention {
  /** 'rtx' | 'gtx' | 'rx' | 'arc' */
  family: string;
  /** The model number as written: "4070", "9070", "a770". */
  number: string;
  /** Variant suffixes in the order they appear: ['ti'], ['ti','super'], ['xt']. */
  suffixes: VariantSuffix[];
}

/** Comparable key for a mention. Two mentions denote the same product iff these match. */
export function mentionKey(m: GpuModelMention): string {
  return `${m.family} ${m.number}${m.suffixes.length ? ` ${m.suffixes.join(' ')}` : ''}`;
}

/**
 * A model mention is a family name, WHITESPACE, then the number — the way a
 * product title writes it ("GeForce RTX 4070 Ti SUPER").
 *
 * The whitespace is required on purpose. Run-together forms appear in vendor
 * part numbers at the end of Newegg titles ("GV-N4070WF3OC-12GD",
 * "RTX4070TI-S"), where the suffix is abbreviated or dropped. Reading those as
 * title claims makes almost every title self-contradict — a "RTX 4070 Ti
 * SUPER" card also containing "RTX4070TI" would look like two different models
 * and be refused as ambiguous. A part number is an identifier, not a claim, so
 * it is not read as one.
 */
const MENTION_RE = /\b(RTX|GTX|RX|Arc)\s+([AB]?\d{3,4})(?!\d)/gi;
const SUFFIX_RE = /^[\s-]*(Ti|Super|XTX|XT|GRE)\b/i;

/** Every distinct model a name mentions, in order of first appearance. */
export function findGpuMentions(name: string): GpuModelMention[] {
  const seen = new Map<string, GpuModelMention>();
  for (const m of String(name ?? '').matchAll(MENTION_RE)) {
    const suffixes: VariantSuffix[] = [];
    let rest = name.slice((m.index ?? 0) + m[0].length);
    for (;;) {
      const s = SUFFIX_RE.exec(rest);
      if (!s) break;
      suffixes.push(s[1].toLowerCase() as VariantSuffix);
      rest = rest.slice(s[0].length);
    }
    const mention: GpuModelMention = {
      family: m[1].toLowerCase(),
      number: m[2].toLowerCase(),
      suffixes,
    };
    const key = mentionKey(mention);
    if (!seen.has(key)) seen.set(key, mention);
  }
  return [...seen.values()];
}

/** The single mention in a catalog entry's own name. Throws if the catalog is malformed. */
export function catalogMention(gpu: CatalogGpu): GpuModelMention {
  const mentions = findGpuMentions(gpu.name);
  if (mentions.length !== 1) {
    throw new Error(
      `Catalog entry "${gpu.id}" (name "${gpu.name}") yields ${mentions.length} model mentions; exactly one is required. The matcher cannot verify a listing against a part it cannot itself name.`,
    );
  }
  return mentions[0];
}

/** Distinct memory sizes a name states, in GB. */
export function findMemorySizes(name: string): number[] {
  const sizes = new Set<number>();
  for (const m of String(name ?? '').matchAll(/\b(\d{1,3})\s*GB\b/gi)) {
    sizes.add(Number.parseInt(m[1], 10));
  }
  return [...sizes];
}

/**
 * WHY A STATED MEMORY SIZE IS ALWAYS REQUIRED
 * -------------------------------------------
 * An earlier version asked the catalog: it required an explicit size only when
 * SpecSmith already held two entries sharing a family, number and suffix
 * (rtx4060ti/rtx4060ti16, arca770-8/arca770-16...). That made the safety of a
 * price depend on the completeness of an editorial parts list, which is
 * backwards — the catalog describes what SpecSmith has chosen to track, not
 * what the manufacturer shipped.
 *
 * The RTX 5060 Ti is the concrete failure. It ships in 8GB and 16GB; the
 * catalog carries only the 16GB part (`rtx5060ti`). Under the old rule no
 * sibling existed, so no size was required, so a listing reading "ASUS Dual
 * GeForce RTX 5060 Ti OC" was accepted as the 16GB card — and an 8GB card's
 * price was published as the 16GB card's. Nothing downstream could detect it.
 *
 * So the rule is now unconditional and reads nothing outside the listing: a
 * title that does not state its memory size does not say which SKU it is, and
 * is refused. That is the same answer for a part the catalog splits, a part it
 * does not split yet, and a part it will split next year. Real Newegg
 * graphics-card titles state the capacity essentially always, so the cost is
 * small and, when it is paid, it is paid as a counted rejection rather than a
 * wrong price.
 */

export type ModelVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: Extract<
        OfferRejectionReason,
        'model-not-found' | 'model-ambiguous' | 'model-mismatch' | 'variant-suffix-mismatch' | 'memory-capacity-mismatch' | 'memory-capacity-unstated'
      >;
      detail: string;
    };

/**
 * Verifies a product name against one catalog part.
 *
 * Gate order — first failure wins, and the order is chosen so the reported
 * reason is the most specific true statement about the listing:
 *   1. no mention at all              -> model-not-found
 *   2. a mention of a different NUMBER-> model-mismatch (all) / model-ambiguous (mixed)
 *   3. same number, different suffix  -> variant-suffix-mismatch
 *   4. memory size wrong              -> memory-capacity-mismatch
 *   5. memory size not stated         -> memory-capacity-unstated
 *
 * Depends on nothing but the title and the one catalog entry being verified —
 * no catalog-wide lookup, so its answer cannot change because an unrelated
 * SKU was added or removed.
 */
export function verifyGpuModel(productName: string, gpu: CatalogGpu): ModelVerdict {
  const target = catalogMention(gpu);
  const mentions = findGpuMentions(productName);

  if (mentions.length === 0) {
    return { ok: false, reason: 'model-not-found', detail: `No GPU model could be read from "${productName}".` };
  }

  const sameNumber = mentions.filter((m) => m.family === target.family && m.number === target.number);
  if (sameNumber.length === 0) {
    const named = mentions.map(mentionKey).join(', ');
    return mentions.length > 1
      ? { ok: false, reason: 'model-ambiguous', detail: `Names ${mentions.length} models (${named}), none of them ${gpu.name}.` }
      : { ok: false, reason: 'model-mismatch', detail: `Names ${named}, not ${gpu.name}.` };
  }
  if (sameNumber.length < mentions.length) {
    return {
      ok: false,
      reason: 'model-ambiguous',
      detail: `Names more than one model (${mentions.map(mentionKey).join(', ')}); which one is being sold is not decidable from the title.`,
    };
  }

  // Every mention is the same family+number, so any suffix disagreement here is
  // a Ti / Super / XT / XTX / GRE variant difference — the exact confusion this
  // gate exists for.
  const targetSuffixes = target.suffixes.join(' ');
  const offending = sameNumber.find((m) => m.suffixes.join(' ') !== targetSuffixes);
  if (offending) {
    return {
      ok: false,
      reason: 'variant-suffix-mismatch',
      detail: `Listing names "${mentionKey(offending)}"; the catalog part is "${mentionKey(target)}". These are different products at different prices.`,
    };
  }

  const sizes = findMemorySizes(productName);
  if (sizes.length > 1) {
    return {
      ok: false,
      reason: 'memory-capacity-mismatch',
      detail: `Names more than one memory size (${sizes.join('GB, ')}GB); the card's own capacity is not decidable from the title.`,
    };
  }
  if (sizes.length === 1 && sizes[0] !== gpu.vram_gb) {
    return {
      ok: false,
      reason: 'memory-capacity-mismatch',
      detail: `Listing states ${sizes[0]}GB; ${gpu.name} is a ${gpu.vram_gb}GB part.`,
    };
  }
  if (sizes.length === 0) {
    return {
      ok: false,
      reason: 'memory-capacity-unstated',
      detail: `Listing states no memory size, so it cannot be confirmed as the ${gpu.vram_gb}GB ${gpu.name}. Graphics cards ship in several capacities under one model name, whether or not SpecSmith's catalog tracks each of them.`,
    };
  }

  return { ok: true };
}
