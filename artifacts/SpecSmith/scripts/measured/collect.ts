// V1 measured-observation collector.
//
//   npx tsx scripts/measured/collect.ts --csv <presentmon.csv> --game-id <id> \
//     --resolution 1440p --preset high --ram-channels 2 \
//     --settings-file <path> [--process <name>] [--swap-chain <addr>] \
//     [--gpu-id <id>] [--cpu-id <id>] [--dry-run]
//
// The GPU and CPU are RESOLVED from what Windows reports, not supplied.
// --gpu-id/--cpu-id are optional and may only disambiguate between catalog
// entries the detected name genuinely could mean (Windows reports one name for
// cards that differ only by memory size). See ./catalog.ts.
//
// SCOPE: one controlled run, on Windows, producing one observation. No
// community submission, no accounts, no UI, no scheduling, no multi-game
// library. Those are deliberately absent, not unfinished.
//
// It creates no statistics and no validation logic of its own. Frame times go
// to computeFrameTimeStats, the assembled record goes to
// validateMeasuredObservation, and blobs go to frameTimeStore — the same code
// paths the schema was reviewed against. A second implementation of any of
// those would be a second definition of what SpecSmith means by a measurement.
//
// THE SAVE RULE: an observation is written only if validation returns zero
// errors. A rejected run is reported and discarded, never written "for later" —
// a store that holds invalid records is not a source of truth.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { computeFrameTimeStats } from '../../src/lib/measured/frameTimes';
import { errors, validateMeasuredObservation, warnings, type MeasuredCatalogs, type MeasuredIssue } from '../../src/lib/measured/validate';
import {
  MAX_FRAME_GENERATION_FACTOR,
  MAX_RENDER_SCALE_PERCENT,
  MEASURED_PRESETS,
  MEASURED_SCHEMA_VERSION,
  MIN_FRAME_GENERATION_FACTOR,
  MIN_RENDER_SCALE_PERCENT,
  RESOLUTIONS,
  UPSCALERS,
  type CaptureToolProvenance,
  type CatalogMatchMethod,
  PINNED_ONE_PERCENT_LOW_METHOD,
  type DetectionGap,
  type MeasuredObservation,
  type MeasuredObservationStore,
  type MeasuredPreset,
  type PlatformContent,
  type Resolution,
  type SettingsFileProvenance,
  type Upscaler,
} from '../../src/lib/measured/types';
import type { GameFeatureProfile } from '../../src/lib/benchmarks/types';
import { parsePresentMonCsv } from './presentmon';
import {
  MAX_CAPTURE_SECONDS,
  MIN_CAPTURE_SECONDS,
  releaseCapture,
  resolvePresentMonBinary,
  runPresentMonCapture,
} from './presentmonRunner';
import { installCancellationHandler } from './cancellation';
import { KNOWN_DETECTION_GAPS, type DetectedHardware } from './environment';
import { loadCatalogs, resolveHardware } from './catalog';
import { readRdr2SystemSettings, type Rdr2SystemSettings } from './rdr2Settings';

export const COLLECTOR_VERSION = '0.1.0';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

/**
 * Every file whose content determines what a saved observation MEANS.
 *
 * Not just this directory. Two observations claiming the same
 * collectorBuildHash are claiming they were produced by code that behaves
 * identically — which is false if hardware attribution, how a frame time is
 * interpreted, how the statistics are computed, or what validation accepts
 * could have changed between them. Paths are relative to `here` (this file's
 * directory); `../../src/lib/measured/...` resolves correctly through
 * path.join without a separate base.
 */
export const DEFAULT_BUILD_HASH_FILES: readonly string[] = [
  // This directory: parsing, environment detection, the fs half of catalog
  // loading, and the assembly/CLI logic itself.
  'collect.ts',
  'presentmon.ts',
  // How the capture was TAKEN determines what it contains: the flag set fixes
  // whether dropped presents are in the file at all, and whether the columns
  // segmentation needs exist. A capture produced under a different flag set is
  // a different measurement even when the parser reads it identically.
  'presentmonRunner.ts',
  // Cancellation decides whether a run completes or is abandoned, and what is
  // left on disk when it is — part of how a capture came to exist.
  'cancellation.ts',
  // Segmentation decides WHICH frames a figure is computed over, so it
  // determines what the figure means just as directly as the statistics do.
  'segmentation.ts',
  'environment.ts',
  'catalog.ts',
  // The pure src/lib/measured half: hardware attribution's actual resolver,
  // frame-time interpretation and statistics, and validation/schema semantics.
  '../../src/lib/measured/hardwareMatch.ts',
  '../../src/lib/measured/frameTimes.ts',
  '../../src/lib/measured/validate.ts',
  '../../src/lib/measured/types.ts',
];

/**
 * Ties an observation to the exact measurement code that produced it.
 *
 * `baseDir` exists so this can be tested against a controlled set of files
 * without depending on the real repository's current content — the property
 * under test is "changing a dependency's bytes changes the digest", which
 * holds for any file set, not specifically these ones.
 */
export function collectorBuildHash(files: readonly string[] = DEFAULT_BUILD_HASH_FILES, baseDir: string = here): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) h.update(fs.readFileSync(path.join(baseDir, f)));
  return h.digest('hex').slice(0, 16);
}

export interface CollectInputs {
  gameId: string; gpuId: string; cpuId: string;
  /**
   * How gpuId/cpuId were arrived at. Defaults to 'manual' only so existing
   * assembly tests keep working; the CLI always supplies the real method from
   * catalog resolution, because 'manual' would now be a false claim.
   */
  gpuMatchMethod?: CatalogMatchMethod; cpuMatchMethod?: CatalogMatchMethod;
  resolution: Resolution; preset: MeasuredPreset; presetLabel?: string;
  upscaler: Upscaler; upscalerMode?: string;
  rayTracing: boolean; frameGeneration: boolean; frameGenerationFactor?: number;
  renderScalePercent: number;
  /** Operator-supplied: see KNOWN_DETECTION_GAPS. */
  ramChannels: number;
  gpuOverclocked: boolean;
  /** Verbatim settings text the operator attests to; hashed so two runs can be compared. */
  settingsText: string;
  gameVersion?: string;
  gameBuildId?: string;
  platformContent?: PlatformContent;
  notes?: string;
}

/**
 * Assembles an observation from a real capture plus a real environment probe.
 *
 * Pure: it takes the detected hardware and frame times rather than reading the
 * machine itself, which is what lets the whole assembly path be tested off
 * Windows. The Windows-only part is the probe, and it is the only part that
 * cannot be exercised here.
 */
export function buildObservation(args: {
  frameTimesMs: readonly number[];
  hardware: DetectedHardware;
  inputs: CollectInputs;
  frameTimeRef: MeasuredObservation['frameTimes'];
  measuredAt: string;
  runNonce: string;
  buildHash: string;
  /** Set only when this run captured its own frames; absent for --csv. */
  captureTool?: CaptureToolProvenance;
  /** Set only when a game-specific settings-file parser ran (today: RDR2 only); see SettingsFileProvenance. */
  settingsFile?: SettingsFileProvenance;
}): MeasuredObservation {
  const { frameTimesMs, hardware, inputs, frameTimeRef, measuredAt, runNonce, buildHash, captureTool, settingsFile } = args;

  // Every field the machine could not tell us, named with why. Nothing here is
  // filled in with a plausible-looking default.
  const detectionGaps: DetectionGap[] = KNOWN_DETECTION_GAPS
    // KNOWN_DETECTION_GAPS's settingsHash entry claims "no general mechanism
    // exists to read an arbitrary game's graphics configuration" — true for
    // every game this collector does not have a parser for, but false the
    // moment settingsFile is actually set. Leaving it in would sit a stale
    // "nothing was read" claim directly beside settingsFile's own honest
    // "this much was read" disclosure. Dropped, not reworded: the disclosure
    // that replaces it is settingsFile.coverage/parsedFields itself.
    .filter((g) => !(g.field === 'settingsHash' && settingsFile))
    .map((g) => ({
      field: g.field,
      reason: g.reason,
      resolution: 'operator-supplied' as const,
    }));
  // captureTool is per-run, not a fixed platform limit, so it is not in
  // KNOWN_DETECTION_GAPS: a --capture-* run resolves it, a --csv run cannot,
  // because nothing about a hand-taken capture says what tool produced it.
  if (!captureTool) {
    detectionGaps.push({
      field: 'captureTool',
      reason: 'This run read an existing CSV (--csv) rather than capturing it; the collector did not run PresentMon itself and has no evidence of what tool produced the file.',
      resolution: 'unresolved',
    });
  }

  return {
    id: `obs-${measuredAt.slice(0, 10)}-${runNonce.slice(0, 8)}`,
    tier: 'measured',
    gameId: inputs.gameId,
    cpuId: inputs.cpuId,
    gpuId: inputs.gpuId,
    ram: {
      totalGb: hardware.ramTotalGb,
      channels: inputs.ramChannels,
      ratedSpeedMts: hardware.ramConfiguredSpeedMts,
    },
    detected: {
      gpuRaw: hardware.gpuRaw,
      cpuRaw: hardware.cpuRaw,
      // Set from catalog resolution against the detected names — see
      // ./catalog.ts. It was previously hardcoded to 'manual', which claimed
      // an operator-verified attribution that nothing had verified.
      gpuMatchMethod: inputs.gpuMatchMethod ?? 'manual',
      cpuMatchMethod: inputs.cpuMatchMethod ?? 'manual',
      gpuOverclockDetected: inputs.gpuOverclocked,
    },
    gameVersion: inputs.gameVersion,
    gameBuildId: inputs.gameBuildId,
    platformContent: inputs.platformContent,
    gpuDriverVersion: hardware.gpuDriverVersion,
    osBuild: hardware.osBuild,
    resolution: inputs.resolution,
    renderScalePercent: inputs.renderScalePercent,
    preset: inputs.preset,
    presetLabel: inputs.presetLabel,
    // config-parsed only when a game-specific parser actually ran and its
    // hash is what settingsHash carries below — never inferred from, say,
    // gameId alone, which would let a mismatched settingsFile silently claim
    // a source it does not back up.
    settingsSource: settingsFile ? 'config-parsed' : 'operator-attested',
    // Reuses settingsHash for the settings-file's own digest rather than
    // adding a second hash field: settingsHash already means "hash over the
    // full settings config," and system.xml IS the full config file — the
    // gap between "hashed everything" and "understood a partial subset" is
    // exactly what settingsFile.coverage/parsedFields discloses.
    settingsHash: settingsFile ? settingsFile.sha256 : createHash('sha256').update(inputs.settingsText).digest('hex').slice(0, 32),
    rayTracing: inputs.rayTracing,
    upscaler: inputs.upscaler,
    upscalerMode: inputs.upscalerMode,
    frameGeneration: inputs.frameGeneration,
    frameGenerationFactor: inputs.frameGenerationFactor,
    frameTimes: frameTimeRef,
    stats: computeFrameTimeStats(frameTimesMs),
    onePercentLowMethod: PINNED_ONE_PERCENT_LOW_METHOD,
    runNonce,
    measuredAt,
    collectorVersion: COLLECTOR_VERSION,
    collectorBuildHash: buildHash,
    captureTool,
    settingsFile,
    detectionGaps,
    notes: inputs.notes,
  };
}

export interface SaveOutcome {
  saved: boolean;
  issues: MeasuredIssue[];
  observation: MeasuredObservation;
}

/**
 * Validates, then saves only on success.
 *
 * Warnings do not block — they are disclosures that travel with the record.
 * Errors do, and the run is discarded rather than parked somewhere.
 */
export function validateAndSave(
  observation: MeasuredObservation,
  frameTimesMs: readonly number[],
  storePath: string,
  featureProfiles: readonly GameFeatureProfile[] = [],
  write: (p: string, contents: string) => void = (p, c) => fs.writeFileSync(p, c),
  catalogs: MeasuredCatalogs = {},
): SaveOutcome {
  const issues = validateMeasuredObservation(observation, frameTimesMs, featureProfiles, catalogs);
  if (errors(issues).length > 0) return { saved: false, issues, observation };

  const store = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as MeasuredObservationStore;
  if (store.schemaVersion !== MEASURED_SCHEMA_VERSION) {
    throw new Error(`Store schemaVersion is ${store.schemaVersion}; this collector writes ${MEASURED_SCHEMA_VERSION}.`);
  }
  store.observations.push(observation);
  write(storePath, `${JSON.stringify(store, null, 2)}\n`);
  return { saved: true, issues, observation };
}

/**
 * Whether this run's frames should be archived at all.
 *
 * Archiving is a side effect on the operator's disk, so it is tied to the run
 * actually being recorded rather than merely being processed. A dry run keeps
 * its promise of writing nothing, and a rejected run leaves nothing behind to
 * be mistaken later for evidence of a measurement that was never accepted.
 */
export function shouldPersistFrameTimes(dryRun: boolean, issues: readonly MeasuredIssue[]): boolean {
  return !dryRun && errors(issues).length === 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export class CliInputError extends Error {}

/**
 * Reads a flag's value.
 *
 * A value that itself starts with `--` is refused rather than accepted: a
 * mistyped command line like `--preset --dry-run` would otherwise set preset
 * to the literal string "--dry-run", which type-checks as a Preset and lands
 * in the store.
 */
function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  // A repeated flag silently used the first occurrence, so a command line that
  // sets --resolution twice recorded the one the operator probably did not
  // mean. There is no legitimate reason to pass one twice.
  if (argv.indexOf(`--${name}`, i + 1) >= 0) {
    throw new CliInputError(`--${name} was given more than once; remove the duplicate rather than relying on which one wins.`);
  }
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new CliInputError(`--${name} needs a value (got ${v === undefined ? 'end of arguments' : JSON.stringify(v)}).`);
  }
  return v;
}

const required = (argv: string[], name: string): string => {
  const v = arg(argv, name);
  if (v === undefined || v.trim() === '') throw new CliInputError(`Missing required --${name}`);
  return v;
};

/**
 * Checks a flag against the values the schema actually accepts.
 *
 * The unions in types.ts vanish at runtime, so `required(argv, 'preset') as
 * MeasuredPreset` is a cast, not a check — the collector used to do exactly
 * that for resolution, preset and upscaler, and any typo travelled straight
 * into the record. Validation catches it again before the store, but failing
 * here means the operator sees the mistake before a 90-second capture is
 * assembled around it.
 */
export function oneOf<T extends string>(value: string, accepted: readonly T[], flag: string): T {
  if (!(accepted as readonly string[]).includes(value)) {
    throw new CliInputError(`--${flag} "${value}" is not valid; accepted values are ${accepted.join(', ')}.`);
  }
  return value as T;
}

/**
 * A frame-generation multiplier.
 *
 * Kept separate from numberInRange so the lower bound reads as what it means:
 * a factor of 1 says every displayed frame was rendered, which is a native run
 * wearing a frame-generation label, not a frame-generation run.
 */
export function frameGenerationFactor(raw: string): number {
  const n = numberInRange(raw, 'frame-generation-factor', -Infinity, MAX_FRAME_GENERATION_FACTOR);
  if (n <= MIN_FRAME_GENERATION_FACTOR) {
    throw new CliInputError(
      `--frame-generation-factor is ${n}; it must be greater than ${MIN_FRAME_GENERATION_FACTOR}. A factor of ${MIN_FRAME_GENERATION_FACTOR} means every displayed frame was rendered, which is a native run.`,
    );
  }
  return n;
}

/** As numberInRange, for a flag that counts things and cannot be fractional. */
export function wholeNumberInRange(raw: string, flag: string, min: number, max: number): number {
  const n = numberInRange(raw, flag, min, max);
  if (!Number.isInteger(n)) throw new CliInputError(`--${flag} is ${n}; it must be a whole number.`);
  return n;
}

/** Parses a numeric flag, refusing anything non-finite or out of range. */
export function numberInRange(raw: string, flag: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new CliInputError(`--${flag} "${raw}" is not a number.`);
  if (n < min || n > max) throw new CliInputError(`--${flag} is ${n}; it must be between ${min} and ${max}.`);
  return n;
}

/**
 * Everything about the run that does NOT come from the machine.
 *
 * Split out and validated before the Windows probe runs, so a typo in
 * --preset fails immediately instead of after a PowerShell round trip — and so
 * these paths can be tested on any platform, which the probe cannot be.
 */
export type RunConditionInputs = Omit<CollectInputs, 'gpuId' | 'cpuId' | 'gpuMatchMethod' | 'cpuMatchMethod' | 'gameVersion'>;

export function parseRunConditions(argv: string[], knownGameIds?: readonly string[]): RunConditionInputs {
  const gameId = required(argv, 'game-id');
  if (knownGameIds && !knownGameIds.includes(gameId)) {
    throw new CliInputError(`--game-id "${gameId}" is not in the SpecSmith game catalog (${knownGameIds.join(', ')}).`);
  }

  const fgFactorRaw = arg(argv, 'frame-generation-factor');
  return {
    gameId,
    resolution: oneOf<Resolution>(required(argv, 'resolution'), RESOLUTIONS, 'resolution'),
    // 'unmapped' is legitimate for games with no comparable tier (Roblox's
    // Manual 1-10). Validation then requires --preset-label.
    preset: oneOf<MeasuredPreset>(required(argv, 'preset'), MEASURED_PRESETS, 'preset'),
    presetLabel: arg(argv, 'preset-label'),
    upscaler: oneOf<Upscaler>(arg(argv, 'upscaler') ?? 'native', UPSCALERS, 'upscaler'),
    upscalerMode: arg(argv, 'upscaler-mode'),
    rayTracing: argv.includes('--ray-tracing'),
    frameGeneration: argv.includes('--frame-generation'),
    frameGenerationFactor: fgFactorRaw === undefined ? undefined : frameGenerationFactor(fgFactorRaw),
    renderScalePercent: numberInRange(arg(argv, 'render-scale') ?? '100', 'render-scale', MIN_RENDER_SCALE_PERCENT, MAX_RENDER_SCALE_PERCENT),
    ramChannels: wholeNumberInRange(required(argv, 'ram-channels'), 'ram-channels', 1, 8),
    gpuOverclocked: argv.includes('--gpu-overclocked'),
    settingsText: fs.readFileSync(required(argv, 'settings-file'), 'utf-8'),
    gameBuildId: arg(argv, 'game-build-id'),
    // Platform games only. contentId is what makes the run interpretable;
    // contentVersion is usually unobtainable and left unset rather than guessed.
    platformContent: arg(argv, 'platform')
      ? {
          platform: String(arg(argv, 'platform')),
          contentId: String(arg(argv, 'content-id') ?? ''),
          contentName: arg(argv, 'content-name'),
          contentVersion: arg(argv, 'content-version'),
        }
      : undefined,
    notes: arg(argv, 'notes'),
  };
}

/**
 * Decides whether this run captures its own frames or reads a file.
 *
 * The two are mutually exclusive rather than one defaulting to the other: a
 * command line carrying both says two different things about where the
 * measurement came from, and picking either would make the record's origin a
 * guess.
 */
export function parseCaptureSelection(argv: string[]): { mode: 'csv'; csvPath: string } | { mode: 'capture'; processId?: number; processName?: string; seconds: number } {
  const csvFlag = arg(argv, 'csv');
  const secondsRaw = arg(argv, 'capture-seconds');
  const pidRaw = arg(argv, 'capture-process-id');
  const nameRaw = arg(argv, 'capture-process-name');
  const wantsCapture = secondsRaw !== undefined || pidRaw !== undefined || nameRaw !== undefined;

  if (csvFlag !== undefined && wantsCapture) {
    throw new CliInputError(
      '--csv and the --capture-* flags cannot be combined. Use --csv to read a capture you already took, or --capture-process-id ' +
        'with --capture-seconds to take one now.',
    );
  }
  if (csvFlag === undefined && !wantsCapture) {
    throw new CliInputError(
      'Nothing to measure. Pass --csv <presentmon.csv>, or capture now with --capture-process-id <pid> --capture-seconds <n>.',
    );
  }
  if (csvFlag !== undefined) {
    if (csvFlag.trim() === '') throw new CliInputError('Missing required --csv');
    return { mode: 'csv', csvPath: csvFlag };
  }
  if (secondsRaw === undefined) {
    throw new CliInputError('--capture-seconds is required when capturing. It is the length of the run to record.');
  }
  return {
    mode: 'capture',
    processId: pidRaw === undefined ? undefined : wholeNumberInRange(pidRaw, 'capture-process-id', 1, 0xffffffff),
    processName: nameRaw,
    seconds: wholeNumberInRange(secondsRaw, 'capture-seconds', MIN_CAPTURE_SECONDS, MAX_CAPTURE_SECONDS),
  };
}

/**
 * The process filter to hand parsePresentMonCsv after an automatic capture.
 *
 * Defaults to the exact pid PresentMon was told to capture (--process_id),
 * never to its executable name. selectTargetProcess already refuses an
 * ambiguous name at process-selection time specifically so a capture cannot
 * be attributed to the wrong one of two processes sharing a name (see
 * presentmonRunner.ts); filtering the CSV by name here would throw that
 * guarantee away right after establishing it — a second process sharing the
 * target's name, presenting during the same capture window, would silently
 * merge into this run's frame times. The pid is unique to the process
 * actually captured, so it is what is used by default.
 *
 * `explicit` — an operator-supplied --process — is never overridden: this
 * only supplies a default when none was given. Note that supplying any
 * filter, pid or name, means parsePresentMonCsv's own multi-process refusal
 * (triggered only when no filter is passed) cannot fire on this path; that
 * guard remains live for the manual --csv path, where no pid is known.
 */
export function resolveCaptureProcessFilter(explicit: string | undefined, targetProcessId: number): string {
  return explicit ?? String(targetProcessId);
}

// ---------------------------------------------------------------------------
// RDR2 settings-file provenance
// ---------------------------------------------------------------------------
//
// Only RDR2 has a settings-file parser today (scripts/measured/rdr2Settings.ts).
// This binds it to an automatic capture: read+hash immediately before
// PresentMon runs, read+hash again immediately after it exits, and refuse the
// run outright if either read fails or the file changed in between — the
// settings a run measured are only provable if nothing touched the file while
// PresentMon was running. Applies ONLY when source.mode === 'capture' and the
// game is rdr2; every other game and the manual --csv path are unaffected,
// since neither ever calls this.

/** The run's settings changed underneath it, or could not be re-confirmed unchanged, after capture. */
export class Rdr2SettingsChangedDuringCaptureError extends Error {}

/**
 * Exactly the fields parseRdr2SystemSettingsXml validates, as the dotted
 * paths SettingsFileProvenance.parsedFields must report. Kept as its own
 * list, rather than derived by reflecting over an Rdr2ParsedSettings value,
 * so it names what the PARSER PROMISES to validate, not what one particular
 * parsed object happens to have keys for.
 */
export const RDR2_PARSED_FIELD_NAMES: readonly string[] = [
  'schemaVersion',
  'videoCardDescription',
  'display.screenWidth',
  'display.screenHeight',
  'display.screenWidthWindowed',
  'display.screenHeightWindowed',
  'display.windowed',
  'display.vSync',
  'graphics.textureQuality',
  'graphics.shadowQuality',
  'graphics.reflectionQuality',
  'graphics.taa',
  'graphics.api',
];

/** Bridges rdr2Settings.ts's own result into the schema-safe, game-agnostic SettingsFileProvenance shape. */
export function toSettingsFileProvenance(settings: Rdr2SystemSettings): SettingsFileProvenance {
  return {
    game: 'rdr2',
    path: settings.location.path,
    sha256: settings.sha256,
    coverage: 'partial',
    parsedFields: RDR2_PARSED_FIELD_NAMES,
    parsedValues: {
      schemaVersion: settings.schemaVersion,
      videoCardDescription: settings.videoCardDescription,
      display: settings.display,
      graphics: settings.graphics,
    },
  };
}

/**
 * Reads RDR2's system.xml once now (`before`), and returns a `verifyUnchanged`
 * closure that re-reads the SAME resolved path — not wherever the locator
 * would find it a second time — and throws Rdr2SettingsChangedDuringCaptureError
 * if that second read fails for any reason, or if its digest differs from the
 * first. Call `before`'s read before capture starts and `verifyUnchanged()`
 * immediately after PresentMon exits; do not call this at all for any other
 * game or for --csv.
 *
 * `readSettings` is injectable (a function of an optional explicit path, not
 * of ReadDeps directly) so tests can drive both reads independently without
 * touching a filesystem — passing undefined for the first call exercises the
 * real locator, and a fixed path for the second pins it to the same file.
 */
export function bindRdr2SettingsProvenance(
  readSettings: (explicitPath?: string) => Rdr2SystemSettings = (explicitPath) => readRdr2SystemSettings({ explicitPath }),
): { before: Rdr2SystemSettings; verifyUnchanged: () => void } {
  const before = readSettings(undefined);
  return {
    before,
    verifyUnchanged: () => {
      let after: Rdr2SystemSettings;
      try {
        after = readSettings(before.location.path);
      } catch (error) {
        throw new Rdr2SettingsChangedDuringCaptureError(
          `Could not re-read RDR2's system.xml at ${before.location.path} after capture, to confirm the settings that were measured are still what the file holds: ` +
            `${error instanceof Error ? error.message : String(error)}. Refusing to save an observation whose settings cannot be confirmed stable.`,
        );
      }
      if (after.sha256 !== before.sha256) {
        throw new Rdr2SettingsChangedDuringCaptureError(
          `system.xml at ${before.location.path} changed during capture (sha256 ${before.sha256} before, ${after.sha256} after). ` +
            'The settings this capture measured are not necessarily the settings the file holds now, and there is no honest way to attribute the run to either version, so it is refused.',
        );
      }
    },
  };
}

/**
 * Validates `--internal-cancel-after-seconds`, a testing-only flag that
 * self-cancels a capture from inside this process instead of depending on a
 * signal delivered from outside it.
 *
 * WHY THIS EXISTS
 * ---------------
 * windows-smoke-test.ps1 used to simulate Ctrl-C with a separate launcher
 * process calling `child.kill('SIGINT')` on the collector. A real Windows
 * run showed that does not work: Node's `child.kill()` on Windows is not a
 * real console Ctrl-C event (`GenerateConsoleCtrlEvent`) that this process's
 * signal handler could catch — it is closer to `TerminateProcess`, so the
 * child exited immediately with signal=SIGINT and never ran any
 * cancellation or cleanup logic at all, leaving the ETW session, lock file
 * and temp directory behind. Manual, real Ctrl-C in a real console continued
 * to work correctly throughout, because that IS a real console event.
 * Nothing OUTSIDE a Windows process can safely simulate one for testing
 * purposes, so this flag triggers the exact same cancellation path from
 * INSIDE the process instead, through cancellation.ts's `simulateSignal` —
 * the same `AbortController` a real Ctrl-C uses, not a second, parallel
 * implementation of what cancellation means.
 *
 * WHY IT IS GATED TO --dry-run
 * -----------------------------
 * This is a testing aid, not a capture mode. An operator who wants a
 * savable capture should never have it silently self-cancel on a timer —
 * `throw`ing here rather than silently ignoring the flag is what makes that
 * impossible rather than merely undocumented.
 *
 * Returns `undefined` when the flag was not passed at all.
 */
export function validateInternalCancelAfterSeconds(
  raw: string | undefined,
  source: ReturnType<typeof parseCaptureSelection>,
  dryRun: boolean,
): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = numberInRange(raw, 'internal-cancel-after-seconds', 0.05, MAX_CAPTURE_SECONDS);
  if (source.mode !== 'capture') {
    throw new CliInputError(
      '--internal-cancel-after-seconds only applies to an automatic capture (--capture-process-id or ' +
        '--capture-process-name), not --csv.',
    );
  }
  if (!dryRun) {
    throw new CliInputError(
      '--internal-cancel-after-seconds requires --dry-run. It exists to smoke-test the cancellation and ' +
        'cleanup path from inside this process, not to take a real, savable capture that then silently ' +
        'cancels itself on a timer.',
    );
  }
  if (seconds >= source.seconds) {
    throw new CliInputError(
      `--internal-cancel-after-seconds (${seconds}) must be less than --capture-seconds ` +
        `(${source.seconds}), or the capture would finish before it ever fires.`,
    );
  }
  return seconds;
}

async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const source = parseCaptureSelection(argv);
  // See validateInternalCancelAfterSeconds for why this exists and why it is
  // gated to --dry-run: it self-cancels a capture from inside this process,
  // for smoke-testing the cancellation and cleanup path without depending on
  // a signal delivered from outside it.
  const internalCancelAfterSeconds = validateInternalCancelAfterSeconds(arg(argv, 'internal-cancel-after-seconds'), source, dryRun);

  // Flags first. Nothing here needs the machine, so a mistyped value costs a
  // second rather than a PowerShell round trip and a 90-second capture built
  // around it.
  const catalogs = loadCatalogs();
  const runConditions = parseRunConditions(argv, catalogs.gameIds);
  const preferredGpuId = arg(argv, 'gpu-id');
  const preferredCpuId = arg(argv, 'cpu-id');

  const { detectWindowsEnvironment, detectExecutableVersion } = await import('./environment');
  // Hardware detection runs BEFORE the capture, not after it.
  //
  // It is the step most likely to refuse \u2014 an iGPU beside a discrete card is
  // the common case, not the exotic one \u2014 and refusing after the capture would
  // throw away a run the operator has to play again. When reading an existing
  // --csv there is nothing to lose either way, so the order is the same for
  // both and there is only one path to reason about.
  //
  // --gpu-name disambiguates a machine with more than one rendering adapter.
  // Without it the probe REFUSES rather than picking one, because a wrong pick
  // records the wrong GPU and the wrong driver version together, silently.
  const hardware = detectWindowsEnvironment(undefined, arg(argv, 'gpu-name'));
  if (hardware.adaptersSeen.length > 1) {
    console.log(`Adapters present: ${hardware.adaptersSeen.join(', ')}`);
  }
  console.log(`Hardware: ${hardware.gpuRaw} / ${hardware.cpuRaw} / driver ${hardware.gpuDriverVersion}`);

  let csvPath: string;
  let csvText: string;
  let release: (() => void) | undefined;
  let processFilter = arg(argv, 'process');
  let captureTool: CaptureToolProvenance | undefined;
  let settingsFile: SettingsFileProvenance | undefined;

  if (source.mode === 'capture') {
    const binary = resolvePresentMonBinary({
      executablePath: arg(argv, 'presentmon') ?? process.env.SPECSMITH_PRESENTMON,
      expectedSha256: arg(argv, 'presentmon-sha256') ?? process.env.SPECSMITH_PRESENTMON_SHA256,
      allowUnpinned: argv.includes('--allow-unpinned-presentmon'),
    });
    console.log(`PresentMon: ${binary.path}\n  sha256 ${binary.sha256}${binary.pinned ? ' (pinned)' : ' (NOT PINNED \u2014 --allow-unpinned-presentmon)'}`);
    // Recorded on the observation itself (captureTool), not just printed \u2014
    // the tool that produced a measurement's frame times is part of what the
    // measurement means, same as the hardware that ran it.
    captureTool = { name: path.basename(binary.path), sha256: binary.sha256, pinned: binary.pinned };

    // Ctrl-C stops the capture and cleans up rather than leaving PresentMon
    // and its ETW session running behind a dead collector.
    //
    // This used to be `process.once('SIGINT', () => controller.abort())`, which
    // aborted the signal but did nothing to keep this process alive long enough
    // to act on it. On Windows the Ctrl+C reaches cmd.exe, pnpm, tsx, the
    // collector and PresentMon simultaneously; the shell tears down, the prompt
    // returns, and the collector died mid-cleanup — leaving a live ETW session,
    // the lock file and the temp capture behind. See ./cancellation.ts.
    const cancellation = installCancellationHandler();
    // Only set when --internal-cancel-after-seconds asked for it; cleared in
    // the finally block below whichever way this settles, same as any other
    // timer here.
    let internalCancelTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Read and hash RDR2's own settings file immediately before capture \u2014
      // only for RDR2, only for an automatic capture. See
      // bindRdr2SettingsProvenance's own comment for why this exists and why
      // it is read again (and compared) immediately after PresentMon exits,
      // below. A read failure here throws its own clear
      // Rdr2SettingsNotFoundError/Rdr2SettingsFormatError and refuses the run
      // before a capture is ever attempted, the same principle hardware
      // detection above already follows.
      const rdr2Provenance = runConditions.gameId === 'rdr2' ? bindRdr2SettingsProvenance() : undefined;
      if (rdr2Provenance) {
        console.log(
          `RDR2 settings: ${rdr2Provenance.before.location.path}\n  sha256 ${rdr2Provenance.before.sha256}\n` +
            `  schema version ${rdr2Provenance.before.schemaVersion} \u00b7 ${rdr2Provenance.before.videoCardDescription}\n` +
            `  resolution ${rdr2Provenance.before.display.screenWidth}x${rdr2Provenance.before.display.screenHeight} ` +
            `(windowed-mode pair ${rdr2Provenance.before.display.screenWidthWindowed}x${rdr2Provenance.before.display.screenHeightWindowed}) \u00b7 ` +
            `windowed=${rdr2Provenance.before.display.windowed} \u00b7 vSync=${rdr2Provenance.before.display.vSync}\n` +
            `  texture=${rdr2Provenance.before.graphics.textureQuality} shadow=${rdr2Provenance.before.graphics.shadowQuality} ` +
            `reflection=${rdr2Provenance.before.graphics.reflectionQuality} taa=${rdr2Provenance.before.graphics.taa} api=${rdr2Provenance.before.graphics.api}\n` +
            `  (partial read \u2014 ${RDR2_PARSED_FIELD_NAMES.length} fields; not a unified preset, not the complete configuration)`,
        );
      }

      console.log(`Capturing ${source.seconds}s\u2026 play the run now. Ctrl-C cancels.`);
      const outcome = await runPresentMonCapture({
        processId: source.processId,
        processName: source.processName,
        seconds: source.seconds,
        binary,
        outputDir: arg(argv, 'capture-output-dir'),
        signal: cancellation.signal,
        // Handed over the moment they exist, not when the capture succeeds, so
        // a Ctrl+C during the capture still has something to clean up.
        onResourcesAllocated: (resources) => {
          cancellation.track(resources);
          // Started HERE, not when this flag was parsed: catalog loading,
          // PresentMon resolution and hardware detection all happen first and
          // take a variable amount of time, and this is the earliest point at
          // which the capture has actually, verifiably begun.
          if (internalCancelAfterSeconds !== undefined) {
            console.log(
              `[internal-cancel] capture began; simulating cancellation in ${internalCancelAfterSeconds}s ` +
                'through the same path a real Ctrl-C would use \u2014 this is testing the cleanup path, not a ' +
                'real Ctrl-C, and is only ever enabled with --dry-run.',
            );
            internalCancelTimer = setTimeout(() => cancellation.simulateSignal('SIGINT'), internalCancelAfterSeconds * 1000);
            internalCancelTimer.unref?.();
          }
        },
      });
      // Immediately after PresentMon exits, not after any further
      // processing — re-reads the exact file bindRdr2SettingsProvenance
      // already resolved and throws if it is unreadable now or its digest
      // moved, refusing the run before anything is assembled around it.
      rdr2Provenance?.verifyUnchanged();
      if (rdr2Provenance) settingsFile = toSettingsFileProvenance(rdr2Provenance.before);

      csvPath = outcome.csvPath;
      csvText = outcome.csv;
      processFilter = resolveCaptureProcessFilter(processFilter, outcome.target.processId);
      if (outcome.columns.missingOptional.length > 0) {
        console.warn(`  WARNING capture: no ${outcome.columns.missingOptional.join(', ')} column; segmentation will record those times as absent.`);
      }
      console.log(`Captured ${outcome.target.name} (pid ${outcome.target.processId}) to ${csvPath}`);
      // Only a temp directory this runner created is ever removed; a
      // --capture-output-dir the operator chose is left alone.
      if (outcome.ownedTempDir) release = () => releaseCapture(outcome);
    } finally {
      if (internalCancelTimer) clearTimeout(internalCancelTimer);
      // The capture is over either way. Past this point the CSV is owned by
      // the normal path (or by --keep-capture), so the last-resort exit
      // cleanup must stop tracking it.
      cancellation.dispose();
    }
  } else {
    csvPath = source.csvPath;
    csvText = fs.readFileSync(csvPath, 'utf-8');
  }

  try {
    await assembleFromCsv({ csvText, csvPath, processFilter, swapChainFilter: arg(argv, 'swap-chain'), argv, dryRun, catalogs, runConditions, preferredGpuId, preferredCpuId, hardware, detectExecutableVersion, captureTool, settingsFile });
  } finally {
    // The CSV has been read into memory and parsed by now, so the temp copy
    // has no further readers. --keep-capture keeps it for a post-mortem.
    if (release && !argv.includes('--keep-capture')) release();
    else if (release) console.log(`Capture retained at ${csvPath} (--keep-capture).`);
  }
}

/** Everything downstream of "we have CSV text": unchanged by where it came from. */
async function assembleFromCsv(ctx: {
  csvText: string; csvPath: string; processFilter?: string; swapChainFilter?: string;
  argv: string[]; dryRun: boolean;
  catalogs: ReturnType<typeof loadCatalogs>;
  runConditions: RunConditionInputs;
  preferredGpuId?: string; preferredCpuId?: string;
  hardware: DetectedHardware;
  detectExecutableVersion: (exePath: string) => string | undefined;
  /** Set only when this run captured its own frames; absent for --csv. */
  captureTool?: CaptureToolProvenance;
  /** Set only for an automatic RDR2 capture whose settings were confirmed stable across it; absent otherwise. */
  settingsFile?: SettingsFileProvenance;
}): Promise<void> {
  const { csvText, argv, dryRun, catalogs, runConditions, preferredGpuId, preferredCpuId, hardware, detectExecutableVersion, captureTool, settingsFile } = ctx;

  const parsed = parsePresentMonCsv(csvText, ctx.processFilter, ctx.swapChainFilter);
  console.log(`Frames: ${parsed.frameTimesMs.length} usable (${parsed.droppedFrames} presented but not displayed \u2014 retained, ${parsed.discardedFirstFrames} initial present with no interval)`);
  if (parsed.truncatedTrailingRows > 0) console.log('Note: the final CSV line was cut off mid-write and was not read.');

  // Hardware attribution is DERIVED from what the machine reported, never
  // taken on trust from the command line. --gpu-id/--cpu-id are optional and
  // may only disambiguate between candidates the detected name supports; see
  // ./catalog.ts.
  const gpuMatch = resolveHardware(hardware.gpuRaw, 'gpu', catalogs.gpus, preferredGpuId);
  const cpuMatch = resolveHardware(hardware.cpuRaw, 'cpu', catalogs.cpus, preferredCpuId);
  console.log(`Attributed: ${gpuMatch.id} ("${gpuMatch.name}", ${gpuMatch.matchMethod}) / ${cpuMatch.id} ("${cpuMatch.name}", ${cpuMatch.matchMethod})`);

  const exePath = arg(argv, 'game-exe');
  const inputs: CollectInputs = {
    ...runConditions,
    gpuId: gpuMatch.id,
    cpuId: cpuMatch.id,
    gpuMatchMethod: gpuMatch.matchMethod,
    cpuMatchMethod: cpuMatch.matchMethod,
    gameVersion: arg(argv, 'game-version') ?? (exePath ? detectExecutableVersion(exePath) : undefined),
  };

  // Described, not yet written. Archiving the frames here would put a blob on
  // disk for a run that may be a dry run or may be about to fail validation —
  // and the program would then print "nothing written" over the top of it.
  // The ref is identical either way, so the record is unaffected.
  const { describeFrameTimes, writeFrameTimes } = await import('./frameTimeStore.mjs');
  const { ref: frameTimeRef } = await describeFrameTimes(parsed.frameTimesMs);

  const observation = buildObservation({
    frameTimesMs: parsed.frameTimesMs,
    hardware,
    inputs,
    frameTimeRef,
    measuredAt: new Date().toISOString(),
    runNonce: randomUUID(),
    buildHash: collectorBuildHash(),
    captureTool,
    settingsFile,
  });

  const profiles = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'src', 'data', 'gameFeatureProfiles.json'), 'utf-8'),
  ) as GameFeatureProfile[];
  const storePath = path.join(repoRoot, 'src', 'data', 'measuredObservations.json');

  // The same catalogs the attribution used, re-checked at the store boundary:
  // the CLI is one caller, and the store's guarantee must not depend on which
  // caller wrote the record.
  // Full entries, not just id lists — validation re-derives attribution
  // from these against the detected hardware, the same resolver this file
  // used above. That re-check is what makes it impossible for a non-CLI
  // caller of validateAndSave to save a gpuId/cpuId the detected hardware
  // does not actually support.
  const idCatalogs: MeasuredCatalogs = { gameIds: catalogs.gameIds, gpus: catalogs.gpus, cpus: catalogs.cpus };
  const issues = validateMeasuredObservation(observation, parsed.frameTimesMs, profiles, idCatalogs);
  for (const w of warnings(issues)) console.warn(`  WARNING ${w.rule}: ${w.message}`);
  for (const e of errors(issues)) console.error(`  ERROR   ${e.rule}: ${e.message}`);

  // The blob goes down BEFORE the record, so a saved observation never points
  // at frames that are not there. The reverse ordering can leave a record
  // referencing nothing; this ordering can at worst leave an orphan blob,
  // which is content-addressed and harmless.
  let outcome: SaveOutcome = { saved: false, issues, observation };
  if (shouldPersistFrameTimes(dryRun, issues)) {
    await writeFrameTimes(parsed.frameTimesMs);
    outcome = validateAndSave(observation, parsed.frameTimesMs, storePath, profiles, undefined, idCatalogs);
  }

  console.log(`\navg ${observation.stats.averageFps} fps · 1% low ${observation.stats.onePercentLow} · 0.1% low ${observation.stats.zeroPointOnePercentLow}`);
  // Confirms captureTool actually made it onto the record, not just that the
  // capture step printed it earlier — this is the same information the store
  // would persist.
  if (observation.captureTool) {
    console.log(`Capture tool: ${observation.captureTool.name} sha256 ${observation.captureTool.sha256}${observation.captureTool.pinned ? ' (pinned)' : ' (NOT PINNED)'}`);
  }
  // Printed unconditionally, same as captureTool above — a dry run must
  // still show the settings provenance it read and confirmed stable, even
  // though it saves nothing.
  if (observation.settingsFile) {
    console.log(
      `Settings file: ${observation.settingsFile.game} — ${observation.settingsFile.path}\n` +
        `  sha256 ${observation.settingsFile.sha256}\n` +
        `  partial coverage (${observation.settingsFile.parsedFields.length} fields): ${observation.settingsFile.parsedFields.join(', ')}`,
    );
  }
  if (dryRun) console.log('Dry run — nothing written, including the frame-time archive.');
  else if (outcome.saved) console.log(`Saved ${observation.id}`);
  else {
    console.error('\nNot saved: validation failed. The run is discarded, not parked — no frames were archived.');
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    // A cancellation (see cancellation.ts) already set a deliberate,
    // documented exit code — CANCELLED_EXIT_CODE — before its error reaches
    // here as this rejection. Overwriting it with a generic 1 is what made a
    // clean, requested cancellation indistinguishable from a real crash: a
    // Windows retest of the cleanup fix found the shell's exit code was 1,
    // not the tested 130, because this line ran after cancellation.ts's and
    // always won. This catch exists for everything ELSE — a real failure that
    // never set an exit code at all — so it only supplies 1 when nothing
    // already decided the process's exit status.
    if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
      process.exitCode = 1;
    }
  });
}
