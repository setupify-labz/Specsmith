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
  type CatalogMatchMethod,
  PINNED_ONE_PERCENT_LOW_METHOD,
  type DetectionGap,
  type MeasuredObservation,
  type MeasuredObservationStore,
  type MeasuredPreset,
  type PlatformContent,
  type Resolution,
  type Upscaler,
} from '../../src/lib/measured/types';
import type { GameFeatureProfile } from '../../src/lib/benchmarks/types';
import { parsePresentMonCsv } from './presentmon';
import { KNOWN_DETECTION_GAPS, type DetectedHardware } from './environment';
import { loadCatalogs, resolveHardware } from './catalog';

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
}): MeasuredObservation {
  const { frameTimesMs, hardware, inputs, frameTimeRef, measuredAt, runNonce, buildHash } = args;

  // Every field the machine could not tell us, named with why. Nothing here is
  // filled in with a plausible-looking default.
  const detectionGaps: DetectionGap[] = KNOWN_DETECTION_GAPS.map((g) => ({
    field: g.field,
    reason: g.reason,
    resolution: 'operator-supplied' as const,
  }));

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
    settingsSource: 'operator-attested',
    settingsHash: createHash('sha256').update(inputs.settingsText).digest('hex').slice(0, 32),
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

async function main(argv: string[]): Promise<void> {
  const csvPath = required(argv, 'csv');
  const dryRun = argv.includes('--dry-run');

  // Flags first. Nothing here needs the machine, so a mistyped value costs a
  // second rather than a PowerShell round trip and a 90-second capture built
  // around it.
  const catalogs = loadCatalogs();
  const runConditions = parseRunConditions(argv, catalogs.gameIds);
  const preferredGpuId = arg(argv, 'gpu-id');
  const preferredCpuId = arg(argv, 'cpu-id');

  const parsed = parsePresentMonCsv(fs.readFileSync(csvPath, 'utf-8'), arg(argv, 'process'), arg(argv, 'swap-chain'));
  console.log(`Frames: ${parsed.frameTimesMs.length} usable (${parsed.droppedFrames} presented but not displayed \u2014 retained, ${parsed.discardedFirstFrames} initial present with no interval)`);
  if (parsed.truncatedTrailingRows > 0) console.log('Note: the final CSV line was cut off mid-write and was not read.');

  const { detectWindowsEnvironment, detectExecutableVersion } = await import('./environment');
  // --gpu-name disambiguates a machine with more than one rendering adapter.
  // Without it the probe REFUSES rather than picking one, because a wrong pick
  // records the wrong GPU and the wrong driver version together, silently.
  const hardware = detectWindowsEnvironment(undefined, arg(argv, 'gpu-name'));
  if (hardware.adaptersSeen.length > 1) {
    console.log(`Adapters present: ${hardware.adaptersSeen.join(', ')}`);
  }
  console.log(`Hardware: ${hardware.gpuRaw} / ${hardware.cpuRaw} / driver ${hardware.gpuDriverVersion}`);

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
    process.exitCode = 1;
  });
}
