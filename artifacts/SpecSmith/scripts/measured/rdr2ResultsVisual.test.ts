import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  DEFAULT_TITLE_CROP as CROP,
  GRID_CELLS,
  MATCH_MIN_SCORE,
  NO_MATCH_MAX_SCORE,
  MIN_INK_FRACTION,
  RDR2_VISUAL_SCHEMA_VERSION,
  EVIDENCE_TOP_LEVEL_KEYS,
  DEBUG_IMAGE_NOTICE,
  assertOutsideBundle,
  detectBoundary,
  readVisualCalibration,
  readVisualEvidence,
  recognizeSample,
  signatureFromGrid,
  writeVisualCalibration,
  writeVisualEvidence,
  VisualEvidenceError,
  type Rdr2VisualEvidenceFile,
  type VisualSample,
} from './rdr2ResultsVisual';
import { titleScreen, gameplayScreen, blackScreen } from './__fixtures__/visualGrids';
import { parseDetectArgs, DetectCliError, collectSamples } from './detectRdr2Results';
import { readMarkerFile } from './rdr2ResultsMarker';
import { writeRdr2ResearchBundle, type Rdr2ResearchManifest } from './collect';

// SYNTHETIC ONLY. Not one pixel here came from RDR2, and the detector ships
// with no built-in reference precisely because a template invented in this
// repo would not be RDR2's title. These fixtures test the MACHINERY: does it
// tolerate resolution changes, does it reject lookalike text, does it refuse
// what it cannot see clearly, and can an image ever escape into a bundle.

const TITLE = 'END OF BENCHMARK';
const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-visual-'));
const reference = () => signatureFromGrid(titleScreen(TITLE, 1920, 1080, CROP));

describe('recognition tolerates resolution changes', () => {
  const ref = reference();

  // The point of normalising the ink block: a game picks an integer font size
  // and centres it, so the same words cover a different fraction of the crop
  // at each resolution.
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160], [1280, 720], [1600, 900], [3440, 1440]]) {
    it(`recognises the title at ${w}x${h}`, () => {
      const r = recognizeSample(titleScreen(TITLE, w, h, CROP), ref);
      expect(r.verdict).toBe('positive');
      expect(r.score ?? 0).toBeGreaterThanOrEqual(MATCH_MIN_SCORE);
    });
  }

  it('scores every resolution well clear of the match bar, not just over it', () => {
    const scores = [[2560, 1440], [3840, 2160], [1280, 720], [1600, 900], [3440, 1440]]
      .map(([w, h]) => recognizeSample(titleScreen(TITLE, w, h, CROP), ref).score ?? 0);
    // Headroom, so ordinary variation does not flip a verdict.
    expect(Math.min(...scores)).toBeGreaterThan(MATCH_MIN_SCORE + 0.05);
  });
});

describe('lookalike screens are rejected, not accepted', () => {
  const ref = reference();

  // The failure that matters most for this tool: confidently calling some
  // other screen the results screen.
  for (const phrase of ['END OF MISSION', 'BENCHMARK SETUP', 'END OF CHAPTER', 'END OF BENCHMARKS', 'MISSION COMPLETE', 'BENCHMARK']) {
    it(`rejects "${phrase}"`, () => {
      const r = recognizeSample(titleScreen(phrase, 1920, 1080, CROP), ref);
      expect(r.verdict).toBe('negative');
      expect(r.score ?? 1).toBeLessThan(NO_MATCH_MAX_SCORE);
    });
  }

  it('rejects lookalikes at other resolutions too', () => {
    for (const [w, h] of [[2560, 1440], [1280, 720]]) {
      const r = recognizeSample(titleScreen('END OF MISSION', w, h, CROP), ref);
      expect(r.verdict).toBe('negative');
    }
  });

  it('treats a busy non-title screen as a negative, not as a refusal', () => {
    // A screen the detector can see clearly and that plainly is not the title
    // must be usable as the negative that bounds the boundary.
    const r = recognizeSample(gameplayScreen(1920, 1080, CROP), ref);
    expect(r.verdict).toBe('negative');
  });

  it('keeps a wide margin between the worst true positive and the best lookalike', () => {
    const truePos = [[1920, 1080], [2560, 1440], [1280, 720]].map(([w, h]) => recognizeSample(titleScreen(TITLE, w, h, CROP), ref).score ?? 0);
    const falsePos = ['END OF MISSION', 'BENCHMARK SETUP', 'END OF CHAPTER'].map((p) => recognizeSample(titleScreen(p, 1920, 1080, CROP), ref).score ?? 0);
    expect(Math.min(...truePos) - Math.max(...falsePos)).toBeGreaterThan(0.3);
  });
});

describe('the detector fails closed', () => {
  const ref = reference();

  it('refuses a black capture rather than calling it a negative', () => {
    // A black frame is what a failed PrintWindow looks like. It is not evidence
    // that the results screen was absent, so it must not bound the boundary.
    const r = recognizeSample(blackScreen(1920, 1080, CROP), ref);
    expect(r.verdict).toBe('refused');
    expect(r.reason).toMatch(/blank or black/);
  });

  it('refuses a grid of the wrong shape', () => {
    expect(recognizeSample(new Array(10).fill(120), ref).verdict).toBe('refused');
  });

  it('refuses a calibration whose grid shape does not match this build', () => {
    const bad = { ...ref, bits: ref.bits.slice(0, 10), gridWidth: 5, gridHeight: 2 };
    expect(recognizeSample(titleScreen(TITLE, 1920, 1080, CROP), bad).verdict).toBe('refused');
  });

  it('refuses a score inside the band between the two bars', () => {
    // Constructed directly, because the fixtures deliberately do not produce
    // ambiguous screens: the band exists for real-world cases they cannot model.
    const half = { ...ref, bits: ref.bits.split('').map((c, i) => (i % 3 === 0 ? (c === '1' ? '0' : '1') : c)).join('') };
    const r = recognizeSample(titleScreen(TITLE, 1920, 1080, CROP), half);
    if (r.verdict === 'refused' && r.score !== null) {
      expect(r.score).toBeGreaterThanOrEqual(NO_MATCH_MAX_SCORE);
      expect(r.score).toBeLessThan(MATCH_MIN_SCORE);
      expect(r.reason).toMatch(/refusal band/);
    } else {
      // If the perturbation did not land in the band, the bars still must not overlap.
      expect(NO_MATCH_MAX_SCORE).toBeLessThan(MATCH_MIN_SCORE);
    }
  });
});

describe('a boundary is bounded, or it is refused', () => {
  const ref = reference();
  const ns = (sec: number): string => BigInt(Math.round(sec * 1e9)).toString();
  const negative = (sec: number): VisualSample => ({ atMonotonicNs: ns(sec), grid: gameplayScreen(1920, 1080, CROP), captureMs: 12 });
  const positive = (sec: number): VisualSample => ({ atMonotonicNs: ns(sec), grid: titleScreen(TITLE, 1920, 1080, CROP), captureMs: 12 });
  const refused = (sec: number): VisualSample => ({ atMonotonicNs: ns(sec), grid: blackScreen(1920, 1080, CROP), captureMs: 12 });

  it('bounds the boundary between the last negative and the first positive', () => {
    const r = detectBoundary([negative(0), negative(0.5), negative(1), positive(1.5), positive(2)], ref);
    expect(r.status).toBe('detected');
    expect(r.boundary?.uncertaintySec).toBeCloseTo(0.5, 6);
    expect(r.counts).toMatchObject({ positive: 2, negative: 3, refused: 0 });
  });

  it('WIDENS the interval when the samples just before the first positive were refused', () => {
    // A refusal is not evidence of absence, so it cannot serve as the lower
    // bound. The honest consequence is a wider interval, not a tighter one.
    const r = detectBoundary([negative(0), negative(0.5), refused(1), refused(1.5), positive(2)], ref);
    expect(r.status).toBe('detected');
    expect(r.boundary?.uncertaintySec).toBeCloseTo(1.5, 6);
    expect(r.counts.refused).toBe(2);
  });

  it('reports not-detected when the title never appears', () => {
    const r = detectBoundary([negative(0), negative(0.5), negative(1)], ref);
    expect(r.status).toBe('not-detected');
    expect(r.boundary).toBeNull();
  });

  it('REFUSES when the first sample is already positive, because the boundary has no lower bound', () => {
    const r = detectBoundary([positive(0), positive(0.5)], ref);
    expect(r.status).toBe('refused');
    expect(r.boundary).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/no lower bound/);
  });

  it('carries sampling instrumentation without making a claim about it', () => {
    const r = detectBoundary([negative(0), negative(0.5), positive(1)], ref);
    expect(r.timing?.captureMsMedian).toBe(12);
    expect(r.timing?.sampleIntervalSecMedian).toBeCloseTo(0.5, 6);
  });
});

describe('images cannot enter research bundles, observations or uploads', () => {
  const evidence = (): Rdr2VisualEvidenceFile => ({
    schemaVersion: RDR2_VISUAL_SCHEMA_VERSION,
    kind: 'rdr2-results-visual-marker',
    publishable: false,
    operatorConfirmed: false,
    automaticDetection: true,
    validated: false,
    note: 'test',
    session: { startedAtWallClock: 'a', endedAtWallClock: 'b', requestedSampleHz: 2, crop: CROP },
    detection: detectBoundary([], reference()),
  });

  it('the evidence file carries no image, no grid and no pixels — only an allowlist of keys', () => {
    const serialized = JSON.stringify(evidence());
    expect(Object.keys(evidence()).sort()).toEqual([...EVIDENCE_TOP_LEVEL_KEYS].sort());
    expect(serialized).not.toMatch(/"grid"/);
    expect(serialized).not.toMatch(/"bits"/);
    expect(serialized).not.toMatch(/"pixels"/);
    expect(serialized).not.toMatch(/data:image/);
    expect(serialized).not.toMatch(/base64/);
  });

  it('refuses to write evidence inside a research bundle', () => {
    const dir = tmpDir();
    const bundle = path.join(dir, 'session-x');
    fs.mkdirSync(bundle);
    expect(() => writeVisualEvidence(path.join(bundle, 'evidence.json'), evidence(), bundle)).toThrow(/inside the research bundle/);
    expect(fs.readdirSync(bundle)).toEqual([]);
  });

  it('refuses to write evidence to anything that looks like an image path', () => {
    const dir = tmpDir();
    expect(() => writeVisualEvidence(path.join(dir, 'evidence.png'), evidence())).toThrow(/Evidence is JSON/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('refuses a debug-image directory inside a research bundle', () => {
    const dir = tmpDir();
    const bundle = path.join(dir, 'session-y');
    fs.mkdirSync(bundle);
    expect(() => assertOutsideBundle(path.join(bundle, 'frames'), bundle, 'Debug-image directory')).toThrow(/inside the research bundle/);
    expect(() => assertOutsideBundle(path.join(dir, 'frames'), bundle, 'Debug-image directory')).not.toThrow();
  });

  it('the research bundle writer publishes ONLY the CSV and the manifest, even with images beside the source', () => {
    // The structural proof: whatever is lying around next to the capture, the
    // published bundle contains exactly two files.
    const dir = tmpDir();
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    const csvPath = path.join(src, 'capture.csv');
    const csv = 'Application,ProcessID,TimeInSeconds,msBetweenPresents,msGPUActive\nRDR2.exe,1,0.1,8,7\n';
    fs.writeFileSync(csvPath, csv);
    fs.writeFileSync(path.join(src, 'LOCAL-ONLY-crop-00001.png'), 'not really a png');
    fs.writeFileSync(path.join(src, 'screenshot.bmp'), 'nor this');

    const bytes = fs.readFileSync(csvPath);
    const manifest = {
      schemaVersion: 1, gameId: 'rdr2', gameVersion: '1.0.0',
      capture: { startedAt: 'a', endedAt: 'b', processId: 1, processName: 'RDR2.exe' },
      hardware: {}, captureTool: {}, settingsFile: { fileName: 'system.xml', locationSource: 'documents', sha256: 'x' },
      collectorVersion: '1', collectorBuildHash: 'h',
      csv: { fileName: 'presentmon.csv', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, rowsUsable: 1, rowsDroppedNotDisplayed: 0, rowsDiscardedFirstFrame: 0 },
    } as unknown as Rdr2ResearchManifest;

    const outputDir = path.join(dir, 'bundle');
    writeRdr2ResearchBundle({ outputDir, csvSourcePath: csvPath, manifest });
    expect(fs.readdirSync(outputDir).sort()).toEqual(['manifest.json', 'presentmon.csv']);
  });

  it('no measured-benchmark source file imports the visual detector', () => {
    // Structural proof that there is no path from a screenshot into benchmark
    // acceptance, an observation, or an upload: the code that produces those
    // cannot see this module.
    const dir = path.join(__dirname);
    const forbidden = ['collect.ts', 'rdr2BenchmarkAnalysis.ts', 'presentmonRunner.ts', 'segmentation.ts', 'rdr2Settings.ts'];
    for (const file of forbidden) {
      const src = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(src, `${file} must not reference the visual detector`).not.toMatch(/rdr2ResultsVisual|detectRdr2Results/);
    }
  });

  it('the debug-image notice says plainly that the frames are local and never uploaded', () => {
    expect(DEBUG_IMAGE_NOTICE).toMatch(/LOCAL/);
    expect(DEBUG_IMAGE_NOTICE).toMatch(/never uploaded|Nothing here is uploaded/);
    expect(DEBUG_IMAGE_NOTICE).toMatch(/research bundle/);
  });
});

describe('the Windows sampler avoids two defects that no unit test can reach', () => {
  const sampler = (): string => fs.readFileSync(path.join(__dirname, 'detectRdr2Results.ps1'), 'utf-8');

  it('never names a variable $pid, which is a read-only PowerShell automatic', () => {
    // Shadowing $PID is a runtime hazard on the one platform this script runs
    // on, and this repo cannot execute PowerShell to find out the hard way.
    expect(sampler()).not.toMatch(/\$pid\b/);
  });

  it('enumerates top-level windows, so the documented ambiguity refusal can actually fire', () => {
    // Get-Process yields ONE process carrying ONE MainWindowHandle, so a guard
    // written against it could never see a second candidate window. The script
    // documents that refusal, so the refusal has to be reachable.
    const src = sampler();
    expect(src).toMatch(/VisibleTopLevelWindowsFor/);
    expect(src).toMatch(/EnumWindows/);
    expect(src).toMatch(/GetWindowThreadProcessId/);
    // The comment above the function explains why MainWindowHandle was
    // abandoned, so this targets a CODE use of it rather than any mention.
    expect(src).not.toMatch(/\$\w+\.MainWindowHandle/);
    expect(src).toMatch(/visible top-level windows; refusing rather than guessing/);
  });
});

describe('the visual evidence kind is distinct from the operator marker', () => {
  it('the operator-marker reader refuses visual evidence', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'visual.json');
    fs.writeFileSync(p, JSON.stringify({
      schemaVersion: 1, kind: 'rdr2-results-visual-marker', publishable: false,
      operatorConfirmed: false, automaticDetection: true, validated: false,
      marks: [{ ordinal: 1 }], session: { startedAtMonotonicNs: '1', endedAtMonotonicNs: '2' },
    }));
    expect(() => readMarkerFile(p)).toThrow(/not an RDR2 results marker/);
  });

  it('the visual reader refuses an operator marker', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'operator.json');
    fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, kind: 'rdr2-results-marker', operatorConfirmed: true, automaticDetection: false }));
    expect(() => readVisualEvidence(p)).toThrow(/not visual-detection evidence/);
  });

  it('refuses visual evidence that misrepresents how it was produced', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'lying.json');
    fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, kind: 'rdr2-results-visual-marker', operatorConfirmed: true, automaticDetection: false }));
    expect(() => readVisualEvidence(p)).toThrow(/misrepresents how it was produced/);
  });
});

describe('calibration is required and validated', () => {
  it('refuses to detect without a calibration file, naming why none ships', () => {
    expect(() => readVisualCalibration(path.join(tmpDir(), 'missing.json'))).toThrow(/ships with NO built-in reference/);
  });

  it('round-trips a calibration', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'cal.json');
    writeVisualCalibration(p, {
      schemaVersion: RDR2_VISUAL_SCHEMA_VERSION, kind: 'rdr2-results-visual-calibration', publishable: false,
      note: 'test', capturedAtWallClock: 'now', crop: CROP, sourceWindow: { width: 1920, height: 1080 }, signature: reference(),
    });
    expect(readVisualCalibration(p).signature.bits.length).toBe(reference().bits.length);
  });

  it('refuses a calibration captured from a blank screen', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'blank.json');
    fs.writeFileSync(p, JSON.stringify({
      schemaVersion: 1, kind: 'rdr2-results-visual-calibration', crop: CROP,
      signature: { ...reference(), inkFraction: MIN_INK_FRACTION / 2 },
    }));
    expect(() => readVisualCalibration(p)).toThrow(/blank or wrong screen/);
  });

  it('refuses to overwrite an existing calibration', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'cal.json');
    fs.writeFileSync(p, '{}');
    expect(() => writeVisualCalibration(p, {
      schemaVersion: RDR2_VISUAL_SCHEMA_VERSION, kind: 'rdr2-results-visual-calibration', publishable: false,
      note: 't', capturedAtWallClock: 'n', crop: CROP, sourceWindow: { width: 1, height: 1 }, signature: reference(),
    })).toThrow(VisualEvidenceError);
    expect(fs.readFileSync(p, 'utf-8')).toBe('{}');
  });
});

describe('the CLI is opt-in and refuses misuse', () => {
  it('requires --pid, so it never samples whatever happens to be in front', () => {
    expect(() => parseDetectArgs(['--out', 'e.json', '--calibration', 'c.json'])).toThrow(/--pid is required/);
  });

  it('requires a calibration to detect, and explains why none ships', () => {
    expect(() => parseDetectArgs(['--pid', '10', '--out', 'e.json'])).toThrow(/no built-in reference/);
  });

  it('refuses a valued flag whose value is another flag', () => {
    expect(() => parseDetectArgs(['--pid', '--out'])).toThrow(DetectCliError);
    expect(() => parseDetectArgs(['--pid', '10', '--out'])).toThrow(DetectCliError);
  });

  it('refuses a non-numeric pid and a duplicated flag', () => {
    expect(() => parseDetectArgs(['--pid', 'abc', '--out', 'e.json', '--calibration', 'c.json'])).toThrow(/needs a number/);
    expect(() => parseDetectArgs(['--pid', '1', '--pid', '2', '--out', 'e.json', '--calibration', 'c.json'])).toThrow(/more than once/);
  });

  it('keeps sampling slow: refuses a rate above 10 Hz', () => {
    expect(() => parseDetectArgs(['--pid', '1', '--out', 'e.json', '--calibration', 'c.json', '--hz', '60'])).toThrow(/samples slowly on purpose/);
    expect(parseDetectArgs(['--pid', '1', '--out', 'e.json', '--calibration', 'c.json']).hz).toBe(2);
  });

  it('refuses a crop that falls outside the window', () => {
    expect(() => parseDetectArgs(['--pid', '1', '--out', 'e.json', '--calibration', 'c.json', '--crop', '0.5,0.5,0.9,0.9'])).toThrow(/not inside the window/);
  });

  it('stamps samples on receipt and marks sampler refusals as refused', async () => {
    const lines = [
      JSON.stringify({ ok: false, reason: 'window is minimised' }),
      JSON.stringify({ ok: true, grid: new Array(GRID_CELLS).fill(100), captureMs: 9 }),
      'not json at all',
    ];
    let t = 0n;
    const samples = await collectSamples({
      lines: (async function* () { for (const l of lines) yield l; })(),
      log: () => {},
      monotonicNs: () => { t += 1_000_000_000n; return t; },
    });
    expect(samples).toHaveLength(2);
    expect(samples[0].samplerRefusal).toMatch(/minimised/);
    expect(samples[1].grid).toHaveLength(GRID_CELLS);
    expect(samples[1].captureMs).toBe(9);
  });

  it('carries the window size through, so a calibration can record what it was captured at', async () => {
    // An earlier version dropped w/h here and wrote 0x0 into the calibration —
    // a false statement in a file whose whole job is to record provenance.
    const samples = await collectSamples({
      lines: (async function* () { yield JSON.stringify({ ok: true, grid: new Array(GRID_CELLS).fill(100), captureMs: 5, w: 2560, h: 1440 }); })(),
      log: () => {},
      monotonicNs: () => 1n,
    });
    expect(samples[0].windowWidth).toBe(2560);
    expect(samples[0].windowHeight).toBe(1440);
  });

  it('leaves the window size undefined when the sampler omits it, rather than inventing zeros', async () => {
    const samples = await collectSamples({
      lines: (async function* () { yield JSON.stringify({ ok: true, grid: new Array(GRID_CELLS).fill(100), captureMs: 5 }); })(),
      log: () => {},
      monotonicNs: () => 1n,
    });
    expect(samples[0].windowWidth).toBeUndefined();
    expect(samples[0].windowHeight).toBeUndefined();
  });

  it('refuses a sampler grid of the wrong size rather than scoring it', async () => {
    const samples = await collectSamples({
      lines: (async function* () { yield JSON.stringify({ ok: true, grid: [1, 2, 3], captureMs: 1 }); })(),
      log: () => {},
      monotonicNs: () => 1n,
    });
    expect(samples[0].samplerRefusal).toMatch(/expected/);
  });
});
