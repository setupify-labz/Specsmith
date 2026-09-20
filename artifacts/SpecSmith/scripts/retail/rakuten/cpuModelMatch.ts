// Does this Newegg listing name the exact canonical processor we are binding?
//
// This is the CPU counterpart of `gpuModelMatch.ts`, and it exists for the same
// reason: a listing title is evidence about identity, and identity is where a
// wrong answer becomes a wrong FPS estimate attached to a real product a
// beginner is about to buy.
//
// VERIFICATION, NOT SEARCH
// ------------------------
// The caller already knows which canonical CPU it is asking about. Nothing here
// is scored, ranked or nearest-matched. The listing either names that part and
// no other, or it is refused with the reason it failed. There is deliberately
// no "closest match" branch to fall into.
//
// WHAT A SUFFIX MEANS HERE
// ------------------------
// For a processor the trailing letters are not decoration, and collapsing them
// is the whole failure mode this file prevents:
//
//   - F  has no integrated graphics. i5-13400 and i5-13400F are different
//        SKUs at different prices, and a build that assumed the wrong one can
//        leave a shopper with no display output at all.
//   - K  is unlocked, KF is unlocked with no graphics, KS is the binned part.
//        The catalog carries i9-14900K, i9-14900KF and i9-14900KS as three
//        separate entries.
//   - X3D is the stacked-cache part and is the single most consequential
//        gaming difference in AMD's line: Ryzen 9 9950X and 9950X3D are not
//        interchangeable, and X3D is precisely what a gamer is paying for.
//   - PRO is a different product line with different platform support.
//   - HX / HS / H / U are mobile parts. They are never desktop parts, and a
//        laptop chip must never bind to a desktop catalog entry.
//
// So a suffix disagreement is a hard refusal, never a near-miss. An absent
// suffix is itself a claim: "i5-13400" states a part WITHOUT the F, so it does
// not verify i5-13400F.

/** The distinct product lines this matcher can read. */
export type CpuLine = 'intel-core' | 'intel-ultra' | 'amd-ryzen';

export interface CpuMention {
  line: CpuLine;
  /** Family as written, normalized: 'i5', 'ultra9', 'ryzen5'. */
  family: string;
  /** The model number as written: '13400', '285', '9950'. */
  number: string;
  /** Trailing designator, normalized upper-case: '', 'F', 'KF', 'X3D'. */
  suffix: string;
  /** AMD's separate professional line. Never interchangeable with the consumer part. */
  pro: boolean;
}

export type CpuRejectionReason =
  | 'model-not-found'
  | 'model-mismatch'
  | 'model-ambiguous'
  | 'variant-suffix-mismatch'
  | 'professional-line-mismatch'
  | 'mobile-part';

export type CpuVerdict = { ok: true } | { ok: false; reason: CpuRejectionReason; detail: string };

/** Mobile designators. A laptop chip may never bind to a desktop catalog entry. */
const MOBILE_SUFFIXES = new Set(['HX', 'HS', 'H', 'U', 'HK', 'P']);

/**
 * Intel Core: "i5-13400F", "i5 13400F", "Core i9-14900KS".
 *
 * The separator is optional but the family token must stand alone (`\b`), so
 * the "i5" inside a vendor part number or a chipset string is not read as a
 * model claim.
 */
const INTEL_CORE_RE = /\b(i[3579])[\s-]?(\d{4,5})([A-Z]{0,3})\b/gi;

/** Intel Core Ultra: "Core Ultra 9 285K". */
const INTEL_ULTRA_RE = /\bCore\s+Ultra\s+([3579])\s+(\d{3})([A-Z]{0,2})\b/gi;

/**
 * AMD Ryzen: "Ryzen 9 9950X3D", "Ryzen 5 PRO 5600".
 *
 * `X3D` is captured whole. Reading it as `X` plus a stray `3D` would make the
 * most important gaming distinction in AMD's range invisible.
 */
const AMD_RYZEN_RE = /\bRyzen\s+([3579])\s+(PRO\s+)?(\d{4})\s?(X3D|XT|X|GE|G|E|HX|HS|H|U)?\b/gi;

/** Comparable key. Two mentions denote the same product iff these match. */
export function mentionKey(m: CpuMention): string {
  const pro = m.pro ? ' PRO' : '';
  return `${m.family}${pro} ${m.number}${m.suffix}`;
}

/** Every distinct processor a name mentions, in order of first appearance. */
export function findCpuMentions(name: string): CpuMention[] {
  const text = String(name ?? '');
  const seen = new Map<string, CpuMention>();
  const add = (m: CpuMention) => {
    const key = mentionKey(m);
    if (!seen.has(key)) seen.set(key, m);
  };

  for (const m of text.matchAll(INTEL_CORE_RE)) {
    add({ line: 'intel-core', family: m[1].toLowerCase(), number: m[2], suffix: (m[3] ?? '').toUpperCase(), pro: false });
  }
  for (const m of text.matchAll(INTEL_ULTRA_RE)) {
    add({ line: 'intel-ultra', family: `ultra${m[1]}`, number: m[2], suffix: (m[3] ?? '').toUpperCase(), pro: false });
  }
  for (const m of text.matchAll(AMD_RYZEN_RE)) {
    add({ line: 'amd-ryzen', family: `ryzen${m[1]}`, number: m[3], suffix: (m[4] ?? '').toUpperCase(), pro: Boolean(m[2]) });
  }

  return [...seen.values()];
}

/**
 * The one mention a canonical catalog entry denotes, read from its own name.
 *
 * Returns null when the entry's name cannot be parsed at all — which is itself
 * a refusal to bind, not a reason to guess.
 */
export function canonicalCpuMention(cpuName: string): CpuMention | null {
  const mentions = findCpuMentions(cpuName);
  return mentions.length === 1 ? mentions[0] : null;
}

/**
 * Verifies that `listingName` names `cpuName` and nothing else.
 *
 * Depends on nothing but the listing's own text and the single catalog entry
 * being verified — no catalog-wide lookup, so its answer cannot change because
 * an unrelated SKU was added or removed.
 */
export function verifyCpuModel(listingName: string, cpuName: string): CpuVerdict {
  const target = canonicalCpuMention(cpuName);
  if (!target) {
    return {
      ok: false,
      reason: 'model-not-found',
      detail: `The catalog entry "${cpuName}" does not parse to exactly one processor, so there is nothing unambiguous to verify against.`,
    };
  }

  const mentions = findCpuMentions(listingName);
  if (mentions.length === 0) {
    return { ok: false, reason: 'model-not-found', detail: `No processor model could be read from "${listingName}".` };
  }

  // More than one distinct processor named: a bundle, a comparison, or a
  // compatibility list. Which one is being sold is not decidable from the
  // title, and choosing would be inventing the answer the merchant withheld.
  if (mentions.length > 1) {
    return {
      ok: false,
      reason: 'model-ambiguous',
      detail: `Names ${mentions.length} processors (${mentions.map(mentionKey).join(', ')}); which one is being sold is not decidable from the title.`,
    };
  }

  const found = mentions[0];

  if (MOBILE_SUFFIXES.has(found.suffix)) {
    return {
      ok: false,
      reason: 'mobile-part',
      detail: `Listing names "${mentionKey(found)}", a mobile processor. Desktop catalog entry "${cpuName}" is a different product.`,
    };
  }

  if (found.line !== target.line || found.family !== target.family || found.number !== target.number) {
    return {
      ok: false,
      reason: 'model-mismatch',
      detail: `Names "${mentionKey(found)}", not "${mentionKey(target)}".`,
    };
  }

  if (found.pro !== target.pro) {
    return {
      ok: false,
      reason: 'professional-line-mismatch',
      detail: `Listing names "${mentionKey(found)}"; the catalog part is "${mentionKey(target)}". PRO is a separate product line, not a spelling of the consumer part.`,
    };
  }

  if (found.suffix !== target.suffix) {
    return {
      ok: false,
      reason: 'variant-suffix-mismatch',
      detail: `Listing names "${mentionKey(found)}"; the catalog part is "${mentionKey(target)}". These are different products — the designator changes integrated graphics, unlocked multiplier or cache, and with it both the price and the performance.`,
    };
  }

  return { ok: true };
}
