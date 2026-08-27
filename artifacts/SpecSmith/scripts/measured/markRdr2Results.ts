// CLI for the operator-confirmed RDR2 results-screen marker. RESEARCH ONLY.
//
//   npx tsx scripts/measured/markRdr2Results.ts --out <path> [--bundle <dir>]
//
// Run this in a SECOND terminal while the PresentMon capture keeps running in
// the first. Press Enter the moment RDR2's results screen appears. Type q then
// Enter when the run is over.
//
// It records nothing about the game and reads nothing from the capture: it
// records WHEN A HUMAN SAID the results screen was on screen, on a monotonic
// clock, so the analyzer's ranking can later be checked against something the
// analyzer did not produce. It is not a detector and must never be used as
// one. See rdr2ResultsMarker.ts for why that distinction is the whole point.
//
// It writes exactly one file, at --out, which must not already exist and may
// not be inside the capture bundle. It never writes an observation and never
// touches the observation store or the frame-time archive.
//
// EXIT CODES
// ----------
//   0  a marker file was written
//   1  the CLI was misused, or writing was refused

import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { runMarkerSession, writeMarkerFile, MarkerError, MARKER_INSTRUCTIONS } from './rdr2ResultsMarker';

export class MarkerCliError extends Error {}

export interface MarkerCliArgs {
  outPath: string;
  /** The bundle this marker accompanies, if known. Used ONLY to refuse writing inside it. */
  bundleDir?: string;
}

/** Same valued-flag rule the collector learned the hard way: a flag's value may not itself look like a flag. */
export function parseMarkerArgs(argv: readonly string[]): MarkerCliArgs {
  let outPath: string | undefined;
  let bundleDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '--bundle') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new MarkerCliError(`${a} needs a value (got ${v === undefined ? 'end of arguments' : JSON.stringify(v)}).`);
      }
      if (a === '--out') {
        if (outPath !== undefined) throw new MarkerCliError('--out was given more than once.');
        outPath = v;
      } else {
        if (bundleDir !== undefined) throw new MarkerCliError('--bundle was given more than once.');
        bundleDir = v;
      }
      i += 1;
      continue;
    }
    throw new MarkerCliError(`Unexpected argument ${JSON.stringify(a)}. Usage: markRdr2Results.ts --out <path> [--bundle <dir>]`);
  }

  if (outPath === undefined) throw new MarkerCliError('--out is required. Usage: markRdr2Results.ts --out <path> [--bundle <dir>]');
  return { outPath, bundleDir };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseMarkerArgs(argv);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  try {
    const file = await runMarkerSession({ lines: rl, log: (l) => console.log(l) });
    if (file.marks.length === 0) {
      console.error('No marks were recorded, so nothing was written. Run again and press Enter when the results screen appears.');
      return 1;
    }
    writeMarkerFile(args.outPath, file, args.bundleDir);
    console.log(`\nWrote ${file.marks.length} operator-confirmed mark${file.marks.length === 1 ? '' : 's'} to ${args.outPath}`);
    console.log('This is evidence for evaluating the analyzer. It is not a detection and not a benchmark result.');
    return 0;
  } finally {
    rl.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      if (e instanceof MarkerCliError) console.error(`${e.message}\n\n${MARKER_INSTRUCTIONS}`);
      else console.error(e instanceof MarkerError ? e.message : e);
      process.exitCode = 1;
    });
}
