// PresentMon CSV -> frame times.
//
// PresentMon (Intel, formerly Microsoft) is the established Windows frame
// capture tool and the one this collector targets. It is not reimplemented
// here; this only reads what it writes.
//
// WHICH COLUMN IS "THE FRAME TIME"
// --------------------------------
// `MsBetweenPresents` — the interval between successive Present() calls, i.e.
// RENDERED frames. That is the figure conventional FPS measurement uses and
// the one SpecSmith's statistics are defined over.
//
// `MsBetweenDisplayChange` is deliberately NOT used: it measures DISPLAYED
// frames, which under frame generation includes frames the GPU never rendered.
// Mixing the two would silently produce a frame-generation-inflated number
// wearing a native label — the exact confusion the schema's frameGeneration
// flag exists to prevent.
//
// COLUMN AVAILABILITY IS CHECKED, NEVER GUESSED
// ---------------------------------------------
// PresentMon 1.x emits `MsBetweenPresents` by default. PresentMon 2.x renamed
// much of its output and emits it only under `--v1_metrics`. Rather than guess
// at which 2.x column is equivalent, a capture without the required column is
// REJECTED with the flag needed to produce one. A wrong column choice here
// would be invisible downstream: the numbers would look entirely plausible.

export interface PresentMonParseResult {
  frameTimesMs: number[];
  /** Rows present in the file for the selected process, before filtering. */
  totalRows: number;
  droppedFrames: number;
  /** Frames excluded because they were the first present of a run (no prior frame to measure against). */
  discardedFirstFrames: number;
  processes: string[];
}

export class PresentMonFormatError extends Error {}

/** Minimal RFC-4180-ish field splitter — application names legitimately contain commas. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { inQuotes = false; }
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

const REQUIRED_COLUMN = 'MsBetweenPresents';

/**
 * Parses a PresentMon CSV into the frame times SpecSmith's statistics consume.
 *
 * `processFilter` selects one application. A capture containing more than one
 * process with no filter is rejected rather than silently concatenated —
 * interleaving two applications' frames would produce a meaningless run.
 */
export function parsePresentMonCsv(csv: string, processFilter?: string): PresentMonParseResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new PresentMonFormatError('CSV contains no data rows.');

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);

  const frameTimeIdx = col(REQUIRED_COLUMN);
  if (frameTimeIdx < 0) {
    throw new PresentMonFormatError(
      `CSV has no "${REQUIRED_COLUMN}" column (found: ${header.join(', ')}). ` +
        'PresentMon 2.x emits it only with --v1_metrics; re-capture with that flag. ' +
        'No other column is substituted, because guessing an equivalent would produce plausible but wrong frame times.',
    );
  }

  const droppedIdx = col('Dropped');
  const appIdx = col('Application');
  const pidIdx = col('ProcessID');

  const processes = new Set<string>();
  const rows: Array<{ app: string; pid: string; dropped: boolean; frameTimeMs: number }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const f = splitCsvLine(lines[i]);
    if (f.length <= frameTimeIdx) continue;

    const app = appIdx >= 0 ? f[appIdx].trim() : '';
    const pid = pidIdx >= 0 ? f[pidIdx].trim() : '';
    if (app) processes.add(app);

    if (processFilter && app !== processFilter && pid !== processFilter) continue;

    const raw = Number(f[frameTimeIdx]);
    rows.push({
      app,
      pid,
      // PresentMon writes Dropped as 0/1. Anything non-zero is dropped.
      dropped: droppedIdx >= 0 ? Number(f[droppedIdx]) !== 0 : false,
      frameTimeMs: raw,
    });
  }

  if (rows.length === 0) {
    throw new PresentMonFormatError(
      processFilter
        ? `No rows matched process "${processFilter}". Processes in this capture: ${[...processes].join(', ') || 'none'}.`
        : 'No data rows could be read.',
    );
  }

  if (!processFilter && processes.size > 1) {
    throw new PresentMonFormatError(
      `Capture contains ${processes.size} processes (${[...processes].join(', ')}). ` +
        'Pass a process filter — interleaving two applications\' frames would produce a meaningless run.',
    );
  }

  const droppedFrames = rows.filter((r) => r.dropped).length;
  const kept = rows.filter((r) => !r.dropped);

  // The first present of a capture has no prior frame to be measured against;
  // PresentMon reports 0 for it. Dropping it is correct, not a data gap.
  let discardedFirstFrames = 0;
  const frameTimesMs: number[] = [];
  for (const r of kept) {
    if (!Number.isFinite(r.frameTimeMs) || r.frameTimeMs <= 0) {
      discardedFirstFrames += 1;
      continue;
    }
    frameTimesMs.push(r.frameTimeMs);
  }

  if (frameTimesMs.length === 0) throw new PresentMonFormatError('Every row was dropped or had a non-positive frame time.');

  return {
    frameTimesMs,
    totalRows: rows.length,
    droppedFrames,
    discardedFirstFrames,
    processes: [...processes],
  };
}
