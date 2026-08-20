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
// DROPPED FRAMES ARE RETAINED, AND WHY
// ------------------------------------
// PresentMon 1.9.2's own column reference defines them as:
//
//   Dropped              "Whether the frame was dropped (1) or displayed (0).
//                         Note, if dropped, msUntilDisplayed will be 0."
//   msBetweenPresents    "The time between this Present() call and the
//                         previous one, in milliseconds."
//   msBetweenDisplayChange
//                        "How long the previous frame was displayed before
//                         this Present() was displayed, in milliseconds."
//
// So "dropped" means NOT DISPLAYED. The application still called Present(),
// the GPU still rendered the frame, and msBetweenPresents is measured over
// Present() calls regardless of what the display did with them. Dropped
// presents are ordinary in any capture without VSync, which is the normal way
// to benchmark.
//
// This parser used to exclude them, which was wrong twice over. It discarded
// real rendered frames from a rendered-frame metric; and because each row's
// msBetweenPresents is a delta against the PREVIOUS PRESENT ROW, deleting a
// row leaves its successor's interval spanning a gap that no longer matches
// the retained series — the kept intervals stop summing to the capture
// duration, inflating the average by removing the short intervals around
// dropped presents.
//
// Exclusion is correct for msBetweenDisplayChange, which is undefined for a
// frame that never reached the screen. It is not correct here. PresentMon
// agrees: `-exclude_dropped` is opt-in, so the default capture — the one a
// benchmark analyses — contains them.
//
// The count is still reported, because a high drop rate is worth disclosing.
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
  /**
   * Presents that were never displayed. RETAINED in frameTimesMs — see the
   * header. Reported so a high drop rate is visible.
   */
  droppedFrames: number;
  /** The single initial present with no prior present to measure against. Always 0 or 1. */
  discardedFirstFrames: number;
  /** A final line cut off mid-write, e.g. by killing the capture. Always 0 or 1. */
  truncatedTrailingRows: number;
  processes: string[];
  swapChains: string[];
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
 * `processFilter` selects one application, `swapChainFilter` one swap chain
 * within it. A capture containing more than one of either with no filter is
 * rejected rather than silently concatenated — interleaving two independent
 * present streams would produce a meaningless run.
 */
export function parsePresentMonCsv(
  csv: string,
  processFilter?: string,
  swapChainFilter?: string,
): PresentMonParseResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new PresentMonFormatError('CSV contains no data rows.');

  const header = splitCsvLine(lines[0]).map((h) => h.trim());

  // Column lookup is CASE-INSENSITIVE. PresentMon has shipped both casings:
  // real 1.x output writes `msBetweenPresents`, while its own documentation and
  // some builds use `MsBetweenPresents`. An exact match rejected a perfectly
  // valid capture with a message claiming the column was absent while listing
  // that very column — confusing, and a hard block on real data.
  //
  // Matching is still on the WHOLE name, never a prefix or a fuzzy match: a
  // column that is merely similarly named is a different measurement.
  const normalized = header.map((h) => h.toLowerCase());
  const col = (name: string) => normalized.indexOf(name.toLowerCase());

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
  const swapChainIdx = col('SwapChainAddress');

  const processes = new Set<string>();
  const swapChains = new Set<string>();
  const rows: Array<{ app: string; pid: string; swapChain: string; dropped: boolean; frameTimeMs: number; line: number }> = [];

  // A row too short to hold the frame-time column used to be skipped in
  // silence, which shortens the capture exactly as invisibly as the first-frame
  // misclassification below. PresentMon writes complete lines, so a short row
  // mid-file means a corrupted file; the one realistic exception is the final
  // line when a capture is killed mid-write, and that one is counted.
  let truncatedTrailingRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const f = splitCsvLine(lines[i]);
    if (f.length <= frameTimeIdx) {
      if (i === lines.length - 1) { truncatedTrailingRows = 1; continue; }
      throw new PresentMonFormatError(
        `Row at CSV line ${i + 1} has ${f.length} fields but the header declares ${header.length}. ` +
          'A short row mid-file means the capture is corrupted, so it is rejected rather than skipped — skipping would quietly shorten the run.',
      );
    }

    const app = appIdx >= 0 ? f[appIdx].trim() : '';
    const pid = pidIdx >= 0 ? f[pidIdx].trim() : '';
    if (app) processes.add(app);

    if (processFilter && app !== processFilter && pid !== processFilter) continue;

    const swapChain = swapChainIdx >= 0 ? f[swapChainIdx].trim() : '';
    if (swapChainFilter && swapChain !== swapChainFilter) continue;
    if (swapChain) swapChains.add(swapChain);

    rows.push({
      app,
      pid,
      swapChain,
      // PresentMon writes Dropped as 0/1. Anything non-zero is dropped.
      dropped: droppedIdx >= 0 ? Number(f[droppedIdx]) !== 0 : false,
      frameTimeMs: Number(f[frameTimeIdx]),
      // 1-based CSV line, so a rejection message points at the actual row.
      line: i + 1,
    });
  }

  if (rows.length === 0) {
    const filters = [
      processFilter ? `process "${processFilter}"` : null,
      swapChainFilter ? `swap chain "${swapChainFilter}"` : null,
    ].filter(Boolean);
    throw new PresentMonFormatError(
      filters.length > 0
        ? `No rows matched ${filters.join(' and ')}. Processes in this capture: ${[...processes].join(', ') || 'none'}.`
        : 'No data rows could be read.',
    );
  }

  if (!processFilter && processes.size > 1) {
    throw new PresentMonFormatError(
      `Capture contains ${processes.size} processes (${[...processes].join(', ')}). ` +
        'Pass a process filter — interleaving two applications\' frames would produce a meaningless run.',
    );
  }

  // Each row's interval is a delta against the previous present ON THE SAME
  // SWAP CHAIN, so two swap chains are two independent series. Interleaving
  // them is as meaningless as interleaving two processes, which is already
  // refused above — and it would also produce a second legitimate zero,
  // muddying the first-frame rule below.
  if (swapChains.size > 1) {
    throw new PresentMonFormatError(
      `Capture contains ${swapChains.size} swap chains for this process (${[...swapChains].join(', ')}). ` +
        'Their present intervals are separate series and cannot be combined. Pass --swap-chain <address> to select one.',
    );
  }

  const droppedFrames = rows.filter((r) => r.dropped).length;

  // ONLY the first present of the series may have no interval. PresentMon
  // reports 0 for it because there is no previous Present() to measure
  // against. Any LATER non-positive or non-finite value is not that — it is a
  // truncated write, a corrupted row, or a column that does not mean what this
  // parser thinks it means. Treating those as "first frames" (which this
  // parser used to do) silently deleted rows and hid the fault behind a
  // plausible-looking count.
  let discardedFirstFrames = 0;
  const frameTimesMs: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const usable = Number.isFinite(r.frameTimeMs) && r.frameTimeMs > 0;
    if (usable) {
      frameTimesMs.push(r.frameTimeMs);
      continue;
    }
    if (i === 0) {
      discardedFirstFrames = 1;
      continue;
    }
    throw new PresentMonFormatError(
      `Row at CSV line ${r.line} has ${REQUIRED_COLUMN} = ${JSON.stringify(rows[i].frameTimeMs)}, which is not a usable interval. ` +
        'Only the first present of a capture legitimately has none. A later one means the file is truncated or corrupted, or the column does not hold what this parser expects — ' +
        'so the capture is rejected rather than quietly shortened.',
    );
  }

  if (frameTimesMs.length === 0) throw new PresentMonFormatError('No usable frame times: the capture holds no present interval at all.');

  return {
    frameTimesMs,
    totalRows: rows.length,
    droppedFrames,
    discardedFirstFrames,
    processes: [...processes],
    swapChains: [...swapChains],
    truncatedTrailingRows,
  };
}
