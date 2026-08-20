// SpecSmith's own measured-observation system — first-party FPS measurement.
//
// WHY THIS IS A SEPARATE TYPE FROM BenchmarkRecord
// ------------------------------------------------
// `../benchmarks/types.ts` describes SOMEONE ELSE'S measurement that we read
// about: it carries `publisher`, `publishedAt`, `evidenceQuality: A|B|C|D` and
// `verificationMethod: search-summary|direct-fetch`. Every one of those is
// meaningless for a run we execute ourselves, and forcing them onto a
// first-party run would corrupt the semantics of a type that already holds
// real source-derived records.
//
// So this is a sibling system, not an extension. It shares only the catalog id
// namespaces (gameId/cpuId/gpuId) and the Resolution/Preset/Upscaler unions.
// The source-derived and estimated systems are untouched by this file.
//
// THE FOUR TIERS, AND WHY THEY NEVER MERGE
// -----------------------------------------
//   measured        SpecSmith-controlled hardware, supervised run, raw frame
//                   times retained. This file.
//   community       Our collector run on a machine we do not control. Defined
//                   in this schema, NOT accepted in V1 (see TIER_ACCEPTED_V1).
//   source-derived  Third-party publication — ../benchmarks, unchanged.
//   estimated       games.json base_fps formula — unchanged.
//
// A community observation can never be promoted to `measured` by accumulating
// agreement. Ten people agreeing is ten unverifiable claims, not a measurement.
// There is deliberately no code path that upgrades a tier.

import type { Preset, Resolution, Upscaler } from '../benchmarks/types';

export type { Preset, Resolution, Upscaler };

/**
 * `community` exists in the schema so the boundary is designed in from the
 * start rather than retrofitted. V1 accepts only `measured` — see
 * validateMeasuredObservation, which rejects anything else outright.
 */
export type ObservationTier = 'measured' | 'community';

/**
 * The normalized preset tiers, plus an explicit "does not map" value.
 *
 * The shared `Preset` union is a CROSS-GAME comparison bucket, and it is
 * deliberately left untouched here — widening it would change what a preset
 * means for the source-derived system too.
 *
 * Some games do not have preset tiers at all. Roblox exposes a Manual graphics
 * slider from 1 to 10; there is no honest answer to "is Manual 8 high or
 * ultra?", because the scale is not calibrated against anything outside
 * Roblox. The existing doctrine in ../benchmarks/types.ts says to record the
 * verbatim name "alongside the closest honest bucket" — but when no bucket is
 * honest, picking one INVENTS a cross-game equivalence that no source
 * supports, and it would then be silently comparable to another game's "high".
 *
 * `unmapped` states the true thing instead: this run's settings have no
 * normalized tier. The verbatim setting still travels in `presetLabel`, which
 * validation REQUIRES whenever preset is `unmapped` — so this records more
 * than a forced bucket would, not less.
 */
export type MeasuredPreset = Preset | 'unmapped';

/**
 * What was actually being played on a platform game.
 *
 * Roblox, Fortnite Creative, Minecraft servers and similar are not single
 * games: the client version says nothing about what was rendered. Two runs of
 * "Roblox" can be unrelated experiences with completely different performance.
 * An observation carrying only a client version is not interpretable.
 *
 * Honesty about what is obtainable:
 *
 *   clientVersion   OBTAINABLE. Roblox ships each client build in
 *                   %LOCALAPPDATA%\Roblox\Versions\version-<hash>\, and the
 *                   executable carries a file version. Read via --game-exe.
 *   contentId       OBTAINABLE BY THE OPERATOR, not by the collector — it is
 *                   the place/universe id from the URL they joined.
 *   contentVersion  GENERALLY NOT OBTAINABLE. Roblox exposes a place version
 *                   to the experience's creator, not to players. Creators
 *                   publish updates continuously with no player-visible
 *                   version string, so this is usually a genuine gap and is
 *                   recorded as one rather than guessed.
 */
export interface PlatformContent {
  /** e.g. 'roblox'. Free-form: this is a description, not a closed catalog. */
  platform: string;
  /** Place/universe/world id. Required — without it the run is uninterpretable. */
  contentId: string;
  contentName?: string;
  /** Set ONLY when the platform genuinely exposes one. Absence is a disclosed gap. */
  contentVersion?: string;
}

/** The only tier V1 will ingest. */
export const TIER_ACCEPTED_V1: readonly ObservationTier[] = ['measured'];

/**
 * THE PINNED 1%-LOW DEFINITION.
 *
 * "1% low" is genuinely ambiguous in PC benchmarking and the two common
 * readings produce different numbers for the same run:
 *
 *   mean-slowest-1pct  the mean FPS of the slowest 1% of frames   <-- ours
 *   p99-frametime      the single frame time at the 99th percentile
 *
 * Comparing a figure computed one way against one computed the other is a
 * silent, invisible error, so the method is pinned here, recorded on every
 * observation, and recomputed at validation. The alternative is named in the
 * union so a record can never be mistaken for using it by default.
 */
export type OnePercentLowMethod = 'mean-slowest-1pct' | 'p99-frametime';
export const PINNED_ONE_PERCENT_LOW_METHOD: OnePercentLowMethod = 'mean-slowest-1pct';

/** How the graphics settings for a run were established. */
export type SettingsSource = 'config-parsed' | 'operator-attested';

/** Whether the run appears to have been limited rather than hardware-bound. */
export type CapDetection = 'none' | 'vsync' | 'fps-limit' | 'suspected';

/** How a detected hardware string was resolved to a catalog id. */
export type CatalogMatchMethod = 'exact' | 'normalized' | 'manual';

/**
 * What the collector actually saw, kept verbatim alongside the resolved
 * catalog ids. A "RTX 4070 Laptop GPU" is not the catalog 4070, and the only
 * way to catch that later is to have kept the original string.
 */
export interface DetectedEnvironment {
  gpuRaw: string;
  cpuRaw: string;
  gpuMatchMethod: CatalogMatchMethod;
  cpuMatchMethod: CatalogMatchMethod;
  /** True when the collector detected a non-stock GPU clock/power profile. */
  gpuOverclockDetected: boolean;
}

export interface RamSpec {
  totalGb: number;
  /** Channel count moves FPS more than capacity does; a single-channel run is not comparable to a dual-channel one. */
  channels: number;
  ratedSpeedMts?: number;
}

/**
 * Pointer to the run's raw frame times, which are stored compressed OUTSIDE
 * git (see scripts/measured/frameTimeStore.mjs and .gitignore).
 *
 * The record keeps the hash rather than the data so that observations stay
 * diffable and the repository stays tractable, while the measurement itself
 * remains auditable: anyone holding the blob can prove it is the one this
 * record was computed from.
 *
 * `sha256` is over the CANONICAL UNCOMPRESSED bytes — `JSON.stringify(number[])`
 * — so the hash is independent of the compression used to store it.
 */
export interface FrameTimeRef {
  sha256: string;
  frameCount: number;
  encoding: 'json-array-ms';
  compression: 'gzip';
  /** Path relative to the frame-time root, not to the repo. */
  storagePath: string;
  compressedByteLength: number;
}

/** Statistics derived from the frame times. Never reported by the collector — always recomputed. */
export interface FrameTimeStats {
  averageFps: number;
  onePercentLow: number;
  zeroPointOnePercentLow: number;
  frameCount: number;
  runDurationSec: number;
  capDetected: CapDetection;
  /** Fraction of frames within ±0.5% of the median frame time. Feeds cap detection. */
  clusteredFraction: number;
}

/**
 * A field the collector could not obtain automatically on this platform.
 *
 * The alternative to recording these is guessing, and a guessed RAM channel
 * count or overclock flag is indistinguishable from a detected one once it is
 * in the store. Every field that was not read from the machine itself is named
 * here with why, so a reader can tell measurement from attestation.
 *
 * `unresolved` means nobody supplied a value — the field is genuinely unknown.
 * `operator-supplied` means a human asserted it; that is weaker evidence than
 * detection and is recorded as such rather than being laundered into the same
 * shape as a detected value.
 */
export interface DetectionGap {
  field: string;
  reason: string;
  resolution: 'operator-supplied' | 'unresolved';
}

export interface MeasuredObservation {
  id: string;
  tier: ObservationTier;

  // --- identity, resolved against the existing catalogs -------------------
  gameId: string;
  cpuId: string;
  gpuId: string;
  ram: RamSpec;
  detected: DetectedEnvironment;

  // --- test conditions ----------------------------------------------------
  gameVersion?: string;
  /** Preferred over gameVersion: patches reuse version strings. At least one of the two is required. */
  gameBuildId?: string;
  /**
   * Set for platform games, where the client version does not identify what
   * was rendered. Absent for ordinary single games.
   */
  platformContent?: PlatformContent;
  gpuDriverVersion: string;
  osBuild: string;

  resolution: Resolution;
  /** Actual swapchain scale. A 1080p run at 70% render scale is not a 1080p record. */
  renderScalePercent: number;

  /** `unmapped` when the game has no comparable preset tier; see MeasuredPreset. */
  preset: MeasuredPreset;
  /**
   * Verbatim in-game setting, e.g. "Graphics Quality: Manual 8". Never
   * invented from `preset`. REQUIRED when preset is `unmapped` — that is the
   * only record of what was actually set.
   */
  presetLabel?: string;
  settingsSource: SettingsSource;
  /** Hash over the full settings config, so two runs can be proven identical. */
  settingsHash: string;

  rayTracing: boolean;
  upscaler: Upscaler;
  upscalerMode?: string;

  /**
   * Frame-Generation frames are DISPLAYED, not independently rendered. A
   * frame-generated figure is never comparable to a native one and must never
   * be presented as native FPS — the same rule the source-derived system
   * already enforces.
   */
  frameGeneration: boolean;
  frameGenerationFactor?: number;

  // --- results: ALL derived from the frame times, never collector-reported -
  frameTimes: FrameTimeRef;
  stats: FrameTimeStats;
  onePercentLowMethod: OnePercentLowMethod;

  // --- run integrity ------------------------------------------------------
  /** Unique per run. Replays of the same nonce are rejected as duplicates. */
  runNonce: string;

  // --- provenance ---------------------------------------------------------
  /** When the run happened (ISO-8601 UTC). Distinct from the source-derived system's `accessedAt`. */
  measuredAt: string;
  collectorVersion: string;
  collectorBuildHash: string;
  /**
   * Fields the collector could not detect. Empty means everything in this
   * record was read from the machine; non-empty is a disclosure, not a defect.
   */
  detectionGaps: DetectionGap[];
  notes?: string;
}

/** Envelope for the separate measured store. */
export interface MeasuredObservationStore {
  schemaVersion: number;
  note: string;
  observations: MeasuredObservation[];
}

export const MEASURED_SCHEMA_VERSION = 1;

/** Minimums below which a run is too short to characterize performance. */
export const MIN_RUN_DURATION_SEC = 60;
export const MIN_FRAME_COUNT = 3000;

/**
 * The accepted values for the enum-typed fields, as runtime data.
 *
 * The unions above are erased at compile time, so a CLI string cast to
 * `Resolution` type-checks and then travels all the way into the store. These
 * arrays are what lets validation actually check the value. They are declared
 * here, beside the types, so the two cannot drift apart.
 */
export const RESOLUTIONS: readonly Resolution[] = ['1080p', '1440p', '4k'];
export const MEASURED_PRESETS: readonly MeasuredPreset[] = ['low', 'medium', 'high', 'ultra', 'extreme', 'unmapped'];
export const UPSCALERS: readonly Upscaler[] = ['native', 'dlss', 'fsr', 'xess'];

/**
 * Bounds for the numeric run-condition fields.
 *
 * Wide on purpose: they exist to catch a typo or a mis-parsed flag entering
 * the store, not to express an opinion about how a run should be configured.
 * Render scale above 100% is legitimate supersampling; a frame-generation
 * factor of 1 is not frame generation at all.
 */
export const MIN_RENDER_SCALE_PERCENT = 1;
export const MAX_RENDER_SCALE_PERCENT = 400;
export const MIN_FRAME_GENERATION_FACTOR = 1;
export const MAX_FRAME_GENERATION_FACTOR = 8;
