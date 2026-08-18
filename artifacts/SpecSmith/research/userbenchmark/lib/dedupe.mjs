// Deterministic deduplication and conflict detection.
//
// RESEARCH-ONLY. Pure functions, no I/O.
//
// The distinction that matters here:
//
//   DUPLICATE  — same identity key AND same compared values. Safe to collapse;
//                the extra copies are recorded as duplicates, not discarded
//                silently.
//   CONFLICT   — same identity key but DIFFERENT values. NEVER collapsed.
//                Both sides are kept and emitted to conflicts.jsonl, because
//                picking a winner would be inventing data.
//
// Records are never merged because values merely "look similar". Equality is
// exact on the declared comparison fields.
//
// All grouping is Map/Set-based — O(n) over the record set, not O(n²).

/** Stable JSON for value comparison: object keys sorted, so key order in the
 * source can't make two identical records look different. */
function stableValue(obj, fields) {
  const out = {};
  for (const f of [...fields].sort()) out[f] = obj[f] === undefined ? null : obj[f];
  return JSON.stringify(out, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/**
 * @param {object[]} records      records carrying an `observationKey`
 * @param {string[]} valueFields  fields whose equality decides duplicate vs conflict
 * @returns {{unique, duplicates, conflicts, stats}}
 */
export function dedupe(records, valueFields) {
  const byKey = new Map();
  for (const r of records) {
    const key = r.observationKey ?? JSON.stringify(r);
    let bucket = byKey.get(key);
    if (!bucket) byKey.set(key, (bucket = []));
    bucket.push(r);
  }

  const unique = [];
  const duplicates = [];
  const conflicts = [];

  for (const [key, bucket] of byKey) {
    if (bucket.length === 1) {
      unique.push(bucket[0]);
      continue;
    }
    // Group this key's records by their compared value signature.
    const byValue = new Map();
    for (const r of bucket) {
      const sig = stableValue(r, valueFields);
      let g = byValue.get(sig);
      if (!g) byValue.set(sig, (g = []));
      g.push(r);
    }

    if (byValue.size === 1) {
      // Same key, same values → a genuine duplicate.
      const [first, ...rest] = bucket;
      unique.push(first);
      for (const d of rest) {
        duplicates.push({
          recordType: 'duplicate',
          observationKey: key,
          duplicateOf: {
            sourceFile: first.provenance?.sourceFile ?? null,
            rawSourceIdentifier: first.provenance?.rawSourceIdentifier ?? null,
          },
          record: d,
        });
      }
      continue;
    }

    // Same key, different values → a conflict. Keep every distinct variant.
    const variants = [...byValue.entries()].map(([sig, rs]) => ({
      valueSignature: sig,
      occurrences: rs.length,
      sources: rs.map((r) => ({
        sourceFile: r.provenance?.sourceFile ?? null,
        rawSourceIdentifier: r.provenance?.rawSourceIdentifier ?? null,
      })),
      sample: rs[0],
    }));
    conflicts.push({
      recordType: 'conflict',
      observationKey: key,
      comparedFields: valueFields,
      variantCount: variants.length,
      note: 'Same identity key with differing values. NOT collapsed — no winner was chosen, because that would invent data. All variants preserved below.',
      variants,
    });
    // Every conflicting variant still goes to `unique`, flagged, so the main
    // dataset never silently loses an observation.
    for (const v of variants) unique.push({ ...v.sample, quality: 'conflicting', conflictKey: key });
  }

  return {
    unique,
    duplicates,
    conflicts,
    stats: {
      input: records.length,
      unique: unique.length,
      duplicatesRemoved: duplicates.length,
      conflictKeys: conflicts.length,
    },
  };
}

/** Duplicate source pages: two saved files that resolve to the same gameId. */
export function findDuplicateSourcePages(parsedPages) {
  const byGame = new Map();
  for (const p of parsedPages) {
    if (!p.game?.gameId) continue;
    let g = byGame.get(p.game.gameId);
    if (!g) byGame.set(p.game.gameId, (g = []));
    g.push(p._meta.sourceFile);
  }
  return [...byGame.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([gameId, files]) => ({ gameId, files, note: 'Multiple saved sources resolve to the same gameId — later parses may overwrite earlier output.' }));
}

/** The value-field sets each dataset compares on. Kept here so dedup
 * behaviour is declared in one place rather than scattered at call sites. */
export const VALUE_FIELDS = Object.freeze({
  games: ['averageFps', 'totalSamples'],
  gpuObservations: ['samples', 'benchPercent', 'valuePercent'],
  cpuObservations: ['samples', 'benchPercent', 'valuePercent'],
  efpsDirect: ['fps'],
  efpsComparisons: ['exactValue'],
  distributions: ['labels', 'data'],
  configurations: ['gpuId', 'cpuId', 'cpuFamilyFilter', 'position2', 'position3'],
});
