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
import type { SegmentationRecord } from './benchmarkProtocol';

export type { Preset, Resolution, Upscaler };
export type { SegmentationRecord };

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

/**
 * Which capture tool produced this run's frame times, and how sure we are it
 * is the tool it claims to be.
 *
 * Absent when the collector did not run the capture itself: a CSV read via
 * `--csv` could have come from any PresentMon build, or a different tool
 * entirely, and the collector has no way to know which. That absence is
 * recorded as a detection gap (see `detectionGaps`) rather than silently
 * omitted.
 */
export interface CaptureToolProvenance {
  /** The executable's file name, e.g. "PresentMon.exe" — not a full path; a local install path is not part of what the run means. */
  name: string;
  /** SHA-256 of the executable's bytes at capture time. */
  sha256: string;
  /** Whether that digest was checked against an operator-pinned value before this capture ran. */
  pinned: boolean;
}

/**
 * Provenance for a game-specific settings file the collector read and hashed
 * directly, rather than an operator attesting to a settings dump it cannot
 * verify. Distinct from `CaptureToolProvenance` (which tool produced the
 * frame times) — this is which settings FILE, and how much of it, the
 * collector actually read.
 *
 * Set only when a game-specific parser exists and ran (today: RDR2's
 * system.xml, via scripts/measured/rdr2Settings.ts). Absent for every other
 * game and for `--csv`, exactly like `captureTool` is absent there.
 *
 * `coverage: 'partial'` is not a placeholder — it is the honest, permanent
 * state until a settings-file parser exists that reads every setting a game
 * exposes, which none does today. `parsedFields` names EXACTLY which
 * settings were read and validated, so "partial" is never a vague hedge: a
 * reader can see precisely what is and is not covered. Neither this type nor
 * anything that constructs it may derive a single "preset" or claim a
 * complete configuration from a partial read — see MeasuredPreset's own
 * `unmapped` for why inventing that cross-game equivalence is refused.
 */
export interface SettingsFileProvenance {
  /** Which game's settings file this is, e.g. 'rdr2'. Free-form, mirroring gameId's own looseness — not a closed catalog. */
  game: string;
  /** Absolute path the file was read from, on the machine that captured this run. */
  path: string;
  /** SHA-256 of the file's raw bytes, read immediately before capture began and re-confirmed unchanged immediately after it ended. */
  sha256: string;
  /** Always 'partial' today — see this interface's own doc comment. */
  coverage: 'partial';
  /** Exactly the field names this parser validated, e.g. ['display.screenWidth', 'graphics.textureQuality', ...]. The complete, literal answer to "what was actually covered." */
  parsedFields: readonly string[];
  /** The parsed values themselves, keyed to match parsedFields. Kept as a plain JSON value rather than a game-specific type, since MeasuredObservation must stay game-agnostic — see DetectedEnvironment and PlatformContent for the same reasoning applied elsewhere in this file. */
  parsedValues: Record<string, unknown>;
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
  /** Set only when a game-specific settings-file parser ran; see SettingsFileProvenance. */
  settingsFile?: SettingsFileProvenance;

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
  /**
   * How the measured region was selected from the raw capture, when any
   * segmentation was applied.
   *
   * Optional: a record produced from a capture used whole carries none. When
   * present the store REJECTS it unless every stage it names is permitted by
   * the benchmark protocol registered for this game — a record cannot grant
   * itself a rule the game was never approved for. See benchmarkProtocol.ts.
   */
  segmentation?: SegmentationRecord;
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
  /** Set only when the collector ran the capture itself; see CaptureToolProvenance. */
  captureTool?: CaptureToolProvenance;
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
