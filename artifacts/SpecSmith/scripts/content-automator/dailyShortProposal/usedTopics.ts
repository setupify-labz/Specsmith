// Which topics a person has already taken from the review queue.
//
// The automatic pick skips a topic once it is marked here, so each run proposes
// the next eligible one without --topic. An entry records only what happened:
// a named person took the topic for review at a time (its proposal and cut go on
// to fact-check and video review). It does not say the Short was fact-checked,
// approved, voiced, scheduled or published; nothing in this job does those.
//
// The committed ledger (used-topics.json) starts empty. Demonstrations and tests
// mark topics in a temporary copy (--used <path>), never in the committed file.

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DailyProposalError } from "./snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_USED_LEDGER = resolve(here, "used-topics.json");

export interface UsedEntry {
  readonly topicId: string;
  /** When the person took the topic for review (ISO 8601). */
  readonly markedAt: string;
  /** Who took it: a person's name or handle. */
  readonly by: string;
  readonly note: string;
}
export interface UsedLedger { readonly kind: "daily-short-used-topics"; readonly version: 1; readonly entries: readonly UsedEntry[] }

export function emptyLedger(): UsedLedger { return { kind: "daily-short-used-topics", version: 1, entries: [] }; }

/** Validates a ledger document against the topic library; throws a DailyProposalError naming what is wrong. */
export function parseUsedLedger(raw: unknown, knownTopicIds: readonly string[], now = new Date()): UsedLedger {
  const doc = raw as Partial<UsedLedger> | null;
  if (!doc || doc.kind !== "daily-short-used-topics" || doc.version !== 1 || !Array.isArray(doc.entries)) {
    throw new DailyProposalError("ledger-invalid", "The used-topic ledger must be {\"kind\": \"daily-short-used-topics\", \"version\": 1, \"entries\": [...]}.");
  }
  const seen = new Set<string>();
  doc.entries.forEach((e: Partial<UsedEntry>, i) => {
    if (!e || typeof e.topicId !== "string" || typeof e.by !== "string" || typeof e.note !== "string" || typeof e.markedAt !== "string") {
      throw new DailyProposalError("ledger-invalid", `Ledger entry ${i} needs topicId, markedAt, by and note.`);
    }
    if (!knownTopicIds.includes(e.topicId)) throw new DailyProposalError("ledger-invalid", `Ledger entry ${i} names "${e.topicId}", which is not in the topic library.`);
    if (seen.has(e.topicId)) throw new DailyProposalError("ledger-invalid", `"${e.topicId}" is marked used twice.`);
    seen.add(e.topicId);
    if (e.by.trim() === "") throw new DailyProposalError("ledger-invalid", `Ledger entry ${i} does not say who took "${e.topicId}".`);
    const at = Date.parse(e.markedAt);
    if (!Number.isFinite(at)) throw new DailyProposalError("ledger-invalid", `Ledger entry ${i} has an unreadable markedAt.`);
    if (at > now.getTime() + 60_000) throw new DailyProposalError("ledger-invalid", `Ledger entry ${i} is dated in the future (${e.markedAt}).`);
  });
  return doc as UsedLedger;
}

export async function loadUsedLedger(path: string, knownTopicIds: readonly string[], now = new Date()): Promise<{ ledger: UsedLedger; sha256: string; path: string }> {
  let bytes: Buffer;
  try { bytes = await readFile(path); } catch { throw new DailyProposalError("ledger-invalid", `No used-topic ledger at ${path}.`); }
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new DailyProposalError("ledger-invalid", `The used-topic ledger at ${path} is not JSON.`); }
  return { ledger: parseUsedLedger(raw, knownTopicIds, now), sha256: createHash("sha256").update(bytes).digest("hex"), path };
}

/** Adds one entry and rewrites the ledger atomically (a temporary file renamed into place). Refuses duplicates and unknown topics. */
export async function markTopicUsed(path: string, entry: { topicId: string; by: string; note?: string }, knownTopicIds: readonly string[], now = new Date()): Promise<UsedLedger> {
  const { ledger } = await loadUsedLedger(path, knownTopicIds, now);
  const next: UsedLedger = { ...ledger, entries: [...ledger.entries, { topicId: entry.topicId, markedAt: now.toISOString(), by: entry.by, note: entry.note ?? "" }] };
  parseUsedLedger(next, knownTopicIds, now);
  const tmp = join(dirname(path), `.${Date.now()}-${process.pid}.used-topics.tmp`);
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, path);
  return next;
}
