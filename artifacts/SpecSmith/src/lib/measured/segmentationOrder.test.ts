import { describe, expect, it } from 'vitest';
import { computeFrameTimeStats } from './frameTimes';
import { errors, validateMeasuredObservation } from './validate';
import type { MeasuredObservation } from './types';

function goodFrames(): number[] {
  return Array.from({ length: 8000 }, (_, i) => 8 + (i % 40) * 0.35);
}

function makeRdr2Observation(
  frames: number[],
  stages: MeasuredObservation['segmentation'] extends infer S
    ? S extends { stages: infer T }
      ? T
      : never
    : never,
): MeasuredObservation {
  return {
    id: 'obs-segmentation-order',
    tier: 'measured',
    gameId: 'rdr2',
    cpuId: 'cpu-1',
    gpuId: 'gpu-1',
    ram: { totalGb: 32, channels: 2, ratedSpeedMts: 6000 },
    detected: {
      gpuRaw: 'NVIDIA GeForce RTX 4070',
      cpuRaw: 'AMD Ryzen 7 7800X3D',
      gpuMatchMethod: 'exact',
      cpuMatchMethod: 'exact',
      gpuOverclockDetected: false,
    },
    gameVersion: '1.0.0',
    gpuDriverVersion: '566.36',
    osBuild: 'Windows 11 26100.2314',
    resolution: '1440p',
    renderScalePercent: 100,
    preset: 'ultra',
    settingsSource: 'config-parsed',
    settingsHash: 'settings-hash',
    rayTracing: false,
    upscaler: 'native',
    frameGeneration: false,
    frameTimes: {
      sha256: 'deadbeef',
      frameCount: frames.length,
      encoding: 'json-array-ms',
      compression: 'gzip',
      storagePath: 'de/deadbeef.json.gz',
      compressedByteLength: 1234,
    },
    stats: computeFrameTimeStats(frames),
    onePercentLowMethod: 'mean-slowest-1pct',
    runNonce: 'nonce-segmentation-order',
    measuredAt: '2026-08-21T12:00:00.000Z',
    collectorVersion: '1.0.0',
    collectorBuildHash: 'build-abc',
    segmentation: {
      protocolId: 'rdr2-builtin-benchmark',
      protocolVersion: '1.0.0',
      stages,
      sourceSha256: 'source-sha',
      retainedSha256: 'deadbeef',
      totalFrames: frames.length,
      retainedFrames: frames.length,
    },
  };
}

describe('measured segmentation protocol ordering', () => {
  it('accepts the registered RDR2 stage order', () => {
    const frames = goodFrames();
    const obs = makeRdr2Observation(frames, ['presentation-path-v1', 'gpu-utilization-v1']);
    const rules = errors(validateMeasuredObservation(obs, frames)).map((issue) => issue.rule);
    expect(rules).not.toContain('segmentation.stage-order-invalid');
    expect(rules).not.toContain('segmentation.duplicate-stage');
  });

  it('rejects the same permitted stages when their order is reversed', () => {
    const frames = goodFrames();
    const obs = makeRdr2Observation(frames, ['gpu-utilization-v1', 'presentation-path-v1']);
    const rules = errors(validateMeasuredObservation(obs, frames)).map((issue) => issue.rule);
    expect(rules).toContain('segmentation.stage-order-invalid');
  });

  it('rejects duplicate stages instead of treating them as a valid protocol run', () => {
    const frames = goodFrames();
    const obs = makeRdr2Observation(frames, ['presentation-path-v1', 'presentation-path-v1']);
    const rules = errors(validateMeasuredObservation(obs, frames)).map((issue) => issue.rule);
    expect(rules).toContain('segmentation.duplicate-stage');
  });
});
