import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  analyzeFrames,
  analyzeRdr2ResearchBundle,
  compareRdr2Analyses,
  writeAnalysisReport,
  AnalysisOutputError,
  RDR2_ANALYSIS_SCHEMA_VERSION,
  type Rdr2AnalysisResult,
  type Rdr2AnalysisSource,
  type Rdr2AnalysisCandidate,
} from './rdr2BenchmarkAnalysis';
import type { PresentMonFrame } from './presentmon';

// SYNTHETIC FIXTURES ONLY.
//
// None of these frames came from a real capture, and none of the offsets a
// real run produced are encoded here. Each fixture is built from a SHAPE —
// "five GPU-busy blocks separated by four GPU-idle blocks" — so a test that
// passes proves the analyzer reads structure, not that it memorised a run.
//
// The scale is deliberately not RDR2's: scenes here are ~20s, not ~30s, and
// the whole run is ~2 minutes rather than ~5. If the analyzer had absolute
// timings baked in, these tests would fail.

const HARDWARE_FLIP = 'Hardware: Legacy Flip';

interface BlockSpec {
  seconds: number;
  fps: number;
  /** msGPUActive / frameTimeMs for every frame in this block. */
  gpuRatio: number;
}

/**
 * Builds frames for a sequence of blocks.
 *
 * Jitter is deterministic (a fixed sawtooth, never Math.random) so a failing
 * test fails identically every time.
 */
function buildFrames(specs: readonly BlockSpec[]): PresentMonFrame[] {
  const frames: PresentMonFrame[] = [];
  let t = 0;
  let line = 2;
  for (const spec of specs) {
    const nominalMs = 1000 / spec.fps;
    const count = Math.round(spec.seconds * spec.fps);
    for (let i = 0; i < count; i += 1) {
      // +/-2% sawtooth: enough variation that medians and min/max are not all
      // the identical number, small enough not to move any block across the
      // derived utilisation cut.
      const frameTimeMs = nominalMs * (1 + ((i % 5) - 2) * 0.01);
      t += frameTimeMs / 1000;
      frames.push({
        frameTimeMs,
        presentMode: HARDWARE_FLIP,
        timeInSeconds: t,
        msGpuActive: frameTimeMs * spec.gpuRatio,
        csvLine: line,
      });
      line += 1;
    }
  }
  return frames;
}

const MENU: BlockSpec = { seconds: 10, fps: 250, gpuRatio: 0.15 };
const SCENE = (seconds = 20): BlockSpec => ({ seconds, fps: 80, gpuRatio: 0.98 });
const TRANSITION: BlockSpec = { seconds: 3, fps: 250, gpuRatio: 0.15 };
const RESULTS: BlockSpec = { seconds: 10, fps: 250, gpuRatio: 0.15 };

/** The canonical complete run: menu, five scenes separated by four transitions, results screen. */
const fiveSceneRun = (): PresentMonFrame[] =>
  buildFrames([
    MENU,
    SCENE(), TRANSITION,
    SCENE(), TRANSITION,
    SCENE(), TRANSITION,
    SCENE(), TRANSITION,
    SCENE(),
    RESULTS,
  ]);

const source = (over: Partial<Rdr2AnalysisSource> = {}): Rdr2AnalysisSource => ({
  bundleDir: '/synthetic/bundle',
  csvFileName: 'presentmon.csv',
  csvSha256: 'a'.repeat(64),
  csvByteLength: 1234,
  processId: 27308,
  processName: 'RDR2.exe',
  gameVersion: '1.0.1436.24',
  collectorBuildHash: 'buildhash',
  ...over,
});

const asCandidate = (r: Rdr2AnalysisResult): Rdr2AnalysisCandidate => {
  if (r.status !== 'candidate') throw new Error(`expected candidate, got unresolved: ${r.reasons.join('; ')}`);
  return r;
};

describe('a valid five-scene pattern resolves to a candidate', () => {
  it('finds gameplay start, four transitions, five scenes and the results screen', () => {
    const result = asCandidate(analyzeFrames(fiveSceneRun(), source()));
    expect(result.status).toBe('candidate');
    expect(result.publishable).toBe(false);
    expect(result.scenes).toHaveLength(5);
    expect(result.boundaries.filter((b) => b.kind === 'transition')).toHaveLength(4);
    expect(result.boundaries.filter((b) => b.kind === 'gameplay-start')).toHaveLength(1);
    expect(result.boundaries.filter((b) => b.kind === 'results-start')).toHaveLength(1);
  });

  it('places boundaries where the fixture actually put them, without any hardcoded run timing', () => {
    const result = asCandidate(analyzeFrames(fiveSceneRun(), source()));
    // Menu is 10s, then scene(20) + transition(3) repeating.
    expect(result.gameplayStartOffsetSec).toBeCloseTo(10, 0);
    const transitions = result.boundaries.filter((b) => b.kind === 'transition');
    expect(transitions[0].startOffsetSec).toBeCloseTo(30, 0);
    expect(transitions[1].startOffsetSec).toBeCloseTo(53, 0);
    expect(transitions[2].startOffsetSec).toBeCloseTo(76, 0);
    expect(transitions[3].startOffsetSec).toBeCloseTo(99, 0);
    expect(result.resultsStartOffsetSec).toBeCloseTo(122, 0);
  });

  it('labels every scene figure as research-only and never as a publishable benchmark result', () => {
    const result = asCandidate(analyzeFrames(fiveSceneRun(), source()));
    expect(result.publishable).toBe(false);
    for (const scene of result.scenes) {
      expect(scene.research).toBeDefined();
      expect(scene.research.meanFps).toBeGreaterThan(0);
      // The figures live ONLY under `research` — nothing at the top level of a
      // scene can be mistaken for a verified benchmark number.
      expect(Object.keys(scene).sort()).toEqual(['durationSec', 'endOffsetSec', 'frameCount', 'ordinal', 'research', 'startOffsetSec']);
    }
  });

  it('carries evidence and a confidence for every boundary', () => {
    const result = asCandidate(analyzeFrames(fiveSceneRun(), source()));
    for (const b of result.boundaries) {
      expect(b.evidence.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(b.confidence);
      expect(b.evidence.join(' ')).toMatch(/GPU utilisation/);
    }
  });

  it('derives the utilisation cut from the capture rather than hardcoding one', () => {
    const result = asCandidate(analyzeFrames(fiveSceneRun(), source()));
    // The fixture's two populations are 0.15 and 0.98; any cut between them
    // separates the run. The point is that it was computed, not that it is a
    // particular number.
    expect(result.diagnostics.utilizationThreshold).toBeGreaterThan(0.15);
    expect(result.diagnostics.utilizationThreshold).toBeLessThan(0.98);
  });

  it('segments a run at a completely different time scale identically — the rule carries no absolute time', () => {
    // Every block half as long and twice the frame rate: same structure, same
    // scene count, different wall clock. A hardcoded threshold would break.
    const fast = buildFrames([
      { seconds: 5, fps: 500, gpuRatio: 0.15 },
      { seconds: 10, fps: 160, gpuRatio: 0.98 }, { seconds: 1.5, fps: 500, gpuRatio: 0.15 },
      { seconds: 10, fps: 160, gpuRatio: 0.98 }, { seconds: 1.5, fps: 500, gpuRatio: 0.15 },
      { seconds: 10, fps: 160, gpuRatio: 0.98 }, { seconds: 1.5, fps: 500, gpuRatio: 0.15 },
      { seconds: 10, fps: 160, gpuRatio: 0.98 }, { seconds: 1.5, fps: 500, gpuRatio: 0.15 },
      { seconds: 10, fps: 160, gpuRatio: 0.98 },
      { seconds: 5, fps: 500, gpuRatio: 0.15 },
    ]);
    const result = asCandidate(analyzeFrames(fast, source()));
    expect(result.scenes).toHaveLength(5);
    expect(result.boundaries.filter((b) => b.kind === 'transition')).toHaveLength(4);
  });
});

describe('incomplete and malformed run shapes fail closed', () => {
  it('refuses the 300-second incomplete-run shape: capture ends mid-scene-5, before the results screen', () => {
    // Four scenes, four transitions, then a fifth scene the recording cuts off
    // in the middle of — the shape of a capture that stopped before the
    // benchmark finished.
    const frames = buildFrames([
      MENU,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(12), // cut off; no results block follows
    ]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.failure).toBe('structure');
    expect(result.reasons.join(' ')).toMatch(/ends while the GPU is still rendering/);
    expect(result.reasons.join(' ')).toMatch(/fifth scene is incomplete/);
  });

  it('refuses a run with too few transitions', () => {
    const frames = buildFrames([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/Found 2 credible inter-scene transitions, expected exactly 4/);
  });

  it('refuses a run with too many transitions — an extra low-GPU loading period mid-run', () => {
    const frames = buildFrames([
      MENU,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(10), { seconds: 4, fps: 250, gpuRatio: 0.15 }, SCENE(10), // an extra loading pause splits scene 5
      RESULTS,
    ]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/Found 5 credible inter-scene transitions, expected exactly 4/);
    // And it names where they were, so a human can judge which is spurious.
    expect(result.reasons.join(' ')).toMatch(/\d+\.\d-\d+\.\d s|\d+\.\d-\d+\.\ds/);
  });

  it('never silently picks the closest four when five candidates exist', () => {
    const frames = buildFrames([
      MENU,
      SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION,
      SCENE(10), { seconds: 4, fps: 250, gpuRatio: 0.15 }, SCENE(10),
      RESULTS,
    ]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    // No boundaries at all are offered on an unresolved result.
    expect(result).not.toHaveProperty('boundaries');
    expect(result).not.toHaveProperty('scenes');
  });

  it('refuses a capture with no results-screen boundary at all — gameplay runs to the very last frame', () => {
    const frames = buildFrames([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(30)]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/A complete benchmark run ends with the results screen/);
  });

  it('refuses a capture whose GPU-utilisation distribution is not bimodal — no derivable cut', () => {
    // Uniformly GPU-bound throughout: there is no idle population, so no
    // transition can be located, and inventing one is exactly what is refused.
    const frames = buildFrames([{ seconds: 120, fps: 80, gpuRatio: 0.98 }]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/not clearly bimodal/);
  });

  it('refuses a capture too short to reason about', () => {
    const frames = buildFrames([{ seconds: 5, fps: 80, gpuRatio: 0.98 }]);
    const result = analyzeFrames(frames, source());
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/not enough recording to reason about benchmark structure/);
  });
});

describe('misleading frame rates do not fool the utilisation signal', () => {
  it('keeps a 250-fps GPU-BOUND scene as gameplay, not as a transition', () => {
    // Scene 3 runs at the same frame rate as the transitions around it, but
    // the GPU is fully busy. A frame-rate rule would cut it; a utilisation
    // rule keeps it.
    const frames = buildFrames([
      MENU,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      { seconds: 20, fps: 250, gpuRatio: 0.98 }, TRANSITION, // high-FPS gameplay
      SCENE(), TRANSITION,
      SCENE(),
      RESULTS,
    ]);
    const result = asCandidate(analyzeFrames(frames, source()));
    expect(result.scenes).toHaveLength(5);
    // The high-FPS block is scene 3 and kept at full length.
    expect(result.scenes[2].durationSec).toBeCloseTo(20, 0);
    expect(result.scenes[2].research.meanFps).toBeGreaterThan(200);
  });

  it('treats a LOW-fps GPU-idle stretch as a transition, not as slow gameplay', () => {
    const frames = buildFrames([
      MENU,
      SCENE(), { seconds: 3, fps: 30, gpuRatio: 0.15 }, // slow AND idle: still a transition
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(),
      RESULTS,
    ]);
    const result = asCandidate(analyzeFrames(frames, source()));
    expect(result.boundaries.filter((b) => b.kind === 'transition')).toHaveLength(4);
    expect(result.scenes).toHaveLength(5);
  });

  it('keeps an isolated GPU-idle blip inside a scene rather than splitting the scene on it', () => {
    // Well under the sustained floor: scheduling noise, not a scene change.
    const frames = buildFrames([
      MENU,
      SCENE(10), { seconds: 0.05, fps: 250, gpuRatio: 0.15 }, SCENE(10), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(), TRANSITION,
      SCENE(),
      RESULTS,
    ]);
    const result = asCandidate(analyzeFrames(frames, source()));
    expect(result.scenes).toHaveLength(5);
    expect(result.boundaries.filter((b) => b.kind === 'transition')).toHaveLength(4);
  });
});

// --- bundle-level integrity, against real files on disk ---------------------

const CSV_HEADER = 'Application,ProcessID,SwapChainAddress,Dropped,TimeInSeconds,msBetweenPresents,PresentMode,msGPUActive';

function framesToCsv(frames: readonly PresentMonFrame[], pid: number, app = 'RDR2.exe'): string {
  const rows = frames.map((f) =>
    `${app},${pid},0x1a2b,0,${f.timeInSeconds.toFixed(6)},${f.frameTimeMs.toFixed(6)},${f.presentMode},${f.msGpuActive.toFixed(6)}`);
  return `${CSV_HEADER}\n${rows.join('\n')}\n`;
}

function makeBundle(over: { frames?: PresentMonFrame[]; pid?: number; app?: string; manifestOver?: Record<string, unknown> } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-analysis-bundle-'));
  const frames = over.frames ?? fiveSceneRun();
  const pid = over.pid ?? 27308;
  const csv = framesToCsv(frames, pid, over.app);
  const csvBuf = Buffer.from(csv, 'utf-8');
  fs.writeFileSync(path.join(dir, 'presentmon.csv'), csvBuf);
  const manifest = {
    schemaVersion: 1,
    gameId: 'rdr2',
    capture: { startedAt: '2026-08-26T20:00:00.000Z', endedAt: '2026-08-26T20:05:00.000Z', processId: pid, processName: 'RDR2.exe' },
    gameVersion: '1.0.1436.24',
    hardware: {
      gpuId: 'gpu-1', gpuRaw: 'NVIDIA GeForce RTX 5070', gpuMatchMethod: 'exact', gpuDriverVersion: '32.0.16.1088',
      cpuId: 'cpu-1', cpuRaw: 'AMD Ryzen 5 5600X', cpuMatchMethod: 'exact', osBuild: 'Windows 11 26100.2314',
      ramTotalGb: 32, ramChannels: 2,
    },
    captureTool: { name: 'PresentMon.exe', sha256: 'b'.repeat(64), pinned: true },
    settingsFile: { game: 'rdr2', fileName: 'system.xml', locationSource: 'documents', sha256: 'c'.repeat(64), coverage: 'partial', parsedFields: ['graphics.api'], parsedValues: { graphics: { api: 'kSettingAPI_Vulkan' } } },
    collectorVersion: '0.1.0',
    collectorBuildHash: 'buildhash',
    csv: {
      fileName: 'presentmon.csv',
      sha256: createHash('sha256').update(csvBuf).digest('hex'),
      byteLength: csvBuf.byteLength,
      rowsUsable: frames.length,
      rowsDroppedNotDisplayed: 0,
      rowsDiscardedFirstFrame: 1,
    },
    ...over.manifestOver,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

describe('bundle integrity is verified before any analysis', () => {
  it('analyses a well-formed bundle end to end', () => {
    const dir = makeBundle();
    const result = asCandidate(analyzeRdr2ResearchBundle(dir));
    expect(result.scenes).toHaveLength(5);
    expect(result.source.processId).toBe(27308);
    expect(result.source.csvFileName).toBe('presentmon.csv');
  });

  it('refuses a CSV whose byte length disagrees with the manifest', () => {
    const dir = makeBundle();
    fs.appendFileSync(path.join(dir, 'presentmon.csv'), 'RDR2.exe,27308,0x1a2b,0,999.0,12.5,Hardware: Legacy Flip,12.0\n');
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.failure).toBe('integrity');
    expect(result.reasons.join(' ')).toMatch(/bytes but the manifest records/);
  });

  it('refuses a CSV whose SHA-256 disagrees with the manifest, even at identical length', () => {
    const dir = makeBundle();
    const p = path.join(dir, 'presentmon.csv');
    const buf = fs.readFileSync(p);
    // Flip one digit without changing the length.
    const idx = buf.lastIndexOf(Buffer.from('12'));
    buf[idx] = buf[idx] === 0x31 ? 0x39 : 0x31;
    fs.writeFileSync(p, buf);
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.failure).toBe('integrity');
    expect(result.reasons.join(' ')).toMatch(/hashes to .+ but the manifest records/);
  });

  it('refuses a bundle for a game other than RDR2', () => {
    const dir = makeBundle({ manifestOver: { gameId: 'marvel-rivals' } });
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.failure).toBe('integrity');
    expect(result.reasons.join(' ')).toMatch(/RDR2-only/);
  });

  it('refuses when the manifest names a PID that has no frames in the capture', () => {
    const dir = makeBundle({ pid: 27308, manifestOver: { capture: { startedAt: 'x', endedAt: 'y', processId: 99999, processName: 'RDR2.exe' } } });
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.failure).toBe('integrity');
    expect(result.reasons.join(' ')).toMatch(/could not be parsed for pid 99999/);
  });

  it('attributes only the manifest PID\'s frames when a second process is present in the same CSV', () => {
    const dir = makeBundle();
    const p = path.join(dir, 'presentmon.csv');
    // A second process interleaved into the same capture; its frames must not
    // reach the analysis.
    const extra = Array.from({ length: 500 }, (_, i) => `Other.exe,55555,0x9999,0,${(i * 0.01).toFixed(6)},10.0,Hardware: Legacy Flip,1.0`).join('\n');
    const csv = `${fs.readFileSync(p, 'utf-8')}${extra}\n`;
    const buf = Buffer.from(csv, 'utf-8');
    fs.writeFileSync(p, buf);
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.csv.sha256 = createHash('sha256').update(buf).digest('hex');
    manifest.csv.byteLength = buf.byteLength;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = asCandidate(analyzeRdr2ResearchBundle(dir));
    // The intruder's 500 frames are excluded, so the structure still reads.
    expect(result.scenes).toHaveLength(5);
  });

  it('refuses a manifest with no game identity at all', () => {
    const dir = makeBundle({ manifestOver: { gameVersion: undefined, gameBuildId: undefined } });
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/neither gameVersion nor gameBuildId/);
  });

  it('refuses a directory that is not a bundle at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-bundle-'));
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    if (result.status !== 'unresolved') throw new Error('unreachable');
    expect(result.reasons.join(' ')).toMatch(/No manifest.json/);
  });
});

describe('the source bundle is never modified', () => {
  const snapshot = (dir: string) =>
    fs.readdirSync(dir).sort().map((name) => {
      const p = path.join(dir, name);
      return { name, sha: createHash('sha256').update(fs.readFileSync(p)).digest('hex'), size: fs.statSync(p).size };
    });

  it('leaves every file byte-identical after a successful analysis', () => {
    const dir = makeBundle();
    const before = snapshot(dir);
    analyzeRdr2ResearchBundle(dir);
    expect(snapshot(dir)).toEqual(before);
    expect(fs.readdirSync(dir).sort()).toEqual(['manifest.json', 'presentmon.csv']);
  });

  it('leaves every file byte-identical after an UNRESOLVED analysis', () => {
    const dir = makeBundle({ frames: buildFrames([MENU, SCENE(), TRANSITION, SCENE(), RESULTS]) });
    const before = snapshot(dir);
    const result = analyzeRdr2ResearchBundle(dir);
    expect(result.status).toBe('unresolved');
    expect(snapshot(dir)).toEqual(before);
  });

  it('refuses to write a report inside the source bundle', () => {
    const dir = makeBundle();
    const result = analyzeRdr2ResearchBundle(dir);
    expect(() => writeAnalysisReport(path.join(dir, 'analysis.json'), result, dir)).toThrow(AnalysisOutputError);
    expect(() => writeAnalysisReport(path.join(dir, 'analysis.json'), result, dir)).toThrow(/inside the source bundle/);
    expect(fs.readdirSync(dir).sort()).toEqual(['manifest.json', 'presentmon.csv']);
  });
});

describe('report output is atomic and never overwrites', () => {
  it('writes a report to a fresh path', () => {
    const dir = makeBundle();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-analysis-out-'));
    const outPath = path.join(outDir, 'analysis.json');
    const result = analyzeRdr2ResearchBundle(dir);
    writeAnalysisReport(outPath, result, dir);
    expect(JSON.parse(fs.readFileSync(outPath, 'utf-8')).status).toBe('candidate');
    // No staging residue beside it.
    expect(fs.readdirSync(outDir).filter((n) => n.startsWith('.rdr2-analysis-staging-'))).toEqual([]);
  });

  it('refuses an output path that already exists', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-analysis-out-'));
    const outPath = path.join(outDir, 'analysis.json');
    fs.writeFileSync(outPath, 'previous');
    expect(() => writeAnalysisReport(outPath, { a: 1 })).toThrow(/already exists/);
    expect(fs.readFileSync(outPath, 'utf-8')).toBe('previous');
  });

  it('leaves no staging residue when serialization fails', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr2-analysis-out-'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeAnalysisReport(path.join(outDir, 'analysis.json'), circular)).toThrow(/circular structure/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});

describe('comparison across runs', () => {
  const candidateFrom = (specs: readonly BlockSpec[], sha: string) => analyzeFrames(buildFrames(specs), source({ csvSha256: sha }));

  const runA = () => candidateFrom([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS], 'a'.repeat(64));
  // Same structure, but gameplay starts much later — the wall clock differs
  // while the SHAPE is identical. This is the case comparison must recognise.
  const runB = () => candidateFrom([{ seconds: 40, fps: 250, gpuRatio: 0.15 }, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS], 'b'.repeat(64));

  it('reports the pattern as reproducing when two runs share a shape but start at different times', () => {
    const cmp = compareRdr2Analyses([runA(), runB()]);
    expect(cmp.status).toBe('compared');
    if (cmp.status !== 'compared') throw new Error('unreachable');
    expect(cmp.reproduces).toBe(true);
    expect(cmp.publishable).toBe(false);
    // Normalised to each run's own gameplay start, the boundaries coincide
    // despite a 30s difference in absolute offset.
    const t1 = cmp.boundaries.find((b) => b.kind === 'transition' && b.ordinal === 1);
    expect(t1?.spreadSec).toBeLessThan(1);
  });

  it('reports NOT reproducing when scene durations genuinely differ', () => {
    const runC = candidateFrom([MENU, SCENE(40), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS], 'c'.repeat(64));
    const cmp = compareRdr2Analyses([runA(), runC]);
    expect(cmp.status).toBe('compared');
    if (cmp.status !== 'compared') throw new Error('unreachable');
    expect(cmp.reproduces).toBe(false);
    expect(cmp.notes.join(' ')).toMatch(/NOT demonstrated to reproduce/);
  });

  it('REFUSES to compare when any run is unresolved, rather than averaging the resolved ones', () => {
    const incomplete = analyzeFrames(buildFrames([MENU, SCENE(), TRANSITION, SCENE(), RESULTS]), source({ csvSha256: 'd'.repeat(64) }));
    expect(incomplete.status).toBe('unresolved');
    const cmp = compareRdr2Analyses([runA(), incomplete]);
    expect(cmp.status).toBe('refused');
    if (cmp.status !== 'refused') throw new Error('unreachable');
    expect(cmp.reasons.join(' ')).toMatch(/unresolved/);
    expect(cmp.reasons.join(' ')).toMatch(/turn a refusal into a number/);
  });

  it('refuses fewer than two analyses', () => {
    const cmp = compareRdr2Analyses([runA()]);
    expect(cmp.status).toBe('refused');
    if (cmp.status !== 'refused') throw new Error('unreachable');
    expect(cmp.reasons.join(' ')).toMatch(/at least two/);
  });

  it('refuses to compare a run against itself', () => {
    const cmp = compareRdr2Analyses([runA(), runA()]);
    expect(cmp.status).toBe('refused');
    if (cmp.status !== 'refused') throw new Error('unreachable');
    expect(cmp.reasons.join(' ')).toMatch(/identical capture/);
  });

  it('notes differing game builds rather than silently comparing across them', () => {
    const a = analyzeFrames(buildFrames([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS]), source({ csvSha256: 'a'.repeat(64), gameVersion: '1.0.1436.24' }));
    const b = analyzeFrames(buildFrames([MENU, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), TRANSITION, SCENE(), RESULTS]), source({ csvSha256: 'b'.repeat(64), gameVersion: '1.0.1491.50' }));
    const cmp = compareRdr2Analyses([a, b]);
    expect(cmp.status).toBe('compared');
    if (cmp.status !== 'compared') throw new Error('unreachable');
    expect(cmp.notes.join(' ')).toMatch(/different game builds/);
  });

  it('carries the schema version on every result shape', () => {
    expect(runA().schemaVersion).toBe(RDR2_ANALYSIS_SCHEMA_VERSION);
    expect(compareRdr2Analyses([runA(), runB()]).schemaVersion).toBe(RDR2_ANALYSIS_SCHEMA_VERSION);
  });
});
