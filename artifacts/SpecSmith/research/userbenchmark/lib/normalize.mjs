// Turns a parsed game page into flat, provenance-carrying dataset records.
//
// RESEARCH-ONLY. Pure functions. No I/O, no network.
//
// Design rule: normalization ADDS structure, it never replaces raw values.
// Every record keeps the exact source text it came from alongside any parsed
// form, so the raw extraction is always recoverable from the dataset itself.
//
// Explicitly NOT done here:
//   - No FPS is inferred, interpolated, averaged or filled in.
//   - Bench % / Value % are carried as their own fields and are NEVER
//     converted into FPS. They are UserBenchmark's own composite scores and
//     have no defined FPS relationship.
//   - No configuration dimension is invented for undocumented URL fields.

import { SOURCE_NAME, PARSER_VERSION } from './version.mjs';

/** Research-quality classification. Deliberately conservative: parsing
 * cleanly earns "structurally-validated", nothing more. Nothing produced by
 * this pipeline is ever "verified benchmark ground truth" — these are
 * crowd-sourced, self-reported values from an aggregator. */
export const QUALITY = Object.freeze({
  EXTRACTED: 'extracted',
  STRUCTURALLY_VALIDATED: 'structurally-validated',
  CONFIGURATION_DECODED: 'configuration-decoded',
  CONFIGURATION_UNRESOLVED: 'configuration-unresolved',
  CONFLICTING: 'conflicting',
  REJECTED: 'rejected',
});

/** Per-record provenance.
 *
 * Deliberately carries NO wall-clock timestamp. A timestamp in every record
 * would make the emitted datasets differ on every run even when the inputs are
 * identical, which destroys byte-level diffability and makes it impossible to
 * tell a real data change from a re-run. Run time is recorded once, in
 * coverage.json and the reports.
 *
 * `sourceContentSha256` replaces it as the provenance anchor: it is
 * deterministic, and it pins the record to the exact bytes it came from — so a
 * silently edited or re-saved source is detectable, which a timestamp could
 * never tell you. */
function provenance(parsed, extra = {}) {
  return {
    source: SOURCE_NAME,
    gameId: parsed.game?.gameId ?? null,
    sourceUrl: parsed.game?.canonicalUrl ?? null,
    sourceFile: parsed._meta.sourceFile,
    sourceContentSha256: parsed._meta.sourceContentSha256 ?? null,
    parserVersion: PARSER_VERSION,
    ...extra,
  };
}

/** A stable identity for an observation, used for dedup and conflict
 * detection. Deterministic: same inputs always produce the same key. */
export function observationKey(parts) {
  return parts.map((p) => (p == null ? '' : String(p).trim().toLowerCase())).join('');
}

export function normalizeGame(parsed) {
  const hist = parsed.fpsHistogram ?? {};
  const chartsOk =
    (hist.labels?.length ?? 0) > 0 &&
    hist.labels.length === (hist.data?.length ?? -1);
  return {
    recordType: 'game',
    gameId: parsed.game.gameId,
    name: parsed.game.name,
    slug: parsed.game.slug,
    canonicalUrl: parsed.game.canonicalUrl,
    /** How this page's game identity was established: 'canonical' when the
     * page carried a canonical link, 'inferred-from-self-links' when it did
     * not and identity came from corroborated self-references. Carried into
     * the dataset so a consumer can tell the two apart rather than assuming
     * every row was canonically anchored. */
    identitySource: parsed.game.identitySource ?? null,
    identityEvidence: parsed.game.identityEvidence ?? null,
    rawFilterPath: parsed.game.filterSegments?.raw ?? null,
    filterSegments: parsed.game.filterSegments,
    averageFps: parsed.sampleSummary.averageFps,
    totalSamples: parsed.sampleSummary.totalSamples,
    /* UserBenchmark's OWN reliability flag, not a threshold of ours. Pages
     * with too little data render their average in a red "only N samples"
     * warning instead of the neutral count. Carried into the dataset so a
     * consumer never has to guess whether a figure was published with
     * confidence: true means the source itself disclaimed it. */
    lowSampleWarning: parsed.sampleSummary.lowSampleWarning ?? null,
    gpuRowCount: parsed.gpuTable.length,
    cpuRowCount: parsed.cpuTable.length,
    efpsRecordCount: parsed.efps.stats.accepted,
    efpsDirectCount: parsed.efps.stats.direct,
    efpsComparisonCount: parsed.efps.stats.comparisons,
    hasFpsHistogram: chartsOk,
    hasSettingsDistribution: (parsed.settingsDistribution?.labels?.length ?? 0) > 0,
    hasResolutionDistribution: (parsed.resolutionDistribution?.labels?.length ?? 0) > 0,
    quality: parsed._meta.warnings.length === 0 ? QUALITY.STRUCTURALLY_VALIDATED : QUALITY.EXTRACTED,
    warnings: parsed._meta.warnings,
    provenance: provenance(parsed, { extractionMethod: 'game-page:identity+summary' }),
  };
}

/** Component table rows → observations. Bench%/Value% are carried verbatim
 * and flagged as NOT FPS, so no downstream consumer can mistake them. */
export function normalizeComponentObservations(parsed, kind) {
  const table = kind === 'gpu' ? parsed.gpuTable : parsed.cpuTable;
  return table.map((row, i) => ({
    recordType: `${kind}-observation`,
    gameId: parsed.game.gameId,
    gameName: parsed.game.name,
    componentKind: kind,
    componentName: row.name,
    componentRatingId: row.componentRatingId,
    componentPageUrl: row.componentPageUrl,
    samples: row.samples,
    // UserBenchmark's own composite scores. NOT FPS. Never convertible to FPS.
    benchPercent: row.benchPercent,
    valuePercent: row.valuePercent,
    scoreNote: 'benchPercent/valuePercent are UserBenchmark composite scores, NOT frames per second, and must never be converted into FPS.',
    priceUsd: row.priceUsd,
    priceStore: row.priceStore,
    priceUrl: row.priceUrl,
    gameFilterUrl: row.gameFilterUrl,
    rawFilterPath: row.filterSegments?.raw ?? null,
    filterSegments: row.filterSegments,
    unresolvedFilterPositions: row.filterSegments?.unresolvedPositions ?? [],
    observationKey: observationKey([parsed.game.gameId, kind, row.name]),
    quality: row.name && row.samples != null ? QUALITY.STRUCTURALLY_VALIDATED : QUALITY.EXTRACTED,
    provenance: provenance(parsed, { extractionMethod: `game-page:${kind}Table`, rawSourceIdentifier: `${kind}Table[${i}]` }),
  }));
}

/** Direct EFPS records → one measured FPS per (game, GPU, CPU). */
export function normalizeEfpsDirect(parsed) {
  return parsed.efps.records
    .filter((r) => r.kind === 'direct')
    .map((r) => ({
      recordType: 'efps-direct',
      gameId: parsed.game.gameId,
      gameName: parsed.game.name,
      efpsGameToken: r.efpsGameToken,
      exactTitle: r.exactTitle,
      exactValue: r.exactValue,
      fps: r.fps,
      gpu: r.config.gpu,
      cpu: r.config.cpu,
      efpsUrl: r.efpsUrl,
      rawUrlPayload: r.rawUrlPayload,
      // Configuration status: game/GPU/CPU are proven positions; the 4th
      // field is undocumented. It is never populated in any saved source, so
      // decoding is complete for every record seen so far.
      configurationStatus: r.unresolvedFields.length === 0 ? QUALITY.CONFIGURATION_DECODED : QUALITY.CONFIGURATION_UNRESOLVED,
      unresolvedFields: r.unresolvedFields,
      observationKey: observationKey([parsed.game.gameId, 'efps-direct', r.config.gpu, r.config.cpu]),
      quality: r.warnings.length === 0 ? QUALITY.STRUCTURALLY_VALIDATED : QUALITY.EXTRACTED,
      warnings: r.warnings,
      provenance: provenance(parsed, { extractionMethod: 'efps:direct', rawSourceIdentifier: `efps[${r.index}]`, extractorVersion: r.extractorVersion }),
    }));
}

/** Comparison EFPS records. Kept as their own record type — a comparison is
 * NOT split into two direct records, because doing so would silently
 * manufacture observations the source didn't publish as standalone. */
export function normalizeEfpsComparisons(parsed) {
  return parsed.efps.records
    .filter((r) => r.kind === 'comparison')
    .map((r) => ({
      recordType: 'efps-comparison',
      gameId: parsed.game.gameId,
      gameName: parsed.game.name,
      efpsGameToken: r.efpsGameToken,
      exactTitle: r.exactTitle,
      exactValue: r.exactValue,
      sides: r.sides.map((s) => ({
        label: s.label,
        fps: s.fps,
        gpu: s.gpu ?? r.sharedConfig.gpu,
        cpu: s.cpu ?? r.sharedConfig.cpu,
        resolvedVariant: s.resolvedVariant,
        variantResolvedByTokenMatch: s.variantResolved,
      })),
      sharedConfig: r.sharedConfig,
      variantA: r.variantA,
      variantB: r.variantB,
      efpsUrl: r.efpsUrl,
      rawUrlPayload: r.rawUrlPayload,
      configurationStatus:
        r.unresolvedFields.length === 0 && r.sides.every((s) => s.variantResolved)
          ? QUALITY.CONFIGURATION_DECODED
          : QUALITY.CONFIGURATION_UNRESOLVED,
      unresolvedFields: r.unresolvedFields,
      observationKey: observationKey([parsed.game.gameId, 'efps-comparison', r.efpsUrl]),
      quality: r.warnings.length === 0 ? QUALITY.STRUCTURALLY_VALIDATED : QUALITY.EXTRACTED,
      warnings: r.warnings,
      provenance: provenance(parsed, { extractionMethod: 'efps:comparison', rawSourceIdentifier: `efps[${r.index}]`, extractorVersion: r.extractorVersion }),
    }));
}

/** The three chart datasets, kept with their exact source labels and arrays. */
export function normalizeDistributions(parsed) {
  const out = [];
  const push = (name, chart, note) => {
    out.push({
      recordType: 'distribution',
      distribution: name,
      gameId: parsed.game.gameId,
      gameName: parsed.game.name,
      labels: chart?.labels ?? [],
      data: chart?.data ?? [],
      rawLabels: chart?.rawLabels ?? null,
      rawData: chart?.rawData ?? null,
      labelCount: chart?.labels?.length ?? 0,
      dataCount: chart?.data?.length ?? 0,
      lengthsMatch: (chart?.labels?.length ?? 0) === (chart?.data?.length ?? -1),
      note,
      quality: (chart?.labels?.length ?? 0) > 0 && (chart?.labels?.length ?? 0) === (chart?.data?.length ?? -1)
        ? QUALITY.STRUCTURALLY_VALIDATED
        : QUALITY.EXTRACTED,
      observationKey: observationKey([parsed.game.gameId, 'distribution', name]),
      provenance: provenance(parsed, { extractionMethod: `game-page:chart:${name}` }),
    });
  };
  push('fpsHistogram', parsed.fpsHistogram, 'FPS buckets → sample counts.');
  push('settings', parsed.settingsDistribution, 'Quality preset → sample count, using the source\'s exact labels.');
  push('resolution', parsed.resolutionDistribution, 'Resolution → sample count, using the source\'s exact labels.');
  return out;
}

/** Every distinct filter-path configuration this page exposes, with the
 * undocumented positions preserved and flagged rather than named. */
export function normalizeConfigurations(parsed) {
  const seen = new Set();
  const out = [];
  const add = (seg, origin) => {
    if (!seg) return;
    const key = observationKey([parsed.game.gameId, seg.raw]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      recordType: 'configuration',
      gameId: parsed.game.gameId,
      gameName: parsed.game.name,
      rawFilterPath: seg.raw,
      positions: seg.positions,
      gpuId: seg.gpuId,
      cpuId: seg.cpuId,
      cpuFamilyFilter: seg.cpuFamilyFilter,
      position2: seg.position2,
      position3: seg.position3,
      unresolvedPositions: seg.unresolvedPositions,
      configurationStatus: seg.unresolvedPositions.length === 0 ? QUALITY.CONFIGURATION_DECODED : QUALITY.CONFIGURATION_UNRESOLVED,
      origin,
      positionSemantics: {
        0: 'gpuId (proven)',
        1: 'cpuId (proven)',
        2: 'UNRESOLVED — never populated in any saved source',
        3: 'UNRESOLVED — never populated in any saved source',
        4: 'cpuFamilyFilter (proven)',
      },
      observationKey: key,
      provenance: provenance(parsed, { extractionMethod: `game-page:filterPath:${origin}` }),
    });
  };
  add(parsed.game.filterSegments, 'canonical');
  for (const p of parsed.ownFilterPaths?.paths ?? []) add(p, 'ownFilterPaths');
  for (const r of parsed.gpuTable) add(r.filterSegments, 'gpuTable');
  for (const r of parsed.cpuTable) add(r.filterSegments, 'cpuTable');
  for (const f of parsed.brandFilterUrls) add(f.filterSegments, 'brandFilter');
  return out;
}

/** Rejected EFPS objects → dataset rows, so nothing is ever silently lost. */
export function normalizeRejected(parsed) {
  return parsed.efps.rejected.map((r) => ({
    recordType: 'rejected',
    stage: 'efps-extraction',
    reason: r.reason,
    detail: r.detail ?? null,
    gameId: parsed.game.gameId,
    gameName: parsed.game.name,
    rawObject: r.rawObject,
    rawUrl: r.rawUrl,
    rawTitle: r.rawTitle,
    rawValue: r.rawValue,
    quality: QUALITY.REJECTED,
    provenance: provenance(parsed, { extractionMethod: 'efps:rejected', rawSourceIdentifier: `efps[${r.index}]` }),
  }));
}

export function normalizeAll(parsed) {
  return {
    games: [normalizeGame(parsed)],
    gpuObservations: normalizeComponentObservations(parsed, 'gpu'),
    cpuObservations: normalizeComponentObservations(parsed, 'cpu'),
    efpsDirect: normalizeEfpsDirect(parsed),
    efpsComparisons: normalizeEfpsComparisons(parsed),
    distributions: normalizeDistributions(parsed),
    configurations: normalizeConfigurations(parsed),
    rejected: normalizeRejected(parsed),
  };
}
