import recordsJson from '../data/publicationBenchmarkRecords.json';
import gpuCatalogJson from '../data/gpus.json';
import cpuCatalogJson from '../data/cpus.json';

export type PublicationEvidenceTier = 'third_party_publication_measured';
export type PublicationSettingsCompleteness = 'partial' | 'complete';
export type PublicationLowMetric = 'one_percent_low' | 'minimum_fps' | 'source_reported_low';
export type PublicationUpscaler = 'dlss' | 'fsr' | 'xess' | 'native' | null;

export interface PublicationBenchmarkSource {
  publisher: string;
  title: string;
  url: string;
  publishedAt: string;
  accessedAt: string;
  verificationMethod: 'direct-fetch';
}

export interface PublicationBenchmarkRecord {
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
  lowFps?: number;
  lowMetric?: PublicationLowMetric;
  settingsSummary: string;
  rayTracing: boolean | null;
  upscaler: PublicationUpscaler;
  upscalerMode: string | null;
  settingsCompleteness: PublicationSettingsCompleteness;
  qualityFlags: string[];
  evidenceTier: PublicationEvidenceTier;
  evidenceQuality: 'B';
  source: PublicationBenchmarkSource;
}

const records = recordsJson as unknown as PublicationBenchmarkRecord[];
const gpuIds = new Set((gpuCatalogJson as Array<{ id: string }>).map((gpu) => gpu.id));
const cpuIds = new Set((cpuCatalogJson as Array<{ id: string }>).map((cpu) => cpu.id));

/**
 * Publication-measured records are deliberately separate from the strict
 * BenchmarkRecord store. A publication comparison can be useful real-world
 * evidence while still omitting a normalized preset or individual setting.
 * Keeping those unknowns explicit is safer than forcing the source into the
 * strict verified schema.
 */
export function getPublicationBenchmarkRecords(): PublicationBenchmarkRecord[] {
  return records;
}

export function getPublicationBenchmarksForBuild(gpuId: string, cpuId: string): PublicationBenchmarkRecord[] {
  return records
    .filter((record) => record.gpuId === gpuId && record.cpuId === cpuId)
    .sort((a, b) => a.gameName.localeCompare(b.gameName) || a.width - b.width || a.height - b.height);
}

export function formatPublicationResolution(
  record: Pick<PublicationBenchmarkRecord, 'width' | 'height'>,
): string {
  if (record.width === 1920 && record.height === 1080) return '1080p';
  if (record.width === 2560 && record.height === 1440) return '1440p';
  if (record.width === 3840 && record.height === 2160) return '4K';
  return `${record.width}×${record.height}`;
}

export function publicationLowMetricLabel(metric: PublicationLowMetric | undefined): string {
  if (metric === 'one_percent_low') return '1% Low';
  if (metric === 'minimum_fps') return 'Minimum';
  if (metric === 'source_reported_low') return 'Reported Low';
  return 'Low';
}

export interface PublicationBenchmarkValidationIssue {
  id: string;
  message: string;
}

export function validatePublicationBenchmarkRecords(
  input: PublicationBenchmarkRecord[] = records,
): PublicationBenchmarkValidationIssue[] {
  const issues: PublicationBenchmarkValidationIssue[] = [];
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
    if (record.lowFps != null) {
      if (!Number.isFinite(record.lowFps) || record.lowFps <= 0 || record.lowFps > record.averageFps) {
        issues.push({ id: record.id, message: 'Low FPS must be positive and cannot exceed average FPS.' });
      }
      if (!record.lowMetric) {
        issues.push({ id: record.id, message: 'A low-FPS value must preserve the source metric label.' });
      }
    }
    if (record.lowMetric && record.lowFps == null) {
      issues.push({ id: record.id, message: 'A low metric label cannot exist without a low-FPS value.' });
    }
    if (record.evidenceTier !== 'third_party_publication_measured') {
      issues.push({ id: record.id, message: 'Publication data must retain the third_party_publication_measured tier.' });
    }
    if (record.settingsCompleteness !== 'partial' && record.settingsCompleteness !== 'complete') {
      issues.push({ id: record.id, message: 'Unknown settings completeness value.' });
    }
    if (record.rayTracing !== null && typeof record.rayTracing !== 'boolean') {
      issues.push({ id: record.id, message: 'Ray-tracing state must be true, false, or unknown (null).' });
    }
    if (record.upscalerMode && !record.upscaler) {
      issues.push({ id: record.id, message: 'Upscaler mode cannot be claimed when the upscaler itself is unknown.' });
    }
    if (!record.settingsSummary.trim()) {
      issues.push({ id: record.id, message: 'Source settings summary must be preserved.' });
    }
    if (!record.source.url.startsWith('https://') || !record.source.publisher || !record.source.title) {
      issues.push({ id: record.id, message: 'Publication source title, publisher, and HTTPS URL are required.' });
    }
    if (record.source.verificationMethod !== 'direct-fetch') {
      issues.push({ id: record.id, message: 'This store only contains records directly read from the publication.' });
    }
  }

  return issues;
}
