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
 * What is currently published at `file`.
 *
 * FAIL CLOSED. Only ENOENT means "nothing published yet": that is the first
 * run, and it is the single case in which having no baseline is a fact rather
 * than an unanswered question. Everything else — a permission error, a
 * directory where a file should be, a truncated body, a file that does not
 * validate — is reported as its own status so the caller can STOP.
 *
 * The distinction matters because the two are opposite. Treating an unreadable
 * file as "absent" would silently disarm collapse protection at exactly the
 * moment something is already wrong with the file it protects, and the next
 * sweep would then be free to replace it with anything at all.
 */
export type PublishedSnapshotRead =
  | { status: 'ok'; snapshot: GpuOfferSnapshot }
  /** ENOENT, and only ENOENT. No snapshot has ever been published here. */
  | { status: 'absent' }
  /** The file exists and could not be read. `errnoCode` is Node's own code, never a message. */
  | { status: 'unreadable'; errnoCode: string | null }
  /** Read, but not JSON at all. */
  | { status: 'malformed' }
  /** Parsed as JSON, but not a snapshot this reader accepts. */
  | { status: 'invalid'; problem: SnapshotProblem };

export function readPublishedSnapshot(file: string): PublishedSnapshotRead {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (cause) {
    // Node's errno code, which is a closed vocabulary of its own making. The
    // error's MESSAGE is never read: it interpolates the path, and this line
    // goes into a CI log.
    const code = (cause as NodeJS.ErrnoException | null)?.code ?? null;
    return code === 'ENOENT' ? { status: 'absent' } : { status: 'unreadable', errnoCode: code };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'malformed' };
  }
  const parsed = parseOfferSnapshot(raw);
  return parsed.ok ? { status: 'ok', snapshot: parsed.snapshot } : { status: 'invalid', problem: parsed.problem };
}

/**
 * One line for an operator, naming the status and nothing else.
 *
 * Never the file's contents and never the underlying error message — both can
 * carry a path or, for a hand-edited file, anything at all.
 */
export function describePublishedRead(read: PublishedSnapshotRead): string {
  switch (read.status) {
    case 'ok':
      return 'The published snapshot was read and validated; it is the collapse baseline for this run.';
    case 'absent':
      return 'No snapshot has been published yet; this run would be the first.';
    case 'unreadable':
      return `The published snapshot exists but could not be read [${read.errnoCode ?? 'unknown'}].`;
    case 'malformed':
      return 'The published snapshot is not valid JSON.';
    case 'invalid':
      return `The published snapshot does not satisfy the schema [${read.problem}].`;
  }
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
