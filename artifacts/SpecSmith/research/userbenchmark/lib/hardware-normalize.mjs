// UserBenchmark component name -> SpecSmith canonical id.
//
// RESEARCH-ONLY. Reads UB observations, writes nothing into production.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE
// --------------------------------------
// An unmatched component is reported as unmatched. It is never mapped to
// "the nearest thing in the catalog", because a wrong hardware id is worse
// than no id: it silently attributes one part's numbers to another, and
// nothing downstream can detect it afterwards.
//
// FORM FACTOR IS A HARD BOUNDARY
// ------------------------------
// A laptop RTX 3060 is a different physical part from a desktop RTX 3060 —
// lower power limit, lower clocks, often 6 GB against 12. UserBenchmark lists
// both, distinguished only by a "(Mobile)" suffix or an Intel U/H/HQ CPU
// suffix. SpecSmith's catalogs contain DESKTOP parts. So a laptop component is
// never matched to a desktop id, at any confidence — it is classified,
// separated, and left unmatched.

/** Desktop, laptop, integrated, or unknown. */
export const FORM_FACTOR = Object.freeze({
  DESKTOP: 'desktop',
  LAPTOP: 'laptop',
  INTEGRATED: 'integrated',
  UNKNOWN: 'unknown',
});

const LAPTOP_GPU_RE = /\(\s*mobile|mobility|max-?q|\blaptop\b/i;
// Intel/AMD mobile CPU suffixes: 7700HQ, 8250U, 8750H, 1165G7, 5800HS, 12900HX.
const LAPTOP_CPU_RE = /\b\d{3,5}\s*(U|H|HQ|HS|HK|HX|G[1-7])\b|\bmobile\b|\blaptop\b/i;
const INTEGRATED_RE = /\biGPU\b|integrated|\bAPU\b|Vega \d+ \(Ryzen|Graphics Media Accelerator|\bHD (Graphics )?\d{3,4}\b|UHD Graphics|Iris/i;

/** Classifies a component by form factor. Ambiguity resolves to UNKNOWN, never to DESKTOP. */
export function classifyFormFactor(name, kind) {
  if (!name || typeof name !== 'string') return FORM_FACTOR.UNKNOWN;
  const laptop = kind === 'cpu' ? LAPTOP_CPU_RE : LAPTOP_GPU_RE;
  // Laptop is checked first: a mobile iGPU is a laptop part, and the laptop
  // boundary is the one that must never be crossed.
  if (laptop.test(name)) return FORM_FACTOR.LAPTOP;
  if (kind === 'gpu' && INTEGRATED_RE.test(name)) return FORM_FACTOR.INTEGRATED;
  if (kind === 'cpu' && /\bAPU\b/i.test(name)) return FORM_FACTOR.DESKTOP; // a desktop APU is still a desktop CPU
  return FORM_FACTOR.DESKTOP;
}

/** Aggressive key used for equality only — never for display or storage. */
export function normalizeKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\((?:mobile|desktop)[^)]*\)/g, ' ')
    .replace(/^(nvidia|amd|intel|ati)\s+/, '')
    .replace(/\bgeforce\b|\bradeon\b|\bcore\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * A deliberately NARROW set of safe equivalences.
 *
 * Each is a formatting difference, not a judgement about which parts are
 * similar: "1060-6GB" and "1060 6GB" are the same product written two ways.
 * Nothing here maps one product onto a different one.
 */
const SAFE_VARIANTS = [
  // A memory-size designator is part of UserBenchmark's naming and usually not
  // part of the catalog's: "GTX 1070 8GB" and "GTX 1070" are one product.
  // Applied to the RAW name, before normalizeKey flattens separators - once
  // "GTX 1070 8GB" has become "gtx10708gb" the memory size can no longer be
  // told apart from the model number.
  (n) => n.replace(/\s*\b\d{1,2}\s*GB\b/i, ' '),
  // "Super" is written both ways by both parties.
  (n) => n.replace(/\bSuper\b/i, 'S'),
  (n) => n.replace(/(\d)S\b/, '$1 Super'),
];

function candidateKeys(name) {
  const keys = new Set([normalizeKey(name)]);
  for (const f of SAFE_VARIANTS) keys.add(normalizeKey(f(name)));
  return [...keys].filter(Boolean);
}

export const MATCH = Object.freeze({
  EXACT: 'exact',
  FUZZY_HIGH: 'fuzzy-high-confidence',
  UNMATCHED: 'unmatched',
  BLOCKED_FORM_FACTOR: 'blocked-form-factor',
});

/**
 * Resolves a UB component name to a catalog id.
 *
 * Exact first. A "fuzzy" match here is only ever one of the SAFE_VARIANTS
 * above resolving to exactly ONE catalog entry — it is a spelling tolerance,
 * not a similarity search. There is deliberately no edit-distance scoring:
 * "RTX 4070" and "RTX 4070 Ti" are one character apart and are different
 * cards, so distance is the wrong tool for this domain entirely.
 *
 * Returns { matchType, catalogId, formFactor, candidates, reason }.
 */
export function resolveComponent(name, kind, catalog) {
  const formFactor = classifyFormFactor(name, kind);

  if (formFactor === FORM_FACTOR.LAPTOP) {
    return {
      matchType: MATCH.BLOCKED_FORM_FACTOR, catalogId: null, formFactor, candidates: [],
      reason: 'Laptop part. SpecSmith catalogs hold desktop parts; a mobile chip shares a name with its desktop sibling but not its power limit, clocks or memory. Never matched across that boundary.',
    };
  }
  if (formFactor === FORM_FACTOR.INTEGRATED) {
    return {
      matchType: MATCH.BLOCKED_FORM_FACTOR, catalogId: null, formFactor, candidates: [],
      reason: 'Integrated graphics. Not a discrete GPU and not represented in the discrete-GPU catalog.',
    };
  }

  const byKey = new Map();
  for (const entry of catalog) {
    const k = normalizeKey(entry.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(entry);
  }

  const exact = byKey.get(normalizeKey(name));
  if (exact && exact.length === 1) {
    return { matchType: MATCH.EXACT, catalogId: exact[0].id, formFactor, candidates: [exact[0].id], reason: 'Normalized name is identical to exactly one catalog entry.' };
  }
  if (exact && exact.length > 1) {
    return { matchType: MATCH.UNMATCHED, catalogId: null, formFactor, candidates: exact.map((e) => e.id), reason: `Normalized name matches ${exact.length} catalog entries; ambiguous, so left unmatched.` };
  }

  const hits = new Map();
  for (const key of candidateKeys(name)) {
    for (const entry of byKey.get(key) ?? []) hits.set(entry.id, entry);
  }
  if (hits.size === 1) {
    const only = [...hits.values()][0];
    return { matchType: MATCH.FUZZY_HIGH, catalogId: only.id, formFactor, candidates: [only.id], reason: 'A formatting variant (separator, Ti/Super/VRAM suffix) resolved to exactly one catalog entry.' };
  }
  if (hits.size > 1) {
    return { matchType: MATCH.UNMATCHED, catalogId: null, formFactor, candidates: [...hits.keys()], reason: `Formatting variants resolved to ${hits.size} different catalog entries; ambiguous, so left unmatched.` };
  }

  return { matchType: MATCH.UNMATCHED, catalogId: null, formFactor, candidates: [], reason: 'No catalog entry corresponds to this component. Reported as unmatched rather than mapped to the nearest-looking part.' };
}
