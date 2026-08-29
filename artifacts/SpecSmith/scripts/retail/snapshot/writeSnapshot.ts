// Publishing the snapshot file: read the current one, write the next one, and
// never leave anything half-written in between.
//
// SERVER-ONLY, but it holds no credential and takes no token: by the time a
// snapshot exists the sweep is over. It reads and writes exactly one path, the
// one it is handed.
//
// WHY THE WRITE IS ATOMIC
// -----------------------
// The file it replaces is being served to browsers. A plain `writeFileSync`
// truncates first and fills after, so a reader arriving in between gets an
// empty or half-written document — and this one is fetched at runtime, so
// "in between" is a real moment a real page can land in. Writing to a
// temporary file in the SAME directory and renaming over the target makes the
// swap a single filesystem operation: a reader sees the old file or the new
// one, never a partial one. Same directory is not incidental — rename is only
// atomic within a filesystem, and a temp under /tmp may be on another.
//
// The bytes are validated BEFORE the rename, by parsing them back with the
// browser's own parser. So the file that replaces a working one is known to be
// readable, not merely known to have been serialized.

import fs from 'node:fs';
import path from 'node:path';

import { parseOfferSnapshot, type GpuOfferSnapshot, type SnapshotProblem } from '../../../src/lib/retail/offerSnapshot';

/** Why a write did not happen. Closed, and never carries file contents. */
export type WriteFailureCode =
  /** The serialized bytes do not parse back into a valid snapshot. */
  | 'serialized-invalid'
  /** The target's directory does not exist. Creating it is not this tool's job. */
  | 'directory-missing';

export class SnapshotWriteError extends Error {
  constructor(
    readonly code: WriteFailureCode,
    readonly problem: SnapshotProblem | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The snapshot currently published at `file`, or null.
 *
 * Null covers three cases that are all "no baseline": the file does not exist,
 * it is not JSON, or it does not validate. That is deliberate — collapse
 * protection compares against a KNOWN-GOOD previous snapshot, and a file that
 * cannot be read is not one. The caller is told which it was so an unreadable
 * existing file is visible rather than silently treated as a fresh start.
 */
export function readPublishedSnapshot(file: string): { snapshot: GpuOfferSnapshot | null; problem: SnapshotProblem | 'absent' | null } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return { snapshot: null, problem: 'absent' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { snapshot: null, problem: 'not-an-object' };
  }
  const parsed = parseOfferSnapshot(raw);
  return parsed.ok ? { snapshot: parsed.snapshot, problem: null } : { snapshot: null, problem: parsed.problem };
}

/** Serialized exactly as it will be published: one trailing newline, stable key order. */
export function serializeSnapshot(snapshot: GpuOfferSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * Writes the snapshot atomically, or throws having changed nothing.
 *
 * The temporary file is removed on every path, including the failure ones, so
 * a rejected write leaves no debris beside the file it did not replace.
 */
export function writeSnapshotAtomically(file: string, snapshot: GpuOfferSnapshot): void {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    throw new SnapshotWriteError('directory-missing', null, `The snapshot's directory does not exist: ${dir}`);
  }

  const text = serializeSnapshot(snapshot);

  // Validate the BYTES, not the object. This is the last point at which the
  // published file and the thing that was validated can still differ.
  const parsed = parseOfferSnapshot(JSON.parse(text));
  if (!parsed.ok) {
    throw new SnapshotWriteError('serialized-invalid', parsed.problem, 'The serialized snapshot does not satisfy the schema; nothing was written.');
  }

  const temp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  try {
    // 0o644: this becomes a public static asset. It carries no secret — the
    // tracked links in it are meant to be handed to browsers — but it is
    // written by a job, so nothing but that job may rewrite it.
    fs.writeFileSync(temp, text, { mode: 0o644 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
