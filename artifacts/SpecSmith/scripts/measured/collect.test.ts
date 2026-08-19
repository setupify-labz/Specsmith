import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildObservation, collectorBuildHash, COLLECTOR_VERSION, validateAndSave, type CollectInputs } from './collect';
import { detectWindowsEnvironment, UnsupportedPlatformError, type DetectedHardware } from './environment';
import { errors, validateMeasuredObservation, warnings } from '../../src/lib/measured/validate';
import { computeFrameTimeStats } from '../../src/lib/measured/frameTimes';
import type { GameFeatureProfile } from '../../src/lib/benchmarks/types';

// Frame times here are SYNTHETIC, used to exercise assembly and the save gate.
// They are not a measurement of anything and never reach the committed store —
// every test writes to a temp file.

const frames = () => Array.from({ length: 8000 }, (_, i) => 8 + (i % 40) * 0.35);

const hardware: DetectedHardware = {
  gpuRaw: 'NVIDIA GeForce RTX 4070',
  gpuDriverVersion: '32.0.15.6636',
  cpuRaw: 'AMD Ryzen 7 7800X3D 8-Core Processor',
  osBuild: 'Microsoft Windows 11 Pro 10.0.26100 build 26100',
  ramTotalGb: 32,
  ramConfiguredSpeedMts: 6000,
  dimmCount: 2,
};

const inputs = (over: Partial<CollectInputs> = {}): CollectInputs => ({
  gameId: 'marvel-rivals', gpuId: 'gpu-1', cpuId: 'cpu-1',
  resolution: '1440p', preset: 'high',
  upscaler: 'native', rayTracing: false, frameGeneration: false,
  renderScalePercent: 100, ramChannels: 2, gpuOverclocked: false,
  settingsText: 'texture=high\nshadows=high\n', gameVersion: '1.2.3',
  ...over,
});

const build = (over: Partial<CollectInputs> = {}, f = frames()) =>
  buildObservation({
    frameTimesMs: f,
    hardware,
    inputs: inputs(over),
    frameTimeRef: { sha256: 'abc', frameCount: f.length, encoding: 'json-array-ms', compression: 'gzip', storagePath: 'ab/abc.json.gz', compressedByteLength: 100 },
    measuredAt: '2026-08-19T12:00:00.000Z',
    runNonce: '11111111-2222-3333-4444-555555555555',
    buildHash: 'buildhash',
  });

describe('assembly reuses the shared logic rather than duplicating it', () => {
  it('derives every statistic from the frame times via computeFrameTimeStats', () => {
    const f = frames();
    expect(build({}, f).stats).toEqual(computeFrameTimeStats(f));
  });

  it('records the pinned 1%-low method', () => {
    expect(build().onePercentLowMethod).toBe('mean-slowest-1pct');
  });

  it('marks the observation as the measured tier', () => {
    expect(build().tier).toBe('measured');
  });

  it('carries the collector version and a build hash tying it to the code', () => {
    const obs = build();
    expect(obs.collectorVersion).toBe(COLLECTOR_VERSION);
    expect(obs.collectorBuildHash).toBeTruthy();
    expect(collectorBuildHash()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('fields that cannot be detected are marked, not guessed', () => {
  // The whole point: an operator-supplied channel count must stay
  // distinguishable from a detected one once it is in the store.
  it('names every undetectable field with a reason', () => {
    const gaps = build().detectionGaps;
    expect(gaps.map((g) => g.field).sort()).toEqual([
      'detected.gpuOverclockDetected',
      'ram.channels',
      'settingsHash',
    ]);
    for (const g of gaps) {
      expect(g.reason.length).toBeGreaterThan(20);
      expect(g.resolution).toBe('operator-supplied');
    }
  });

  it('labels catalog matching as manual, since no fuzzy matcher is used', () => {
    const obs = build();
    expect(obs.detected.gpuMatchMethod).toBe('manual');
    expect(obs.detected.cpuMatchMethod).toBe('manual');
  });

  it('keeps the raw detected strings beside the catalog ids', () => {
    const obs = build();
    expect(obs.detected.gpuRaw).toBe(hardware.gpuRaw);
    expect(obs.detected.cpuRaw).toBe(hardware.cpuRaw);
  });

  it('records settings as operator-attested, which validation surfaces as a warning', () => {
    const f = frames();
    const obs = build({}, f);
    expect(obs.settingsSource).toBe('operator-attested');
    // V1 cannot parse an arbitrary game's config, so every observation carries
    // this disclosure. It is a warning, not a rejection.
    const issues = validateMeasuredObservation(obs, f);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain('settings.operator-attested');
  });

  it('hashes the attested settings so two runs can be compared', () => {
    expect(build({ settingsText: 'a' }).settingsHash).not.toBe(build({ settingsText: 'b' }).settingsHash);
    expect(build({ settingsText: 'a' }).settingsHash).toBe(build({ settingsText: 'a' }).settingsHash);
  });
});

describe('the save gate', () => {
  const tempStore = (): string => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-store-')), 'measuredObservations.json');
    fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, note: 'test', observations: [] }, null, 2));
    return p;
  };

  it('saves a valid observation', () => {
    const p = tempStore();
    const f = frames();
    const outcome = validateAndSave(build({}, f), f, p);
    expect(outcome.saved).toBe(true);
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(1);
  });

  // A store holding invalid records is not a source of truth. A rejected run is
  // discarded, not parked.
  it('does not write anything when validation fails', () => {
    const p = tempStore();
    const f = frames();
    const obs = build({}, f);
    obs.stats = { ...obs.stats, averageFps: obs.stats.averageFps + 10 };
    const outcome = validateAndSave(obs, f, p);
    expect(outcome.saved).toBe(false);
    expect(errors(outcome.issues).map((i) => i.rule)).toContain('stats.averageFps-mismatch');
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(0);
  });

  it('does not write a run that is too short', () => {
    const p = tempStore();
    const short = Array.from({ length: 400 }, () => 10);
    expect(validateAndSave(build({}, short), short, p).saved).toBe(false);
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(0);
  });

  it('saves despite warnings — a disclosure is not a rejection', () => {
    const p = tempStore();
    const f = frames();
    const outcome = validateAndSave(build({ renderScalePercent: 70, ramChannels: 1 }, f), f, p);
    expect(outcome.saved).toBe(true);
    expect(warnings(outcome.issues).map((i) => i.rule)).toContain('render-scale.non-native');
    expect(warnings(outcome.issues).map((i) => i.rule)).toContain('ram.single-channel');
  });

  it('refuses a store whose schema version it does not write', () => {
    const p = tempStore();
    fs.writeFileSync(p, JSON.stringify({ schemaVersion: 99, note: '', observations: [] }));
    const f = frames();
    expect(() => validateAndSave(build({}, f), f, p)).toThrow(/schemaVersion/);
  });

  it('rejects a run using a feature the game is confirmed not to support', () => {
    const p = tempStore();
    const f = frames();
    const profile: GameFeatureProfile = {
      gameId: 'marvel-rivals', name: 'Marvel Rivals',
      dlss: { status: 'unsupported' }, fsr: { status: 'supported' },
      xess: { status: 'unknown' }, frameGeneration: { status: 'unknown' }, rayTracing: { status: 'supported' },
    };
    const outcome = validateAndSave(build({ upscaler: 'dlss', upscalerMode: 'quality' }, f), f, p, [profile]);
    expect(outcome.saved).toBe(false);
    expect(errors(outcome.issues).map((i) => i.rule)).toContain('features.contradicts-profile');
  });
});

describe('platform gate', () => {
  // A collector that "worked" off Windows would produce observations whose
  // hardware fields describe nothing.
  it.runIf(process.platform !== 'win32')('refuses to detect hardware off Windows', () => {
    expect(() => detectWindowsEnvironment()).toThrow(UnsupportedPlatformError);
    expect(() => detectWindowsEnvironment()).toThrow(/must run on Windows/);
  });
});

describe('integration with the real frame-time store', () => {
  // Exercises the actual gzip/content-addressed store rather than a stub, so
  // the hash an observation carries is one the store really produced and the
  // frames really round-trip.
  it('writes frames, embeds the real ref, validates, and saves', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-ft-int-'));
    const prior = process.env.SPECSMITH_FRAMETIME_ROOT;
    process.env.SPECSMITH_FRAMETIME_ROOT = root;
    try {
      const { writeFrameTimes, readFrameTimes } = await import('./frameTimeStore.mjs');
      const f = frames();
      const ref = await writeFrameTimes(f);

      const obs = buildObservation({
        frameTimesMs: f,
        hardware,
        inputs: inputs(),
        frameTimeRef: ref,
        measuredAt: '2026-08-19T12:00:00.000Z',
        runNonce: 'nonce-integration',
        buildHash: collectorBuildHash(),
      });

      const storePath = path.join(root, 'store.json');
      fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 1, note: 'test', observations: [] }));
      const outcome = validateAndSave(obs, f, storePath);
      expect(outcome.saved).toBe(true);

      // The blob the record points at is the run it was computed from.
      const roundTripped = await readFrameTimes(obs.frameTimes);
      expect(roundTripped).toEqual(f);
      expect(computeFrameTimeStats(roundTripped)).toEqual(obs.stats);
    } finally {
      if (prior === undefined) delete process.env.SPECSMITH_FRAMETIME_ROOT;
      else process.env.SPECSMITH_FRAMETIME_ROOT = prior;
    }
  });
});
