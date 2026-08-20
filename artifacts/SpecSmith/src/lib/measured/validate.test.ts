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

// FIX 4: a failed memory read collapsed the probe's byte sum to 0, and no rule
// caught it — a record claiming 0 GB of RAM validated cleanly. Absent memory is
// a failed detection, not a machine with no memory.
describe('memory must have been read, not defaulted', () => {
  it('rejects a zero RAM total', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { ram: { totalGb: 0, channels: 2 } });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('ram.total-invalid');
  });

  it.each([[NaN], [-8], [undefined as unknown as number]])('rejects a RAM total of %s', (totalGb) => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { ram: { totalGb, channels: 2 } });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('ram.total-invalid');
  });

  it('rejects a zero or fractional channel count', () => {
    const frames = goodFrames();
    for (const channels of [0, -1, 1.5]) {
      const obs = makeObservation(frames, { ram: { totalGb: 32, channels } });
      expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('ram.channels-invalid');
    }
  });

  // Single-channel is a real, valid configuration — it warns, it does not fail.
  it('accepts a real single-channel machine, warning rather than rejecting', () => {
    const frames = goodFrames();
    const issues = validateMeasuredObservation(makeObservation(frames, { ram: { totalGb: 16, channels: 1 } }), frames);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain('ram.single-channel');
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

  // The reverse contradiction. A reader trusting frameGeneration would report
  // native rendering; a reader trusting the factor would apply a
  // displayed-to-rendered ratio to a stat that was never inflated. Both
  // readings are live in a hand-built record, so both directions are checked.
  it('rejects a factor when frameGeneration is explicitly false', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { frameGeneration: false, frameGenerationFactor: 2 });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('framegen.factor-without-frame-generation');
  });

  it('accepts frameGeneration false with no factor, the ordinary native case', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { frameGeneration: false, frameGenerationFactor: undefined });
    const rules = errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule);
    expect(rules).not.toContain('framegen.factor-without-frame-generation');
    expect(rules).not.toContain('framegen.factor-missing');
  });

  it('rejects both directions of the contradiction, never just one', () => {
    // frameGeneration true, factor missing: covered above. frameGeneration
    // false, factor set: covered above. This confirms the two rules do not
    // overlap into a gap — every combination of the boolean and undefined-ness
    // is checked.
    const frames = goodFrames();
    const cases: Array<[boolean, number | undefined, string | null]> = [
      [true, undefined, 'framegen.factor-missing'],
      [true, 2, null],
      [false, 2, 'framegen.factor-without-frame-generation'],
      [false, undefined, null],
    ];
    for (const [frameGeneration, frameGenerationFactor, expectedRule] of cases) {
      const obs = makeObservation(frames, { frameGeneration, frameGenerationFactor });
      const rules = errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule);
      if (expectedRule) expect(rules).toContain(expectedRule);
      else {
        expect(rules).not.toContain('framegen.factor-missing');
        expect(rules).not.toContain('framegen.factor-without-frame-generation');
      }
    }
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

// Roblox is the case that forced these rules. It has no preset tiers — only a
// Manual 1-10 slider — and it is a platform, not a game: two runs of "Roblox"
// can be unrelated experiences with different performance. The first real
// capture was run with `--preset high`, which is a cross-game equivalence
// nothing supports.
describe('games with no comparable preset tier', () => {
  it('accepts preset "unmapped" when the verbatim setting is recorded', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { preset: 'unmapped', presetLabel: 'Graphics Quality: Manual 8' });
    expect(errors(validateMeasuredObservation(obs, frames))).toEqual([]);
  });

  // Without the label the run carries no description of its settings at all,
  // which is worse than a forced bucket rather than better.
  it('rejects "unmapped" with no presetLabel', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { preset: 'unmapped', presetLabel: undefined });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('preset.unmapped-without-label');
  });

  it('rejects a whitespace-only presetLabel', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { preset: 'unmapped', presetLabel: '   ' });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('preset.unmapped-without-label');
  });

  // The normalized tiers must keep working exactly as before for games that
  // genuinely have them.
  it('leaves normalized presets unaffected', () => {
    const frames = goodFrames();
    for (const preset of ['low', 'medium', 'high', 'ultra', 'extreme'] as const) {
      expect(errors(validateMeasuredObservation(makeObservation(frames, { preset }), frames))).toEqual([]);
    }
  });
});

describe('platform games', () => {
  const roblox = { platform: 'roblox', contentId: '920587237', contentName: 'Adopt Me!' };

  it('accepts a platform run identified by its content id', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { platformContent: { ...roblox, contentVersion: '412' } });
    expect(errors(validateMeasuredObservation(obs, frames))).toEqual([]);
  });

  // The client version does not identify what was rendered.
  it('rejects a platform run with no content id', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { platformContent: { platform: 'roblox', contentId: '' } });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('platform.content-id-missing');
  });

  it('rejects a platform block that names no platform', () => {
    const frames = goodFrames();
    const obs = makeObservation(frames, { platformContent: { platform: '', contentId: '123' } });
    expect(errors(validateMeasuredObservation(obs, frames)).map((i) => i.rule)).toContain('platform.name-missing');
  });

  // Roblox creators publish continuously with no player-visible version, so an
  // absent content version is disclosed rather than treated as a fault.
  it('warns, without rejecting, when the platform exposes no content version', () => {
    const frames = goodFrames();
    const issues = validateMeasuredObservation(makeObservation(frames, { platformContent: roblox }), frames);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.rule)).toContain('platform.content-version-unavailable');
  });

  it('does not warn when a content version genuinely exists', () => {
    const frames = goodFrames();
    const issues = validateMeasuredObservation(makeObservation(frames, { platformContent: { ...roblox, contentVersion: '412' } }), frames);
    expect(warnings(issues).map((i) => i.rule)).not.toContain('platform.content-version-unavailable');
  });

  // Ordinary single games must be unaffected.
  it('leaves non-platform observations alone', () => {
    const frames = goodFrames();
    const issues = validateMeasuredObservation(makeObservation(frames), frames);
    expect(issues.map((i) => i.rule).filter((r) => r.startsWith('platform.'))).toEqual([]);
  });
});

// The unions in types.ts are erased at runtime, so a CLI string cast to
// `Resolution` type-checks and travels straight into the store. These rules
// are what actually stops that.
describe('run-condition field values are checked at runtime', () => {
  const bad = (over: Record<string, unknown>) => {
    const f = goodFrames();
    const obs = { ...makeObservation(f), ...over } as unknown as MeasuredObservation;
    return validateMeasuredObservation(obs, f).map((i) => i.rule);
  };

  it('accepts a well-formed observation', () => {
    const f = goodFrames();
    const rules = validateMeasuredObservation(makeObservation(f), f).filter((i) => i.severity === 'error');
    expect(rules).toEqual([]);
  });

  it('rejects a resolution outside the accepted set', () => {
    expect(bad({ resolution: '1440' })).toContain('fields.resolution-invalid');
    expect(bad({ resolution: '' })).toContain('fields.resolution-invalid');
  });

  it('rejects a misspelled preset', () => {
    expect(bad({ preset: 'hihg' })).toContain('fields.preset-invalid');
  });

  it('accepts every preset the schema defines, including unmapped', () => {
    for (const p of ['low', 'medium', 'high', 'ultra', 'extreme']) {
      expect(bad({ preset: p })).not.toContain('fields.preset-invalid');
    }
  });

  it('rejects an unknown upscaler', () => {
    expect(bad({ upscaler: 'dlss4' })).toContain('fields.upscaler-invalid');
  });

  it('rejects a render scale that is not a usable number', () => {
    for (const v of [0, -50, Number.NaN, 'sixty', 10000]) {
      expect(bad({ renderScalePercent: v })).toContain('fields.render-scale-invalid');
    }
  });

  it('allows supersampling above 100%', () => {
    expect(bad({ renderScalePercent: 150 })).not.toContain('fields.render-scale-invalid');
  });

  it('rejects a frame-generation factor that is not frame generation', () => {
    // A factor of 1 means every displayed frame was rendered — the record
    // would claim FG while describing a native run.
    expect(bad({ frameGenerationFactor: 1 })).toContain('fields.framegen-factor-invalid');
    expect(bad({ frameGenerationFactor: 0 })).toContain('fields.framegen-factor-invalid');
    expect(bad({ frameGenerationFactor: Number.NaN })).toContain('fields.framegen-factor-invalid');
  });

  it('leaves an absent frame-generation factor alone', () => {
    expect(bad({ frameGenerationFactor: undefined })).not.toContain('fields.framegen-factor-invalid');
  });

  it('rejects an empty identifier', () => {
    expect(bad({ gameId: '' })).toContain('fields.game-id-missing');
    expect(bad({ gpuId: '   ' })).toContain('fields.gpu-id-missing');
    expect(bad({ cpuId: undefined })).toContain('fields.cpu-id-missing');
  });
});

describe('catalog membership, when the caller supplies the catalogs', () => {
  const check = (over: Record<string, unknown>, catalogs: Parameters<typeof validateMeasuredObservation>[3]) => {
    const f = goodFrames();
    const obs = { ...makeObservation(f), ...over } as unknown as MeasuredObservation;
    return validateMeasuredObservation(obs, f, [], catalogs).map((i) => i.rule);
  };
  // gpus/cpus deliberately name the SAME parts makeObservation's default
  // detected.gpuRaw/cpuRaw resolve to, so a membership-only test does not
  // incidentally also trip the attribution rule below.
  const known = {
    gameIds: ['cs2'],
    gpus: [{ id: 'rtx4070', name: 'RTX 4070' }],
    cpus: [{ id: 'r7-7800x3d', name: 'Ryzen 7 7800X3D' }],
  };

  it('accepts ids that exist', () => {
    const rules = check({ gameId: 'cs2', gpuId: 'rtx4070', cpuId: 'r7-7800x3d' }, known);
    expect(rules).not.toContain('fields.game-id-unknown');
    expect(rules).not.toContain('fields.gpu-id-unknown');
    expect(rules).not.toContain('fields.cpu-id-unknown');
  });

  it('rejects an id that names nothing', () => {
    expect(check({ gameId: 'halflife3' }, known)).toContain('fields.game-id-unknown');
    expect(check({ gpuId: 'rtx9090' }, known)).toContain('fields.gpu-id-unknown');
    expect(check({ cpuId: 'ryzen-1000x' }, known)).toContain('fields.cpu-id-unknown');
  });

  it('checks nothing when no catalogs are supplied, so the shape rules stay usable alone', () => {
    expect(check({ gameId: 'halflife3' }, {})).not.toContain('fields.game-id-unknown');
  });
});

// The store-boundary half of the merge blocker: catalog MEMBERSHIP above only
// proves gpuId/cpuId names something real. It does not prove the DETECTED
// hardware can legitimately mean it. This re-derives attribution with the
// same resolver the CLI uses and requires it to agree with the record.
describe('hardware attribution is re-derived, not merely checked for existence', () => {
  const check = (over: Record<string, unknown>, catalogs: Parameters<typeof validateMeasuredObservation>[3]) => {
    const f = goodFrames();
    const obs = { ...makeObservation(f), ...over } as unknown as MeasuredObservation;
    return validateMeasuredObservation(obs, f, [], catalogs).map((i) => i.rule);
  };
  const catalogs = {
    gpus: [
      { id: 'rtx5070', name: 'RTX 5070' },
      { id: 'rtx4090', name: 'RTX 4090' },
    ],
    cpus: [
      { id: 'r5-5600x', name: 'Ryzen 5 5600X' },
      { id: 'r9-9950x', name: 'Ryzen 9 9950X' },
    ],
  };

  it('accepts an id that matches what the detected hardware resolves to', () => {
    const rules = check(
      { gpuId: 'rtx5070', cpuId: 'r5-5600x', detected: { gpuRaw: 'NVIDIA GeForce RTX 5070', cpuRaw: 'AMD Ryzen 5 5600X 6-Core Processor', gpuMatchMethod: 'normalized', cpuMatchMethod: 'normalized', gpuOverclockDetected: false } },
      catalogs,
    );
    expect(rules).not.toContain('hardware.gpu-attribution-mismatch');
    expect(rules).not.toContain('hardware.cpu-attribution-mismatch');
  });

  // The exact scenario the audit named: a detected RTX 5070 paired with the
  // catalog id for an unrelated card.
  it('rejects a detected RTX 5070 paired with gpuId rtx4090', () => {
    const rules = check(
      { gpuId: 'rtx4090', cpuId: 'r5-5600x', detected: { gpuRaw: 'NVIDIA GeForce RTX 5070', cpuRaw: 'AMD Ryzen 5 5600X 6-Core Processor', gpuMatchMethod: 'manual', cpuMatchMethod: 'normalized', gpuOverclockDetected: false } },
      catalogs,
    );
    expect(rules).toContain('hardware.gpu-attribution-mismatch');
  });

  // The analogous CPU case: a detected Ryzen 5 5600X paired with the catalog
  // id for a Ryzen 9 9950X.
  it('rejects a detected Ryzen 5 5600X paired with cpuId r9-9950x', () => {
    const rules = check(
      { gpuId: 'rtx5070', cpuId: 'r9-9950x', detected: { gpuRaw: 'NVIDIA GeForce RTX 5070', cpuRaw: 'AMD Ryzen 5 5600X 6-Core Processor', gpuMatchMethod: 'normalized', cpuMatchMethod: 'manual', gpuOverclockDetected: false } },
      catalogs,
    );
    expect(rules).toContain('hardware.cpu-attribution-mismatch');
  });

  it('rejects a claimed id the detected hardware cannot resolve to anything', () => {
    const rules = check(
      { gpuId: 'rtx5070', detected: { gpuRaw: 'NVIDIA GeForce RTX 3060 Laptop GPU', cpuRaw: 'AMD Ryzen 5 5600X 6-Core Processor', gpuMatchMethod: 'manual', cpuMatchMethod: 'normalized', gpuOverclockDetected: false } },
      { ...catalogs, cpus: catalogs.cpus },
    );
    expect(rules).toContain('hardware.gpu-attribution-unresolvable');
  });

  it('does nothing when the caller supplies no catalogs, so shape-only validation still works', () => {
    const rules = check({ gpuId: 'rtx4090' }, {});
    expect(rules).not.toContain('hardware.gpu-attribution-mismatch');
    expect(rules).not.toContain('hardware.gpu-attribution-unresolvable');
  });
});
