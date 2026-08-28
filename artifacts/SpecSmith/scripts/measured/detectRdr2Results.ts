// CLI for the RDR2 results-screen visual detector. RESEARCH ONLY, OPT-IN ONLY.
//
//   npx tsx scripts/measured/detectRdr2Results.ts --calibrate --pid <pid> --out <calibration.json>
//   npx tsx scripts/measured/detectRdr2Results.ts --pid <pid> --calibration <calibration.json> --out <evidence.json>
//
// Nothing here runs unless it is asked for by name. There is no default mode,
// no ambient sampling, and no code path from this file into benchmark
// acceptance, production observations, uploads or collect.ts.
//
// It samples the RDR2 WINDOW at roughly 2 Hz through detectRdr2Results.ps1,
// which reduces each frame to a grid of numbers inside its own process. No
// frame reaches this file. The evidence written at --out is timestamps, scores
// and counts; --debug-images is the only way an image is ever written, must be
// asked for explicitly, and is refused if it points inside a research bundle.
//
// EXIT CODES
// ----------
//   0  calibrated, or the boundary was detected
//   2  the run completed but did not resolve (nothing recognised, or refused)
//   1  the CLI was misused, or something failed
//
// 2 is distinct from 1 for the same reason it is in the analyzer: "this run
// does not resolve" is a real answer, not a malfunction.

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TITLE_CROP,
  GRID_WIDTH,
  GRID_HEIGHT,
  GRID_CELLS,
  RDR2_VISUAL_SCHEMA_VERSION,
  MATCH_MIN_SCORE,
  NO_MATCH_MAX_SCORE,
  assertOutsideBundle,
  cropIsValid,
  cropsEqual,
  detectBoundary,
  readVisualCalibration,
  signatureFromGrid,
  writeVisualCalibration,
  writeVisualEvidence,
  VisualEvidenceError,
  type NormalizedCrop,
  type VisualSample,
  type Rdr2VisualEvidenceFile,
} from './rdr2ResultsVisual';

export class DetectCliError extends Error {}

export interface DetectCliArgs {
  mode: 'calibrate' | 'detect';
  pid: number;
  outPath: string;
  calibrationPath?: string;
  bundleDir?: string;
  debugImagesDir?: string;
  crop: NormalizedCrop;
  hz: number;
}

const NUMERIC_FLAGS = new Set(['--pid', '--hz']);
const VALUED_FLAGS = new Set(['--pid', '--out', '--calibration', '--bundle', '--debug-images', '--crop', '--hz']);

/** Same valued-flag rule the collector learned the hard way: a flag's value may not itself look like a flag. */
export function parseDetectArgs(argv: readonly string[]): DetectCliArgs {
  let calibrate = false;
  const seen = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--calibrate') {
      calibrate = true;
      continue;
    }
    if (VALUED_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new DetectCliError(`${a} needs a value (got ${v === undefined ? 'end of arguments' : JSON.stringify(v)}).`);
      }
      if (seen.has(a)) throw new DetectCliError(`${a} was given more than once.`);
      if (NUMERIC_FLAGS.has(a) && !Number.isFinite(Number(v))) throw new DetectCliError(`${a} needs a number (got ${JSON.stringify(v)}).`);
      seen.set(a, v);
      i += 1;
      continue;
    }
    throw new DetectCliError(`Unexpected argument ${JSON.stringify(a)}.`);
  }

  const pidRaw = seen.get('--pid');
  if (pidRaw === undefined) throw new DetectCliError('--pid is required: this samples one exact process, never whatever happens to be in front.');
  const pid = Number(pidRaw);
  if (!Number.isInteger(pid) || pid <= 0) throw new DetectCliError(`--pid must be a positive integer (got ${JSON.stringify(pidRaw)}).`);

  const outPath = seen.get('--out');
  if (outPath === undefined) throw new DetectCliError('--out is required.');

  const calibrationPath = seen.get('--calibration');
  if (!calibrate && calibrationPath === undefined) {
    throw new DetectCliError(
      'Detection needs --calibration. There is no built-in reference: a template invented in this repo would not be RDR2\'s title. Run --calibrate once with the results screen on display.',
    );
  }

  let crop = DEFAULT_TITLE_CROP;
  const cropRaw = seen.get('--crop');
  if (cropRaw !== undefined) {
    const parts = cropRaw.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new DetectCliError(`--crop needs four numbers "x,y,w,h" as fractions of the window (got ${JSON.stringify(cropRaw)}).`);
    }
    crop = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    if (!cropIsValid(crop)) throw new DetectCliError(`--crop ${JSON.stringify(cropRaw)} is not inside the window.`);
  }

  const hz = seen.has('--hz') ? Number(seen.get('--hz')) : 2;
  if (!(hz > 0 && hz <= 10)) throw new DetectCliError(`--hz must be in (0, 10]; this samples slowly on purpose (got ${hz}).`);

  return {
    mode: calibrate ? 'calibrate' : 'detect',
    pid,
    outPath,
    calibrationPath,
    bundleDir: seen.get('--bundle'),
    debugImagesDir: seen.get('--debug-images'),
    crop,
    hz,
  };
}

interface RawSample {
  ok: boolean;
  grid?: number[];
  w?: number;
  h?: number;
  captureMs?: number;
  reason?: string;
}

export interface SamplerIo {
  /** One NDJSON line per sample. */
  lines: AsyncIterable<string>;
  log: (line: string) => void;
  monotonicNs?: () => bigint;
}

/**
 * Turns the sampler's NDJSON into stamped samples.
 *
 * The monotonic stamp is taken HERE, on receipt, not in the sampler: the two
 * processes have no shared clock, and inventing an alignment between them
 * would be exactly the kind of unbacked precision this project keeps refusing.
 * The sampler's own `captureMs` is carried through so the lag between capture
 * and stamp is visible rather than assumed away — at 2 Hz the boundary
 * interval is ~500ms wide, orders of magnitude above that lag.
 */
export async function collectSamples(io: SamplerIo, maxSamples?: number): Promise<VisualSample[]> {
  const now = io.monotonicNs ?? (() => process.hrtime.bigint());
  const out: VisualSample[] = [];
  for await (const line of io.lines) {
    const text = line.trim();
    if (text.length === 0) continue;
    let raw: RawSample;
    try {
      raw = JSON.parse(text) as RawSample;
    } catch {
      io.log(`  ignoring unparseable sampler line: ${text.slice(0, 120)}`);
      continue;
    }
    const atMonotonicNs = now().toString();
    if (!raw.ok) {
      out.push({ atMonotonicNs, grid: [], captureMs: Number.NaN, samplerRefusal: raw.reason ?? 'sampler refused without a reason' });
      io.log(`  refused: ${raw.reason ?? 'no reason given'}`);
    } else if (!Array.isArray(raw.grid) || raw.grid.length !== GRID_CELLS) {
      out.push({ atMonotonicNs, grid: [], captureMs: Number.NaN, samplerRefusal: `sampler returned ${raw.grid?.length ?? 0} cells, expected ${GRID_CELLS}` });
    } else {
      out.push({
        atMonotonicNs,
        grid: raw.grid,
        captureMs: Number(raw.captureMs ?? Number.NaN),
        windowWidth: Number.isFinite(raw.w) ? raw.w : undefined,
        windowHeight: Number.isFinite(raw.h) ? raw.h : undefined,
      });
    }
    if (maxSamples !== undefined && out.length >= maxSamples) break;
  }
  return out;
}

function spawnSampler(args: DetectCliArgs, maxSamples: number): { lines: AsyncIterable<string>; stop: () => void } {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'detectRdr2Results.ps1');
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-ProcessId', String(args.pid),
      '-CropX', String(args.crop.x), '-CropY', String(args.crop.y), '-CropW', String(args.crop.w), '-CropH', String(args.crop.h),
      '-GridWidth', String(GRID_WIDTH), '-GridHeight', String(GRID_HEIGHT),
      '-Hz', String(args.hz),
      '-MaxSamples', String(maxSamples),
      ...(args.debugImagesDir ? ['-DebugDir', args.debugImagesDir] : []),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  return { lines: rl, stop: () => { rl.close(); child.kill(); } };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseDetectArgs(argv);

  // Both outputs are refused inside a research bundle: a bundle is evidence and
  // never carries derived files, and an image inside one would be published by
  // the bundle writer's atomic rename along with it.
  assertOutsideBundle(args.outPath, args.bundleDir, 'Output file');
  if (args.debugImagesDir) {
    assertOutsideBundle(args.debugImagesDir, args.bundleDir, 'Debug-image directory');
    console.log(
      'PRIVACY: --debug-images will write cropped frames of your game window to disk.\n' +
        `They are local only, are never uploaded, and never enter a research bundle.\n` +
        `A PRIVACY-README.txt is written beside them. Delete ${args.debugImagesDir} when you are done.\n`,
    );
  }

  if (args.mode === 'calibrate') {
    console.log('Calibrating. Put RDR2\'s results screen on display, then leave it there.');
    const sampler = spawnSampler(args, 1);
    const samples = await collectSamples({ lines: sampler.lines, log: (l) => console.log(l) }, 1);
    sampler.stop();
    const usable = samples.find((s) => !s.samplerRefusal);
    if (!usable) {
      console.error(`Could not capture a usable frame: ${samples[0]?.samplerRefusal ?? 'no samples at all'}`);
      return 1;
    }
    if (usable.windowWidth === undefined || usable.windowHeight === undefined) {
      console.error('The sampler did not report the window size, so a calibration could not record what it was captured at. Refusing to write one that misstates its own provenance.');
      return 1;
    }
    const signature = signatureFromGrid(usable.grid);
    writeVisualCalibration(args.outPath, {
      schemaVersion: RDR2_VISUAL_SCHEMA_VERSION,
      kind: 'rdr2-results-visual-calibration',
      publishable: false,
      note: 'Reference signature for RDR2\'s results-screen title, captured on this machine at this resolution and language. Research only.',
      capturedAtWallClock: new Date().toISOString(),
      crop: args.crop,
      // What it was actually captured at. Writing a placeholder here would put a
      // false statement into a file whose whole job is to record provenance.
      sourceWindow: { width: usable.windowWidth, height: usable.windowHeight },
      signature,
    }, args.bundleDir);
    console.log(`\nWrote calibration to ${args.outPath} (ink fraction ${signature.inkFraction.toFixed(4)}, captured at ${usable.windowWidth}x${usable.windowHeight}).`);
    console.log('Check that number looks like a line of text and not a blank screen before relying on it.');
    return 0;
  }

  const calibration = readVisualCalibration(args.calibrationPath as string);
  if (!cropsEqual(calibration.crop, args.crop)) {
    throw new DetectCliError(
      `The calibration was taken from crop ${JSON.stringify(calibration.crop)} but this run uses ${JSON.stringify(args.crop)}. ` +
        'Comparing across different crops would compare different parts of the screen; re-calibrate or pass the matching --crop.',
    );
  }

  const startedAt = new Date().toISOString();
  console.log(`Sampling pid ${args.pid} at ${args.hz} Hz. Press Ctrl+C when the run is over.`);
  const sampler = spawnSampler(args, 0);
  const samples = await collectSamples({ lines: sampler.lines, log: (l) => console.log(l) });
  sampler.stop();

  const detection = detectBoundary(samples, calibration.signature);
  const evidence: Rdr2VisualEvidenceFile = {
    schemaVersion: RDR2_VISUAL_SCHEMA_VERSION,
    kind: 'rdr2-results-visual-marker',
    publishable: false,
    operatorConfirmed: false,
    automaticDetection: true,
    validated: false,
    note:
      'UNVALIDATED RESEARCH. Machine detection of RDR2\'s results-screen title, never confirmed against ground truth on a real capture. ' +
      'Not a benchmark measurement, not an input to segmentation acceptance, and not interchangeable with an operator-confirmed marker.',
    session: { startedAtWallClock: startedAt, endedAtWallClock: new Date().toISOString(), requestedSampleHz: args.hz, crop: args.crop },
    detection,
  };
  writeVisualEvidence(args.outPath, evidence, args.bundleDir);

  console.log(`\nstatus ${detection.status}`);
  console.log(`samples ${detection.counts.total} (positive ${detection.counts.positive}, negative ${detection.counts.negative}, refused ${detection.counts.refused})`);
  console.log(`bars    match >= ${MATCH_MIN_SCORE}, no-match < ${NO_MATCH_MAX_SCORE}, anything between is refused`);
  if (detection.timing) {
    console.log(
      `timing  capture ${detection.timing.captureMsMin.toFixed(1)}/${detection.timing.captureMsMedian.toFixed(1)}/${detection.timing.captureMsMax.toFixed(1)} ms min/median/max, ` +
        `interval median ${detection.timing.sampleIntervalSecMedian.toFixed(3)}s`,
    );
    console.log('        INSTRUMENTATION ONLY — no claim is made about overhead until this has been measured on the real machine during a real capture.');
  }
  if (detection.boundary) {
    console.log(`boundary bounded across ${detection.boundary.uncertaintySec.toFixed(3)}s between the last confident negative and the first confident positive`);
  }
  for (const r of detection.reasons) console.log(`  - ${r}`);
  console.log(`\nWrote ${args.outPath}. It contains timestamps, scores and counts — no image and no grid.`);
  return detection.status === 'detected' ? 0 : 2;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(e instanceof DetectCliError || e instanceof VisualEvidenceError ? e.message : e);
      process.exitCode = 1;
    });
}
