// Cleaning stage: duplicates, plausibility, outliers.
//
// WHAT THESE METRICS ARE - AND ARE NOT
// ------------------------------------
// UserBenchmark publishes composite SCORES, not frames per second:
//
//   benchPercent   a 0-100 composite performance score for the component
//                  within that game's sample set. NOT FPS.
//   valuePercent   a 0-100 price/performance score. NOT FPS.
//   samples        how many user submissions the row aggregates.
//
// Nothing in this pipeline converts any of them into FPS, and every cleaned
// row carries its metric definitions with it so a later reader cannot mistake
// a score for a measurement. This is the single rule the whole file exists to
// protect.

/**
 * benchPercent is a standing within one page's sample set, so it is bounded.
 * valuePercent deliberately has NO upper bound - see inspectRow.
 */
export const MAX_BENCH_PERCENT = 100;

/** Collision-resistant separator for composite keys - cannot occur in a name. */
const KEY_SEP = '\u0001';

export const METRIC_DEFINITIONS = Object.freeze({
  benchPercent:
    "UserBenchmark composite performance score (0-100) for this component within this game's sample set. NOT frames per second. Must never be converted to FPS.",
  valuePercent:
    'UserBenchmark price/performance score, expressed as a percentage of a baseline. NOT frames per second, and NOT bounded at 100 - a part offering better-than-baseline value scores above it (this corpus publishes up to 131%).',
  samples: 'Number of user submissions aggregated into this row. Not a measurement of performance.',
  priceUsd: 'Retail price in USD as displayed by UserBenchmark at capture time. Volatile; not a performance metric.',
});

export const FLAG = Object.freeze({
  MISSING_FIELD: 'missing-field',
  MALFORMED: 'malformed',
  IMPOSSIBLE: 'impossible-value',
  UNMATCHED_HARDWARE: 'unmatched-hardware',
  FORM_FACTOR_BLOCKED: 'form-factor-blocked',
  EXACT_DUPLICATE: 'exact-duplicate',
  SUSPICIOUS_DUPLICATE: 'suspicious-duplicate',
  OUTLIER: 'outlier',
});

/** Fields without which a row cannot be interpreted at all. */
const REQUIRED = ['gameId', 'componentName', 'componentKind'];

/**
 * Structural checks on one row.
 *
 * Every finding names the field and why. Nothing is repaired or defaulted -
 * a row that fails is flagged and routed to review, never silently corrected.
 */
export function inspectRow(row) {
  const flags = [];

  for (const f of REQUIRED) {
    if (row[f] === undefined || row[f] === null || row[f] === '') {
      flags.push({ flag: FLAG.MISSING_FIELD, field: f, detail: `Required field "${f}" is absent.` });
    }
  }

  for (const f of ['benchPercent', 'valuePercent']) {
    const v = row[f];
    // Absent is legitimate: UserBenchmark renders "-" for rows it has no score
    // for. That is a source gap, not a malformed value.
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      flags.push({ flag: FLAG.MALFORMED, field: f, detail: `${f} is ${JSON.stringify(v)}, not a finite number.` });
      continue;
    }
    if (v < 0) {
      flags.push({ flag: FLAG.IMPOSSIBLE, field: f, detail: `${f} is ${v}; neither score can be negative.` });
      continue;
    }
    // benchPercent is a 0-100 standing WITHIN the page's sample set, so a
    // value above 100 would not be the metric it claims to be.
    //
    // valuePercent is NOT bounded at 100 and must not be checked as if it
    // were. It is price/performance against a baseline, so a part offering
    // better-than-baseline value legitimately scores above it — the corpus
    // publishes up to 131% (e.g. the Arma 3 page's GTX 1070-Ti row reads
    // "39% | 102%" in the raw HTML). Treating those as impossible flagged 254
    // faithfully-parsed rows as broken and invited someone to "repair" correct
    // source data by clamping it.
    if (f === 'benchPercent' && v > MAX_BENCH_PERCENT) {
      flags.push({ flag: FLAG.IMPOSSIBLE, field: f, detail: `${f} is ${v}; a within-page standing cannot exceed ${MAX_BENCH_PERCENT}.` });
    }
  }

  if (row.samples !== null && row.samples !== undefined) {
    if (typeof row.samples !== 'number' || !Number.isInteger(row.samples)) {
      flags.push({ flag: FLAG.MALFORMED, field: 'samples', detail: `samples is ${JSON.stringify(row.samples)}, not an integer.` });
    } else if (row.samples < 0) {
      flags.push({ flag: FLAG.IMPOSSIBLE, field: 'samples', detail: `samples is ${row.samples}; a count cannot be negative.` });
    }
  }

  if (row.priceUsd !== null && row.priceUsd !== undefined && (typeof row.priceUsd !== 'number' || !(row.priceUsd > 0))) {
    flags.push({ flag: FLAG.IMPOSSIBLE, field: 'priceUsd', detail: `priceUsd is ${JSON.stringify(row.priceUsd)}; a price must be a positive number.` });
  }

  return flags;
}

/** The values that decide whether two rows for the same key agree. */
const COMPARED = ['benchPercent', 'valuePercent', 'samples', 'priceUsd'];

/**
 * Splits repeats into exact duplicates and suspicious ones.
 *
 * EXACT      same (game, kind, component) AND identical values - safe to
 *            collapse, since one is a redundant copy of the other.
 * SUSPICIOUS same key, DIFFERENT values - never collapsed. Two different
 *            answers to the same question means one of them is wrong, and
 *            picking either would be a guess. Both go to review with the
 *            conflicting values attached.
 */
export function findDuplicates(rows) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const key = [row.gameId, row.componentKind, String(row.componentName ?? '').toLowerCase()].join(KEY_SEP);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, row });
  }

  const exact = [];
  const suspicious = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sig = (r) => JSON.stringify(COMPARED.map((f) => r[f] ?? null));
    const distinct = new Set(members.map((m) => sig(m.row)));
    if (distinct.size === 1) {
      exact.push({
        key,
        keptIndex: members[0].index,
        duplicateIndexes: members.slice(1).map((m) => m.index),
        count: members.length,
      });
    } else {
      suspicious.push({
        key,
        indexes: members.map((m) => m.index),
        distinctValueSets: [...distinct],
        detail: `${members.length} rows share (game, component) but report ${distinct.size} different value sets. Not collapsed - one of them is wrong and choosing would be a guess.`,
      });
    }
  }
  return { exact, suspicious };
}

/** Median and median absolute deviation - robust to the outliers being looked for. */
function medianAndMad(values) {
  if (values.length === 0) return { median: null, mad: null };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: deviations[Math.floor(deviations.length / 2)] };
}

/**
 * Flags values far from their peer group, reported separately and never dropped.
 *
 * Grouped PER GAME, because a component's composite score is only meaningful
 * relative to the other components measured on that same page. Comparing a
 * score across games would manufacture outliers that do not exist.
 *
 * Uses median/MAD rather than mean/standard deviation: the mean is dragged by
 * the very values being looked for. A modified z-score above 3.5 is the
 * conventional threshold, applied as a REPORTING trigger and never as a
 * deletion - an unusual value may simply be unusual.
 */
export function findOutliers(rows, field = 'benchPercent', threshold = 3.5) {
  const byGame = new Map();
  for (const [index, row] of rows.entries()) {
    const v = row[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!byGame.has(row.gameId)) byGame.set(row.gameId, []);
    byGame.get(row.gameId).push({ index, value: v, row });
  }

  const outliers = [];
  for (const [gameId, members] of byGame) {
    // Too few peers for the comparison to mean anything.
    if (members.length < 5) continue;
    const { median, mad } = medianAndMad(members.map((m) => m.value));
    // A group with no spread has no outliers by this measure.
    if (!mad) continue;
    for (const m of members) {
      const score = (0.6745 * (m.value - median)) / mad;
      if (Math.abs(score) > threshold) {
        outliers.push({
          index: m.index,
          gameId,
          field,
          value: m.value,
          median,
          modifiedZScore: Math.round(score * 100) / 100,
          componentName: m.row.componentName,
          detail: `${field} ${m.value} against a per-game median of ${median} (modified z ${Math.round(score * 100) / 100}). Reported, not removed - an unusual value may be genuine.`,
        });
      }
    }
  }
  return outliers;
}
