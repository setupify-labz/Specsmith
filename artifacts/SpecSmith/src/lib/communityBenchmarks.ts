import recordsJson from '../data/communityBenchmarkRecords.json';
import gpuCatalogJson from '../data/gpus.json';
import cpuCatalogJson from '../data/cpus.json';

export type CommunityEvidenceTier = 'third_party_community_measured';
export type CommunitySettingsCompleteness = 'partial' | 'complete';

export interface CommunityBenchmarkSource {
  publisher: string;
  sessionId: string;
  url: string;
  license: string;
  licenseUrl: string;
  accessedAt: string;
}

export interface CommunityBenchmarkRecord {
  id: string;
  gameId: string;
  gameName: string;
  gpuId: string;
  gpuName: string;
  cpuId: string;
  cpuName: string;
  width: number;
  height: number;
  averageFps: number;
  onePercentLow?: number;
  zeroPointOnePercentLow?: number;
  maxFps?: number;
  fpsLimit: number | null;
  observedSettings: Record<string, string>;
  settingsCompleteness: CommunitySettingsCompleteness;
  qualityFlags: string[];
  evidenceTier: CommunityEvidenceTier;
  source: CommunityBenchmarkSource;
}

const records = recordsJson as unknown as CommunityBenchmarkRecord[];
const gpuIds = new Set((gpuCatalogJson as Array<{ id: string }>).map((gpu) => gpu.id));
const cpuIds = new Set((cpuCatalogJson as Array<{ id: string }>).map((cpu) => cpu.id));

/**
 * Community benchmark records are deliberately isolated from BenchmarkRecord.
 * They may come from uncontrolled third-party gameplay sessions and can preserve
 * exact width x height plus partial per-setting metadata without pretending those
 * settings map to SpecSmith's normalized verified-benchmark preset contract.
 */
export function getCommunityBenchmarkRecords(): CommunityBenchmarkRecord[] {
  return records;
}

export function getCommunityBenchmarksForBuild(gpuId: string, cpuId: string): CommunityBenchmarkRecord[] {
  return records
    .filter((record) => record.gpuId === gpuId && record.cpuId === cpuId)
    .sort((a, b) => a.gameName.localeCompare(b.gameName) || a.width - b.width || a.height - b.height);
}

export function getCommunityBenchmarkCountForBuild(gpuId: string, cpuId: string): number {
  return getCommunityBenchmarksForBuild(gpuId, cpuId).length;
}

export function formatCommunityResolution(record: Pick<CommunityBenchmarkRecord, 'width' | 'height'>): string {
  if (record.width === 1920 && record.height === 1080) return '1080p';
  if (record.width === 2560 && record.height === 1440) return '1440p';
  if (record.width === 3840 && record.height === 2160) return '4K';
  return `${record.width}×${record.height}`;
}

export interface CommunityBenchmarkValidationIssue {
  id: string;
  message: string;
}

export function validateCommunityBenchmarkRecords(
  input: CommunityBenchmarkRecord[] = records,
): CommunityBenchmarkValidationIssue[] {
  const issues: CommunityBenchmarkValidationIssue[] = [];
  const ids = new Set<string>();

  for (const record of input) {
    if (!record.id || ids.has(record.id)) {
      issues.push({ id: record.id || '(missing)', message: 'Record id is missing or duplicated.' });
    }
    ids.add(record.id);

    if (!record.gameId || !record.gameName || !record.gpuId || !record.cpuId) {
      issues.push({ id: record.id, message: 'Game, CPU, and GPU identifiers must be present.' });
    }

    if (!gpuIds.has(record.gpuId)) {
      issues.push({ id: record.id, message: `GPU id ${record.gpuId} is not in the SpecSmith GPU catalog.` });
    }

    if (!cpuIds.has(record.cpuId)) {
      issues.push({ id: record.id, message: `CPU id ${record.cpuId} is not in the SpecSmith CPU catalog.` });
    }

    if (!Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width <= 0 || record.height <= 0) {
      issues.push({ id: record.id, message: 'Resolution must be a positive integer width and height.' });
    }

    if (!Number.isFinite(record.averageFps) || record.averageFps <= 0) {
      issues.push({ id: record.id, message: 'Average FPS must be a positive finite number.' });
    }

    if (record.onePercentLow != null && record.onePercentLow > record.averageFps) {
      issues.push({ id: record.id, message: '1% low cannot exceed average FPS.' });
    }

    if (record.zeroPointOnePercentLow != null && record.onePercentLow != null && record.zeroPointOnePercentLow > record.onePercentLow) {
      issues.push({ id: record.id, message: '0.1% low cannot exceed 1% low.' });
    }

    if (record.maxFps != null && record.maxFps < record.averageFps) {
      issues.push({ id: record.id, message: 'Maximum FPS cannot be below average FPS.' });
    }

    if (record.evidenceTier !== 'third_party_community_measured') {
      issues.push({ id: record.id, message: 'Community data must retain the third_party_community_measured evidence tier.' });
    }

    if (record.settingsCompleteness !== 'partial' && record.settingsCompleteness !== 'complete') {
      issues.push({ id: record.id, message: 'Unknown settings completeness value.' });
    }

    if (!record.source.url.startsWith('https://')) {
      issues.push({ id: record.id, message: 'Source URL must be HTTPS.' });
    }

    if (!record.source.publisher || !record.source.sessionId || !record.source.license) {
      issues.push({ id: record.id, message: 'Source publisher, session id, and license must be preserved.' });
    }
  }

  return issues;
}
