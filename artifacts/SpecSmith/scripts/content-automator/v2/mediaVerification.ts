// Rendered media is bytes on disk, not a string that looks like a hash.
//
// A 64-character hex string is only SHAPED like a SHA-256. Reporting media as
// verified requires reading the actual file and hashing what is there. This
// module does that, once, and issues a frozen record for it. Only records it
// issued are accepted (a module-private WeakSet, as the compositor does for
// its receipts): a hand-built, spread or JSON-round-tripped object with a
// plausible digest is not verified media.
//
// A record says what the file held WHEN it was read. Anything that relies on
// it later calls `recheckMedia`, which reads the file again, so a video
// changed after review is caught rather than trusted.
//
// What this does NOT establish: that the bytes are a render of any particular
// storyboard, that they play, or that anyone watched them.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";

export interface VerifiedMedia {
  /** realpath of the file that was read. */
  readonly path: string;
  /** SHA-256 of the bytes that were read. Computed here, never supplied. */
  readonly sha256: string;
  readonly bytes: number;
  readonly verifiedAt: string;
}

export class MediaVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaVerificationError";
  }
}

const ISSUED = new WeakSet<object>();

function hashFile(path: string): { sha256: string; bytes: number } {
  const data = readFileSync(path);
  return { sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length };
}

/** Read a rendered file and record the digest of its actual bytes. */
export function verifyRenderedMedia(path: string, now: Date = new Date()): VerifiedMedia {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new MediaVerificationError(`No rendered media at ${path}: nothing exists to verify.`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) throw new MediaVerificationError(`${path} is not a regular file.`);
  const { sha256, bytes } = hashFile(real);
  if (bytes === 0) throw new MediaVerificationError(`${path} is empty: zero bytes are not a render.`);
  const record: VerifiedMedia = Object.freeze({ path: real, sha256, bytes, verifiedAt: now.toISOString() });
  ISSUED.add(record);
  return record;
}

/** True only for a record `verifyRenderedMedia` issued, unaltered. */
export function isVerifiedMedia(value: unknown): value is VerifiedMedia {
  return typeof value === "object" && value !== null && ISSUED.has(value);
}

export type MediaRecheck =
  | { readonly ok: true; readonly sha256: string }
  | { readonly ok: false; readonly reason: string };

/** Read the file again and confirm it still holds the verified bytes. */
export function recheckMedia(media: VerifiedMedia): MediaRecheck {
  if (!isVerifiedMedia(media)) return { ok: false, reason: "The media record was not issued by verifyRenderedMedia; its digest was never computed from a file." };
  let current: string;
  try {
    current = hashFile(media.path).sha256;
  } catch {
    return { ok: false, reason: `The verified file ${media.path} no longer exists.` };
  }
  if (current !== media.sha256) {
    return { ok: false, reason: `The file at ${media.path} changed after it was verified (now ${current.slice(0, 12)}…, verified ${media.sha256.slice(0, 12)}…).` };
  }
  return { ok: true, sha256: current };
}
