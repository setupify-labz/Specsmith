import benchmarkRecordsData from '../../data/benchmarkRecords.json';
import gameFeatureProfilesData from '../../data/gameFeatureProfiles.json';
import estimatorGamesData from '../../data/games.json';
import estimatorGpusData from '../../data/gpus.json';
import estimatorCpusData from '../../data/cpus.json';
import type {
  BenchmarkRecord,
  GameFeatureProfile,
  Resolution,
  Preset,
  Upscaler,
  VerifiedFpsResult,
} from './types';

const benchmarkRecords = benchmarkRecordsData as BenchmarkRecord[];
const gameFeatureProfiles = gameFeatureProfilesData as GameFeatureProfile[];
const estimatorGameIds = new Set((estimatorGamesData as { id: string }[]).map((g) => g.id));
const estimatorGpuCount = (estimatorGpusData as { id: string }[]).length;
const estimatorCpuCount = (estimatorCpusData as { id: string }[]).length;

export interface VerifiedFpsQuery {
  gameId: string;
  cpuId: string;
  gpuId: string;
  resolution: Resolution;
  preset: Preset;
  rayTracing: boolean;
  upscaler: Upscaler;
  /**
   * Which DLSS/FSR/XeSS quality mode is being asked about (e.g. "Quality",
   * "Balanced"). Only meaningful when `upscaler !== 'native'`; leave
   * undefined for native. Undefined does NOT mean "any mode" — see
   * matchesUpscalerMode below.
   */
  upscalerMode?: string;
  frameGeneration: boolean;
}

/**
 * Exact upscaler-mode matching, split out and exported so it's directly
 * unit-testable without needing a full VerifiedFpsQuery/BenchmarkRecord.
 *
 * Rules (per the provenance spec — an unspecified mode must never silently
 * mean "any mode"):
 * - upscaler === 'native': mode doesn't apply to either side; always matches.
 * - upscaler !== 'native': both the query's requested mode and the record's
 *   confirmed mode must be present AND equal. If either side is missing a
 *   mode (query didn't ask for one, or the record's mode is an unconfirmed
 *   provenance gap — see BenchmarkRecord.upscalerMode's doc comment), that's
 *   a non-match, not a wildcard match. This is what stops "DLSS Quality"
 *   silently satisfying a query for "DLSS Performance" (or vice versa) once
 *   mode-specific records exist.
 */
export function matchesUpscalerMode(
  upscaler: Upscaler,
  queryMode: string | undefined,
  recordMode: string | undefined,
): boolean {
  if (upscaler === 'native') return true;
  return queryMode !== undefined && recordMode !== undefined && queryMode === recordMode;
}

export function getGameFeatureProfile(gameId: string): GameFeatureProfile | undefined {
  return gameFeatureProfiles.find((p) => p.gameId === gameId);
}

export function getVerifiedGames(): GameFeatureProfile[] {
  return gameFeatureProfiles;
}

/**
 * Exact-match lookup only — no interpolation, no nearby-benchmark scaling,
 * no formula fallback. This is deliberate: the whole point of this engine
 * is that every displayed number traces to a real source. See
 * types.ts / the project's benchmark-provenance spec for why.
 *
 * `records` defaults to the real bundled benchmarkRecords.json and normally
 * should never be overridden in application code — the parameter exists so
 * tests can exercise the matching logic (including upscalerMode, which no
 * real seeded record uses yet) against synthetic in-memory fixtures instead
 * of requiring fake entries in the actual "honest database."
 */
export function lookupVerifiedFps(query: VerifiedFpsQuery, records: BenchmarkRecord[] = benchmarkRecords): VerifiedFpsResult {
  const profile = getGameFeatureProfile(query.gameId);

  if (profile) {
    if (query.rayTracing && profile.rayTracing.status === 'unsupported') {
      return { state: 'UNSUPPORTED', featureNote: profile.rayTracing.notes ?? 'Ray tracing is not supported in this game.' };
    }
    if (query.rayTracing && profile.rayTracing.status === 'conditional') {
      return {
        state: 'CONDITIONAL',
        featureNote: `Ray tracing requires: ${(profile.rayTracing.requirements ?? []).join(', ')}`,
      };
    }
    if (query.upscaler !== 'native') {
      const support = profile[query.upscaler];
      if (support.status === 'unsupported') {
        return { state: 'UNSUPPORTED', featureNote: support.notes ?? `${query.upscaler.toUpperCase()} is not supported in this game.` };
      }
      if (support.status === 'conditional') {
        return { state: 'CONDITIONAL', featureNote: `${query.upscaler.toUpperCase()} requires: ${(support.requirements ?? []).join(', ')}` };
      }
    }
    if (query.frameGeneration && profile.frameGeneration.status === 'unsupported') {
      return { state: 'UNSUPPORTED', featureNote: profile.frameGeneration.notes ?? 'Frame Generation is not supported in this game.' };
    }
    if (query.frameGeneration && profile.frameGeneration.status === 'conditional') {
      return {
        state: 'CONDITIONAL',
        featureNote: `Frame Generation requires: ${(profile.frameGeneration.requirements ?? []).join(', ')}`,
      };
    }
  }

  const record = records.find(
    (r) =>
      r.gameId === query.gameId &&
      r.cpuId === query.cpuId &&
      r.gpuId === query.gpuId &&
      r.resolution === query.resolution &&
      r.preset === query.preset &&
      r.rayTracing === query.rayTracing &&
      r.upscaler === query.upscaler &&
      matchesUpscalerMode(query.upscaler, query.upscalerMode, r.upscalerMode) &&
      r.frameGeneration === query.frameGeneration,
  );

  if (!record) return { state: 'NOT_AVAILABLE' };
  return { state: 'MEASURED', record };
}

export interface CoverageSummary {
  totalRecords: number;
  games: { id: string; name: string; recordCount: number }[];
  cpus: string[];
  gpus: string[];
  sources: { url: string; publisher: string; recordCount: number }[];
  /** Size of the Estimator's own catalog, for computing "N of M" coverage against it. */
  estimatorCatalogSize: { games: number; gpus: number; cpus: number };
  /**
   * Verified-games (gameFeatureProfiles) whose gameId does NOT appear in
   * the Estimator's games.json — real, honest, and worth surfacing: it
   * means that game's measured data is reachable only from the Verified
   * Benchmarks panel and nowhere else on the site (not the Estimator, not
   * matchup pages, not tier lists), since every other surface reads from
   * games.json. Not an error — profiles are allowed to cover games outside
   * the Estimator's roster — but a real discoverability gap.
   */
  gamesNotInEstimatorCatalog: string[];
}

export function getCoverageSummary(): CoverageSummary {
  const gameCounts = new Map<string, number>();
  const cpuSet = new Set<string>();
  const gpuSet = new Set<string>();
  const sourceCounts = new Map<string, { url: string; publisher: string; recordCount: number }>();

  for (const r of benchmarkRecords) {
    gameCounts.set(r.gameId, (gameCounts.get(r.gameId) ?? 0) + 1);
    cpuSet.add(r.cpuId);
    gpuSet.add(r.gpuId);
    const key = r.source.url;
    const existing = sourceCounts.get(key);
    if (existing) existing.recordCount += 1;
    else sourceCounts.set(key, { url: r.source.url, publisher: r.source.publisher, recordCount: 1 });
  }

  return {
    totalRecords: benchmarkRecords.length,
    games: gameFeatureProfiles.map((p) => ({ id: p.gameId, name: p.name, recordCount: gameCounts.get(p.gameId) ?? 0 })),
    cpus: [...cpuSet],
    gpus: [...gpuSet],
    sources: [...sourceCounts.values()],
    estimatorCatalogSize: { games: estimatorGameIds.size, gpus: estimatorGpuCount, cpus: estimatorCpuCount },
    gamesNotInEstimatorCatalog: gameFeatureProfiles.map((p) => p.gameId).filter((id) => !estimatorGameIds.has(id)),
  };
}

export function getAllBenchmarkRecords(): BenchmarkRecord[] {
  return benchmarkRecords;
}
