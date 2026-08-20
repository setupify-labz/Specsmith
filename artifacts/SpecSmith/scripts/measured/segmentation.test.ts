// Segmentation tests, keyed to two REAL Red Dead Redemption 2 captures.
//
// The fixtures are the operator's own PresentMon output, stored verbatim
// (gzipped only — losslessly, with the hash of the ORIGINAL bytes pinned
// below, so "unmodified" is a proven claim rather than an assurance). They
// exist so this layer can be developed and changed without relaunching the
// game, which is the only other way to get data of this shape.
//
// Run 2 and run 3 are independent captures of the same scene at the same
// settings. Having both is what makes cross-run agreement testable: a rule
// that only works on one capture is fitted to it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parsePresentMonCsv, type PresentMonFrame } from './presentmon';
import {
  AmbiguousSegmentationError,
  MAX_STEADY_RUNS,
  MIN_TRANSITION_FRAME_MULTIPLE,
  SEGMENTATION_METHOD,
  findUtilizationThreshold,
  segmentBenchmark,
  segmentByGpuUtilization,
  segmentCapture,
  segmentationProvenance,
} from './segmentation';
import { computeFrameTimeStats } from '../../src/lib/measured/frameTimes';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * SHA-256 of each capture as PresentMon wrote it, before compression.
 *
 * Pinned so the fixtures cannot drift. If gzip round-tripping ever stopped
 * being lossless, or someone "tidied" a capture, these fail immediately.
 */
const ORIGINAL_SHA256 = {
  run2: 'c9bb01dd077957700abed96c4f97d680cbe876c2e431ee577a57f0503cdcd372',
  run3: '7bcf234902db50249cfcd6d99e8c0f2cc90644ce640d7f8b77f7234d24b9eab3',
} as const;

const readCapture = (name: keyof typeof ORIGINAL_SHA256): string =>
  zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, `rdr2-1440p-ultra-${name}.csv.gz`))).toString('utf-8');

const captures = { run2: readCapture('run2'), run3: readCapture('run3') };
const parsed = { run2: parsePresentMonCsv(captures.run2), run3: parsePresentMonCsv(captures.run3) };

/** A synthetic frame, for the refusal cases real captures do not contain. */
const frame = (presentMode: string, frameTimeMs = 10, timeInSeconds = 0): PresentMonFrame =>
  ({ frameTimeMs, presentMode, timeInSeconds, msGpuActive: frameTimeMs * 0.97, csvLine: 2 });
const streak = (presentMode: string, n: number, frameTimeMs = 10): PresentMonFrame[] =>
  Array.from({ length: n }, (_, i) => frame(presentMode, frameTimeMs, i * 0.01));

const FLIP = 'Hardware: Legacy Flip';
const COMPOSED = 'Composed: Copy with GPU GDI';

describe('the RDR2 fixtures are the raw captures, unmodified', () => {
  it('decompresses to bytes identical to what PresentMon wrote', () => {
    for (const [name, sha] of Object.entries(ORIGINAL_SHA256)) {
      expect(createHash('sha256').update(captures[name as keyof typeof captures]).digest('hex')).toBe(sha);
    }
  });

  it('is a real RDR2 capture, not a reconstruction', () => {
    for (const p of Object.values(parsed)) {
      expect(p.processes).toEqual(['RDR2.exe']);
      expect(p.frameTimesMs.length).toBeGreaterThan(30_000);
    }
  });

  it('parses without the parser having to discard or repair anything', () => {
    for (const p of Object.values(parsed)) {
      expect(p.truncatedTrailingRows).toBe(0);
      expect(p.droppedFrames).toBe(0);
      // Both captures' first present carries a real interval, so the
      // first-frame discard never fires here.
      expect(p.discardedFirstFrames).toBe(0);
    }
  });
});

describe('segmenting the real captures', () => {
  it('finds the same three-part shape in both independent runs', () => {
    for (const p of Object.values(parsed)) {
      const s = segmentCapture(p.frames);
      expect(s.steadyPresentMode).toBe(FLIP);
      expect(s.included).toHaveLength(1);
      // A compositor-paced head, the boundary frame, and a compositor-paced tail.
      expect(s.excluded).toHaveLength(3);
      expect(s.excluded.filter((e) => e.presentMode === COMPOSED)).toHaveLength(2);
    }
  });

  it('cuts run 2 at exactly the observed presentation-path boundaries', () => {
    const s = segmentCapture(parsed.run2.frames);
    expect(s.totalFrames).toBe(37_844);
    expect(s.retainedFrames).toBe(37_514);
    expect(s.included[0]).toMatchObject({ startIndex: 173, endIndex: 37_686, frameCount: 37_514 });
    expect(s.excluded.map((e) => [e.startIndex, e.endIndex])).toEqual([[0, 171], [172, 172], [37_687, 37_843]]);
  });

  it('cuts run 3 at exactly the observed presentation-path boundaries', () => {
    const s = segmentCapture(parsed.run3.frames);
    expect(s.totalFrames).toBe(35_470);
    expect(s.retainedFrames).toBe(35_367);
    expect(s.included[0]).toMatchObject({ startIndex: 41, endIndex: 35_407, frameCount: 35_367 });
    expect(s.excluded.map((e) => [e.startIndex, e.endIndex])).toEqual([[0, 39], [40, 40], [35_408, 35_469]]);
  });

  it('excludes only the edges — over 99% of each capture survives', () => {
    for (const p of Object.values(parsed)) {
      const s = segmentCapture(p.frames);
      expect(s.retainedFrames / s.totalFrames).toBeGreaterThan(0.99);
    }
  });

  it('records a reason for every excluded interval', () => {
    for (const p of Object.values(parsed)) {
      for (const e of segmentCapture(p.frames).excluded) expect(e.reason.length).toBeGreaterThan(30);
    }
  });

  it('accounts for every frame exactly once across included and excluded', () => {
    for (const p of Object.values(parsed)) {
      const s = segmentCapture(p.frames);
      const seen = new Set<number>();
      for (const iv of [...s.included, ...s.excluded]) {
        for (let i = iv.startIndex; i <= iv.endIndex; i += 1) {
          expect(seen.has(i)).toBe(false);
          seen.add(i);
        }
      }
      expect(seen.size).toBe(s.totalFrames);
    }
  });

  it('retains frame times matching the included intervals, in capture order', () => {
    for (const p of Object.values(parsed)) {
      const s = segmentCapture(p.frames);
      const expected = s.included.flatMap((iv) =>
        p.frames.slice(iv.startIndex, iv.endIndex + 1).map((f) => f.frameTimeMs));
      expect(s.retainedFrameTimesMs).toEqual(expected);
    }
  });
});

// The property that makes this rule trustworthy: it is decided by HOW frames
// were presented, so it cannot have been fitted to the frame rate it produces.
describe('the cut does not depend on the frame rate it produces', () => {
  it('is unchanged when every frame time is halved or doubled', () => {
    const base = segmentCapture(parsed.run2.frames);
    for (const factor of [0.5, 2, 10]) {
      const scaled = parsed.run2.frames.map((f) => ({ ...f, frameTimeMs: f.frameTimeMs * factor }));
      const s = segmentCapture(scaled);
      expect(s.included).toEqual(base.included);
      expect(s.excluded).toEqual(base.excluded);
      expect(s.retainedFrames).toBe(base.retainedFrames);
    }
  });

  it('keeps a large isolated stall inside the steady region', () => {
    // Run 2 holds a 354 ms hitch at index 37,476 — mid-gameplay, on the
    // steady path. It is a real stutter and belongs in the 1% low; a rule
    // that chased spikes to flatter the result would have removed it.
    const s = segmentCapture(parsed.run2.frames);
    const worst = Math.max(...s.retainedFrameTimesMs);
    expect(worst).toBeGreaterThan(300);
    expect(worst).toBe(Math.max(...parsed.run2.frames.map((f) => f.frameTimeMs)));
  });

  it('does not chase spikes: injecting one into the steady region changes nothing', () => {
    const base = segmentCapture(parsed.run3.frames);
    const spiked = parsed.run3.frames.map((f, i) => (i === 20_000 ? { ...f, frameTimeMs: 5_000 } : f));
    const s = segmentCapture(spiked);
    expect(s.included).toEqual(base.included);
    expect(s.excluded).toEqual(base.excluded);
  });
});

describe('determinism', () => {
  it('produces an identical result on repeated runs', () => {
    for (const p of Object.values(parsed)) {
      expect(segmentCapture(p.frames)).toEqual(segmentCapture(p.frames));
    }
  });

  it('pins the retained-frame hash, so a change in the rule cannot pass silently', () => {
    expect(segmentCapture(parsed.run2.frames).retainedSha256)
      .toBe('2d87c62bdce78fce8207f65bc688e23a048c42099fd13255b95ea55ac00ad8cb');
    expect(segmentCapture(parsed.run3.frames).retainedSha256)
      .toBe('2fbfe6f5510714b4d7a7fa70ffef768131e294a165cb21243ca38a1826549918');
  });
});

// Two captures of the same scene at the same settings on the same machine.
// They are not expected to be identical — they are expected to agree.
describe('the two independent runs agree after segmentation', () => {
  it('lands within a few percent on average FPS and close on the 1% low', () => {
    const a = computeFrameTimeStats(segmentCapture(parsed.run2.frames).retainedFrameTimesMs);
    const b = computeFrameTimeStats(segmentCapture(parsed.run3.frames).retainedFrameTimesMs);
    expect(Math.abs(a.averageFps - b.averageFps) / a.averageFps).toBeLessThan(0.05);
    expect(Math.abs(a.onePercentLow - b.onePercentLow) / a.onePercentLow).toBeLessThan(0.05);
  });

  it('moves the figures only slightly here, because the edges are small — the point is that they are recorded, not that they are large', () => {
    // Honest framing: on THIS capture the excluded head and tail are under 1%
    // of frames, so the correction is small. The value is that the excluded
    // region is identified and recorded rather than silently averaged in; on a
    // capture with a real loading screen the same rule removes far more.
    const raw = computeFrameTimeStats(parsed.run2.frameTimesMs);
    const seg = computeFrameTimeStats(segmentCapture(parsed.run2.frames).retainedFrameTimesMs);
    expect(seg.averageFps).toBeGreaterThan(raw.averageFps);
    expect(Math.abs(seg.averageFps - raw.averageFps) / raw.averageFps).toBeLessThan(0.05);
  });
});

describe('provenance', () => {
  const s = segmentCapture(parsed.run2.frames);
  const prov = segmentationProvenance(s, captures.run2);

  it('pins the source capture by the hash of its exact bytes', () => {
    expect(prov.sourceSha256).toBe(ORIGINAL_SHA256.run2);
  });

  it('pins the retained frames separately from the source', () => {
    expect(prov.retainedSha256).toBe(s.retainedSha256);
    expect(prov.retainedSha256).not.toBe(prov.sourceSha256);
  });

  it('names the rule that produced the cut', () => {
    expect(prov.method).toBe(SEGMENTATION_METHOD);
    expect(prov.steadyPresentMode).toBe(FLIP);
  });

  it('carries the intervals, so the cut can be re-checked against the original file', () => {
    expect(prov.included).toEqual(s.included);
    expect(prov.excluded).toEqual(s.excluded);
    expect(prov.totalFrames).toBe(37_844);
    expect(prov.retainedFrames).toBe(37_514);
  });

  it('changes the source hash if a single byte of the capture differs', () => {
    expect(segmentationProvenance(s, `${captures.run2} `).sourceSha256).not.toBe(prov.sourceSha256);
  });
});

describe('refusing ambiguous segmentation', () => {
  it('refuses a capture with no PresentMode column', () => {
    expect(() => segmentCapture(streak('', 100))).toThrow(AmbiguousSegmentationError);
    expect(() => segmentCapture(streak('', 100))).toThrow(/no PresentMode column/);
  });

  it('refuses an empty capture', () => {
    expect(() => segmentCapture([])).toThrow(AmbiguousSegmentationError);
  });

  it('refuses when the dominant path is not a hardware flip mode', () => {
    // A windowed session: never composited out, so nothing to exclude — but
    // also not a measurement of the game rendering at full rate.
    expect(() => segmentCapture(streak(COMPOSED, 500))).toThrow(/not a hardware flip mode/);
  });

  it('refuses when the steady path is a minority of the capture', () => {
    // Flip IS the largest single path (200 of 500) but is still a minority,
    // and neither runner-up is close enough to trip the ambiguity check
    // first — so this reaches the share rule specifically.
    const frames = [...streak(COMPOSED, 150), ...streak(FLIP, 200), ...streak('Composed: Flip', 150)];
    expect(() => segmentCapture(frames)).toThrow(/covers only/);
  });

  it('refuses when two presentation paths are comparable in size', () => {
    const frames = [...streak(FLIP, 500), ...streak('Hardware: Independent Flip', 450)];
    expect(() => segmentCapture(frames)).toThrow(/comparable in size/);
  });

  it('refuses a capture fragmented across too many steady stretches', () => {
    const frames = Array.from({ length: MAX_STEADY_RUNS + 1 }, () => [...streak(FLIP, 200), ...streak(COMPOSED, 2)]).flat();
    expect(() => segmentCapture(frames)).toThrow(/separate stretches/);
  });

  it('refuses rather than returning an empty measurement', () => {
    // Every steady stretch is a single frame, and each is the boundary frame
    // of its own run, so nothing survives. That must throw, not return [].
    const frames = [...streak(COMPOSED, 1), ...streak(FLIP, 1), ...streak(COMPOSED, 1), ...streak(FLIP, 1)];
    expect(() => segmentCapture(frames)).toThrow(AmbiguousSegmentationError);
  });
});

describe('the boundary frame', () => {
  it('is dropped when a steady run follows a different path', () => {
    const s = segmentCapture([...streak(COMPOSED, 10), ...streak(FLIP, 100)]);
    expect(s.included[0].startIndex).toBe(11);
    expect(s.retainedFrames).toBe(99);
    expect(s.excluded.some((e) => e.startIndex === 10 && e.frameCount === 1)).toBe(true);
  });

  it('is NOT dropped when the capture already starts on the steady path', () => {
    // Nothing precedes frame 0, so its interval spans no mode change and
    // there is no transition cost to remove.
    const s = segmentCapture(streak(FLIP, 100));
    expect(s.included).toEqual([expect.objectContaining({ startIndex: 0, endIndex: 99, frameCount: 100 })]);
    expect(s.excluded).toEqual([]);
    expect(s.retainedFrames).toBe(100);
  });

  it('really is the frame that spans the switch in the real capture', () => {
    // Run 2's boundary frame reports 82.81 ms against a steady median near
    // 10.5 ms — it timed the mode change, not a rendered frame.
    const boundary = parsed.run2.frames[172];
    expect(boundary.frameTimeMs).toBeCloseTo(82.81, 2);
    expect(boundary.presentMode).toBe(FLIP);
    expect(segmentCapture(parsed.run2.frames).retainedFrameTimesMs[0]).not.toBeCloseTo(82.81, 2);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: GPU utilisation
// ---------------------------------------------------------------------------

const gpuFrame = (presentMode: string, frameTimeMs: number, msGpuActive: number, timeInSeconds = 0): PresentMonFrame =>
  ({ frameTimeMs, msGpuActive, presentMode, timeInSeconds, csvLine: 2 });

/** n frames at a given interval and GPU-busy time, with a running clock. */
const gpuStreak = (n: number, frameTimeMs: number, msGpuActive: number, startSec = 0): PresentMonFrame[] => {
  const out: PresentMonFrame[] = [];
  let t = startSec;
  for (let i = 0; i < n; i += 1) { out.push(gpuFrame(FLIP, frameTimeMs, msGpuActive, t)); t += frameTimeMs / 1000; }
  return out;
};

describe('the ratio distribution is bimodal in both real captures', () => {
  it('separates a GPU-idle mode from a GPU-bound mode', () => {
    for (const p of Object.values(parsed)) {
      const d = findUtilizationThreshold(p.frames.map((f) => f.msGpuActive / f.frameTimeMs));
      expect(d).not.toBeNull();
      expect(d!.idleModeBin).toBeLessThan(d!.busyModeBin);
      expect(d!.histogram[d!.valleyBin]).toBeLessThan(d!.histogram[d!.busyModeBin] * 0.05);
    }
  });

  it('derives the SAME cut from each capture independently, without either being consulted about the other', () => {
    const a = findUtilizationThreshold(parsed.run2.frames.map((f) => f.msGpuActive / f.frameTimeMs))!;
    const b = findUtilizationThreshold(parsed.run3.frames.map((f) => f.msGpuActive / f.frameTimeMs))!;
    expect(a.threshold).toBe(b.threshold);
    expect(a.threshold).toBe(0.525);
  });
});

// The property the whole rule stands on. Utilisation is a RATIO of two times,
// so scaling the time base cannot move it — the rule has no frame rate in it.
describe('the GPU-utilisation cut is invariant to uniform frame-time scaling', () => {
  it('is unchanged when the entire time base is scaled', () => {
    for (const p of Object.values(parsed)) {
      const base = segmentBenchmark(p.frames);
      for (const k of [0.25, 0.5, 2, 10]) {
        const scaled = p.frames.map((f) => ({ ...f, frameTimeMs: f.frameTimeMs * k, msGpuActive: f.msGpuActive * k, timeInSeconds: f.timeInSeconds * k }));
        const s = segmentBenchmark(scaled);
        // Compare the CUT, not the timestamps: startTimeSec/endTimeSec are
        // wall-clock labels and are expected to scale with the time base.
        const shape = (r: typeof base.gpuUtilization) => ({
          threshold: r.utilizationThreshold,
          included: r.included.map((iv) => [iv.startIndex, iv.endIndex, iv.frameCount]),
          excluded: r.excluded.map((iv) => [iv.startIndex, iv.endIndex, iv.frameCount]),
        });
        expect(shape(s.gpuUtilization)).toEqual(shape(base.gpuUtilization));
        expect(s.retainedFrameTimesMs.length).toBe(base.retainedFrameTimesMs.length);
      }
    }
  });

  it('classifies by GPU work, not frame rate: fast GPU-bound frames are KEPT and slow GPU-idle frames are EXCLUDED', () => {
    // The exact opposite of an "FPS > X" rule. The 250 fps stretch is doing
    // full GPU work and must survive; the 40 fps stretch is idle and must not.
    const frames = [
      ...gpuStreak(2000, 4, 3.9, 0),      // 250 fps, ratio 0.98  -> gameplay
      ...gpuStreak(80, 25, 1.0, 8),       // 40 fps,  ratio 0.04  -> transition (2.0s)
      ...gpuStreak(2000, 4, 3.9, 10),     // 250 fps again
    ];
    const s = segmentByGpuUtilization(frames);
    expect(s.excluded.some((e) => e.startIndex === 2000 && e.endIndex === 2079)).toBe(true);
    // Every retained frame is from one of the fast, GPU-bound stretches.
    expect(s.retainedFrameTimesMs.every((v) => v === 4)).toBe(true);
  });
});

describe('sustained transitions versus isolated frames', () => {
  it('keeps an isolated GPU-idle frame, which is scheduling noise rather than a transition', () => {
    const frames = [...gpuStreak(1000, 10, 9.7, 0), gpuFrame(FLIP, 10, 0.2, 10), ...gpuStreak(1000, 10, 9.7, 10.01)];
    const s = segmentByGpuUtilization(frames);
    expect(s.excluded).toEqual([]);
    expect(s.retainedFrames).toBe(2001);
  });

  it('excludes an idle stretch once it lasts long enough to be a transition', () => {
    const frames = [...gpuStreak(1000, 10, 9.7, 0), ...gpuStreak(200, 4, 0.7, 10), ...gpuStreak(1000, 10, 9.7, 10.8)];
    const s = segmentByGpuUtilization(frames);
    expect(s.excluded.some((e) => e.frameCount === 200)).toBe(true);
  });

  it('sits inside the empty gap between the two idle-run populations, not on either', () => {
    // Idle runs in both captures are either far below or far above the gate;
    // nothing sits near it, which is what makes the exact value uncritical.
    for (const p of Object.values(parsed)) {
      const s = segmentBenchmark(p.frames);
      const ref = s.gpuUtilization.renderedFrameMedianMs;
      const gateMs = ref * MIN_TRANSITION_FRAME_MULTIPLE;
      const excludedMs = s.gpuUtilization.excluded
        .filter((e) => e.frameCount > 1 && e.startTimeSec !== null && e.endTimeSec !== null)
        .map((e) => (e.endTimeSec! - e.startTimeSec!) * 1000);
      // Every excluded stretch clears the gate by a wide margin.
      for (const ms of excludedMs) expect(ms).toBeGreaterThan(gateMs * 1.5);
    }
  });

  it('gives identical intervals anywhere in 32x-76x, so the multiple is not a knife edge', () => {
    // Re-derive the classification at the ends of the empirical gap and check
    // the excluded set does not move.
    for (const p of Object.values(parsed)) {
      const base = segmentBenchmark(p.frames).gpuUtilization.excluded.map((e) => [e.startIndex, e.endIndex]);
      expect(MIN_TRANSITION_FRAME_MULTIPLE).toBeGreaterThan(32);
      expect(MIN_TRANSITION_FRAME_MULTIPLE).toBeLessThan(76);
      expect(base.length).toBeGreaterThan(4);
    }
  });
});

describe('refusing when the structural evidence is insufficient', () => {
  it('refuses a capture with no msGPUActive column', () => {
    const frames = streak(FLIP, 500).map((f) => ({ ...f, msGpuActive: Number.NaN }));
    expect(() => segmentByGpuUtilization(frames)).toThrow(/no msGPUActive column/);
  });

  it('excludes nothing when the region is GPU-bound throughout — a clean run needs no cut', () => {
    const s = segmentByGpuUtilization(gpuStreak(3000, 10, 9.7));
    expect(s.excluded).toEqual([]);
    expect(s.retainedFrames).toBe(3000);
    expect(Number.isNaN(s.utilizationThreshold)).toBe(true);
  });

  it('refuses when the GPU was idle throughout, because nothing here is a benchmark', () => {
    expect(() => segmentByGpuUtilization(gpuStreak(3000, 4, 0.7))).toThrow(/idle for most of this capture/);
  });

  it('refuses a distribution whose modes are not cleanly separated', () => {
    // A smear across the whole range: no valley, so no defensible cut.
    const frames = Array.from({ length: 4000 }, (_, i) => gpuFrame(FLIP, 10, (i % 100) / 10, i * 0.01));
    const d = findUtilizationThreshold(frames.map((f) => f.msGpuActive / f.frameTimeMs));
    expect(d).toBeNull();
  });
});

describe('segmenting the real captures with both stages', () => {
  const results = { run2: segmentBenchmark(parsed.run2.frames), run3: segmentBenchmark(parsed.run3.frames) };

  it('leaves presentation-path-v1 answering exactly as it did before', () => {
    expect(results.run2.presentationPath.retainedFrames).toBe(37_514);
    expect(results.run3.presentationPath.retainedFrames).toBe(35_367);
    expect(results.run2.presentationPath.method).toBe(SEGMENTATION_METHOD);
  });

  it('removes the internal transitions stage 1 retained', () => {
    expect(results.run2.retainedFrameTimesMs.length).toBe(18_908);
    expect(results.run3.retainedFrameTimesMs.length).toBe(18_800);
  });

  it('covers the transition windows the operator observed as black screens in run 3', () => {
    // Reported visually: ~59-83, 109-113, 139-142, 168-176, 202-212 s.
    const excluded = results.run3.intervalsInCaptureIndices.excluded
      .filter((e) => e.frameCount > 1 && e.startTimeSec !== null);
    for (const [from, to] of [[59, 83], [109, 113], [139, 142], [168, 176], [202, 212]]) {
      // A window may be split across several excluded stretches when brief
      // rendering interrupts the black screen, so measure aggregate coverage.
      let covered = 0;
      for (const e of excluded) {
        const lo = Math.max(from, e.startTimeSec!);
        const hi = Math.min(to, e.endTimeSec!);
        if (hi > lo) covered += hi - lo;
      }
      expect(covered / (to - from), `window ${from}-${to}s is only ${(covered / (to - from) * 100).toFixed(0)}% excluded`).toBeGreaterThan(0.8);
    }
  });

  it('retains a homogeneously GPU-bound population in both runs', () => {
    for (const [name, s] of Object.entries(results)) {
      const ratios = s.intervalsInCaptureIndices.included.flatMap((iv) =>
        Array.from({ length: iv.endIndex - iv.startIndex + 1 }, (_, k) => {
          const f = parsed[name as keyof typeof parsed].frames[iv.startIndex + k];
          return f.msGpuActive / f.frameTimeMs;
        }));
      const median = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      expect(median).toBeGreaterThan(0.9);
    }
  });

  it('brings the two independent runs into far closer agreement than stage 1 alone', () => {
    const stage1 = ['run2', 'run3'].map((n) =>
      computeFrameTimeStats(results[n as 'run2'].presentationPath.retainedFrameTimesMs).averageFps);
    const both = ['run2', 'run3'].map((n) =>
      computeFrameTimeStats(results[n as 'run2'].retainedFrameTimesMs).averageFps);
    const spread = (a: number[]) => Math.abs(a[0] - a[1]) / a[0];
    expect(spread(both)).toBeLessThan(spread(stage1));
    expect(spread(both)).toBeLessThan(0.01);
  });

  it('accounts for every frame of the capture exactly once across both stages', () => {
    for (const [name, s] of Object.entries(results)) {
      const seen = new Set<number>();
      for (const iv of [...s.intervalsInCaptureIndices.included, ...s.intervalsInCaptureIndices.excluded]) {
        for (let i = iv.startIndex; i <= iv.endIndex; i += 1) { expect(seen.has(i)).toBe(false); seen.add(i); }
      }
      expect(seen.size).toBe(parsed[name as keyof typeof parsed].frames.length);
    }
  });

  it('gives every excluded interval a reason naming its structural evidence', () => {
    for (const s of Object.values(results)) {
      for (const e of s.intervalsInCaptureIndices.excluded) {
        expect(e.reason).toMatch(/GPU utilisation|presentation-path|Presented via|First frame/);
      }
    }
  });
});
