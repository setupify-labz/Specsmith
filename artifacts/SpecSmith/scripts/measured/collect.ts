// V1 measured-observation collector.
//
//   npx tsx scripts/measured/collect.ts --csv <presentmon.csv> --game-id <id> \
//     --gpu-id <id> --cpu-id <id> --resolution 1440p --preset high \
//     --ram-channels 2 --settings-file <path> [--process <name>] [--dry-run]
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
import { errors, validateMeasuredObservation, warnings, type MeasuredIssue } from '../../src/lib/measured/validate';
import {
  MEASURED_SCHEMA_VERSION,
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

export const COLLECTOR_VERSION = '0.1.0';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

/** Ties an observation to the exact measurement code that produced it. */
export function collectorBuildHash(files: readonly string[] = ['collect.ts', 'presentmon.ts', 'environment.ts']): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) h.update(fs.readFileSync(path.join(here, f)));
  return h.digest('hex').slice(0, 16);
}

export interface CollectInputs {
  gameId: string; gpuId: string; cpuId: string;
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
      // 'manual' is the honest label: the operator supplied the catalog ids and
      // the collector recorded what the machine reported beside them. No fuzzy
      // matcher is used, because a wrong automatic match (a laptop part sharing
      // a desktop part's name) would be invisible afterwards.
      gpuMatchMethod: 'manual',
      cpuMatchMethod: 'manual',
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
): SaveOutcome {
  const issues = validateMeasuredObservation(observation, frameTimesMs, featureProfiles);
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

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const required = (argv: string[], name: string): string => {
  const v = arg(argv, name);
  if (v === undefined) throw new Error(`Missing required --${name}`);
  return v;
};

async function main(argv: string[]): Promise<void> {
  const csvPath = required(argv, 'csv');
  const dryRun = argv.includes('--dry-run');

  const parsed = parsePresentMonCsv(fs.readFileSync(csvPath, 'utf-8'), arg(argv, 'process'));
  console.log(`Frames: ${parsed.frameTimesMs.length} usable (${parsed.droppedFrames} dropped, ${parsed.discardedFirstFrames} discarded)`);

  const { detectWindowsEnvironment, detectExecutableVersion } = await import('./environment');
  // --gpu-name disambiguates a machine with more than one rendering adapter.
  // Without it the probe REFUSES rather than picking one, because a wrong pick
  // records the wrong GPU and the wrong driver version together, silently.
  const hardware = detectWindowsEnvironment(undefined, arg(argv, 'gpu-name'));
  if (hardware.adaptersSeen.length > 1) {
    console.log(`Adapters present: ${hardware.adaptersSeen.join(', ')}`);
  }
  console.log(`Hardware: ${hardware.gpuRaw} / ${hardware.cpuRaw} / driver ${hardware.gpuDriverVersion}`);

  const exePath = arg(argv, 'game-exe');
  const inputs: CollectInputs = {
    gameId: required(argv, 'game-id'),
    gpuId: required(argv, 'gpu-id'),
    cpuId: required(argv, 'cpu-id'),
    resolution: required(argv, 'resolution') as Resolution,
    // 'unmapped' is legitimate for games with no comparable tier (Roblox's
    // Manual 1-10). Validation then requires --preset-label.
    preset: required(argv, 'preset') as MeasuredPreset,
    presetLabel: arg(argv, 'preset-label'),
    upscaler: (arg(argv, 'upscaler') ?? 'native') as Upscaler,
    upscalerMode: arg(argv, 'upscaler-mode'),
    rayTracing: argv.includes('--ray-tracing'),
    frameGeneration: argv.includes('--frame-generation'),
    frameGenerationFactor: arg(argv, 'frame-generation-factor') ? Number(arg(argv, 'frame-generation-factor')) : undefined,
    renderScalePercent: Number(arg(argv, 'render-scale') ?? '100'),
    ramChannels: Number(required(argv, 'ram-channels')),
    gpuOverclocked: argv.includes('--gpu-overclocked'),
    settingsText: fs.readFileSync(required(argv, 'settings-file'), 'utf-8'),
    gameVersion: arg(argv, 'game-version') ?? (exePath ? detectExecutableVersion(exePath) : undefined),
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

  const issues = validateMeasuredObservation(observation, parsed.frameTimesMs, profiles);
  for (const w of warnings(issues)) console.warn(`  WARNING ${w.rule}: ${w.message}`);
  for (const e of errors(issues)) console.error(`  ERROR   ${e.rule}: ${e.message}`);

  // The blob goes down BEFORE the record, so a saved observation never points
  // at frames that are not there. The reverse ordering can leave a record
  // referencing nothing; this ordering can at worst leave an orphan blob,
  // which is content-addressed and harmless.
  let outcome: SaveOutcome = { saved: false, issues, observation };
  if (shouldPersistFrameTimes(dryRun, issues)) {
    await writeFrameTimes(parsed.frameTimesMs);
    outcome = validateAndSave(observation, parsed.frameTimesMs, storePath, profiles);
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
