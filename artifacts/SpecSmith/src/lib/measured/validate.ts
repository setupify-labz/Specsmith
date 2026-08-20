// Validation for measured observations.
//
// Severity model, inherited from the systems already in this repo:
//
//   ERROR   — the collector or pipeline produced something structurally
//             impossible or self-contradictory. A TOOLING fault. The
//             observation is rejected; it does not enter the store.
//   WARNING — a real, disclosed condition about the run that a reader must
//             see but which does not invalidate the measurement.
//
// The load-bearing rule: every published figure is RECOMPUTED here from the
// raw frame times and compared against what the record claims. A record whose
// averageFps cannot be reproduced from its own frames is not a measurement.

import type { GameFeatureProfile } from '../benchmarks/types';
import { computeFrameTimeStats, canonicalFrameTimeBytes } from './frameTimes';
import { HardwareAttributionError, resolveHardware, type CatalogEntry } from './hardwareMatch';
import {
  MAX_FRAME_GENERATION_FACTOR,
  MAX_RENDER_SCALE_PERCENT,
  MEASURED_PRESETS,
  MIN_FRAME_COUNT,
  MIN_FRAME_GENERATION_FACTOR,
  MIN_RENDER_SCALE_PERCENT,
  MIN_RUN_DURATION_SEC,
  PINNED_ONE_PERCENT_LOW_METHOD,
  RESOLUTIONS,
  TIER_ACCEPTED_V1,
  UPSCALERS,
  type MeasuredObservation,
} from './types';

/**
 * The catalogs an observation is checked against.
 *
 * Optional because these rules are about IDENTITY, not shape, and the pure
 * validator has no business reading files. The collector passes the real
 * catalogs; a caller that omits them still gets every shape rule.
 *
 * `gameIds` is a plain id list — a game is not attributed to detected
 * hardware, so membership is all there is to check. `gpus`/`cpus` carry full
 * entries (id + name) because membership alone cannot prove attribution: it
 * shows gpuId names something real, not that the DETECTED gpuRaw can
 * legitimately mean it. See the hardware-attribution rule below.
 */
export interface MeasuredCatalogs {
  gameIds?: readonly string[];
  gpus?: readonly CatalogEntry[];
  cpus?: readonly CatalogEntry[];
}

export type Severity = 'error' | 'warning';

export interface MeasuredIssue {
  severity: Severity;
  rule: string;
  message: string;
  observationId: string;
}

const err = (observationId: string, rule: string, message: string): MeasuredIssue => ({ severity: 'error', rule, message, observationId });
/** `gpuId` -> `gpu-id`, so rule names read the way the CLI flags do. */
const kebab = (field: string): string => field.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const warn = (observationId: string, rule: string, message: string): MeasuredIssue => ({ severity: 'warning', rule, message, observationId });

/**
 * Validates one observation against the raw frame times it was computed from.
 *
 * `frameTimesMs` is passed in rather than read from disk so this stays a pure
 * function — the same shape the rest of the repo's validators use, and the
 * reason it can be tested without touching the filesystem.
 */
export function validateMeasuredObservation(
  obs: MeasuredObservation,
  frameTimesMs: readonly number[],
  featureProfiles: readonly GameFeatureProfile[] = [],
  catalogs: MeasuredCatalogs = {},
): MeasuredIssue[] {
  const issues: MeasuredIssue[] = [];
  const id = obs.id;

  // --- tier ---------------------------------------------------------------
  // The community tier exists in the schema so the boundary is designed in,
  // but V1 does not ingest it. Rejecting here rather than silently ignoring
  // means a community record can never slip into the measured store.
  if (!TIER_ACCEPTED_V1.includes(obs.tier)) {
    issues.push(err(id, 'tier.not-accepted-in-v1', `Tier "${obs.tier}" is defined in the schema but not accepted in V1; only ${TIER_ACCEPTED_V1.join(', ')} may enter the measured store.`));
  }

  // --- frame-time evidence ------------------------------------------------
  // Without frames, the figures cannot be reproduced, and an unreproducible
  // figure is a report rather than a measurement.
  if (frameTimesMs.length === 0) {
    issues.push(err(id, 'frametimes.absent', 'No raw frame times available; a measured observation must be derivable from its own frames.'));
    return issues; // nothing below can be checked meaningfully
  }

  if (obs.frameTimes.frameCount !== frameTimesMs.length) {
    issues.push(err(id, 'frametimes.count-mismatch', `frameTimes.frameCount is ${obs.frameTimes.frameCount} but ${frameTimesMs.length} frames were supplied.`));
  }
  if (frameTimesMs.some((ms) => !(ms > 0) || !Number.isFinite(ms))) {
    issues.push(err(id, 'frametimes.non-positive', 'Frame times must all be finite and greater than zero.'));
  }

  // --- pinned method ------------------------------------------------------
  if (obs.onePercentLowMethod !== PINNED_ONE_PERCENT_LOW_METHOD) {
    issues.push(err(id, 'stats.method-not-pinned', `onePercentLowMethod is "${obs.onePercentLowMethod}" but this system pins "${PINNED_ONE_PERCENT_LOW_METHOD}". Figures computed the other way are not comparable and are never silently recomputed.`));
  }

  // --- recomputation ------------------------------------------------------
  const recomputed = computeFrameTimeStats(frameTimesMs);
  for (const field of ['averageFps', 'onePercentLow', 'zeroPointOnePercentLow'] as const) {
    if (obs.stats[field] !== recomputed[field]) {
      issues.push(err(id, `stats.${field}-mismatch`, `${field} is recorded as ${obs.stats[field]} but recomputes to ${recomputed[field]} from the supplied frames.`));
    }
  }
  if (obs.stats.frameCount !== recomputed.frameCount) {
    issues.push(err(id, 'stats.frame-count-mismatch', `stats.frameCount is ${obs.stats.frameCount} but ${recomputed.frameCount} frames were supplied.`));
  }

  // --- run length ---------------------------------------------------------
  if (recomputed.runDurationSec < MIN_RUN_DURATION_SEC) {
    issues.push(err(id, 'run.too-short', `Run lasted ${recomputed.runDurationSec}s; the minimum is ${MIN_RUN_DURATION_SEC}s.`));
  }
  if (frameTimesMs.length < MIN_FRAME_COUNT) {
    issues.push(err(id, 'run.too-few-frames', `Run captured ${frameTimesMs.length} frames; the minimum is ${MIN_FRAME_COUNT}.`));
  }

  // --- test conditions that make a run reproducible ------------------------
  if (!obs.gpuDriverVersion) issues.push(err(id, 'conditions.driver-missing', 'No GPU driver version; the run is not reproducible without it.'));
  if (!obs.osBuild) issues.push(err(id, 'conditions.os-missing', 'No OS build recorded.'));
  if (!obs.gameVersion && !obs.gameBuildId) {
    issues.push(err(id, 'conditions.game-version-missing', 'Neither gameVersion nor gameBuildId is recorded; the run cannot be tied to a specific build.'));
  }
  if (!obs.settingsHash) issues.push(err(id, 'conditions.settings-hash-missing', 'No settingsHash; two runs cannot be proven to share settings.'));

  // --- preset -------------------------------------------------------------
  // `unmapped` says the game has no comparable preset tier. That is only
  // honest if the verbatim setting is recorded — otherwise the run carries no
  // description of its settings at all, which is worse than a forced bucket.
  if (obs.preset === 'unmapped' && !obs.presetLabel?.trim()) {
    issues.push(
      err(
        id,
        'preset.unmapped-without-label',
        'preset is "unmapped" but no presetLabel was recorded. When a game has no comparable tier, the verbatim in-game setting is the only description of what was run.',
      ),
    );
  }

  // --- platform content ---------------------------------------------------
  // For a platform game the client version says nothing about what was
  // rendered: two Roblox runs can be unrelated experiences. Without a content
  // id the observation is not interpretable, so an incomplete block is a fault
  // rather than a gap.
  if (obs.platformContent) {
    if (!obs.platformContent.platform?.trim()) {
      issues.push(err(id, 'platform.name-missing', 'platformContent is present but names no platform.'));
    }
    if (!obs.platformContent.contentId?.trim()) {
      issues.push(
        err(
          id,
          'platform.content-id-missing',
          'platformContent has no contentId. A platform run without the place/experience id cannot be interpreted — the client version does not identify what was rendered.',
        ),
      );
    }
  }

  // --- memory --------------------------------------------------------------
  // Win32_PhysicalMemory returns nothing on some systems (certain VMs, locked
  // -down hosts), and the probe's byte sum then collapses to 0. Without this
  // rule a record claiming 0 GB of RAM validates cleanly, which is exactly the
  // confident-but-wrong output this pipeline exists to refuse. Absent memory
  // is a failed read, not a machine with no memory.
  if (!(obs.ram.totalGb > 0)) {
    issues.push(err(id, 'ram.total-invalid', `RAM total is ${obs.ram.totalGb} GB — the machine's memory could not be read. This is a failed detection, not a valid measurement.`));
  }
  if (!(obs.ram.channels > 0) || !Number.isInteger(obs.ram.channels)) {
    issues.push(err(id, 'ram.channels-invalid', `RAM channel count is ${obs.ram.channels}; it must be a positive integer.`));
  }

  // --- run-condition field values ------------------------------------------
  // TypeScript's unions are erased at runtime, so a CLI string cast to
  // `Resolution` type-checks and then travels all the way into the store. A
  // record carrying resolution "1440" or preset "hihg" is not a measurement of
  // anything describable, and nothing downstream can recover the intent — so
  // these are ERRORs, checked against the value arrays in types.ts.
  const identifiers: Array<[string, string]> = [
    ['gameId', obs.gameId],
    ['gpuId', obs.gpuId],
    ['cpuId', obs.cpuId],
  ];
  for (const [field, value] of identifiers) {
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push(err(id, `fields.${kebab(field)}-missing`, `${field} is ${JSON.stringify(value)}; a measured observation must name what it measured.`));
    }
  }

  if (!RESOLUTIONS.includes(obs.resolution)) {
    issues.push(err(id, 'fields.resolution-invalid', `resolution is ${JSON.stringify(obs.resolution)}; accepted values are ${RESOLUTIONS.join(', ')}.`));
  }
  if (!MEASURED_PRESETS.includes(obs.preset)) {
    issues.push(err(id, 'fields.preset-invalid', `preset is ${JSON.stringify(obs.preset)}; accepted values are ${MEASURED_PRESETS.join(', ')}.`));
  }
  if (!UPSCALERS.includes(obs.upscaler)) {
    issues.push(err(id, 'fields.upscaler-invalid', `upscaler is ${JSON.stringify(obs.upscaler)}; accepted values are ${UPSCALERS.join(', ')}.`));
  }

  if (
    typeof obs.renderScalePercent !== 'number' ||
    !Number.isFinite(obs.renderScalePercent) ||
    obs.renderScalePercent < MIN_RENDER_SCALE_PERCENT ||
    obs.renderScalePercent > MAX_RENDER_SCALE_PERCENT
  ) {
    issues.push(err(id, 'fields.render-scale-invalid', `renderScalePercent is ${JSON.stringify(obs.renderScalePercent)}; it must be a finite number between ${MIN_RENDER_SCALE_PERCENT} and ${MAX_RENDER_SCALE_PERCENT}.`));
  }

  // Absent is legitimate — that is a run without frame generation, and the
  // framegen.factor-missing rule below covers the contradictory case.
  if (obs.frameGenerationFactor !== undefined) {
    const f = obs.frameGenerationFactor;
    if (typeof f !== 'number' || !Number.isFinite(f) || f <= MIN_FRAME_GENERATION_FACTOR || f > MAX_FRAME_GENERATION_FACTOR) {
      issues.push(err(id, 'fields.framegen-factor-invalid', `frameGenerationFactor is ${JSON.stringify(f)}; it must be a finite number greater than ${MIN_FRAME_GENERATION_FACTOR} and at most ${MAX_FRAME_GENERATION_FACTOR}. A factor of ${MIN_FRAME_GENERATION_FACTOR} or less is not frame generation.`));
    }
  }

  // --- catalog membership --------------------------------------------------
  // A syntactically fine id that names nothing is still unusable: the record
  // cannot be joined to a game or a part, and the mistake is invisible in the
  // store. Only checked when the caller supplied the catalogs.
  const membership: Array<[string, string, readonly string[] | undefined]> = [
    ['gameId', obs.gameId, catalogs.gameIds],
    ['gpuId', obs.gpuId, catalogs.gpus?.map((e) => e.id)],
    ['cpuId', obs.cpuId, catalogs.cpus?.map((e) => e.id)],
  ];
  for (const [field, value, known] of membership) {
    if (known && value && !known.includes(value)) {
      issues.push(err(id, `fields.${kebab(field)}-unknown`, `${field} "${value}" is not in the SpecSmith catalog.`));
    }
  }

  // --- hardware resolution -------------------------------------------------
  // A detected string that did not resolve to exactly one catalog id must not
  // be guessed at — a laptop part sharing a desktop part's name is the exact
  // case this prevents.
  if (!obs.gpuId || !obs.cpuId) {
    issues.push(err(id, 'hardware.unresolved', `Detected hardware did not resolve to catalog ids (gpu="${obs.detected.gpuRaw}", cpu="${obs.detected.cpuRaw}").`));
  }

  // --- hardware attribution is RE-DERIVED, not merely checked for existence
  // Catalog membership above proves gpuId/cpuId NAME something real. It does
  // not prove the DETECTED hardware can legitimately mean that something — a
  // caller that skips the CLI (or a future one) could pair a genuine
  // detected.gpuRaw with an unrelated gpuId and pass every rule above this
  // one. This re-runs the SAME resolver the CLI uses (hardwareMatch.ts)
  // against the detected string and requires it to agree with what the
  // record claims. Every caller capable of writing to the store funnels
  // through this function, so this is the one place the check cannot be
  // bypassed by construction rather than by discipline.
  for (const [field, raw, claimedId, catalog] of [
    ['gpu', obs.detected.gpuRaw, obs.gpuId, catalogs.gpus] as const,
    ['cpu', obs.detected.cpuRaw, obs.cpuId, catalogs.cpus] as const,
  ]) {
    // Skipped when the caller supplied no catalog (shape-only validation) or
    // no claimed id (already covered by hardware.unresolved above).
    if (!catalog || !claimedId) continue;
    try {
      const resolved = resolveHardware(raw, field, catalog);
      if (resolved.id !== claimedId) {
        issues.push(err(
          id,
          `hardware.${field}-attribution-mismatch`,
          `${field}Id "${claimedId}" does not match what detected ${field.toUpperCase()} "${raw}" resolves to ("${resolved.id}"). The id must be exactly what the detected hardware supports; it cannot be substituted.`,
        ));
      }
    } catch (e) {
      const reason = e instanceof HardwareAttributionError ? e.message : String(e);
      issues.push(err(
        id,
        `hardware.${field}-attribution-unresolvable`,
        `Detected ${field.toUpperCase()} "${raw}" cannot be attributed to catalog id "${claimedId}": ${reason}`,
      ));
    }
  }

  // --- frame generation ----------------------------------------------------
  // FG frames are displayed, not independently rendered. A record that claims
  // FG without saying by how much cannot be interpreted at all.
  if (obs.frameGeneration && obs.frameGenerationFactor === undefined) {
    issues.push(err(id, 'framegen.factor-missing', 'frameGeneration is true but frameGenerationFactor is unset; displayed frames cannot be related to rendered ones.'));
  }
  // The reverse contradiction: a factor with frameGeneration explicitly
  // false claims two things about the same run that cannot both be true. A
  // reader trusting frameGeneration would report native rendering; a reader
  // trusting the factor would apply a displayed-to-rendered ratio to a stat
  // that was never inflated. Both readings are live in a record built by
  // hand, so both are checked rather than assuming which one is right.
  if (!obs.frameGeneration && obs.frameGenerationFactor !== undefined) {
    issues.push(err(id, 'framegen.factor-without-frame-generation', `frameGenerationFactor is ${obs.frameGenerationFactor} but frameGeneration is false; a run cannot carry a frame-generation multiplier while claiming frame generation was off.`));
  }

  // --- feature support cross-check ----------------------------------------
  // A run claiming a feature the game is confirmed not to support is a
  // collector fault, not a discovery about the game.
  const profile = featureProfiles.find((p) => p.gameId === obs.gameId);
  if (profile) {
    const claimed: Array<[boolean, keyof GameFeatureProfile, string]> = [
      [obs.upscaler === 'dlss', 'dlss', 'DLSS'],
      [obs.upscaler === 'fsr', 'fsr', 'FSR'],
      [obs.upscaler === 'xess', 'xess', 'XeSS'],
      [obs.frameGeneration, 'frameGeneration', 'Frame Generation'],
      [obs.rayTracing, 'rayTracing', 'Ray Tracing'],
    ];
    for (const [isClaimed, key, label] of claimed) {
      if (!isClaimed) continue;
      const support = profile[key];
      if (support && typeof support === 'object' && 'status' in support && support.status === 'unsupported') {
        issues.push(err(id, 'features.contradicts-profile', `Observation uses ${label} but ${profile.name}'s feature profile records it as unsupported.`));
      }
    }
  }

  // --- disclosed conditions (WARNING) --------------------------------------
  if (recomputed.capDetected !== 'none') {
    issues.push(warn(id, 'run.capped', `Frame times cluster tightly (${(recomputed.clusteredFraction * 100).toFixed(1)}% within ±0.5% of median), suggesting a ${recomputed.capDetected} limit. Average FPS may be measuring the cap rather than the hardware.`));
  }
  // The platform genuinely does not publish a player-visible content version
  // in most cases (Roblox creators publish continuously with no such string).
  // Disclosed, not treated as a fault.
  if (obs.platformContent && !obs.platformContent.contentVersion?.trim()) {
    issues.push(
      warn(
        id,
        'platform.content-version-unavailable',
        `No content version for ${obs.platformContent.platform} content "${obs.platformContent.contentId}". Most platforms expose this to creators only, so the exact build that was rendered is unknown.`,
      ),
    );
  }
  if (obs.settingsSource === 'operator-attested') {
    issues.push(warn(id, 'settings.operator-attested', 'Graphics settings were attested by the operator rather than parsed from the game config.'));
  }
  if (obs.renderScalePercent !== 100) {
    issues.push(warn(id, 'render-scale.non-native', `Render scale is ${obs.renderScalePercent}%; this is not a native ${obs.resolution} result.`));
  }
  if (obs.ram.channels < 2) {
    issues.push(warn(id, 'ram.single-channel', `Run used ${obs.ram.channels}-channel memory; not comparable to dual-channel results.`));
  }
  if (obs.detected.gpuOverclockDetected) {
    issues.push(warn(id, 'gpu.overclocked', 'A non-stock GPU clock/power profile was detected; this is not a stock-hardware result.'));
  }

  return issues;
}

/** Validates a whole store, including cross-record checks. */
export function validateMeasuredStore(
  observations: readonly MeasuredObservation[],
  frameTimesById: ReadonlyMap<string, readonly number[]>,
  featureProfiles: readonly GameFeatureProfile[] = [],
): MeasuredIssue[] {
  const issues: MeasuredIssue[] = [];

  for (const obs of observations) {
    issues.push(...validateMeasuredObservation(obs, frameTimesById.get(obs.id) ?? [], featureProfiles));
  }

  // A repeated nonce means the same run was submitted twice.
  const seenNonce = new Map<string, string>();
  for (const obs of observations) {
    const prior = seenNonce.get(obs.runNonce);
    if (prior !== undefined) {
      issues.push(err(obs.id, 'run.duplicate-nonce', `runNonce "${obs.runNonce}" was already used by observation "${prior}"; the same run cannot be recorded twice.`));
    } else {
      seenNonce.set(obs.runNonce, obs.id);
    }
  }

  const seenId = new Set<string>();
  for (const obs of observations) {
    if (seenId.has(obs.id)) issues.push(err(obs.id, 'store.duplicate-id', `Observation id "${obs.id}" appears more than once.`));
    seenId.add(obs.id);
  }

  return issues;
}

/** Confirms a frame-time blob is the one an observation was computed from. */
export function verifyFrameTimeHash(
  frameTimesMs: readonly number[],
  expectedSha256: string,
  sha256: (input: string) => string,
): boolean {
  return sha256(canonicalFrameTimeBytes(frameTimesMs)) === expectedSha256;
}

export const errors = (issues: readonly MeasuredIssue[]): MeasuredIssue[] => issues.filter((i) => i.severity === 'error');
export const warnings = (issues: readonly MeasuredIssue[]): MeasuredIssue[] => issues.filter((i) => i.severity === 'warning');
