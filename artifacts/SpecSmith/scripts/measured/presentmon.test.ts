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

  // PresentMon 1.9.2 defines Dropped as "whether the frame was dropped (1) or
  // displayed (0)" — i.e. NOT DISPLAYED. The application still called
  // Present(), and msBetweenPresents is "the time between this Present() call
  // and the previous one", which is defined regardless of what the display did
  // with the frame. So a dropped present is a real rendered frame and belongs
  // in a rendered-frame metric.
  it('retains dropped presents, because they were still presented', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 1, 0.01, 8.4), row('game.exe', 1, 0, 0.02, 8.5)].join('\n');
    const result = parsePresentMonCsv(csv);
    expect(result.frameTimesMs).toEqual([8.3, 8.4, 8.5]);
  });

  it('still counts them, because a high drop rate is worth disclosing', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 1, 0.01, 8.4), row('game.exe', 1, 0, 0.02, 8.5)].join('\n');
    expect(parsePresentMonCsv(csv).droppedFrames).toBe(1);
  });

  // The concrete harm of the old behaviour. Each row's interval is a delta
  // against the PREVIOUS present, so removing a row does not remove its time
  // from the capture — it just stops that time being counted. The retained
  // intervals then no longer span the run.
  it('keeps the intervals summing to the capture duration', () => {
    const csv = [
      header,
      row('game.exe', 1, 0, 0, 10),
      row('game.exe', 1, 1, 0.01, 10),
      row('game.exe', 1, 0, 0.02, 10),
      row('game.exe', 1, 0, 0.03, 10),
    ].join('\n');
    const result = parsePresentMonCsv(csv);
    const total = result.frameTimesMs.reduce((a, b) => a + b, 0);
    expect(total).toBe(40);
    // Excluding the dropped row would leave 30ms of intervals describing a
    // 40ms span, overstating the average frame rate by a third.
    expect(result.frameTimesMs).toHaveLength(4);
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

  it('reads Dropped from the real header, and keeps the frame', () => {
    const csv = [REAL_HEADER, realRow(1, 1.8099), realRow(0, 16.61)].join('\n');
    const r = parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe');
    expect(r.droppedFrames).toBe(1);
    expect(r.frameTimesMs).toEqual([1.8099, 16.61]);
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

  // A capture of nothing but dropped presents is no longer empty — those are
  // real frames. What IS still rejected is a capture with no usable interval
  // at all.
  it('accepts a capture in which every present was dropped', () => {
    const csv = [header, row('game.exe', 1, 1, 0, 8.3), row('game.exe', 1, 1, 0.01, 8.4)].join('\n');
    const r = parsePresentMonCsv(csv);
    expect(r.frameTimesMs).toEqual([8.3, 8.4]);
    expect(r.droppedFrames).toBe(2);
  });

  it('rejects a capture whose only row has no interval', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 0)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/no present interval at all/);
  });
});

// Only the FIRST present of a series legitimately has no interval. The parser
// used to classify EVERY non-positive or non-finite value as a "discarded
// first frame", so a truncated write or a misread column silently shortened
// the capture and reported a plausible-looking count for it.
describe('rows that carry no usable interval', () => {
  it('accepts the initial present, which has no predecessor', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 0), row('game.exe', 1, 0, 0.01, 8.3)].join('\n');
    const r = parsePresentMonCsv(csv);
    expect(r.discardedFirstFrames).toBe(1);
    expect(r.frameTimesMs).toEqual([8.3]);
  });

  it('rejects a zero interval later in the capture, naming the CSV line', () => {
    const csv = [
      header,
      row('game.exe', 1, 0, 0, 8.3),
      row('game.exe', 1, 0, 0.01, 8.4),
      row('game.exe', 1, 0, 0.02, 0),
    ].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/line 4/);
    expect(() => parsePresentMonCsv(csv)).toThrow(PresentMonFormatError);
  });

  it('rejects a negative interval rather than discarding the row', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 0, 0.01, -4)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/not a usable interval/);
  });

  it('rejects an unparseable interval rather than discarding the row', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 0, 0.01, Number.NaN)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(PresentMonFormatError);
  });

  it('never reports more than one discarded first frame', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 0), row('game.exe', 1, 0, 0.01, 8.3)].join('\n');
    expect(parsePresentMonCsv(csv).discardedFirstFrames).toBe(1);
  });
});

// Two swap chains are two independent present series — each row's interval is
// a delta against the previous present on the SAME chain. Concatenating them
// is as meaningless as concatenating two processes, and it would also produce
// a second legitimate zero, which the first-frame rule above cannot allow for.
describe('swap chains', () => {
  const sc = (address: string, ms: number, t: number) =>
    `RobloxPlayerBeta.exe,7980,${address},DXGI,0,0,0,${t},0.13,${ms},0,Composed: Copy with GPU GDI,1.1,0,0,0,-0.6,1.1,0`;

  it('refuses to combine two swap chains', () => {
    const csv = [REAL_HEADER, sc('0xAAA', 16.6, 0.01), sc('0xBBB', 8.3, 0.02)].join('\n');
    expect(() => parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe')).toThrow(/2 swap chains/);
  });

  it('accepts one when the operator selects it', () => {
    const csv = [REAL_HEADER, sc('0xAAA', 16.6, 0.01), sc('0xBBB', 8.3, 0.02)].join('\n');
    const r = parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe', '0xAAA');
    expect(r.frameTimesMs).toEqual([16.6]);
    expect(r.swapChains).toEqual(['0xAAA']);
  });

  it('is untroubled by a capture with a single swap chain', () => {
    const csv = [REAL_HEADER, sc('0xAAA', 16.6, 0.01), sc('0xAAA', 16.7, 0.02)].join('\n');
    expect(parsePresentMonCsv(csv, 'RobloxPlayerBeta.exe').frameTimesMs).toEqual([16.6, 16.7]);
  });
});

// Same silent-shortening hazard as an unusable interval, one step earlier.
describe('rows too short to hold the frame-time column', () => {
  it('rejects a short row in the middle of the file', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), 'game.exe,1,0', row('game.exe', 1, 0, 0.02, 8.4)].join('\n');
    expect(() => parsePresentMonCsv(csv)).toThrow(/corrupted/);
  });

  it('tolerates a final line cut off mid-write, and says so', () => {
    const csv = [header, row('game.exe', 1, 0, 0, 8.3), row('game.exe', 1, 0, 0.01, 8.4), 'game.exe,1,0'].join('\n');
    const r = parsePresentMonCsv(csv);
    expect(r.truncatedTrailingRows).toBe(1);
    expect(r.frameTimesMs).toEqual([8.3, 8.4]);
  });
});
