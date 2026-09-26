// A record that a person listened to one exact master, all the way through (#157).
//
// WHY THIS EXISTS. A passing audio verdict used to rest on
// `audioClarityScore` alone: a number anyone could type, with nothing saying
// how it was reached. Signal statistics (silencedetect, volumedetect,
// loudness) are useful, but they cannot hear a mispronounced part name, a
// clipped last word, narration drifting out of sync with the picture, or a
// sentence that is simply unintelligible. Only listening can. So a passing
// audio verdict now needs a record that someone listened to the whole of
// these exact bytes.
//
// HOW IT IS BOUND. A record is issued only by `recordListeningReview`, which
// takes the render receipt the compositor issued for the master and refuses
// unless the record names that receipt's digest AND its master SHA-256. That is
// the same binding QC, rights and inspection carry, so a listen to a previous
// render, or to the same bytes under a different receipt, is stale and never
// counts. Issued records are frozen and kept in a module-private WeakSet, like
// receipts and hosted masters: a hand-built, spread, cloned or JSON
// round-tripped record is not issued and is refused wherever it is checked.
//
// WHAT IT DOES NOT PROVE. The listener's identity is data, exactly like the
// inspection record's approver (publishGate.ts, limit e). The binding proves
// which bytes and which receipt the claim is about, not that the person named
// really listened. Never record "listened-full" unless someone did, to these
// bytes.

import { isIssuedRenderReceipt, type RenderReceipt } from "./motionCompositor.ts";

/**
 * How the audio was reviewed. Only "listened-full" can support a passing
 * audio verdict; the other two say, honestly, that no one has.
 */
export const AUDIO_REVIEW_METHODS = ["listened-full", "signal-analysis-only", "not-reviewed"] as const;
export type AudioReviewMethod = (typeof AUDIO_REVIEW_METHODS)[number];

/** The persisted form: what a reviewer writes down after listening. */
export interface ListeningReviewRecord {
  method: AudioReviewMethod;
  /** Who listened. */
  reviewedBy: string;
  /** ISO-8601. Must parse, and must not be in the future. */
  reviewedAt: string;
  /** The exact master listened to. Must be the receipt's master. */
  masterSha256: string;
  /** The receipt that master was rendered under. Must be the receipt's digest. */
  receiptDigest: string;
  /**
   * What was heard. Required, and non-empty, for "listened-full": a full listen
   * says what it checked (intelligibility, pronunciation, sync, truncation).
   */
  notes: string[];
}

/** An issued, frozen record. Only `recordListeningReview` makes one. */
export type ListeningReview = Readonly<Omit<ListeningReviewRecord, "notes">> & { readonly notes: readonly string[] };

export class ListeningReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListeningReviewError";
  }
}

const ISSUED_LISTENING_REVIEWS = new WeakSet<object>();
const HEX_DIGEST = /^[0-9a-f]{64}$/;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const short = (digest: string): string => `${digest.slice(0, 16)}…`;

function digestField(raw: Record<string, unknown>, field: "masterSha256" | "receiptDigest"): string {
  const value = typeof raw[field] === "string" ? (raw[field] as string).trim().toLowerCase() : "";
  if (!HEX_DIGEST.test(value)) throw new ListeningReviewError(`Listening review ${field} is missing or not a SHA-256 digest.`);
  return value;
}

/**
 * Issues a listening record for the master `receipt` describes.
 *
 * Refuses (throws) when the receipt is not one the compositor issued, when the
 * record is malformed, names an unknown method, is dated in the future, or
 * names a different master or receipt. A listen is never transferred from one
 * render to another.
 */
export function recordListeningReview(
  receipt: RenderReceipt,
  record: unknown,
  now: Date = new Date(),
): ListeningReview {
  if (!isIssuedRenderReceipt(receipt)) {
    throw new ListeningReviewError(
      "A listening review can only be recorded against a render receipt the compositor issued.",
    );
  }
  if (!record || typeof record !== "object") {
    throw new ListeningReviewError("A listening review must be an object.");
  }
  const raw = record as Record<string, unknown>;

  if (!(AUDIO_REVIEW_METHODS as readonly unknown[]).includes(raw.method)) {
    throw new ListeningReviewError(
      `Listening review method ${JSON.stringify(raw.method)} is not one of ${AUDIO_REVIEW_METHODS.join(", ")}.`,
    );
  }
  const method = raw.method as AudioReviewMethod;
  if (!isNonEmptyString(raw.reviewedBy)) {
    throw new ListeningReviewError("Listening review reviewedBy is empty; a listen needs a listener.");
  }
  if (!isNonEmptyString(raw.reviewedAt) || Number.isNaN(new Date(raw.reviewedAt).getTime())) {
    throw new ListeningReviewError("Listening review reviewedAt is missing or not a valid timestamp.");
  }
  // A minute of clock skew, as for every other sign-off.
  if (new Date(raw.reviewedAt).getTime() > now.getTime() + 60_000) {
    throw new ListeningReviewError(`Listening review reviewedAt "${raw.reviewedAt}" is in the future.`);
  }
  if (!Array.isArray(raw.notes) || !raw.notes.every((note) => typeof note === "string")) {
    throw new ListeningReviewError("Listening review notes must be an array of strings.");
  }
  if (method === "listened-full" && !raw.notes.some(isNonEmptyString)) {
    throw new ListeningReviewError(
      "A full listen must say what was heard: intelligibility, pronunciation, sync and truncation.",
    );
  }

  const masterSha256 = digestField(raw, "masterSha256");
  const receiptDigest = digestField(raw, "receiptDigest");
  if (masterSha256 !== receipt.masterSha256) {
    throw new ListeningReviewError(
      `This listen covers master ${short(masterSha256)}, not this master ${short(receipt.masterSha256)}; `
      + "a listen to other bytes is stale.",
    );
  }
  if (receiptDigest !== receipt.digest) {
    throw new ListeningReviewError(
      `This listen covers receipt ${short(receiptDigest)}, not this receipt ${short(receipt.digest)}; `
      + "a listen recorded against another receipt is stale.",
    );
  }

  const issued: ListeningReview = Object.freeze({
    method,
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
    masterSha256,
    receiptDigest,
    notes: Object.freeze([...(raw.notes as string[])]),
  });
  ISSUED_LISTENING_REVIEWS.add(issued);
  return issued;
}

/** True only for a record `recordListeningReview` issued, unaltered. */
export function isIssuedListeningReview(value: unknown): value is ListeningReview {
  return typeof value === "object" && value !== null && ISSUED_LISTENING_REVIEWS.has(value);
}
