import { describe, it, expect } from 'vitest';
import {
  AmbiguousAdapterError,
  detectExecutableVersion,
  isRenderingAdapter,
  selectAdapter,
  type VideoAdapter,
} from './environment';

const adapter = (name: string, driverVersion = '32.0.15.6636'): VideoAdapter => ({
  name, driverVersion, pnpDeviceId: `PCI\\VEN_XXXX&DEV_YYYY\\${name}`,
});

// FIX 1: adapter selection. `Select-Object -First 1` silently returned whichever
// adapter Windows enumerated first, which on any machine with integrated
// graphics can be the iGPU — and since the driver version is read from the same
// object, BOTH fields would have been wrong together, with no error.
describe('GPU adapter selection', () => {
  it('uses the single rendering adapter when there is only one', () => {
    expect(selectAdapter([adapter('NVIDIA GeForce RTX 4070')]).name).toBe('NVIDIA GeForce RTX 4070');
  });

  it('ignores virtual and fallback display devices', () => {
    const chosen = selectAdapter([
      adapter('Microsoft Basic Display Adapter'),
      adapter('NVIDIA GeForce RTX 4070'),
    ]);
    expect(chosen.name).toBe('NVIDIA GeForce RTX 4070');
  });

  // The exact scenario the old code got wrong.
  it('REFUSES to guess between an iGPU and a discrete card', () => {
    const adapters = [adapter('Intel(R) UHD Graphics 770'), adapter('NVIDIA GeForce RTX 4070')];
    expect(() => selectAdapter(adapters)).toThrow(AmbiguousAdapterError);
    expect(() => selectAdapter(adapters)).toThrow(/--gpu-name/);
    // The message must name both, or the operator cannot act on it.
    expect(() => selectAdapter(adapters)).toThrow(/Intel\(R\) UHD Graphics 770/);
    expect(() => selectAdapter(adapters)).toThrow(/NVIDIA GeForce RTX 4070/);
  });

  it('never silently returns the first adapter when several are plausible', () => {
    const adapters = [adapter('AMD Radeon RX 7900 XTX'), adapter('AMD Radeon Graphics')];
    let picked: VideoAdapter | undefined;
    try { picked = selectAdapter(adapters); } catch { /* expected */ }
    expect(picked).toBeUndefined();
  });

  it('selects by exact name when the operator disambiguates', () => {
    const adapters = [adapter('Intel(R) UHD Graphics 770'), adapter('NVIDIA GeForce RTX 4070')];
    expect(selectAdapter(adapters, 'NVIDIA GeForce RTX 4070').name).toBe('NVIDIA GeForce RTX 4070');
    expect(selectAdapter(adapters, '  nvidia geforce rtx 4070 ').name).toBe('NVIDIA GeForce RTX 4070');
  });

  it('selects on an unambiguous partial name', () => {
    const adapters = [adapter('Intel(R) UHD Graphics 770'), adapter('NVIDIA GeForce RTX 4070')];
    expect(selectAdapter(adapters, 'RTX 4070').name).toBe('NVIDIA GeForce RTX 4070');
  });

  it('rejects a --gpu-name that matches nothing, listing what is present', () => {
    const adapters = [adapter('NVIDIA GeForce RTX 4070')];
    expect(() => selectAdapter(adapters, 'RTX 5090')).toThrow(/Adapters present.*RTX 4070/s);
  });

  it('rejects a machine with only fallback adapters rather than measuring on one', () => {
    expect(() => selectAdapter([adapter('Microsoft Basic Display Adapter')])).toThrow(/should not be benchmarked/);
  });

  it('rejects a machine reporting no adapters at all', () => {
    expect(() => selectAdapter([])).toThrow(/no video adapters/);
  });

  it('classifies known non-rendering devices', () => {
    for (const n of ['Microsoft Basic Display Adapter', 'DisplayLink USB Device', 'Parsec Virtual Display Adapter', 'VMware SVGA 3D']) {
      expect(isRenderingAdapter(n), n).toBe(false);
    }
    for (const n of ['NVIDIA GeForce RTX 4070', 'AMD Radeon RX 7900 XTX', 'Intel(R) Arc(TM) A770 Graphics']) {
      expect(isRenderingAdapter(n), n).toBe(true);
    }
  });
});

// FIX 2: the path was quoted with JSON.stringify, which is JS escaping, not
// PowerShell escaping. PowerShell does not treat backslash as an escape, so a
// Windows path arrived with every separator doubled. It is now passed through
// an environment variable, which removes the quoting problem rather than
// attempting to escape correctly.
describe('game executable version detection', () => {
  it('passes the path via the environment, never interpolated into the script', () => {
    let seenScript = '';
    let seenEnv: NodeJS.ProcessEnv = {};
    detectExecutableVersion('C:\\Games\\My Game\\Game.exe', (script, env) => {
      seenScript = script; seenEnv = env; return '1.2.3.4';
    });
    expect(seenEnv.SPECSMITH_GAME_EXE).toBe('C:\\Games\\My Game\\Game.exe');
    expect(seenScript).toContain('$env:SPECSMITH_GAME_EXE');
    // The regression: no part of the path may appear inside the command string.
    expect(seenScript).not.toContain('C:');
    expect(seenScript).not.toContain('\\\\');
  });

  it('preserves paths with spaces, quotes and backslashes exactly', () => {
    for (const p of ['C:\\Program Files\\A Game\\game.exe', "D:\\it's a game\\g.exe", 'E:\\a"b\\g.exe']) {
      let got = '';
      detectExecutableVersion(p, (_s, env) => { got = String(env.SPECSMITH_GAME_EXE); return '1'; });
      expect(got).toBe(p);
    }
  });

  it('returns the trimmed version string', () => {
    expect(detectExecutableVersion('C:\\g.exe', () => '  1.2.3.4  ')).toBe('1.2.3.4');
  });

  // Returning undefined is correct: an unread version is a gap the validator
  // reports, not something to invent.
  it('returns undefined rather than guessing when the read fails', () => {
    expect(detectExecutableVersion('C:\\missing.exe', () => { throw new Error('not found'); })).toBeUndefined();
    expect(detectExecutableVersion('C:\\g.exe', () => '')).toBeUndefined();
  });
});
