// EFPS extraction from a locally saved UserBenchmark FPS-Estimates page.
//
// RESEARCH-ONLY. Reads a string that a human already saved to disk. No
// network code.
//
// ---------------------------------------------------------------------------
// What an EFPS object looks like
// ---------------------------------------------------------------------------
// UserBenchmark game pages embed a JS array of objects shaped like:
//
//   { id: 'https://www.userbenchmark.com/EFps/,,,_,,,_Fortnite,2060S,3600,',
//     t:  'Fortnite 3600 2060S',
//     p:  '131' }
//
// The `id` URL payload is THREE underscore-separated groups, each of FOUR
// comma-separated fields. Field meanings are proven in
// efps/configuration-analysis.md:
//
//   field[0] = game     (only ever set in group 3)
//   field[1] = GPU
//   field[2] = CPU
//   field[3] = UNRESOLVED — never populated in any saved source
//
// Group 3 is the base/shared configuration. Groups 1 and 2 are the two
// variants being compared; for a direct (single) record both are empty.
//
// ---------------------------------------------------------------------------
// Classification: why NOT the game-name prefix
// ---------------------------------------------------------------------------
// A previous approach classified records by stripping a `gameName + " "`
// prefix from `t`. That breaks on real data:
//   - Games whose display name differs from the EFPS token ("PUBG" vs
//     "PlayerUnknown's Battlegrounds", "CSGO" vs "Counter-Strike: Global
//     Offensive") never match the prefix at all.
//   - Game names containing " vs " or " - " corrupt the split.
//
// Classification here uses the EFPS STRUCTURE instead, which is
// name-independent: a record is a COMPARISON when groups 1 and 2 carry any
// value, and DIRECT when they are entirely empty. The `p` field
// ("123 vs 117" vs "131") and the title's " vs " marker are then used as
// independent cross-checks; a disagreement is recorded as a warning rather
// than silently resolved.
//
// ---------------------------------------------------------------------------
// The title/URL ordering trap
// ---------------------------------------------------------------------------
// The order of the two sides in `t` does NOT reliably match the order of
// groups 1/2 in the URL. Measured on the saved Fortnite source: 91 records
// where title-side-A corresponds to group 1, and 82 where it corresponds to
// group 2. So a parser that assumes `title[0] === group1` is wrong ~47% of
// the time.
//
// The pairing that IS reliable is title-side-to-value: `t` and `p` are
// written in the same order ("A vs B" ↔ "137 vs 108"). So each side's
// (label, fps) pair is taken from t/p, and the URL group each side came from
// is resolved by matching the label token against the group's own fields —
// never by position.

import { EFPS_EXTRACTOR_VERSION } from './version.mjs';

const EFPS_URL_PREFIX = 'https://www.userbenchmark.com/EFps/';

/** Matches the embedded object literals. Tolerates arbitrary whitespace and
 * newlines between keys (the real markup spreads each object over 4 lines),
 * and both quote styles. */
const EFPS_OBJECT_RE =
  /\{\s*id\s*:\s*(['"])(.*?)\1\s*,\s*t\s*:\s*(['"])(.*?)\3\s*,\s*p\s*:\s*(['"])(.*?)\5\s*\}/g;

/** Splits an EFPS URL payload into its 3 groups × 4 fields. Returns null when
 * the shape doesn't match, so the caller can reject rather than guess. */
export function parseEfpsUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(EFPS_URL_PREFIX)) return null;
  const payload = url.slice(EFPS_URL_PREFIX.length);
  const groups = payload.split('_');
  if (groups.length !== 3) return null;
  const fields = groups.map((g) => g.split(','));
  if (!fields.every((f) => f.length === 4)) return null;
  const norm = (v) => (v && v.trim() !== '' ? v.trim() : null);
  const asGroup = (f) => ({
    game: norm(f[0]),
    gpu: norm(f[1]),
    cpu: norm(f[2]),
    // Field 3 has no proven meaning — preserved raw, never named.
    field3: norm(f[3]),
    raw: f.join(','),
  });
  return {
    rawPayload: payload,
    variantA: asGroup(fields[0]),
    variantB: asGroup(fields[1]),
    base: asGroup(fields[2]),
  };
}

/** Parses the `p` value. Returns { kind, values[], raw }. `kind` is
 * 'single' | 'comparison' | 'malformed'. Never throws, never invents a
 * number — a value that isn't a clean positive integer is reported as
 * malformed with its raw text preserved. */
export function parseEfpsValue(p) {
  const raw = p == null ? '' : String(p).trim();
  const parts = raw.split(/\s+vs\s+/i).map((s) => s.trim());
  const nums = parts.map((s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null));
  if (parts.length === 1) {
    return nums[0] != null && nums[0] > 0
      ? { kind: 'single', values: [nums[0]], raw }
      : { kind: 'malformed', values: [], raw, reason: nums[0] == null ? 'not-a-number' : 'non-positive' };
  }
  if (parts.length === 2) {
    if (nums.some((n) => n == null)) return { kind: 'malformed', values: [], raw, reason: 'comparison-side-not-a-number' };
    if (nums.some((n) => n <= 0)) return { kind: 'malformed', values: [], raw, reason: 'non-positive' };
    return { kind: 'comparison', values: nums, raw };
  }
  return { kind: 'malformed', values: [], raw, reason: `unexpected-side-count:${parts.length}` };
}

/**
 * Parses the title `t`. Comparison titles observed take the form
 * `<game> <A> vs <B> - <shared>`; direct titles take `<game> <tokens...>`.
 * The game prefix is NOT assumed or stripped by name — the title is only
 * used for the " vs " split and its side labels, both of which are
 * name-independent.
 */
export function parseEfpsTitle(t) {
  const raw = t == null ? '' : String(t).trim();
  const vsMatch = raw.match(/^(.*?)\s+vs\s+(.*)$/i);
  if (!vsMatch) return { hasVs: false, raw, sideALabel: null, sideBLabel: null, sharedLabel: null };
  // Left side: the token immediately before " vs " is the compared part;
  // anything earlier is the game name (which may itself contain spaces).
  const leftTokens = vsMatch[1].split(/\s+/);
  const sideALabel = leftTokens[leftTokens.length - 1] || null;
  // Right side: `<B> - <shared>`; the " - " separator is optional.
  const rightMatch = vsMatch[2].match(/^(.*?)\s+-\s+(.*)$/);
  const sideBLabel = (rightMatch ? rightMatch[1] : vsMatch[2]).trim() || null;
  const sharedLabel = rightMatch ? rightMatch[2].trim() : null;
  return { hasVs: true, raw, sideALabel, sideBLabel, sharedLabel };
}

/** Resolves which URL variant group a title-side label came from, by matching
 * the label against that group's own field values. Returns 'A' | 'B' | null.
 * Never falls back to positional assumption. */
function resolveVariantForLabel(label, parsedUrl) {
  if (!label || !parsedUrl) return null;
  const inGroup = (g) => g && (g.gpu === label || g.cpu === label);
  const inA = inGroup(parsedUrl.variantA);
  const inB = inGroup(parsedUrl.variantB);
  if (inA && !inB) return 'A';
  if (inB && !inA) return 'B';
  return null; // absent, or ambiguous because both groups carry the same token
}

/**
 * Extracts every EFPS object from a saved page's raw text.
 *
 * Returns { records[], rejected[], stats }. Malformed records are NEVER
 * silently dropped — each lands in `rejected` with a reason and its raw
 * source text.
 *
 * @param {string} html    raw saved page source
 * @param {object} context { sourceFile, gameId, gameName, sourceUrl }
 */
export function extractEfpsRecords(html, context = {}) {
  const { sourceFile = null, gameId = null, gameName = null, sourceUrl = null } = context;
  const records = [];
  const rejected = [];
  const seenRaw = new Map(); // exact raw object text -> first index, for duplicate detection

  let m;
  EFPS_OBJECT_RE.lastIndex = 0;
  let ordinal = 0;
  while ((m = EFPS_OBJECT_RE.exec(html)) !== null) {
    const rawObject = m[0];
    const url = m[2];
    const title = m[4];
    const pRaw = m[6];
    const index = ordinal++;

    // Only EFPS URLs are in scope; anything else shaped like {id,t,p} is
    // reported rather than assumed to be EFPS.
    if (!url.startsWith(EFPS_URL_PREFIX)) {
      rejected.push({
        reason: 'not-an-efps-url',
        detail: `id did not start with ${EFPS_URL_PREFIX}`,
        rawObject,
        rawUrl: url,
        rawTitle: title,
        rawValue: pRaw,
        sourceFile,
        index,
      });
      continue;
    }

    const parsedUrl = parseEfpsUrl(url);
    if (!parsedUrl) {
      rejected.push({
        reason: 'unparseable-efps-url',
        detail: 'payload was not 3 underscore-separated groups of 4 comma-separated fields',
        rawObject,
        rawUrl: url,
        rawTitle: title,
        rawValue: pRaw,
        sourceFile,
        index,
      });
      continue;
    }

    const value = parseEfpsValue(pRaw);
    const parsedTitle = parseEfpsTitle(title);

    // --- Structural classification (primary, name-independent) ---
    const hasVariantData =
      Object.entries(parsedUrl.variantA).some(([k, v]) => k !== 'raw' && v != null) ||
      Object.entries(parsedUrl.variantB).some(([k, v]) => k !== 'raw' && v != null);
    const structuralKind = hasVariantData ? 'comparison' : 'direct';

    // --- Independent cross-checks ---
    const warnings = [];
    if (value.kind === 'comparison' && structuralKind !== 'comparison') {
      warnings.push('value has two sides but URL carries no comparison variants');
    }
    if (value.kind === 'single' && structuralKind === 'comparison') {
      warnings.push('URL carries comparison variants but value has a single side');
    }
    if (parsedTitle.hasVs !== (structuralKind === 'comparison')) {
      warnings.push(`title " vs " marker (${parsedTitle.hasVs}) disagrees with URL structure (${structuralKind})`);
    }

    if (value.kind === 'malformed') {
      rejected.push({
        reason: 'malformed-fps-value',
        detail: value.reason,
        rawObject,
        rawUrl: url,
        rawTitle: title,
        rawValue: pRaw,
        structuralKind,
        sourceFile,
        index,
      });
      continue;
    }

    const duplicateOf = seenRaw.has(rawObject) ? seenRaw.get(rawObject) : null;
    if (duplicateOf == null) seenRaw.set(rawObject, index);

    const base = {
      index,
      kind: structuralKind,
      gameId,
      gameName,
      efpsGameToken: parsedUrl.base.game,
      exactTitle: title,
      exactValue: pRaw,
      efpsUrl: url,
      rawUrlPayload: parsedUrl.rawPayload,
      rawObject,
      sourceFile,
      sourceUrl,
      extractorVersion: EFPS_EXTRACTOR_VERSION,
      isExactDuplicateOfIndex: duplicateOf,
      warnings,
      // Undocumented URL field, preserved but never interpreted.
      unresolvedFields: [parsedUrl.variantA, parsedUrl.variantB, parsedUrl.base]
        .map((g, gi) => (g.field3 != null ? { group: gi + 1, field: 3, value: g.field3 } : null))
        .filter(Boolean),
    };

    if (structuralKind === 'direct') {
      records.push({
        ...base,
        fps: value.values[0],
        config: { game: parsedUrl.base.game, gpu: parsedUrl.base.gpu, cpu: parsedUrl.base.cpu },
      });
    } else {
      // Pair each title side with its value by POSITION WITHIN t/p (reliable),
      // then resolve which URL group it came from by TOKEN MATCH (never by
      // position).
      const sides = [
        { label: parsedTitle.sideALabel, fps: value.values[0] },
        { label: parsedTitle.sideBLabel, fps: value.values[1] },
      ].map((s) => {
        const variant = resolveVariantForLabel(s.label, parsedUrl);
        const group = variant === 'A' ? parsedUrl.variantA : variant === 'B' ? parsedUrl.variantB : null;
        return {
          label: s.label,
          fps: s.fps ?? null,
          resolvedVariant: variant,
          gpu: group ? group.gpu : null,
          cpu: group ? group.cpu : null,
          variantResolved: variant != null,
        };
      });
      if (sides.some((s) => !s.variantResolved)) {
        warnings.push('could not match a title side to a URL variant group by token — side kept with raw label only');
      }
      records.push({
        ...base,
        sides,
        sharedConfig: {
          game: parsedUrl.base.game,
          gpu: parsedUrl.base.gpu,
          cpu: parsedUrl.base.cpu,
          sharedLabel: parsedTitle.sharedLabel,
        },
        variantA: parsedUrl.variantA,
        variantB: parsedUrl.variantB,
      });
    }
  }

  const direct = records.filter((r) => r.kind === 'direct');
  const comparisons = records.filter((r) => r.kind === 'comparison');
  return {
    records,
    rejected,
    stats: {
      total: records.length + rejected.length,
      accepted: records.length,
      direct: direct.length,
      comparisons: comparisons.length,
      rejected: rejected.length,
      exactDuplicates: records.filter((r) => r.isExactDuplicateOfIndex != null).length,
      withWarnings: records.filter((r) => r.warnings.length > 0).length,
      unresolvedVariantSides: comparisons.reduce((n, r) => n + r.sides.filter((s) => !s.variantResolved).length, 0),
    },
  };
}
