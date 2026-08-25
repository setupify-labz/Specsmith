import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildObservation, CliInputError, collectorBuildHash, COLLECTOR_VERSION, DEFAULT_BUILD_HASH_FILES, frameGenerationFactor, numberInRange, oneOf, parseCaptureSelection, parseRunConditions, shouldPersistFrameTimes, validateAndSave, wholeNumberInRange, type CollectInputs } from './collect';
import { detectWindowsEnvironment, UnsupportedPlatformError, type DetectedHardware } from './environment';
import { loadCatalogs } from './catalog';
import { errors, validateMeasuredObservation, warnings, type MeasuredIssue } from '../../src/lib/measured/validate';
import { computeFrameTimeStats } from '../../src/lib/measured/frameTimes';
import { MEASURED_PRESETS, RESOLUTIONS, UPSCALERS, type CaptureToolProvenance } from '../../src/lib/measured/types';
import type { GameFeatureProfile } from '../../src/lib/benchmarks/types';

// Frame times here are SYNTHETIC, used to exercise assembly and the save gate.
// They are not a measurement of anything and never reach the committed store —
// every test writes to a temp file.

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const build = (over: Partial<CollectInputs> = {}, f = frames(), captureTool?: CaptureToolProvenance) =>
  buildObservation({
    frameTimesMs: f,
    hardware,
    inputs: inputs(over),
    frameTimeRef: { sha256: 'abc', frameCount: f.length, encoding: 'json-array-ms', compression: 'gzip', storagePath: 'ab/abc.json.gz', compressedByteLength: 100 },
    measuredAt: '2026-08-19T12:00:00.000Z',
    runNonce: '11111111-2222-3333-4444-555555555555',
    buildHash: 'buildhash',
    captureTool,
  });

const capturedByPresentMon: CaptureToolProvenance = { name: 'PresentMon.exe', sha256: 'a'.repeat(64), pinned: true };

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
      'captureTool',
      'detected.gpuOverclockDetected',
      'ram.channels',
      'settingsHash',
    ]);
    for (const g of gaps) {
      expect(g.reason.length).toBeGreaterThan(20);
    }
  });

  it('marks the fixed, platform-level gaps as operator-supplied', () => {
    const fixed = build().detectionGaps.filter((g) => g.field !== 'captureTool');
    for (const g of fixed) expect(g.resolution).toBe('operator-supplied');
  });

  // Unlike the fixed platform gaps above, whether captureTool is known
  // depends on THIS run: a --capture-* run resolves it, a --csv run cannot,
  // because nothing about a hand-taken capture says what tool produced it.
  // Nobody can supply it after the fact, so it is 'unresolved', not
  // 'operator-supplied'.
  it('marks a missing capture tool as unresolved, not operator-suppliable', () => {
    const gap = build().detectionGaps.find((g) => g.field === 'captureTool');
    expect(gap?.resolution).toBe('unresolved');
  });

  it('records no capture-tool gap when the collector ran the capture itself', () => {
    const gaps = build({}, frames(), capturedByPresentMon).detectionGaps;
    expect(gaps.map((g) => g.field)).not.toContain('captureTool');
  });

  it('carries the capture tool onto the observation verbatim, when supplied', () => {
    expect(build({}, frames(), capturedByPresentMon).captureTool).toEqual(capturedByPresentMon);
  });

  it('leaves captureTool unset — not a fabricated value — for a --csv run', () => {
    expect(build().captureTool).toBeUndefined();
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

  // The store-boundary half of the merge blocker: buildObservation() alone
  // accepts any gpuId/cpuId — it has no opinion about whether they match the
  // detected hardware, because assembly is not where that gets decided.
  // validateAndSave() is what every caller capable of writing to the store
  // funnels through, so THIS is where a bypass must be caught. These tests
  // construct an observation the way a non-CLI caller could — buildObservation
  // called directly, skipping catalog.ts's resolveHardware() entirely — to
  // prove the save-gate catches it anyway.
  describe('hardware attribution cannot be bypassed at the store boundary', () => {
    const catalogs = loadCatalogs();
    const idCatalogs = { gameIds: catalogs.gameIds, gpus: catalogs.gpus, cpus: catalogs.cpus };

    const bypassObservation = (over: { gpuRaw?: string; cpuRaw?: string; gpuId?: string; cpuId?: string }) => {
      const f = frames();
      const hw: DetectedHardware = {
        ...hardware,
        gpuRaw: over.gpuRaw ?? 'NVIDIA GeForce RTX 5070',
        cpuRaw: over.cpuRaw ?? 'AMD Ryzen 5 5600X 6-Core Processor',
      };
      const obs = buildObservation({
        frameTimesMs: f,
        hardware: hw,
        // gameId overridden to a real catalog id — idCatalogs below uses the
        // real game catalog too, and the default 'marvel-rivals' test fixture id
        // is not in it.
        inputs: inputs({ gameId: 'cs2', gpuId: over.gpuId ?? 'rtx5070', cpuId: over.cpuId ?? 'r5-5600x' }),
        frameTimeRef: { sha256: 'abc', frameCount: f.length, encoding: 'json-array-ms', compression: 'gzip', storagePath: 'ab/abc.json.gz', compressedByteLength: 100 },
        measuredAt: '2026-08-19T12:00:00.000Z',
        runNonce: '11111111-2222-3333-4444-555555555555',
        buildHash: 'buildhash',
      });
      return { obs, f };
    };

    it('accepts a save when gpuId/cpuId genuinely match the detected hardware', () => {
      const p = tempStore();
      const { obs, f } = bypassObservation({});
      const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
      expect(outcome.saved).toBe(true);
    });

    // The exact scenario the audit named: detected RTX 5070, claimed rtx4090.
    it('rejects a save where a detected RTX 5070 is paired with gpuId rtx4090', () => {
      const p = tempStore();
      const { obs, f } = bypassObservation({ gpuId: 'rtx4090' });
      const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
      expect(outcome.saved).toBe(false);
      expect(errors(outcome.issues).map((i) => i.rule)).toContain('hardware.gpu-attribution-mismatch');
      expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(0);
    });

    // The analogous CPU mismatch: detected Ryzen 5 5600X, claimed r9-9950x.
    it('rejects a save where a detected Ryzen 5 5600X is paired with cpuId r9-9950x', () => {
      const p = tempStore();
      const { obs, f } = bypassObservation({ cpuId: 'r9-9950x' });
      const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
      expect(outcome.saved).toBe(false);
      expect(errors(outcome.issues).map((i) => i.rule)).toContain('hardware.cpu-attribution-mismatch');
      expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(0);
    });

    // Regression: the store-boundary check originally re-resolved the detected
    // name WITHOUT the claimed id, so a genuinely ambiguous real card threw on
    // ambiguity before the claimed id was ever consulted — rejecting an
    // observation the CLI itself would have accepted via --gpu-id. The real
    // catalog carries both memory variants under this exact detected string.
    describe('a legitimately ambiguous real card, resolved by the claimed id', () => {
      it('confirms the catalog actually carries the ambiguous pair this test relies on', () => {
        const names = catalogs.gpus.filter((g) => g.name.startsWith('RTX 4060 Ti')).map((g) => g.id);
        expect(names.sort()).toEqual(['rtx4060ti', 'rtx4060ti16']);
      });

      // 1. The exact scenario reported: CLI correctly accepts --gpu-id
      // rtx4060ti16 for a detected "NVIDIA GeForce RTX 4060 Ti"; the store
      // must save it, not reject it as unresolvable.
      it('accepts a save where a detected RTX 4060 Ti is paired with the claimed 16GB id', () => {
        const p = tempStore();
        const { obs, f } = bypassObservation({ gpuRaw: 'NVIDIA GeForce RTX 4060 Ti', gpuId: 'rtx4060ti16' });
        const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
        expect(outcome.saved).toBe(true);
        expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(1);
      });

      it('accepts the 8GB candidate just as validly', () => {
        const p = tempStore();
        const { obs, f } = bypassObservation({ gpuRaw: 'NVIDIA GeForce RTX 4060 Ti', gpuId: 'rtx4060ti' });
        const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
        expect(outcome.saved).toBe(true);
      });

      // 2. Passing the claimed id as the resolver's disambiguator must not
      // weaken the check for hardware it cannot possibly mean.
      it('still rejects an unrelated id neither ambiguous candidate supports', () => {
        const p = tempStore();
        const { obs, f } = bypassObservation({ gpuRaw: 'NVIDIA GeForce RTX 4060 Ti', gpuId: 'rtx4090' });
        const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
        expect(outcome.saved).toBe(false);
        expect(errors(outcome.issues).map((i) => i.rule)).toContain('hardware.gpu-attribution-mismatch');
        expect(JSON.parse(fs.readFileSync(p, 'utf-8')).observations).toHaveLength(0);
      });

      // 3. The original mismatch case must still be rejected after this fix.
      it('still rejects a detected RTX 5070 paired with gpuId rtx4090', () => {
        const p = tempStore();
        const { obs, f } = bypassObservation({ gpuId: 'rtx4090' });
        const outcome = validateAndSave(obs, f, p, [], undefined, idCatalogs);
        expect(outcome.saved).toBe(false);
        expect(errors(outcome.issues).map((i) => i.rule)).toContain('hardware.gpu-attribution-mismatch');
      });
    });
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

// The frame-time archive is a side effect on the operator's own disk. It is
// tied to the run being RECORDED, not merely processed, so that "nothing was
// written" is true when the collector says it and a rejected run leaves
// nothing behind that could later be mistaken for accepted evidence.
describe('when frames are archived', () => {
  const clean: MeasuredIssue[] = [];
  const withWarning: MeasuredIssue[] = [
    { severity: 'warning', rule: 'settings.operator-attested', message: 'attested', observationId: 'x' },
  ];
  const withError: MeasuredIssue[] = [
    { severity: 'error', rule: 'conditions.game-version-missing', message: 'missing', observationId: 'x' },
  ];

  it('archives a run that is being saved', () => {
    expect(shouldPersistFrameTimes(false, clean)).toBe(true);
  });

  it('archives nothing on a dry run, however clean', () => {
    expect(shouldPersistFrameTimes(true, clean)).toBe(false);
  });

  it('archives nothing for a run validation rejects', () => {
    expect(shouldPersistFrameTimes(false, withError)).toBe(false);
  });

  it('still archives a run that only raised warnings, since that run is saved', () => {
    expect(shouldPersistFrameTimes(false, withWarning)).toBe(true);
  });
});

// TypeScript's unions vanish at runtime, so the collector used to cast CLI
// strings straight to Resolution/Preset/Upscaler. These helpers are the check
// that cast never was.
describe('CLI values are checked, not cast', () => {
  it('accepts a value the schema defines', () => {
    expect(oneOf('1440p', RESOLUTIONS, 'resolution')).toBe('1440p');
    expect(oneOf('unmapped', MEASURED_PRESETS, 'preset')).toBe('unmapped');
    expect(oneOf('dlss', UPSCALERS, 'upscaler')).toBe('dlss');
  });

  it('refuses one it does not, and says what is accepted', () => {
    expect(() => oneOf('1440', RESOLUTIONS, 'resolution')).toThrow(CliInputError);
    expect(() => oneOf('1440', RESOLUTIONS, 'resolution')).toThrow(/1080p, 1440p, 4k/);
    expect(() => oneOf('hihg', MEASURED_PRESETS, 'preset')).toThrow(CliInputError);
    expect(() => oneOf('DLSS', UPSCALERS, 'upscaler')).toThrow(CliInputError);
  });

  it('refuses a number that is not one', () => {
    expect(() => numberInRange('sixty', 'render-scale', 1, 400)).toThrow(/is not a number/);
    expect(() => numberInRange('', 'render-scale', 1, 400)).toThrow(CliInputError);
  });

  it('refuses a number outside its range', () => {
    expect(() => numberInRange('0', 'render-scale', 1, 400)).toThrow(/between 1 and 400/);
    expect(() => numberInRange('5000', 'render-scale', 1, 400)).toThrow(CliInputError);
    expect(numberInRange('150', 'render-scale', 1, 400)).toBe(150);
  });
});

// Hardware attribution is derived from the machine, so the record must say so
// rather than claiming an operator verified it.
describe('how the hardware attribution was reached', () => {
  it('records the method the resolver reported', () => {
    const obs = build({ gpuMatchMethod: 'normalized', cpuMatchMethod: 'exact' });
    expect(obs.detected.gpuMatchMethod).toBe('normalized');
    expect(obs.detected.cpuMatchMethod).toBe('exact');
  });

  it('keeps the raw detected names beside the ids, so the two can be compared', () => {
    const obs = build();
    expect(obs.detected.gpuRaw).toBe('NVIDIA GeForce RTX 4070');
    expect(obs.detected.cpuRaw).toBe('AMD Ryzen 7 7800X3D 8-Core Processor');
  });
});

describe('parsing a whole command line', () => {
  const argv = (over: string[] = []) => [
    '--game-id', 'cs2', '--resolution', '1440p', '--preset', 'high',
    '--ram-channels', '2', '--settings-file', os.devNull, ...over,
  ];

  it('reads a valid command line', () => {
    const r = parseRunConditions(argv());
    expect(r.gameId).toBe('cs2');
    expect(r.resolution).toBe('1440p');
    expect(r.preset).toBe('high');
    expect(r.upscaler).toBe('native');
    expect(r.renderScalePercent).toBe(100);
    expect(r.frameGenerationFactor).toBeUndefined();
  });

  it('checks the game id against the catalog when one is supplied', () => {
    expect(() => parseRunConditions(argv(), ['cs2'])).not.toThrow();
    expect(() => parseRunConditions(argv(), ['fortnite'])).toThrow(/not in the SpecSmith game catalog/);
  });

  // The trap this guards: `--preset --dry-run` used to set preset to the
  // literal string "--dry-run", which type-checks as a Preset.
  it('refuses a flag whose value is the next flag', () => {
    const bad = ['--game-id', 'cs2', '--resolution', '1440p', '--preset', '--dry-run', '--ram-channels', '2', '--settings-file', os.devNull];
    expect(() => parseRunConditions(bad)).toThrow(CliInputError);
    expect(() => parseRunConditions(bad)).toThrow(/needs a value/);
  });

  it('refuses a flag given twice rather than silently taking the first', () => {
    expect(() => parseRunConditions(argv(['--resolution', '1080p']))).toThrow(/more than once/);
  });

  it('refuses a missing required flag', () => {
    expect(() => parseRunConditions(['--resolution', '1440p'])).toThrow(/Missing required --game-id/);
  });

  it('refuses a fractional channel count', () => {
    const fractional = ['--game-id', 'cs2', '--resolution', '1440p', '--preset', 'high', '--ram-channels', '2.5', '--settings-file', os.devNull];
    expect(() => parseRunConditions(fractional)).toThrow(/whole number/);
    expect(wholeNumberInRange('2', 'ram-channels', 1, 8)).toBe(2);
  });

  it('refuses a frame-generation factor that describes a native run', () => {
    expect(() => frameGenerationFactor('1')).toThrow(/native run/);
    expect(() => frameGenerationFactor('0.5')).toThrow(CliInputError);
    expect(frameGenerationFactor('2')).toBe(2);
  });
});

// Regression: a real capture of Red Dead Redemption 2 needed to validate
// against the collector, and the question was whether the SpecSmith catalog
// carried it under a canonical id. It already did — 'rdr2' was present in
// both games.json (the CLI's --game-id whitelist) and gameFeatureProfiles.json
// (what validateMeasuredObservation consults for preset/upscaler
// compatibility) before this test was written. No catalog file was changed
// for this; the test exists so that stays true.
describe('the real catalog already supports Red Dead Redemption 2', () => {
  const catalogs = loadCatalogs();

  it('carries gameId "rdr2" in the CLI\'s --game-id whitelist', () => {
    expect(catalogs.gameIds).toContain('rdr2');
  });

  it('accepts --game-id rdr2 on a full command line', () => {
    const argv = [
      '--game-id', 'rdr2', '--resolution', '1440p', '--preset', 'high',
      '--ram-channels', '2', '--settings-file', os.devNull,
    ];
    const r = parseRunConditions(argv, catalogs.gameIds);
    expect(r.gameId).toBe('rdr2');
  });

  it('has a gameFeatureProfiles.json entry, so preset/upscaler compatibility checks run against real data rather than silently finding no profile', () => {
    const profiles = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'src', 'data', 'gameFeatureProfiles.json'), 'utf-8'),
    ) as GameFeatureProfile[];
    const profile = profiles.find((p) => p.gameId === 'rdr2');
    expect(profile).toBeDefined();
    expect(profile?.name).toBe('Red Dead Redemption 2');
  });
});

// Provenance: collectorBuildHash claims two observations sharing its value
// were produced by identical code. That claim was false the moment attribution
// (catalog.ts, and the resolver it now re-exports from hardwareMatch.ts),
// frame-time interpretation and statistics (frameTimes.ts), or
// validation/schema semantics (validate.ts, types.ts) could change without the
// hash moving — all four determine what a saved figure MEANS, and none of
// them were being hashed.
describe('collector build identity', () => {
  it('covers hardware attribution, frame-time interpretation, statistics and validation semantics', () => {
    expect(DEFAULT_BUILD_HASH_FILES).toEqual(expect.arrayContaining([
      'collect.ts',
      'presentmon.ts',
      // The capture flags fix what the file CONTAINS — whether dropped
      // presents are in it, whether segmentation's columns exist — so they
      // determine what a saved figure means as directly as the parser does.
      'presentmonRunner.ts',
      'segmentation.ts',
      'environment.ts',
      'catalog.ts',
      '../../src/lib/measured/hardwareMatch.ts',
      '../../src/lib/measured/frameTimes.ts',
      '../../src/lib/measured/validate.ts',
      '../../src/lib/measured/types.ts',
    ]));
  });

  it('is deterministic — the same files produce the same digest every time', () => {
    expect(collectorBuildHash()).toBe(collectorBuildHash());
    expect(collectorBuildHash()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when a dependency file\'s content changes', () => {
    // Two directories holding byte-identical copies of the same file names —
    // standing in for the real dependency set without depending on the real
    // repository's current content, which is what makes this a test of the
    // MECHANISM rather than a snapshot of today's source.
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-hash-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'specsmith-hash-b-'));
    const names = ['collect.ts', 'hardwareMatch.ts', 'validate.ts'];
    for (const n of names) {
      fs.writeFileSync(path.join(dirA, n), `// ${n}, version 1`);
      fs.writeFileSync(path.join(dirB, n), `// ${n}, version 1`);
    }
    expect(collectorBuildHash(names, dirA)).toBe(collectorBuildHash(names, dirB));

    // Mutate ONE dependency, standing in for a change to validate.ts. The
    // other files are untouched; the identity must still move.
    fs.writeFileSync(path.join(dirB, 'validate.ts'), '// validate.ts, version 2');
    expect(collectorBuildHash(names, dirA)).not.toBe(collectorBuildHash(names, dirB));
  });
});

// The capture source decides where a measurement CAME FROM, which is the one
// thing about a record that cannot be re-derived later. A command line that
// says two different things about it, or nothing at all, is refused rather
// than resolved by precedence.
describe('choosing between reading a CSV and capturing one', () => {
  it('reads a CSV when --csv is given', () => {
    expect(parseCaptureSelection(['--csv', 'run.csv'])).toEqual({ mode: 'csv', csvPath: 'run.csv' });
  });

  it('captures when a target and a duration are given', () => {
    expect(parseCaptureSelection(['--capture-process-id', '4242', '--capture-seconds', '90'])).toEqual({
      mode: 'capture', processId: 4242, processName: undefined, seconds: 90,
    });
  });

  it('captures by process name too', () => {
    expect(parseCaptureSelection(['--capture-process-name', 'RDR2.exe', '--capture-seconds', '60'])).toEqual({
      mode: 'capture', processId: undefined, processName: 'RDR2.exe', seconds: 60,
    });
  });

  it('REFUSES a command line that both reads and captures', () => {
    expect(() => parseCaptureSelection(['--csv', 'run.csv', '--capture-seconds', '90'])).toThrow(CliInputError);
    expect(() => parseCaptureSelection(['--csv', 'run.csv', '--capture-process-id', '1'])).toThrow(/cannot be combined/);
  });

  it('refuses a command line that does neither', () => {
    expect(() => parseCaptureSelection(['--game-id', 'x'])).toThrow(/Nothing to measure/);
  });

  it('requires a duration when capturing', () => {
    expect(() => parseCaptureSelection(['--capture-process-id', '4242'])).toThrow(/--capture-seconds is required/);
  });

  // These reuse the collector's existing numeric flag validation rather than
  // adding a second, differently-behaved one.
  it('rejects a non-numeric or fractional duration', () => {
    expect(() => parseCaptureSelection(['--capture-process-id', '1', '--capture-seconds', 'ninety'])).toThrow(/not a number/);
    expect(() => parseCaptureSelection(['--capture-process-id', '1', '--capture-seconds', '90.5'])).toThrow(/whole number/);
  });

  it('rejects a duration outside the runner\'s bounds', () => {
    expect(() => parseCaptureSelection(['--capture-process-id', '1', '--capture-seconds', '1'])).toThrow(/between/);
    expect(() => parseCaptureSelection(['--capture-process-id', '1', '--capture-seconds', '99999'])).toThrow(/between/);
  });

  it('rejects a nonsense pid', () => {
    expect(() => parseCaptureSelection(['--capture-process-id', '0', '--capture-seconds', '30'])).toThrow(/between/);
    expect(() => parseCaptureSelection(['--capture-process-id', 'abc', '--capture-seconds', '30'])).toThrow(/not a number/);
  });
});
