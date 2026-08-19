import { describe, it, expect } from 'vitest';
import { PresentMonFormatError, parsePresentMonCsv, splitCsvLine } from './presentmon';

// The CSVs below are SYNTHETIC PARSER FIXTURES, written by hand to exercise
// the reader's branches. They are not measurements and never become
// observations — no number here describes any real hardware. The real capture
// path is PresentMon on Windows, which this environment cannot run.

const header = 'Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,MsBetweenPresents,MsInPresentAPI';
const row = (app: string, pid: number, dropped: number, t: number, ms: number) =>
  `${app},${pid},0x1,DXGI,0,0,${dropped},${t},${ms},0.5`;

describe('CSV field splitting', () => {
  it('handles quoted fields, because application names contain commas', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('handles escaped quotes', () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(['a', 'say "hi"', 'b']);
  });
});

describe('reading frame times', () => {
  it('reads MsBetweenPresents for a single process', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 0), row('game.exe', 1, 0, 0.01, 8.3), row('game.exe', 1, 0, 0.02, 8.4)].join('\n');
    const result = parsePresentMonCsv(csv);
    expect(result.frameTimesMs).toEqual([8.3, 8.4]);
  });

  // The first present has no prior frame to be measured against; PresentMon
  // reports 0 for it. Dropping it is correct, not a data gap.
  it('discards the first present rather than treating 0ms as a frame', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 0), row('game.exe', 1, 0, 0.01, 8.3)].join('\n');
    const result = parsePresentMonCsv(csv);
    expect(result.discardedFirstFrames).toBe(1);
    expect(result.frameTimesMs).toEqual([8.3]);
  });

  it('excludes dropped frames and reports how many', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 1, 0.01, 8.4), row('game.exe', 1, 0, 0.02, 8.5)].join('\n');
    const result = parsePresentMonCsv(csv);
    expect(result.droppedFrames).toBe(1);
    expect(result.frameTimesMs).toEqual([8.3, 8.5]);
  });

  it('filters to one process by name or pid', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('other.exe', 2, 0, 0, 33.3)].join('\n');
    expect(parsePresentMonCsv(csv, 'game.exe').frameTimesMs).toEqual([8.3]);
    expect(parsePresentMonCsv(csv, '2').frameTimesMs).toEqual([33.3]);
  });
});

// REGRESSION: the real PresentMon header, copied verbatim from an actual
// Windows capture (Roblox, PresentMon 1.x). The parser originally matched
// column names case-sensitively against "MsBetweenPresents" and REJECTED this
// file — while listing "msBetweenPresents" in its own error message. PresentMon
// has shipped both casings, so real captures were a hard block.
//
// This header is pinned exactly as it appeared on disk. Nothing about it is
// reconstructed or assumed.
const REAL_HEADER =
  'Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,' +
  'msInPresentAPI,msBetweenPresents,AllowsTearing,PresentMode,msUntilRenderComplete,msUntilDisplayed,' +
  'msBetweenDisplayChange,msFlipDelay,msUntilRenderStart,msGPUActive,msSinceInput';

const realRow = (dropped: number, msBetweenPresents: number) =>
  `RobloxPlayerBeta.exe,7980,0x000002154358A010,DXGI,0,0,${dropped},0.00317310000000,0.13830000000000,` +
  `${msBetweenPresents},0,Composed: Copy with GPU GDI,1.18630000000000,0.00000000000000,0.00000000000000,` +
  '0.00000000000000,-0.67060000000000,1.15150000000000,0.00000000000000';

describe('a real PresentMon capture', () => {
  it('accepts the actual on-disk header, which uses lowercase msBetweenPresents', () => {
    const csv = [REAL_HEADER, realRow(0, 16.61), realRow(0, 16.7)].join('\n');
    expect(parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe').frameTimesMs).toEqual([16.61, 16.7]);
  });

  it('reads Dropped from the real header too', () => {
    const csv = [REAL_HEADER, realRow(1, 1.8099), realRow(0, 16.61)].join('\n');
    const r = parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe');
    expect(r.droppedFrames).toBe(1);
    expect(r.frameTimesMs).toEqual([16.61]);
  });

  // "Composed: Copy with GPU GDI" sits in an unquoted field. It contains no
  // comma, but it does contain a colon and spaces — worth pinning that it does
  // not disturb field alignment.
  it('keeps field alignment despite the PresentMode text value', () => {
    const csv = [REAL_HEADER, realRow(0, 16.61)].join('\n');
    expect(parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe').frameTimesMs).toEqual([16.61]);
  });

  it('matches column names case-insensitively but never by prefix', () => {
    // A similarly-named column is a different measurement and must not match.
    const wrong = REAL_HEADER.replace('msBetweenPresents', 'msBetweenPresentsDelta');
    expect(() => parsePresentMonCsv([wrong, realRow(0, 16.61)].join('\n'), 'RobloxPlayerBeta.exe')).toThrow(PresentMonFormatError);
  });
});

describe('formats it refuses rather than guesses at', () => {
  // The failure this guards is invisible downstream: a wrong column would
  // produce entirely plausible frame times.
  it('rejects a capture with no MsBetweenPresents column, naming the fix', () => {
    const csv = ['Application,ProcessID,CPUStartTime,FrameTime,GPUBusy', 'game.exe,1,0.0,8.3,7.1'].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(PresentMonFormatError);
    expect(() => parsePresentMonCsv(csv)).toThrow(/--v1_metrics/);
  });

  // Interleaving two applications' frames would produce a meaningless run.
  it('rejects a multi-process capture with no filter', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('other.exe', 2, 0, 0, 33.3)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/2 processes/);
  });

  it('rejects a filter that matches nothing, listing what was present', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3)].join('\n');
    expect(() => parsePresentMonCsv(csv, 'absent.exe')).toThrow(/game\.exe/);
  });

  it('rejects a file with no data rows', () => {
    expect(() => parsePresentMonCsv(header)).toThrow(PresentMonFormatError);
  });

  it('rejects a capture in which every frame was dropped', () => {
    const csv = [header, row('game.exe', 1, 1, 0, 8.3), row('game.exe', 1, 1, 0.01, 8.4)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/dropped/);
  });
});
