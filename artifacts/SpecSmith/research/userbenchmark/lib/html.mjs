// Shared, dependency-free HTML/text helpers used by every parser in this
// directory. Pure functions only — no I/O, no network.

/** Decodes the small set of HTML entities UserBenchmark's templates actually
 * emit. Deliberately not a general entity decoder: an unknown entity should
 * survive verbatim into the output (and be visible as a bug) rather than be
 * silently mangled by a half-right lookup table. */
export function decodeEntities(s) {
  if (s == null) return s;
  return String(s)
    // U+00A0. UserBenchmark's title template emits it (the Shadow of the Tomb
    // Raider page ends "...Tomb Raider&nbsp; "), so it belongs in the set of
    // entities this decoder covers. Decoding it before the trim below also
    // lets a trailing one be trimmed, which is what leaves the name clean.
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Parses "1,234" / "1234" / "1,234x" to a number. Returns null (never NaN,
 * never 0) when the input isn't a clean integer, so callers can distinguish
 * "absent" from "genuinely zero". */
export function parseIntLoose(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[,x]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Pulls the first signed decimal out of a percentage cell like "24%" or
 * "-3.5 %". Returns null when there is no number at all. */
export function parsePercent(s) {
  if (s == null) return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Splits a JS array literal's inner text into values, converting anything
 * that is exactly an integer/decimal into a Number and leaving everything
 * else as a trimmed, unquoted string. */
export function parseArrayLiteral(raw) {
  if (raw == null) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const unquoted = s.replace(/^["']|["']$/g, '');
      return /^-?\d+(\.\d+)?$/.test(unquoted) ? Number(unquoted) : unquoted;
    });
}

// ---------------------------------------------------------------------------
// UserBenchmark game-page filter path
// ---------------------------------------------------------------------------
/**
 * A game page URL ends in a 5-segment dot-separated filter path, e.g.
 * `153864.0.0.0.0`. Two positions are PROVEN from the page's own markup
 * (see efps/configuration-analysis.md):
 *
 *   [0] GPU id  — every row in the GPU table links to a path with only [0] set
 *   [1] CPU id  — every row in the CPU table links to a path with only [1] set
 *   [4] CPU family text filter — the i3/i5/i7/i9/Ryzen/FX/Athlon/Pentium
 *       quick-filter buttons produce paths with only [4] set, to a literal
 *       family name rather than an id
 *
 * Positions [2] and [3] are NEVER populated by any link on any saved source,
 * so their meaning is UNKNOWN. They are deliberately NOT named
 * "resolutionFilter"/"settingsFilter" — that would be an invented meaning.
 * They are preserved as raw positional values and flagged unresolved.
 */
export const FILTER_PATH_POSITIONS = Object.freeze({
  0: { name: 'gpuId', status: 'proven' },
  1: { name: 'cpuId', status: 'proven' },
  2: { name: 'position2', status: 'unresolved' },
  3: { name: 'position3', status: 'unresolved' },
  4: { name: 'cpuFamilyFilter', status: 'proven' },
});

export function parseFilterSegments(pathTail) {
  if (pathTail == null) return null;
  const parts = String(pathTail).split('.');
  const val = (i) => (parts[i] && parts[i] !== '0' ? parts[i] : null);
  const position2 = val(2);
  const position3 = val(3);
  return {
    raw: String(pathTail),
    positions: parts,
    gpuId: val(0),
    cpuId: val(1),
    cpuFamilyFilter: val(4),
    // Undocumented positions — preserved raw, never reinterpreted.
    position2,
    position3,
    unresolvedPositions: [
      ...(position2 != null ? [{ index: 2, value: position2 }] : []),
      ...(position3 != null ? [{ index: 3, value: position3 }] : []),
    ],
  };
}
