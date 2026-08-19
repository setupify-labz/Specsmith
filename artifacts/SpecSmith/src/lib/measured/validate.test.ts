import { describe, it, expect } from 'vitest';
import type { GameFeatureProfile } from '../benchmarks/types';
import { computeFrameTimeStats } from './frameTimes';
import { errors, validateMeasuredObservation, validateMeasuredStore, verifyFrameTimeHash, warnings } from './validate';
import type { MeasuredObservation } from './types';

/** A run long enough to clear the minimums, with realistic variation. */
function goodFrames(): number[] {
  return Array.from({ length: 8000 }, (_, i) => 8 + (i % 40) * 0.35);
}

function makeObservation(frames: number[], over: Partial<MeasuredObservation> = {}): MeasuredObservation {
  return {
    id: 'obs-1',
    tier: 'measured',
    gameId: 'marvel-rivals',
    cpuId: 'cpu-1',
    gpuId: 'gpu-1',
    ram: { totalGb: 32, channels: 2, ratedSpeedMts: 6000 },
    detected: { gpuRaw: 'NVIDIA GeForce RTX 4070', cpuRaw: 'AMD Ryzen 7 7800X3D', gpuMatchMethod: 'exact', cpuMatchMethod: 'exact', gpuOverclockDetected: false },
    gameVersion: '1.2.3',
    gpuDriverVersion: '566.36',
    osBuild: 'Windows 11 26100.2314',
    resolution: '1440p',
    renderScalePercent: 100,
    preset: 'high',
    settingsSource: 'config-parsed',
    settingsHash: 'abc123',
    rayTracing: false,
    upscaler: 'native',
    frameGeneration: false,
    frameTimes: { sha256: 'deadbeef', frameCount: frames.length, encoding: 'json-array-ms', compression: 'gzip', storagePath: 'de/deadbeef.json.gz', compressedByteLength: 1234 },
    stats: computeFrameTimeStats(frames),
    onePercentLowMethod: 'mean-slowest-1pct',
    runNonce: 'nonce-1',
    measuredAt: '2026-08-19T12:00:00.000Z',
    collectorVersion: '1.0.0',
    collectorBuildHash: 'build-abc',
    ...over,
  };
}

describe('a well-formed measured observation', () => {
  it('produces no errors', () => {
    const frames = goodFrames();
    expect(errors(validateMeasuredObservation(makeObservation(frames), frames))).toEqual([]);
  });
});

describe('the figures must be reproducible from the frames', () => {
  // The core property. A number that cannot be recomputed from the run's own
  // frames is a claim, not a measurement.
  it('rejects an averageFps that does not recompute', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames);
    obs.stats = { ...obs.stats, averageFps: obs.stats.averageFps + 5 };
    const rules = errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule);
    expect(rules).toContain('stats.averageFps-mismatch');
  });

  it('rejects a 1% low that does not recompute', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames);
    obs.stats = { ...obs.stats, onePercentLow: 999 };
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('stats.onePercentLow-mismatch');
  });

  it('rejects an observation with no frame-time evidence at all', () => {
    const rules = errors(validateMeasuredObservation(makeObservation(goodFrames()), [])).map((i) => i.rule);
    expect(rules).toContain('frametimes.absent');
  });

  it('rejects a frame count that disagrees with the frames supplied', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames);
    obs.frameTimes = { ...obs.frameTimes, frameCount: frames.length - 1 };
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('frametimes.count-mismatch');
  });
});

describe('the 1%-low method is pinned', () => {
  // A figure computed the other way is not comparable. It is rejected rather
  // than silently recomputed under our definition.
  it('rejects a record claiming the p99-frametime method', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { onePercentLowMethod: 'p99-frametime' });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('stats.method-not-pinned');
  });
});

describe('the community tier is defined but not ingested in V1', () => {
  it('rejects a community observation from the measured store', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { tier: 'community' });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('tier.not-accepted-in-v1');
  });
});

describe('run length minimums', () => {
  it('rejects a run that is too short to characterize performance', () => {
    const frames = Array.from({ length: 500 }, () => 10); // 5 seconds
    const obs = makeObservation(frames);
    const rules = errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule);
    expect(rules).toContain('run.too-short');
    expect(rules).toContain('run.too-few-frames');
  });
});

describe('conditions that make a run reproducible', () => {
  it.each([
    ['gpuDriverVersion', 'conditions.driver-missing'],
    ['osBuild', 'conditions.os-missing'],
    ['settingsHash', 'conditions.settings-hash-missing'],
  ])('rejects a record with no %s', (field, rule) => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { [field]: '' } as Partial<MeasuredObservation>);
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain(rule);
  });

  it('rejects a record with neither a game version nor a build id', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { gameVersion: undefined, gameBuildId: undefined });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('conditions.game-version-missing');
  });

  it('accepts a build id alone, without a version string', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { gameVersion: undefined, gameBuildId: 'build-99887' });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).not.toContain('conditions.game-version-missing');
  });

  it('rejects hardware that did not resolve to catalog ids', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { gpuId: '' });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('hardware.unresolved');
  });
});

describe('frame generation', () => {
  // FG frames are displayed, not rendered. Without a factor the figure cannot
  // be related to a native one at all.
  it('rejects frameGeneration without a factor', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { frameGeneration: true, frameGenerationFactor: undefined });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('framegen.factor-missing');
  });

  it('accepts frameGeneration when the factor is stated', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { frameGeneration: true, frameGenerationFactor: 2 });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).not.toContain('framegen.factor-missing');
  });
});

describe('feature support cross-check', () => {
  const profile: GameFeatureProfile = {
    gameId: 'marvel-rivals',
    name: 'Marvel Rivals',
    dlss: { status: 'unsupported' },
    fsr: { status: 'supported' },
    xess: { status: 'unknown' },
    frameGeneration: { status: 'unknown' },
    rayTracing: { status: 'supported' },
  };

  it('rejects a run using a feature the game is confirmed not to support', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { upscaler: 'dlss', upscalerMode: 'quality' });
    expect(errors(validateMeasuredObservation(obs, frames, [profile])).map((i) => i.rule)).toContain('features.contradicts-profile');
  });

  // 'unknown' means unverified, not broken — it must never be presumed
  // unsupported, matching how the source-derived system already gates.
  it('does not reject a feature whose support is merely unverified', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { upscaler: 'xess', upscalerMode: 'quality' });
    expect(errors(validateMeasuredObservation(obs, frames, [profile])).map((i) => i.rule)).not.toContain('features.contradicts-profile');
  });
});

describe('disclosed conditions are warnings, not rejections', () => {
  it('warns on a capped run without rejecting it', () => {
    const frames = Array.from({ length: 8000 }, () => 1000 / 60);
    const obs = makeObservation(frames);
    const issues = validateMeasuredObservation(obs, frames);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain('run.capped');
  });

  it.each([
    [{ settingsSource: 'operator-attested' as const }, 'settings.operator-attested'],
    [{ renderScalePercent: 70 }, 'render-scale.non-native'],
    [{ ram: { totalGb: 16, channels: 1 } }, 'ram.single-channel'],
  ])('warns on %o without rejecting', (over, rule) => {
    const frames = goodFrames();
    const issues = validateMeasuredObservation(makeObservation(frames, over), frames);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain(rule);
  });

  it('warns on a detected overclock', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames);
    obs.detected = { ...obs.detected, gpuOverclockDetected: true };
    const issues = validateMeasuredObservation(obs, frames);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain('gpu.overclocked');
  });
});

describe('store-level checks', () => {
  it('rejects the same run recorded twice under one nonce', () => {
    const frames = goodFrames();
    const a = makeObservation(frames, { id: 'obs-a', runNonce: 'shared' });
    const b = makeObservation(frames, { id: 'obs-b', runNonce: 'shared' });
    const map = new Map([['obs-a', frames], ['obs-b', frames]]);
    expect(errors(validateMeasuredStore([a, b], map)).map((i) => i.rule)).toContain('run.duplicate-nonce');
  });

  it('rejects a duplicated observation id', () => {
    const frames = goodFrames();
    const a = makeObservation(frames, { id: 'dup', runNonce: 'n1' });
    const b = makeObservation(frames, { id: 'dup', runNonce: 'n2' });
    const map = new Map([['dup', frames]]);
    expect(errors(validateMeasuredStore([a, b], map)).map((i) => i.rule)).toContain('store.duplicate-id');
  });

  it('accepts distinct, well-formed observations', () => {
    const frames = goodFrames();
    const a = makeObservation(frames, { id: 'obs-a', runNonce: 'n1' });
    const b = makeObservation(frames, { id: 'obs-b', runNonce: 'n2' });
    const map = new Map([['obs-a', frames], ['obs-b', frames]]);
    expect(errors(validateMeasuredStore([a, b], map))).toEqual([]);
  });
});

describe('frame-time blob identity', () => {
  // Proves a blob is the one a record was computed from.
  it('accepts a matching hash and rejects a mismatched one', () => {
    const fakeSha = (s: string) => `len${s.length}`;
    expect(verifyFrameTimeHash([16.7, 8.3], 'len10', fakeSha)).toBe(true);
    expect(verifyFrameTimeHash([16.7, 8.3], 'wrong', fakeSha)).toBe(false);
  });
});
