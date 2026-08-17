import type { BenchmarkRecord, GameFeatureProfile, EvidenceQuality, VerificationMethod, ProvenanceField } from './types';
import { REQUIRED_PROVENANCE_FIELDS } from './types';

// Runtime data-integrity gate for the "honest database."
//
// benchmarkRecords.json and gameFeatureProfiles.json are loaded via a bare
// `as BenchmarkRecord[]` / `as GameFeatureProfile[]` cast (see lookup.ts) —
// TypeScript checks the *code* that reads these files, but nothing checks
// the JSON *content* itself. A typo'd evidenceQuality, a gpuId that doesn't
// exist in the parts catalog, or a confirmedFields entry that isn't a real
// provenance field would compile cleanly and silently degrade the data
// (wrong match, wrong sourcing badge) without ever failing a build. This
// module is the thing that actually reads every field and complains.
//
// Used from three places: validate.test.ts (fails `pnpm test` if the real
// bundled data ever regresses), scripts/validate-benchmarks.mjs (a
// standalone check to run while hand-authoring a new record, before it's
// added to the JSON at all), and AdminBenchmarks.tsx (surfaces issues in
// the same internal dashboard that shows coverage).

export interface ValidationIssue {
  recordId: string;
  message: string;
}

const EVIDENCE_QUALITIES: readonly EvidenceQuality[] = ['A', 'B', 'C', 'D'];
const VERIFICATION_METHODS: readonly VerificationMethod[] = ['search-summary', 'direct-fetch'];
const RESOLUTIONS = ['1080p', '1440p', '4k'];
const PRESETS = ['low', 'medium', 'high', 'ultra', 'extreme'];
const UPSCALERS = ['native', 'dlss', 'fsr', 'xess'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a single record against the catalogs it must reference and its
 * own internal consistency rules. Returns one message per problem found —
 * empty array means the record is clean. Does not judge whether the FPS
 * number itself is *true* (that's what evidenceQuality/source are for) —
 * only whether the record is well-formed and honestly self-describes what
 * it does and doesn't confirm.
 *
 * `knownGameIds` must be the *verified-games* namespace (every
 * GameFeatureProfile.gameId — see gameFeatureProfiles.json), not the
 * Estimator's games.json catalog. The two are deliberately independent:
 * VerifiedBenchmarkPanel's game dropdown is built entirely from
 * gameFeatureProfiles (see getVerifiedGames in lookup.ts), so a record
 * whose gameId has no profile would be permanently unreachable from the
 * UI — that's the real invariant this enforces. Whether that gameId is
 * *also* in games.json is a separate, softer question — see
 * getCoverageSummary's `gamesNotInEstimatorCatalog` for that instead of
 * conflating it with a hard validation error here.
 */
export function validateBenchmarkRecord(
  record: BenchmarkRecord,
  knownGpuIds: ReadonlySet<string>,
  knownCpuIds: ReadonlySet<string>,
  knownGameIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];

  if (!record.id || record.id.trim() === '') errors.push('missing id');
  if (!knownGameIds.has(record.gameId)) errors.push(`gameId "${record.gameId}" has no matching entry in gameFeatureProfiles.json — this record would be unreachable from the Verified Benchmarks UI, which only offers games that have a profile`);
  if (!knownGpuIds.has(record.gpuId)) errors.push(`gpuId "${record.gpuId}" not found in gpus.json`);
  if (!knownCpuIds.has(record.cpuId)) errors.push(`cpuId "${record.cpuId}" not found in cpus.json`);

  if (!RESOLUTIONS.includes(record.resolution)) errors.push(`invalid resolution "${record.resolution}"`);
  if (!PRESETS.includes(record.preset)) errors.push(`invalid preset "${record.preset}"`);
  if (!UPSCALERS.includes(record.upscaler)) errors.push(`invalid upscaler "${record.upscaler}"`);
  if (!EVIDENCE_QUALITIES.includes(record.evidenceQuality)) errors.push(`invalid evidenceQuality "${record.evidenceQuality}" (must be A/B/C/D)`);
  if (!VERIFICATION_METHODS.includes(record.verificationMethod)) errors.push(`invalid verificationMethod "${record.verificationMethod}"`);

  if (record.upscaler === 'native' && record.upscalerMode) {
    errors.push('upscalerMode set but upscaler is "native" — mode does not apply to native rendering');
  }

  if (!Number.isFinite(record.averageFps) || record.averageFps <= 0) {
    errors.push(`averageFps must be a positive number, got ${record.averageFps}`);
  }
  if (record.onePercentLow !== undefined && record.onePercentLow > record.averageFps) {
    errors.push('onePercentLow is greater than averageFps — 1% low should be at or below the average');
  }
  if (record.zeroPointOnePercentLow !== undefined && record.onePercentLow !== undefined
      && record.zeroPointOnePercentLow > record.onePercentLow) {
    errors.push('zeroPointOnePercentLow is greater than onePercentLow — 0.1% low should be at or below the 1% low');
  }

  if (!record.source) {
    errors.push('missing source');
  } else {
    if (!isValidUrl(record.source.url)) errors.push(`source.url is not a valid http(s) URL: "${record.source.url}"`);
    if (!record.source.publisher || record.source.publisher.trim() === '') errors.push('source.publisher is missing');
    if (!ISO_DATE_RE.test(record.source.accessedAt)) errors.push(`source.accessedAt is not an ISO date (YYYY-MM-DD): "${record.source.accessedAt}"`);
    if (record.source.publishedAt && !ISO_DATE_RE.test(record.source.publishedAt)) {
      errors.push(`source.publishedAt is not an ISO date (YYYY-MM-DD): "${record.source.publishedAt}"`);
    }
  }

  const invalidFields = record.confirmedFields.filter((f) => !REQUIRED_PROVENANCE_FIELDS.includes(f as ProvenanceField));
  if (invalidFields.length > 0) {
    errors.push(`confirmedFields contains unknown field(s): ${invalidFields.join(', ')}`);
  }
  if (new Set(record.confirmedFields).size !== record.confirmedFields.length) {
    errors.push('confirmedFields contains a duplicate entry');
  }

  // Spec rule 9 (see types.ts BenchmarkRecord.frameGeneration doc): a
  // frame-generation-boosted number must never be presentable as
  // equivalent to native FPS. The one thing that keeps that distinction
  // visible is nativeVsDisplayed actually being confirmed — if it's
  // frame-generated but that field was never checked off, the record is
  // making a claim (displayed vs. rendered) it hasn't actually verified.
  if (record.frameGeneration && !record.confirmedFields.includes('nativeVsDisplayed')) {
    errors.push('frameGeneration is true but "nativeVsDisplayed" is not in confirmedFields — the displayed-vs-rendered distinction must be explicitly confirmed, not assumed');
  }

  return errors;
}

/** Validates every record, plus cross-record rules (duplicate ids). */
export function validateAllBenchmarkRecords(
  records: readonly BenchmarkRecord[],
  knownGpuIds: ReadonlySet<string>,
  knownCpuIds: ReadonlySet<string>,
  knownGameIds: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, number>();

  records.forEach((record) => {
    seenIds.set(record.id, (seenIds.get(record.id) ?? 0) + 1);
    for (const message of validateBenchmarkRecord(record, knownGpuIds, knownCpuIds, knownGameIds)) {
      issues.push({ recordId: record.id || '(no id)', message });
    }
  });

  for (const [id, count] of seenIds) {
    if (count > 1) issues.push({ recordId: id, message: `id is used by ${count} records — ids must be unique` });
  }

  return issues;
}

/**
 * Validates game feature profiles for internal consistency. Deliberately
 * does NOT require profile.gameId to exist in games.json (the Estimator's
 * catalog) — a verified game is allowed to exist outside the Estimator's
 * roster (see the note on validateBenchmarkRecord above); that's a real
 * product observation worth surfacing, not a malformed-data error. See
 * getCoverageSummary's `gamesNotInEstimatorCatalog` for that cross-check.
 */
export function validateGameFeatureProfiles(profiles: readonly GameFeatureProfile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenGameIds = new Map<string, number>();
  const statuses = ['supported', 'unsupported', 'conditional', 'unknown'];

  profiles.forEach((profile) => {
    seenGameIds.set(profile.gameId, (seenGameIds.get(profile.gameId) ?? 0) + 1);
    for (const key of ['dlss', 'fsr', 'xess', 'frameGeneration', 'rayTracing'] as const) {
      const support = profile[key];
      if (!statuses.includes(support.status)) {
        issues.push({ recordId: profile.gameId, message: `${key}.status "${support.status}" is not a valid FeatureSupportStatus` });
      }
      if (support.status === 'conditional' && (!support.requirements || support.requirements.length === 0)) {
        issues.push({ recordId: profile.gameId, message: `${key}.status is "conditional" but requirements is empty — conditional status must explain the condition` });
      }
    }
  });

  for (const [gameId, count] of seenGameIds) {
    if (count > 1) issues.push({ recordId: gameId, message: `gameId is used by ${count} profiles — one profile per game` });
  }

  return issues;
}
