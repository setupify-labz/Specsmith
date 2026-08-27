import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  runMarkerSession,
  writeMarkerFile,
  readMarkerFile,
  alignMarksToCapture,
  compareRankedCandidatesToMarker,
  MarkerError,
  RDR2_RESULTS_MARKER_SCHEMA_VERSION,
  type Rdr2ResultsMarkerFile,
  type MarkerClock,
} from './rdr2ResultsMarker';
import { parseMarkerArgs, MarkerCliError } from './markRdr2Results';
import { parseAnalyzeArgs } from './analyzeRdr2Research';
import { analyzeFrames, type Rdr2AnalysisSource, type Rdr2AnalysisResult } from './rdr2BenchmarkAnalysis';
import type { PresentMonFrame } from './presentmon';

// SYNTHETIC ONLY. No timestamp from any real run appears here: the fixtures
// below choose their own scale so a test that passes proves the alignment
// arithmetic, not that it memorised a capture.

/** A clock the test drives by hand, so nothing waits and nothing is flaky. */
function fakeClock(startWallMs: number, startMonoNs: bigint): MarkerClock & { advance: (sec: number) => void; stepWallClock: (sec: number) => void } {
  let mono = startMonoNs;
  let wall = startWallMs;
  return {
    monotonicNs: () => mono,
    wallClock: () => new Date(wall),
    advance: (sec) => { mono += BigInt(Math.round(sec * 1e9)); wall += sec * 1000; },
    // A wall-clock step (an NTP correction) that the monotonic clock does not see.
    stepWallClock: (sec) => { wall += sec * 1000; },
  };
}

/** Feeds the session lines, advancing the clock between them. */
async function* scriptedLines(clock: { advance: (s: number) => void }, script: ReadonlyArray<{ waitSec: number; line: string }>): AsyncGenerator<string> {
  for (const step of script) {
    clock.advance(step.waitSec);
    yield step.line;
  }
}

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-marker-'));

async function sessionWith(script: ReadonlyArray<{ waitSec: number; line: string }>, tailSec = 1): Promise<Rdr2ResultsMarkerFile> {
  const clock = fakeClock(Date.parse('2026-01-02T03:04:05.000Z'), 1_000_000_000n);
  const file = await runMarkerSession({ lines: scriptedLines(clock, script), log: () => {}, clock });
  // runMarkerSession stamps the end as soon as the input ends; advancing after
  // the fact would not be observed, so the tail is baked into the script.
  void tailSec;
  return file;
}

describe('the marker records what an operator confirmed, and says so', () => {
  it('records one mark per input line, on both a monotonic and a wall clock', async () => {
    const file = await sessionWith([
      { waitSec: 30, line: '' },
      { waitSec: 5, line: 'still on screen' },
      { waitSec: 2, line: 'q' },
    ]);
    expect(file.marks).toHaveLength(2);
    expect(file.marks[0].sinceSessionStartSec).toBeCloseTo(30, 6);
    expect(file.marks[1].sinceSessionStartSec).toBeCloseTo(35, 6);
    expect(file.marks[0].label).toBe('results screen visible');
    expect(file.marks[1].label).toBe('still on screen');
    // Both time bases are present on every mark.
    for (const m of file.marks) {
      expect(BigInt(m.atMonotonicNs)).toBeGreaterThan(0n);
      expect(Number.isFinite(Date.parse(m.atWallClock))).toBe(true);
    }
  });

  it('stamps itself operator-confirmed, non-automatic and unpublishable', async () => {
    const file = await sessionWith([{ waitSec: 10, line: '' }, { waitSec: 1, line: 'q' }]);
    expect(file.kind).toBe('rdr2-results-marker');
    expect(file.publishable).toBe(false);
    expect(file.operatorConfirmed).toBe(true);
    expect(file.automaticDetection).toBe(false);
    expect(file.note).toMatch(/never an input to it/);
  });

  it('measures how far the wall clock drifted against the monotonic one', async () => {
    const clock = fakeClock(Date.parse('2026-01-02T03:04:05.000Z'), 5_000_000_000n);
    async function* lines(): AsyncGenerator<string> {
      clock.advance(20);
      yield '';
      clock.stepWallClock(-7); // an NTP correction mid-capture
      clock.advance(10);
      yield 'q';
    }
    const file = await runMarkerSession({ lines: lines(), log: () => {}, clock });
    expect(file.session.wallClockDriftSec).toBeCloseTo(-7, 6);
  });

  it('ends the session on q, quit, done or exit without recording them as marks', async () => {
    for (const word of ['q', 'quit', 'DONE', 'exit']) {
      const file = await sessionWith([{ waitSec: 3, line: '' }, { waitSec: 1, line: word }]);
      expect(file.marks).toHaveLength(1);
    }
  });
});

describe('the marker file is written and read safely', () => {
  it('writes to a fresh path and reads back what it wrote', async () => {
    const dir = tmpDir();
    const file = await sessionWith([{ waitSec: 12, line: '' }, { waitSec: 1, line: 'q' }]);
    const out = path.join(dir, 'marker.json');
    writeMarkerFile(out, file);
    const back = readMarkerFile(out);
    expect(back.marks).toHaveLength(1);
    expect(back.schemaVersion).toBe(RDR2_RESULTS_MARKER_SCHEMA_VERSION);
  });

  it('refuses to overwrite an existing path', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'marker.json');
    fs.writeFileSync(out, '{}');
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    expect(() => writeMarkerFile(out, file)).toThrow(MarkerError);
    expect(fs.readFileSync(out, 'utf-8')).toBe('{}');
  });

  it('refuses to write inside the capture bundle it accompanies', async () => {
    const dir = tmpDir();
    const bundle = path.join(dir, 'session-x');
    fs.mkdirSync(bundle);
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    expect(() => writeMarkerFile(path.join(bundle, 'marker.json'), file, bundle)).toThrow(/is inside the capture bundle/);
    expect(fs.readdirSync(bundle)).toEqual([]);
  });

  it('refuses a directory it was not pointed at, and leaves no staging residue', async () => {
    const dir = tmpDir();
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    expect(() => writeMarkerFile(path.join(dir, 'nope', 'marker.json'), file)).toThrow(MarkerError);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('refuses a file that does not declare itself operator-confirmed', async () => {
    const dir = tmpDir();
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    const out = path.join(dir, 'marker.json');
    fs.writeFileSync(out, JSON.stringify({ ...file, operatorConfirmed: false }));
    expect(() => readMarkerFile(out)).toThrow(/a human, not an algorithm/);
  });

  it('refuses a file claiming to be an automatic detection', async () => {
    const dir = tmpDir();
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    const out = path.join(dir, 'marker.json');
    fs.writeFileSync(out, JSON.stringify({ ...file, automaticDetection: true }));
    expect(() => readMarkerFile(out)).toThrow(/a human, not an algorithm/);
  });

  it('refuses a wrong kind, a wrong schema version and an empty mark list', async () => {
    const dir = tmpDir();
    const file = await sessionWith([{ waitSec: 1, line: '' }, { waitSec: 1, line: 'q' }]);
    const write = (name: string, body: unknown): string => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, JSON.stringify(body));
      return p;
    };
    expect(() => readMarkerFile(write('a.json', { ...file, kind: 'something-else' }))).toThrow(/not an RDR2 results marker/);
    expect(() => readMarkerFile(write('b.json', { ...file, schemaVersion: 99 }))).toThrow(/schemaVersion/);
    expect(() => readMarkerFile(write('c.json', { ...file, marks: [] }))).toThrow(/holds no marks/);
    expect(() => readMarkerFile(path.join(dir, 'missing.json'))).toThrow(/No marker file/);
  });
});

describe('alignment onto the capture timeline reports an interval, not a point', () => {
  const capture = { startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:00.000Z', durationSec: 120 };

  it('places a mark by wall clock and by monotonic elapsed, and reports the disagreement', async () => {
    // Marker session starts 5s after the capture and ends 3s after it. So the
    // wall-clock anchor sees 5 + 40 = 45s, and the monotonic anchor sees
    // 120 - (session end - mark) = 120 - (50 - 40) = 110... unless the session
    // is stopped promptly, which is what the operator instructions require.
    const clock = fakeClock(Date.parse('2026-01-02T03:04:05.000Z'), 9_000_000_000n);
    async function* lines(): AsyncGenerator<string> {
      clock.advance(40);
      yield '';
      clock.advance(78); // stop the marker 3s after the capture ended
      yield 'q';
    }
    const file = await runMarkerSession({ lines: lines(), log: () => {}, clock });
    const [a] = alignMarksToCapture(file, capture);
    expect(a.offsetSecByAnchor.wallClock).toBeCloseTo(45, 6);
    expect(a.offsetSecByAnchor.monotonicFromCaptureEnd).toBeCloseTo(120 - 78, 6);
    expect(a.earliestOffsetSec).toBeCloseTo(42, 6);
    expect(a.latestOffsetSec).toBeCloseTo(45, 6);
    expect(a.anchorSpreadSec).toBeCloseTo(3, 6);
    expect(a.withinCapture).toBe(true);
  });

  it('keeps the monotonic anchor steady when the wall clock is stepped mid-capture', async () => {
    const clock = fakeClock(Date.parse('2026-01-02T03:04:05.000Z'), 9_000_000_000n);
    async function* lines(): AsyncGenerator<string> {
      clock.advance(40);
      clock.stepWallClock(30); // the wall clock jumps forward; the counter does not
      yield '';
      clock.advance(78);
      yield 'q';
    }
    const file = await runMarkerSession({ lines: lines(), log: () => {}, clock });
    const [a] = alignMarksToCapture(file, capture);
    // The wall-clock anchor is wrong by exactly the step; the monotonic one is not.
    expect(a.offsetSecByAnchor.wallClock).toBeCloseTo(75, 6);
    expect(a.offsetSecByAnchor.monotonicFromCaptureEnd).toBeCloseTo(42, 6);
    // And the disagreement between them makes the problem visible rather than hiding it.
    expect(a.anchorSpreadSec).toBeCloseTo(33, 6);
  });
});

// ---------------------------------------------------------------------------
// Comparison against a real analysis
// ---------------------------------------------------------------------------

const HARDWARE_FLIP = 'Hardware: Legacy Flip';
interface BlockSpec { seconds: number; fps: number; gpuRatio: number; drift?: number; ramp?: number }
function buildFrames(specs: readonly BlockSpec[]): PresentMonFrame[] {
  const frames: PresentMonFrame[] = [];
  let t = 0;
  let line = 2;
  for (const spec of specs) {
    const nominalMs = 1000 / spec.fps;
    const count = Math.round(spec.seconds * spec.fps);
    for (let i = 0; i < count; i += 1) {
      const level = 1
        + ((spec.drift ?? 0) / 2) * Math.sin((2 * Math.PI * 3 * i) / Math.max(1, count))
        + (spec.ramp ?? 0) * (i / Math.max(1, count - 1));
      const frameTimeMs = nominalMs * level * (1 + ((i % 5) - 2) * 0.01);
      t += frameTimeMs / 1000;
      frames.push({ frameTimeMs, presentMode: HARDWARE_FLIP, timeInSeconds: t, msGpuActive: frameTimeMs * spec.gpuRatio, csvLine: line });
      line += 1;
    }
  }
  return frames;
}
const SCENE = (seconds = 20): BlockSpec => ({ seconds, fps: 80, gpuRatio: 0.98, drift: 0.25 });
const MENU: BlockSpec = { seconds: 10, fps: 250, gpuRatio: 0.15 };
const TRANSITION: BlockSpec = { seconds: 3, fps: 250, gpuRatio: 0.15 };

const analysisSource = (over: Partial<Rdr2AnalysisSource> = {}): Rdr2AnalysisSource => ({
  bundleDir: '/synthetic',
  csvFileName: 'presentmon.csv',
  csvSha256: 'f'.repeat(64),
  csvByteLength: 1,
  processId: 4242,
  processName: 'RDR2.exe',
  captureStartedAt: '2026-01-02T03:04:00.000Z',
  captureEndedAt: '2026-01-02T03:06:30.000Z',
  gameVersion: '1.0.0',
  collectorBuildHash: 'synthetic',
  ...over,
});

/** A capture that ends mid-scene-5, so the analysis is unresolved but still ranks candidates. */
const truncatedRun = (): PresentMonFrame[] =>
  buildFrames([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(35)]);

/** Builds a marker whose single mark lands at `offsetSec` on the capture timeline, under both anchors. */
async function markerAt(offsetSec: number, captureDurationSec: number): Promise<Rdr2ResultsMarkerFile> {
  const clock = fakeClock(Date.parse('2026-01-02T03:04:00.000Z'), 3_000_000_000n);
  async function* lines(): AsyncGenerator<string> {
    clock.advance(offsetSec);
    yield '';
    clock.advance(captureDurationSec - offsetSec);
    yield 'q';
  }
  return runMarkerSession({ lines: lines(), log: () => {}, clock });
}

describe('the marker measures the ranking without touching it', () => {
  const frames = truncatedRun();
  const analysed = (opts?: { diagnoseTail?: boolean }): Rdr2AnalysisResult => analyzeFrames(frames, analysisSource(), opts);

  it('refuses to compare when the analysis carries no ranked candidates', async () => {
    const result = analysed();
    const duration = result.status === 'candidate' ? result.diagnostics.captureDurationSec : (result.diagnostics?.captureDurationSec ?? 0);
    const marker = await markerAt(120, duration);
    const cmp = compareRankedCandidatesToMarker(result, marker, {
      startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:30.000Z', durationSec: duration,
    });
    expect(cmp.status).toBe('refused');
    if (cmp.status !== 'refused') throw new Error('unreachable');
    expect(cmp.reasons.join(' ')).toMatch(/--diagnose-tail/);
  });

  it('reports where the marker falls among the ranked candidates', async () => {
    const result = analysed({ diagnoseTail: true });
    const tail = result.tailDiagnostics;
    if (!tail) throw new Error('unreachable');
    const duration = result.status === 'candidate' ? result.diagnostics.captureDurationSec : (result.diagnostics?.captureDurationSec ?? 0);

    // Put the mark on a candidate in the MIDDLE of the tail, so candidates
    // fall on both sides of it and the sign of each distance is exercised.
    const byTime = [...tail.candidates].sort((a, b) => a.startOffsetSec - b.startOffsetSec);
    const target = byTime[Math.floor(byTime.length / 2)].startOffsetSec;
    const marker = await markerAt(target, duration);
    const cmp = compareRankedCandidatesToMarker(result, marker, {
      startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:30.000Z', durationSec: duration,
    });
    expect(cmp.status).toBe('compared');
    if (cmp.status !== 'compared') throw new Error('unreachable');
    expect(cmp.candidates).toHaveLength(tail.candidates.length);
    // A candidate lands on the mark to within the nanosecond the clock is
    // recorded at, and it is the nearest one.
    expect(cmp.nearestDistanceSec).toBeCloseTo(0, 6);
    expect(cmp.candidates[cmp.nearestRank - 1].offsetSec).toBeCloseTo(target, 6);
    // Ranking order is the ANALYZER's, untouched: rank 1 is still rank 1.
    expect(cmp.candidates[0].offsetSec).toBeCloseTo(tail.candidates[0].startOffsetSec, 9);
    // Distances are signed, so a reader can see which side of the marker a
    // candidate sits on rather than only how far away it is.
    expect(cmp.candidates.some((c) => c.distanceToMarkerSec < 0)).toBe(true);
    expect(cmp.candidates.some((c) => c.distanceToMarkerSec > 0)).toBe(true);
  });

  it('leaves an unresolved analysis unresolved, and offers no accepted boundary', async () => {
    const result = analysed({ diagnoseTail: true });
    expect(result.status).toBe('unresolved');
    const duration = result.status === 'candidate' ? result.diagnostics.captureDurationSec : (result.diagnostics?.captureDurationSec ?? 0);
    const marker = await markerAt(duration - 20, duration);
    const cmp = compareRankedCandidatesToMarker(result, marker, {
      startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:30.000Z', durationSec: duration,
    });
    if (cmp.status !== 'compared') throw new Error('unreachable');
    expect(cmp.analysisStatus).toBe('unresolved');
    expect(cmp.acceptedOffsetSec).toBeNull();
    expect(cmp.acceptedDistanceSec).toBeNull();
    expect(cmp.acceptanceThresholdsUnchanged).toBe(true);
    // No candidate became acceptable because a human pointed at it.
    expect(cmp.candidates.every((c) => c.qualifies === false)).toBe(true);
    expect(cmp.notes.join(' ')).toMatch(/does NOT show that the final boundary can be detected from PresentMon data alone/);
  });

  it('produces the SAME analysis whether or not a marker exists', async () => {
    // The load-bearing isolation claim, stated as an executable check: the
    // marker is read after the fact and cannot reach the decision.
    const before = analysed({ diagnoseTail: true });
    const duration = before.status === 'candidate' ? before.diagnostics.captureDurationSec : (before.diagnostics?.captureDurationSec ?? 0);
    const marker = await markerAt(duration - 10, duration);
    compareRankedCandidatesToMarker(before, marker, {
      startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:30.000Z', durationSec: duration,
    });
    const after = analyzeFrames(frames, analysisSource(), { diagnoseTail: true });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('the analyzer module does not import the marker module at all', () => {
    // Structural proof of the same claim: there is no code path by which a
    // marker could influence a bar, because the decision code cannot see it.
    const src = fs.readFileSync(path.join(__dirname, 'rdr2BenchmarkAnalysis.ts'), 'utf-8');
    expect(src).not.toMatch(/rdr2ResultsMarker/);
    expect(src).not.toMatch(/markRdr2Results/);
  });

  it('refuses a marker that does not land inside the capture under EITHER anchoring', async () => {
    const result = analysed({ diagnoseTail: true });
    const duration = result.status === 'candidate' ? result.diagnostics.captureDurationSec : (result.diagnostics?.captureDurationSec ?? 0);
    // A marker session for some other run entirely: it began well before this
    // capture and ran on well past it, so the mark is before the capture by
    // the wall clock and before it by monotonic elapsed too.
    const clock = fakeClock(Date.parse('2026-01-02T03:04:00.000Z') - 100_000, 3_000_000_000n);
    async function* lines(): AsyncGenerator<string> {
      clock.advance(10);
      yield '';
      clock.advance(duration + 200);
      yield 'q';
    }
    const marker = await runMarkerSession({ lines: lines(), log: () => {}, clock });
    const cmp = compareRankedCandidatesToMarker(result, marker, {
      startedAt: '2026-01-02T03:04:00.000Z', endedAt: '2026-01-02T03:06:30.000Z', durationSec: duration,
    });
    expect(cmp.status).toBe('refused');
    if (cmp.status !== 'refused') throw new Error('unreachable');
    expect(cmp.reasons.join(' ')).toMatch(/do not describe the same run/);
  });
});

describe('the marker CLIs refuse misuse', () => {
  it('requires --out and rejects a value that is another flag', () => {
    expect(() => parseMarkerArgs([])).toThrow(/--out is required/);
    expect(() => parseMarkerArgs(['--out'])).toThrow(MarkerCliError);
    expect(() => parseMarkerArgs(['--out', '--bundle'])).toThrow(MarkerCliError);
    expect(parseMarkerArgs(['--out', 'm.json', '--bundle', '/b'])).toEqual({ outPath: 'm.json', bundleDir: '/b' });
  });

  it('rejects a stray positional argument rather than guessing what it meant', () => {
    expect(() => parseMarkerArgs(['m.json'])).toThrow(/Unexpected argument/);
  });

  it('makes --marker imply the tail diagnostic, since the ranking is what it compares', () => {
    const args = parseAnalyzeArgs(['/bundle', '--marker', 'm.json']);
    expect(args.markerPath).toBe('m.json');
    expect(args.diagnoseTail).toBe(true);
  });

  it('refuses --marker alongside --compare', () => {
    expect(() => parseAnalyzeArgs(['--compare', '/a', '/b', '--marker', 'm.json'])).toThrow(/applies to a single analysis/);
  });

  it('refuses --marker with no value', () => {
    expect(() => parseAnalyzeArgs(['/bundle', '--marker'])).toThrow(/--marker needs a value/);
  });
});
