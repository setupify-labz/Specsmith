import benchmarkRecordsData from '../../data/benchmarkRecords.json';
import gameFeatureProfilesData from '../../data/gameFeatureProfiles.json';
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

export interface VerifiedFpsQuery {
  gameId: string;
  cpuId: string;
  gpuId: string;
  resolution: Resolution;
  preset: Preset;
  rayTracing: boolean;
  upscaler: Upscaler;
  frameGeneration: boolean;
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
 * KNOWN GAP (tracked, not silent): matching does not yet consider
 * upscalerMode (Quality/Balanced/Performance/Ultra Performance). No seeded
 * record currently sets a mode, so this can't misfire today — but the
 * moment a DLSS/FSR/XeSS record is added, this match logic must be
 * extended to require an exact mode match too, or two different quality
 * modes could be conflated as the same result. Do not add a mode-specific
 * record without fixing this first.
 */
export function lookupVerifiedFps(query: VerifiedFpsQuery): VerifiedFpsResult {
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

  const record = benchmarkRecords.find(
    (r) =>
      r.gameId === query.gameId &&
      r.cpuId === query.cpuId &&
      r.gpuId === query.gpuId &&
      r.resolution === query.resolution &&
      r.preset === query.preset &&
      r.rayTracing === query.rayTracing &&
      r.upscaler === query.upscaler &&
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
  };
}

export function getAllBenchmarkRecords(): BenchmarkRecord[] {
  return benchmarkRecords;
}
