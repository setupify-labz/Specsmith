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
  SEGMENTATION_METHOD,
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
  ({ frameTimeMs, presentMode, timeInSeconds, csvLine: 2 });
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
