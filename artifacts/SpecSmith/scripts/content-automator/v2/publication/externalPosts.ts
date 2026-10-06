// MASTER #8: posts that were published OUTSIDE the authorization boundary.
//
// The RAM-fit and FPS Shorts went out before MASTER #8's approval path existed
// in production (Metricool auto-published at least one of them). They are real
// posts, so the learning loop should know about them, but they never passed
// recordMachineReview -> authorizePublication -> confirmProviderState. Writing
// them into a publication ledger, or giving them an AuthorizedPublication, would
// claim an approval that did not happen.
//
// So they live in their own records, apart from the ledger:
//
//   - `machineAuthorized: false` is a literal, checked on every read.
//   - Nothing here touches publishingStore: no ledger, no authorization, no
//     provider-post index. buildLearningReport (authorized publications only)
//     does not count these posts.
//   - Every fact carries its source: `user-provided` (and who supplied it),
//     `connector-reported` (an authenticated connector returned it elsewhere
//     and it was relayed here), `file-measured` (and the file's SHA-256), or
//     `provider-reported`, which must cite a real trusted observation stored
//     for the same platform, post and account. Unknown facts are null with a
//     reason. A scheduled time is its own fact, never a publication time.
//   - Facts are completed or corrected by appending a correction. The original
//     record and every correction are kept; the current value is the latest
//     correction for that field, and every replay step is re-validated. A
//     post's identity (platform, post id) is never corrected: a different post
//     is a different record.
//   - Numbers arrive two ways, kept apart:
//       * authenticated observations from a registered source, through
//         importExternalPostObservations (same trust check as any other);
//       * exploratory evidence: numbers a person read off a dashboard, or a
//         connector snapshot relayed from elsewhere (possibly delayed, not
//         fetched here), kept through recordUnverifiedObservations and shown
//         only as EXPLORATORY context: not a verified metric, never ranked or
//         compared, never causal.
//
// externalPostReport walks post -> report -> next-brief input, with values,
// collection times and source references, and keeps observations, exploratory
// context, hypotheses and unknowns apart. It never publishes, schedules,
// approves a claim or moves a ledger.

import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoPlatform } from "../../types.ts";
import { sha256Json } from "../review/util.ts";
import type { NextBriefInput } from "./learningReport.ts";
import {
  externalPostKey,
  loadObservations,
  loadUnverifiedObservations,
  PRODUCTION_OBSERVATION_SOURCES,
  recordUnverifiedObservations,
  type ObservationRecord,
} from "./observations.ts";
import { metricsAccessFor, platformAccessStatus } from "./platformAccess.ts";
import { publicationStoreMode } from "../../publishingStore.ts";

export const EXTERNAL_POST_VERSION = "external-post-v2";
export const EXTERNAL_CORRECTION_VERSION = "external-post-correction-v1";
export const DASHBOARD_EVIDENCE_KIND = "DASHBOARD_EVIDENCE" as const;

export class ExternalPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalPostError";
  }
}

/**
 * Where a fact came from.
 *   user-provided       a person said so (and the record says who)
 *   connector-reported  an authenticated connector (e.g. Metricool's) returned it to
 *                       someone else, who relayed it here; this environment did not
 *                       fetch it and cannot re-check it
 *   file-measured       measured from a media file, named by its SHA-256
 *   provider-reported   a trusted observation stored here, for this same post and
 *                       account, reported it (checked against the store)
 */
export type FactSource = "user-provided" | "connector-reported" | "file-measured" | "provider-reported";
const FACT_SOURCES: readonly FactSource[] = ["user-provided", "connector-reported", "file-measured", "provider-reported"];

export interface SourcedFact<T> {
  readonly value: T | null;
  readonly source: FactSource | null;
  /** Who supplied it, which file it was measured from, which connector returned it; or why it is unknown. */
  readonly basis: string;
  /** For provider-reported facts: the trusted observation that reported it. */
  readonly observationId?: string;
}

/** What could be measured from a copy of the published video. */
export interface MediaEvidence {
  readonly fileName: string;
  readonly sha256: string;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  /** The container's creation_time tag. A re-encode time, not a publication time. */
  readonly containerCreatedAt: string | null;
  readonly encoder: string | null;
  /** Where this copy came from, as far as is known. */
  readonly origin: string;
}

type Unknown = { readonly value: null; readonly basis: string };
type Supplied<T> = { readonly value: T; readonly source: FactSource; readonly basis: string; readonly observationId?: string };
type FactInput = Supplied<string> | Unknown;

/** Every fact an external post carries besides its identity (platform + post id + URL). */
export const FACT_FIELDS = [
  "creativeId", "creativeVersion", "sourceMediaSha256",
  "publishedVia", "aggregatorPostId", "providerStatus", "scheduledAt", "publishedAt",
  "accountId", "handle",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];
/** All of them may be completed or corrected later; the identity never is. */
export const CORRECTABLE_FIELDS = FACT_FIELDS;
export type CorrectableField = FactField;

export interface ExternalPostInput {
  readonly platform: VideoPlatform;
  /** The URL and where it came from. */
  readonly postUrl: Supplied<string>;
  /** Stable creative identifier, e.g. "fps-20-wins@ce47598". */
  readonly creativeId: FactInput;
  readonly creativeVersion: FactInput;
  /** SHA-256 of the render that was uploaded, when known. */
  readonly sourceMediaSha256: FactInput;
  /** "metricool-scheduled", "manual-upload", … */
  readonly publishedVia: FactInput;
  /** The publishing tool's own post id (e.g. Metricool's), shared across the platforms it posted to. */
  readonly aggregatorPostId: FactInput;
  /** The status the publishing tool reported for this platform, e.g. "PUBLISHED". */
  readonly providerStatus: FactInput;
  /** When the post was SCHEDULED to go out. Not proof of when it actually did. */
  readonly scheduledAt: FactInput;
  /** When the post actually went out, when someone or something confirmed it. */
  readonly publishedAt: FactInput;
  /** The platform API's own account identifier (YouTube channel id, TikTok open_id, Instagram business account id). */
  readonly accountId: FactInput;
  /** The public handle, e.g. "@specsmithpc". Not an API account identifier. */
  readonly handle: FactInput;
  /** A copy of the post as published, when supplied. */
  readonly media: MediaEvidence | null;
  readonly notes?: readonly string[];
}

export type ExternalPostRecord = {
  readonly version: typeof EXTERNAL_POST_VERSION;
  readonly kind: "EXTERNAL_PUBLICATION";
  /** Always false. These posts never passed MASTER #8's review and approval boundary. */
  readonly machineAuthorized: false;
  readonly recordId: string;
  readonly recordedAt: string;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  readonly postUrl: SourcedFact<string>;
  readonly media: MediaEvidence | null;
  readonly notes: readonly string[];
} & { readonly [K in FactField]: SourcedFact<string> };

export interface ExternalPostCorrection {
  readonly version: typeof EXTERNAL_CORRECTION_VERSION;
  readonly correctionId: string;
  readonly sequence: number;
  readonly recordId: string;
  readonly field: CorrectableField;
  readonly previous: SourcedFact<string>;
  readonly next: SourcedFact<string>;
  readonly reason: string;
  readonly suppliedBy: string;
  readonly at: string;
}

/** The record with every correction applied, plus the history that produced it. */
export type ResolvedExternalPost = ExternalPostRecord & { readonly corrections: readonly ExternalPostCorrection[] };

/** The platform's own post id, read from its URL. Null when the URL is not that platform's post URL. */
export function nativePostIdFromUrl(platform: VideoPlatform, url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^(www|m|vm)\./, "");
  const path = parsed.pathname;
  if (platform === "youtube-shorts") {
    if (host === "youtube.com") return path.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? (path === "/watch" ? parsed.searchParams.get("v")?.match(/^[A-Za-z0-9_-]{11}$/)?.[0] ?? null : null);
    if (host === "youtu.be") return path.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    return null;
  }
  if (platform === "tiktok") return host === "tiktok.com" ? path.match(/^\/@[\w.-]+\/video\/(\d{8,25})\/?$/)?.[1] ?? null : null;
  if (platform === "instagram-reels") return host === "instagram.com" ? path.match(/^\/(?:[\w.]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]{5,40})\/?$/)?.[1] ?? null : null;
  return null;
}

const directory = (storeRoot: string) => join(storeRoot, "external-posts");
const recordFile = (storeRoot: string, platform: VideoPlatform, nativePostId: string) => join(directory(storeRoot), `${platform}-${nativePostId}.json`);
const correctionsDir = (storeRoot: string, platform: VideoPlatform, nativePostId: string) => join(directory(storeRoot), `${platform}-${nativePostId}.corrections`);

async function writeExclusive(path: string, value: unknown): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function checkTimestamp(value: string, what: string) {
  if (!Number.isFinite(Date.parse(value)) || !/T\d{2}:\d{2}/.test(value) || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new ExternalPostError(`${what} "${value}" must be a full timestamp with a timezone (e.g. 2026-10-03T19:30:00-04:00). Leave it unknown with a reason when it is not known.`);
  }
}

const TIMESTAMP_FIELDS: readonly string[] = ["publishedAt", "scheduledAt"];

/**
 * Which value in an observation reports which post fact. Only the account: the
 * provider returns it with the numbers. Every other identity value an
 * observation carries (creative, variant, media hash, publication time) was
 * copied into it FROM this record at import, so citing it would be circular,
 * and a metric (views, likes, …) says nothing about any fact here. A
 * provider-reported fact for any other field is refused.
 */
const OBSERVATION_SUPPORT: Partial<Record<string, (record: ObservationRecord) => string>> = {
  accountId: (record) => record.accountId,
};

/** Validate a stored fact's shape: used when a fact is first written AND every time one is read back. */
function validateFact(field: string, entry: SourcedFact<string> | undefined): SourcedFact<string> {
  if (!entry || typeof entry !== "object" || typeof entry.basis !== "string" || !entry.basis.trim()) {
    throw new ExternalPostError(`${field} must carry a basis: who supplied it, what it was measured from, or why it is unknown.`);
  }
  if (entry.value === null) {
    if (entry.source !== null || entry.observationId !== undefined) throw new ExternalPostError(`An unknown ${field} cannot carry a source.`);
    return entry;
  }
  if (typeof entry.value !== "string" || !entry.value.trim()) throw new ExternalPostError(`${field} must be text, or unknown.`);
  if (!FACT_SOURCES.includes(entry.source as FactSource)) throw new ExternalPostError(`${field} has an unrecognised source "${entry.source}".`);
  if (entry.source === "provider-reported") {
    if (!OBSERVATION_SUPPORT[field]) throw new ExternalPostError(`No provider observation reports ${field}; it cannot be provider-reported. Record who supplied it instead.`);
    if (!/^obs-[a-f0-9]{24}$/.test(entry.observationId ?? "")) throw new ExternalPostError(`A provider-reported ${field} must name the trusted observation (observationId) that reported it.`);
  } else if (entry.observationId !== undefined) {
    throw new ExternalPostError(`Only a provider-reported ${field} may name an observation.`);
  }
  if (TIMESTAMP_FIELDS.includes(field)) {
    checkTimestamp(entry.value, field === "publishedAt" ? "Publication time" : "Scheduled time");
    if (new Date(entry.value).toISOString() !== entry.value) throw new ExternalPostError(`${field} must be stored in UTC ISO form.`);
  }
  if (field === "sourceMediaSha256" && !/^[a-f0-9]{64}$/.test(entry.value)) throw new ExternalPostError("A media hash must be a SHA-256 hex digest.");
  return entry;
}

function normalize(input: FactInput, field: string): SourcedFact<string> {
  if (input.value === null) return validateFact(field, { value: null, source: null, basis: input.basis });
  const supplied = input as Supplied<string>;
  if (TIMESTAMP_FIELDS.includes(field)) checkTimestamp(supplied.value, field === "publishedAt" ? "Publication time" : "Scheduled time");
  return validateFact(field, {
    value: TIMESTAMP_FIELDS.includes(field) ? new Date(supplied.value).toISOString() : supplied.value,
    source: supplied.source, basis: supplied.basis,
    ...(supplied.observationId !== undefined ? { observationId: supplied.observationId } : {}),
  });
}

const sameFact = (a: SourcedFact<string> | undefined, b: SourcedFact<string> | undefined) =>
  !!a && !!b && a.value === b.value && a.source === b.source && a.basis === b.basis && (a.observationId ?? null) === (b.observationId ?? null);

/** Whether this store would trust an observation record (the same rule the report uses). */
function trustedObservation(record: ObservationRecord, simulated: boolean): boolean {
  if (simulated) return record.sourceMechanism === "simulated";
  return record.sourceMechanism !== "simulated" && PRODUCTION_OBSERVATION_SOURCES.some((source) => source.sourceId === record.source);
}

/**
 * A provider-reported fact must point at a real, trusted observation stored for
 * this same platform, post and account, AND that observation must itself report
 * the exact value asserted for this field (OBSERVATION_SUPPORT). An id-shaped
 * string proves nothing; neither does a genuine observation of something else.
 */
async function checkProviderReference(storeRoot: string, post: { readonly platform: VideoPlatform; readonly nativePostId: string; readonly accountId: string | null }, field: string, entry: SourcedFact<string>) {
  if (entry.source !== "provider-reported") return;
  const simulated = (await publicationStoreMode(storeRoot)) === "simulation";
  const records = await loadObservations(storeRoot, externalPostKey(post.platform, post.nativePostId));
  const record = records.find((candidate) => candidate.observationId === entry.observationId);
  // For the account itself, the observation must be about the account being asserted.
  const account = field === "accountId" ? entry.value : post.accountId;
  if (!record || !trustedObservation(record, simulated) || record.platform !== post.platform || record.providerPostId !== post.nativePostId || !account || record.accountId !== account) {
    throw new ExternalPostError(`${field} cites observation ${entry.observationId}, but no trusted observation with that id exists for ${post.platform} post ${post.nativePostId} on account ${account ?? "(unknown)"}.`);
  }
  const support = OBSERVATION_SUPPORT[field];
  const reported = support ? support(record) : null;
  if (reported === null || reported !== entry.value) {
    throw new ExternalPostError(`${field} cites observation ${entry.observationId} (${record.metricId}), which does not report ${field} = ${entry.value}${support ? `; it reports ${reported}` : ""}.`);
  }
}

/** Record one externally published post. Refuses rather than guesses. */
export async function recordExternalPost(input: { readonly storeRoot: string; readonly post: ExternalPostInput; readonly now?: Date }): Promise<ExternalPostRecord> {
  const { post } = input;
  const nativeId = nativePostIdFromUrl(post.platform, post.postUrl?.value ?? "");
  if (!nativeId) throw new ExternalPostError(`${post.postUrl?.value} is not a ${post.platform} post URL; refusing to record it.`);
  const postUrl = validateFact("postUrl", { value: post.postUrl.value, source: post.postUrl.source, basis: post.postUrl.basis });
  if (postUrl.source === "provider-reported" || postUrl.source === "file-measured") throw new ExternalPostError("A post URL is supplied by a person or a connector.");
  const facts = Object.fromEntries(FACT_FIELDS.map((field) => [field, normalize(post[field], field)])) as { [K in FactField]: SourcedFact<string> };
  if (FACT_FIELDS.some((field) => facts[field].source === "file-measured") && !post.media) {
    throw new ExternalPostError("A fact measured from a file must come with that file's evidence.");
  }
  for (const field of FACT_FIELDS) {
    await checkProviderReference(input.storeRoot, { platform: post.platform, nativePostId: nativeId, accountId: facts.accountId.value }, field, facts[field]);
  }
  const body = { platform: post.platform, nativeId, postUrl, facts, media: post.media?.sha256 ?? null };
  const record: ExternalPostRecord = {
    version: EXTERNAL_POST_VERSION,
    kind: "EXTERNAL_PUBLICATION",
    machineAuthorized: false,
    recordId: `external-${post.platform}-${nativeId}-${sha256Json(body).slice(0, 12)}`,
    recordedAt: (input.now ?? new Date()).toISOString(),
    platform: post.platform,
    nativePostId: nativeId,
    postUrl,
    ...facts,
    media: post.media,
    notes: [...(post.notes ?? [])],
  };
  await mkdir(directory(input.storeRoot), { recursive: true });
  const path = recordFile(input.storeRoot, post.platform, nativeId);
  if (await writeExclusive(path, record)) return record;
  const existing = JSON.parse(await readFile(path, "utf8")) as ExternalPostRecord;
  if (existing.recordId !== record.recordId) {
    throw new ExternalPostError(`${post.platform} post ${nativeId} is already recorded (${existing.recordId}); records are not overwritten. Use correctExternalPost to complete or correct a fact.`);
  }
  return existing;
}

/**
 * Complete or correct one fact by appending a correction. The record and every
 * earlier correction are kept. An identical fact is refused as a no-op.
 */
export async function correctExternalPost(input: {
  readonly storeRoot: string;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  readonly field: CorrectableField;
  readonly next: FactInput;
  readonly reason: string;
  readonly suppliedBy: string;
  readonly now?: Date;
}): Promise<ExternalPostCorrection> {
  if (!(CORRECTABLE_FIELDS as readonly string[]).includes(input.field)) {
    throw new ExternalPostError(`${input.field} cannot be corrected. A post's platform, id and URL are its identity: a different post is a different record.`);
  }
  if (!input.reason?.trim() || !input.suppliedBy?.trim()) throw new ExternalPostError("A correction must give its reason and who supplied it.");
  const current = await resolveExternalPost(input.storeRoot, input.platform, input.nativePostId);
  if (!current) throw new ExternalPostError(`${input.platform} post ${input.nativePostId} is not recorded.`);
  const previous = current[input.field];
  const next = normalize(input.next, input.field);
  if (next.source === "file-measured" && !current.media) throw new ExternalPostError("A fact measured from a file must come with that file's evidence.");
  await checkProviderReference(input.storeRoot, { platform: current.platform, nativePostId: current.nativePostId, accountId: input.field === "accountId" ? next.value : current.accountId.value }, input.field, next);
  if (sameFact(previous, next)) throw new ExternalPostError(`${input.field} is already ${next.value ?? "unknown"}; nothing to correct.`);
  const sequence = current.corrections.length + 1;
  const at = (input.now ?? new Date()).toISOString();
  const correction: ExternalPostCorrection = {
    version: EXTERNAL_CORRECTION_VERSION,
    correctionId: `correction-${sha256Json({ recordId: current.recordId, sequence, field: input.field, previous, next, at }).slice(0, 16)}`,
    sequence, recordId: current.recordId, field: input.field, previous, next, reason: input.reason, suppliedBy: input.suppliedBy, at,
  };
  const dir = correctionsDir(input.storeRoot, input.platform, input.nativePostId);
  await mkdir(dir, { recursive: true });
  if (!(await writeExclusive(join(dir, `${String(sequence).padStart(4, "0")}.json`), correction))) {
    throw new ExternalPostError("Another correction was recorded at the same time; reload and retry.");
  }
  return correction;
}

function checkRecord(record: ExternalPostRecord) {
  if (record.version !== EXTERNAL_POST_VERSION || record.kind !== "EXTERNAL_PUBLICATION" || record.machineAuthorized !== false) {
    throw new ExternalPostError(`Malformed external post record ${record.recordId ?? "(no id)"}; refusing to read it.`);
  }
  if (nativePostIdFromUrl(record.platform, record.postUrl?.value ?? "") !== record.nativePostId) {
    throw new ExternalPostError(`External post record ${record.recordId}'s URL does not match its post id; refusing to read it.`);
  }
  validateFact("postUrl", record.postUrl);
  for (const field of FACT_FIELDS) validateFact(field, record[field]);
}

/**
 * The post as currently known: the original record with its corrections
 * replayed in order. Each replay step is checked, not trusted: the correction's
 * `previous` must equal the fact as it stands at that point, its replacement
 * must be a valid fact, and a provider-reported replacement must cite a real
 * trusted observation for this post and account. Anything else refuses the read.
 */
export async function resolveExternalPost(storeRoot: string, platform: VideoPlatform, nativePostId: string): Promise<ResolvedExternalPost | null> {
  let record: ExternalPostRecord;
  try { record = JSON.parse(await readFile(recordFile(storeRoot, platform, nativePostId), "utf8")) as ExternalPostRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  checkRecord(record);
  for (const field of FACT_FIELDS) await checkProviderReference(storeRoot, { platform, nativePostId, accountId: record.accountId.value }, field, record[field]);
  let names: string[] = [];
  try { names = (await readdir(correctionsDir(storeRoot, platform, nativePostId))).filter((name) => /^\d{4}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const corrections: ExternalPostCorrection[] = [];
  const resolved: Record<string, unknown> = { ...record };
  for (const name of names) {
    const correction = JSON.parse(await readFile(join(correctionsDir(storeRoot, platform, nativePostId), name), "utf8")) as ExternalPostCorrection;
    const refuse = (why: string): never => { throw new ExternalPostError(`Correction ${name} for ${record.recordId} ${why}; refusing to read the post.`); };
    if (correction.version !== EXTERNAL_CORRECTION_VERSION || correction.recordId !== record.recordId) refuse("is malformed");
    if (correction.sequence !== corrections.length + 1) refuse("is out of order");
    if (!(CORRECTABLE_FIELDS as readonly string[]).includes(correction.field)) refuse(`changes ${correction.field}, which is not correctable`);
    const field = correction.field;
    if (!sameFact(correction.previous, resolved[field] as SourcedFact<string>)) refuse(`expects ${field} to be ${correction.previous?.value ?? "unknown"}, but at that point it is ${(resolved[field] as SourcedFact<string>).value ?? "unknown"}`);
    try {
      validateFact(field, correction.next);
      await checkProviderReference(storeRoot, { platform, nativePostId, accountId: (resolved.accountId as SourcedFact<string>).value }, field, correction.next);
    } catch (error) {
      refuse(`has an invalid replacement: ${(error as Error).message}`);
    }
    if (correction.next.source === "file-measured" && !record.media) refuse("claims a file measurement with no file evidence");
    corrections.push(correction);
    resolved[field] = correction.next;
  }
  return { ...(resolved as unknown as ExternalPostRecord), corrections };
}

export async function loadExternalPosts(storeRoot: string): Promise<ResolvedExternalPost[]> {
  let names: string[];
  try { names = await readdir(directory(storeRoot)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const posts: ResolvedExternalPost[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const record = JSON.parse(await readFile(join(directory(storeRoot), name), "utf8")) as ExternalPostRecord;
    checkRecord(record);
    posts.push((await resolveExternalPost(storeRoot, record.platform, record.nativePostId))!);
  }
  return posts;
}

// ---------------------------------------------------------------------------
// User-provided dashboard evidence: exploratory context only
// ---------------------------------------------------------------------------

export interface DashboardValue {
  /** The dashboard's own label, verbatim ("Views", "Viewed vs. swiped away"). Not mapped onto SpecSmith's metric ids. */
  readonly label: string;
  readonly value: number | string;
  readonly unit?: string;
  /** The window the dashboard showed, verbatim ("Since published", "Last 7 days"). */
  readonly window?: string;
}

/**
 * How the numbers reached this repository.
 *   user-read-dashboard          a person read them off a dashboard or screenshot
 *   relayed-connector-snapshot   an authenticated connector returned them to another
 *                                assistant, which relayed them here; possibly delayed,
 *                                not fetched or re-checked by this environment
 */
export type ExploratoryOrigin = "user-read-dashboard" | "relayed-connector-snapshot";

export interface UnavailableValue {
  readonly label: string;
  readonly reason: string;
}

export interface DashboardEvidence {
  readonly kind: typeof DASHBOARD_EVIDENCE_KIND;
  /** Defaults to user-read-dashboard. */
  readonly origin?: ExploratoryOrigin;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  /** e.g. "YouTube Studio", "Metricool", "TikTok app analytics". */
  readonly dashboard: string;
  /** When the numbers were read (with timezone), or null when that was not supplied. */
  readonly readAt: string | null;
  /** Why readAt is unknown; required when it is null. */
  readonly readAtBasis?: string;
  /** What it was read from: a screenshot file name and its SHA-256, or "typed from the screen". */
  readonly sourceReference: string;
  readonly values: readonly DashboardValue[];
  /** Values that were asked for or expected and are not available, with why. */
  readonly unavailable?: readonly UnavailableValue[];
}

/**
 * Keep numbers a person read off a dashboard, as EXPLORATORY context. Stored
 * through recordUnverifiedObservations (verification: "unverified"), keyed by
 * platform and post so a YouTube screenshot can never attach to the TikTok
 * copy of the same video. They are never observations, never compared, and
 * never move a ledger.
 */
export async function recordDashboardEvidence(input: {
  readonly storeRoot: string;
  readonly suppliedBy: string;
  readonly evidence: Omit<DashboardEvidence, "kind">;
  readonly now?: Date;
}) {
  const { evidence } = input;
  const post = await resolveExternalPost(input.storeRoot, evidence.platform, evidence.nativePostId);
  if (!post) throw new ExternalPostError(`${evidence.platform} post ${evidence.nativePostId} is not recorded; record the post before attaching evidence to it.`);
  if (!evidence.dashboard?.trim() || !evidence.sourceReference?.trim()) throw new ExternalPostError("Dashboard evidence must name the dashboard and what it was read from.");
  const origin = evidence.origin ?? "user-read-dashboard";
  if (origin !== "user-read-dashboard" && origin !== "relayed-connector-snapshot") throw new ExternalPostError(`Unrecognised evidence origin "${origin}".`);
  if (evidence.readAt === null) {
    if (!evidence.readAtBasis?.trim()) throw new ExternalPostError("When the read time is unknown, say why (readAtBasis).");
  } else {
    checkTimestamp(evidence.readAt, "The time the dashboard was read");
    if (Date.parse(evidence.readAt) > (input.now ?? new Date()).getTime()) throw new ExternalPostError("The dashboard cannot have been read in the future.");
  }
  if ((evidence.unavailable ?? []).some((entry) => !entry.label?.trim() || !entry.reason?.trim())) throw new ExternalPostError("Each unavailable value needs its label and why.");
  if (!evidence.values.length || evidence.values.some((value) => !value.label?.trim() || (typeof value.value === "number" && !Number.isFinite(value.value)))) {
    throw new ExternalPostError("Each dashboard value needs its dashboard label and a finite value.");
  }
  return recordUnverifiedObservations({
    storeRoot: input.storeRoot,
    providerPostId: externalPostKey(evidence.platform, evidence.nativePostId),
    suppliedBy: input.suppliedBy,
    supplied: { kind: DASHBOARD_EVIDENCE_KIND, ...evidence, origin },
    now: input.now,
  });
}

// ---------------------------------------------------------------------------
// Post -> report -> next-brief input
// ---------------------------------------------------------------------------

export interface ReportedObservation {
  readonly metricId: string;
  readonly providerField: string | null;
  readonly value: number | null;
  readonly unit: string | null;
  readonly state: ObservationRecord["state"];
  readonly collectedAt: string;
  readonly publicationAgeHours: number;
  readonly source: string;
  readonly observationId: string;
  readonly definitionId: string | null;
}

export interface MetricAvailability {
  readonly metricId: string;
  readonly providerField: string | null;
  readonly reason: string;
}

const EXPLORATORY_LABELS = {
  "user-read-dashboard": "EXPLORATORY: user-provided dashboard evidence, not verified, not a metric, not causal",
  "relayed-connector-snapshot": "EXPLORATORY: relayed connector snapshot, possibly delayed, not fetched by this environment, not a verified metric, not causal",
} as const;

export interface ExploratoryEvidence {
  readonly label: (typeof EXPLORATORY_LABELS)[ExploratoryOrigin];
  readonly origin: ExploratoryOrigin;
  readonly dashboard: string;
  readonly readAt: string | null;
  readonly readAtBasis: string | null;
  readonly unavailable: readonly UnavailableValue[];
  readonly sourceReference: string;
  readonly suppliedBy: string;
  readonly receivedAt: string;
  readonly evidenceSha256: string;
  readonly values: readonly DashboardValue[];
}

/** A creative measurement taken from a file, kept beside its evidence. */
export interface CreativeMeasurement {
  readonly creativeId: string;
  readonly statement: string;
  readonly evidence: string;
}

/** One proposed creative change: a hypothesis, with what it rests on and how it would be tested. */
export interface CreativeChange {
  readonly change: string;
  readonly appliesTo: string;
  readonly restsOn: readonly string[];
  readonly hypothesis: string;
  readonly testWith: string;
  readonly status: string;
}

export interface ReportedPost {
  readonly recordId: string;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  readonly postUrl: string;
  readonly creativeId: SourcedFact<string>;
  readonly creativeVersion: SourcedFact<string>;
  readonly publishedVia: SourcedFact<string>;
  readonly aggregatorPostId: SourcedFact<string>;
  readonly providerStatus: SourcedFact<string>;
  /** When it was scheduled to go out; not a confirmed publication time. */
  readonly scheduledAt: SourcedFact<string>;
  readonly publishedAt: SourcedFact<string>;
  readonly accountId: SourcedFact<string>;
  readonly handle: SourcedFact<string>;
  readonly sourceMediaSha256: SourcedFact<string>;
  readonly publishedCopySha256: string | null;
  readonly ageHours: number | null;
  readonly corrections: readonly { readonly field: string; readonly from: string | null; readonly to: string | null; readonly at: string; readonly reason: string }[];
  /** Trusted, authenticated observations with values, times and sources. */
  readonly observations: readonly ReportedObservation[];
  /** Metrics this platform documents that no trusted observation covers, with why. */
  readonly notObserved: readonly MetricAvailability[];
  readonly exploratory: readonly ExploratoryEvidence[];
}

export interface ExternalPostReport {
  readonly version: "external-post-report-v2";
  readonly reportId: string;
  readonly generatedAt: string;
  readonly posts: readonly ReportedPost[];
  readonly creativesWithoutPosts: readonly string[];
  /** Supplied, connector-relayed, file-measured or provider-reported facts, each labelled with its source. */
  readonly observations: readonly string[];
  /** User-provided dashboard numbers: context to look at, never evidence of an effect. */
  readonly exploratoryContext: readonly string[];
  /** Possible explanations or bets. Never conclusions. */
  readonly hypotheses: readonly string[];
  readonly unknowns: readonly string[];
  readonly recommendation: CreativeChange | null;
  readonly nextBrief: NextBriefInput;
}

const CONSTRAINTS = [
  "Every factual claim, figure and disclosure stays exactly as research and MASTER #7 require; performance data never changes what may be said.",
  "These posts were published outside the MASTER #8 authorization boundary; nothing here records or implies their approval.",
  "User-provided dashboard numbers are exploratory context, not verified metrics and not evidence of what caused a result.",
  "The recommended change is a creative execution choice to test, not an approved claim, a schedule, or an authorization to publish.",
  "The next concepts go through research, the creative workflow, rendering, MASTER #7 review and trusted human approval like any other.",
];

const shown = (value: string | null) => value ?? "unknown";
const describeMedia = (creativeId: string, media: MediaEvidence) =>
  `${creativeId}: published copy ${media.fileName} (sha256 ${media.sha256}; ${media.origin}) is ${media.durationSeconds.toFixed(2)} s, ${media.frames} frames at ${media.width}x${media.height} (file-measured).`;
const describe = (entry: DashboardValue) => `${entry.label}: ${entry.value}${entry.unit ? ` ${entry.unit}` : ""}${entry.window ? ` (${entry.window})` : ""}`;

export async function externalPostReport(input: {
  readonly storeRoot: string;
  /** Creatives known to be published whose post locations were not supplied. */
  readonly creativesWithoutPosts?: readonly { readonly creativeId: string; readonly media: MediaEvidence | null; readonly sourceMediaSha256?: string | null; readonly note: string }[];
  readonly measurements?: readonly CreativeMeasurement[];
  readonly recommendation?: CreativeChange | null;
  /** Access facts from a probe, reported as the cause of missing observations. */
  readonly accessFindings?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
}): Promise<ExternalPostReport> {
  const now = input.now ?? new Date();
  const simulated = (await publicationStoreMode(input.storeRoot)) === "simulation";
  const posts = await loadExternalPosts(input.storeRoot);
  const trusted = new Set(PRODUCTION_OBSERVATION_SOURCES.map((source) => source.sourceId));
  const observations: string[] = [];
  const exploratoryContext: string[] = [];
  const unknowns: string[] = [];
  const reported: ReportedPost[] = [];
  const observationIds: string[] = [];
  // One description per published copy, however many platforms carry it.
  const describedMedia = new Set<string>();

  for (const post of posts) {
    const key = externalPostKey(post.platform, post.nativePostId);
    const label = `${shown(post.creativeId.value)} on ${post.platform}`;
    // Only what a registered source issued for this store's mode.
    const stored = (await loadObservations(input.storeRoot, key))
      .filter((record) => record.platform === post.platform && record.providerPostId === post.nativePostId)
      .filter((record) => simulated ? record.sourceMechanism === "simulated" : record.sourceMechanism !== "simulated" && trusted.has(record.source))
      .sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt) || a.metricId.localeCompare(b.metricId));
    const reportedObservations: ReportedObservation[] = stored.filter((record) => record.state !== "unavailable").map((record) => ({
      metricId: record.metricId, providerField: record.providerField, value: record.value, unit: record.unit, state: record.state,
      collectedAt: record.collectedAt, publicationAgeHours: record.publicationAgeHours, source: record.source,
      observationId: record.observationId, definitionId: record.definitionId,
    }));
    observationIds.push(...reportedObservations.map((record) => record.observationId));
    const status = platformAccessStatus(post.platform, input.env ?? process.env);
    const notObserved = metricsAccessFor(post.platform).metrics
      .filter((metric) => !reportedObservations.some((record) => record.metricId === metric.metricId))
      .map((metric) => {
        const unavailable = stored.filter((record) => record.metricId === metric.metricId && record.state === "unavailable").at(-1);
        const reason = !metric.servedByProvider
          ? `not served by the ${post.platform} API: ${metric.absenceReason ?? "no such field"}`
          : unavailable
            ? `the trusted source reported it unavailable at ${unavailable.collectedAt}: ${unavailable.unavailableReason ?? ""}`.trim()
            : stored.length
              ? "not returned by the trusted source"
              : `no trusted observation (${status.state}${status.blockedHosts.length ? `: ${status.blockedHosts.join(", ")} refused by the network policy` : ""}${status.missingCredentials.length ? `; missing ${status.missingCredentials.join(", ")}` : ""})`;
        return { metricId: metric.metricId, providerField: metric.providerField, reason };
      });

    const exploratory: ExploratoryEvidence[] = (await loadUnverifiedObservations(input.storeRoot, key)).flatMap((record) => {
      const supplied = record.supplied as Partial<DashboardEvidence> | null;
      if (supplied?.kind !== DASHBOARD_EVIDENCE_KIND || supplied.platform !== post.platform || supplied.nativePostId !== post.nativePostId) return [];
      const origin = supplied.origin ?? "user-read-dashboard";
      return [{
        label: EXPLORATORY_LABELS[origin], origin,
        dashboard: supplied.dashboard!, readAt: supplied.readAt ?? null, readAtBasis: supplied.readAtBasis ?? null,
        unavailable: supplied.unavailable ?? [], sourceReference: supplied.sourceReference!,
        suppliedBy: record.suppliedBy, receivedAt: record.receivedAt, evidenceSha256: record.sha256, values: supplied.values ?? [],
      }];
    });

    const publishedAt = post.publishedAt.value;
    const ageHours = publishedAt ? Math.round(((now.getTime() - Date.parse(publishedAt)) / 3_600_000) * 10) / 10 : null;
    reported.push({
      recordId: post.recordId, platform: post.platform, nativePostId: post.nativePostId, postUrl: post.postUrl.value!,
      creativeId: post.creativeId, creativeVersion: post.creativeVersion, publishedVia: post.publishedVia, aggregatorPostId: post.aggregatorPostId,
      providerStatus: post.providerStatus, scheduledAt: post.scheduledAt, publishedAt: post.publishedAt, accountId: post.accountId, handle: post.handle,
      sourceMediaSha256: post.sourceMediaSha256, publishedCopySha256: post.media?.sha256 ?? null, ageHours,
      corrections: post.corrections.map((entry) => ({ field: entry.field, from: entry.previous.value, to: entry.next.value, at: entry.at, reason: entry.reason })),
      observations: reportedObservations, notObserved, exploratory,
    });

    const toolStatus = post.providerStatus.value ? `; ${post.providerStatus.source} status ${post.providerStatus.value}` : "";
    const scheduled = post.scheduledAt.value ? `; scheduled for ${post.scheduledAt.value} (${post.scheduledAt.source}; a schedule, not a confirmed publication time)` : "";
    const aggregator = post.aggregatorPostId.value ? `; publishing-tool post id ${post.aggregatorPostId.value} (${post.aggregatorPostId.source})` : "";
    observations.push(`${label}: ${post.postUrl.value} [${post.postUrl.source}: ${post.postUrl.basis}]; published outside the MASTER #8 authorization boundary${post.publishedVia.value ? ` via ${post.publishedVia.value}` : ""}${aggregator}${toolStatus}${scheduled}.`);
    if (post.media && !describedMedia.has(post.media.sha256)) {
      describedMedia.add(post.media.sha256);
      observations.push(describeMedia(shown(post.creativeId.value), post.media));
    }
    for (const record of reportedObservations) {
      observations.push(`${label}: ${record.metricId} = ${record.value ?? "(curve)"}${record.unit && record.unit !== "count" ? ` ${record.unit}` : ""} at ${record.publicationAgeHours}h, collected ${record.collectedAt} by ${record.source} (${record.observationId}${record.definitionId ? `, ${record.definitionId}` : ""}).`);
    }
    for (const entry of exploratory) {
      const tag = entry.origin === "relayed-connector-snapshot" ? "EXPLORATORY, relayed connector snapshot, possibly delayed, not fetched here" : "EXPLORATORY, user-provided, unverified";
      const when = entry.readAt ? `at ${entry.readAt}` : `at an unknown time (${entry.readAtBasis})`;
      const missing = entry.unavailable.length ? ` Unavailable: ${entry.unavailable.map((value) => `${value.label} (${value.reason})`).join("; ")}.` : "";
      const age = publishedAt ? `published ${publishedAt}` : `actual publication time unknown${post.scheduledAt.value ? `, scheduled ${post.scheduledAt.value}` : ""}`;
      exploratoryContext.push(`${label} [${tag}]: ${entry.values.map(describe).join("; ")} — from ${entry.dashboard} ${when} (${entry.sourceReference}; supplied by ${entry.suppliedBy}; evidence sha256 ${entry.evidenceSha256.slice(0, 16)}…; ${age}).${missing} Not a verified metric; not ranked against other posts; says nothing about cause.`);
    }

    if (!publishedAt) unknowns.push(`${label}: actual publication time unknown (${post.publishedAt.basis})${post.scheduledAt.value ? `; it was scheduled for ${post.scheduledAt.value}, which is not used as the publication time` : ""}. Authenticated observations cannot be placed at a publication age until it is added with a correction.`);
    if (!post.accountId.value) unknowns.push(`${label}: platform account id unknown (${post.accountId.basis})${post.handle.value ? `; the handle ${post.handle.value} is known but is not that id` : ""}. Authenticated observations cannot be bound until it is added with a correction.`);
    if (!post.creativeId.value) unknowns.push(`${label}: which creative this post carries is unknown (${post.creativeId.basis}).`);
    if (!reportedObservations.length) unknowns.push(`${label}: no trusted observation is stored. ${status.missingCapability}`);
    const served = notObserved.filter((metric) => !metric.reason.startsWith("not served"));
    if (reportedObservations.length && served.length) unknowns.push(`${label}: not observed by the trusted source — ${served.map((metric) => metric.metricId).join(", ")}.`);
  }
  for (const creative of input.creativesWithoutPosts ?? []) {
    unknowns.push(`${creative.creativeId}: published, but no post URL was supplied for any platform (${creative.note}).`);
    if (creative.media && !describedMedia.has(creative.media.sha256)) {
      describedMedia.add(creative.media.sha256);
      observations.push(describeMedia(creative.creativeId, creative.media));
    }
  }
  for (const measurement of input.measurements ?? []) observations.push(`${measurement.creativeId}: ${measurement.statement} (${measurement.evidence})`);
  if (reported.length && reported.every((post) => !post.observations.length)) {
    for (const finding of input.accessFindings ?? []) unknowns.push(`Access: ${finding}`);
  }
  if (posts.length === 0) unknowns.push("No externally published post is recorded.");
  const withExploratory = reported.filter((post) => post.exploratory.length);
  if (withExploratory.length > 1) {
    unknowns.push(`Exploratory values exist for ${withExploratory.length} posts (${withExploratory.map((post) => `${post.platform}:${post.nativePostId}`).join(", ")}). They are not ranked or compared: the posts went out at different times (actual times unknown), so their numbers are at different ages, and relayed snapshots may be delayed.`);
  }
  if (new Set(reported.filter((post) => post.observations.length).map((post) => post.platform)).size > 1) {
    unknowns.push("Observations are from different platforms; their metric definitions differ, so they are not compared with each other.");
  }

  const recommendation = input.recommendation ?? null;
  const hypotheses = recommendation ? [recommendation.hypothesis] : [];
  const reportId = `external-${sha256Json({ generatedAt: now.toISOString(), posts: reported.map((post) => [post.recordId, post.corrections.length]), observations, exploratoryContext, hypotheses }).slice(0, 16)}`;
  const creativeIds = [...new Set([
    ...reported.map((post) => post.creativeId.value).filter((id): id is string => id !== null),
    ...(input.creativesWithoutPosts ?? []).map((creative) => creative.creativeId),
  ])];
  const mediaSha256s = [...new Set([
    ...reported.flatMap((post) => [post.sourceMediaSha256.value, post.publishedCopySha256]),
    ...(input.creativesWithoutPosts ?? []).flatMap((creative) => [creative.sourceMediaSha256 ?? null, creative.media?.sha256 ?? null]),
  ].filter((hash): hash is string => hash !== null))];
  const memoryObservations = [
    ...observations.map((line) => `Observation about published SpecSmith videos (context, not a rule; report ${reportId}): ${line}`),
    ...exploratoryContext.map((line) => `Exploratory context (report ${reportId}; user-provided and unverified, not a metric or a causal finding): ${line}`),
    ...(recommendation ? [`Creative change to test (report ${reportId}; a hypothesis, not a finding): ${recommendation.change} Rests on: ${recommendation.restsOn.join("; ")}. Test with: ${recommendation.testWith}`] : []),
  ];
  return {
    version: "external-post-report-v2",
    reportId,
    generatedAt: now.toISOString(),
    posts: reported,
    creativesWithoutPosts: (input.creativesWithoutPosts ?? []).map((creative) => creative.creativeId),
    observations,
    exploratoryContext,
    hypotheses,
    unknowns,
    recommendation,
    nextBrief: {
      version: "next-brief-input-v1",
      reportId,
      simulated,
      evidence: {
        creativeIds,
        providerPostIds: reported.map((post) => `${post.platform}:${post.nativePostId}`),
        mediaSha256s,
        reviewPacketIds: [],
        observationIds,
      },
      observations,
      hypotheses,
      unknowns,
      // Reserved for a valid single-variable performance comparison of authorized
      // publications (learningReport.ts). The craft change travels as a labelled
      // hypothesis in memoryObservations instead.
      proposedChange: null,
      constraints: CONSTRAINTS,
      memoryObservations,
    },
  };
}

export function formatExternalPostReport(report: ExternalPostReport): string {
  const lines: string[] = [];
  lines.push(`PUBLISHED-POST REPORT ${report.reportId}${report.nextBrief.simulated ? " — SIMULATED DATA, NOT REAL PERFORMANCE" : ""} — posts published outside the MASTER #8 authorization boundary`);
  lines.push(`Generated ${report.generatedAt}`, "", "Posts:");
  const factLine = (name: string, entry: SourcedFact<string>) => `      ${name}: ${entry.value ?? "unknown"} [${entry.source ?? "unknown"}; ${entry.basis}]`;
  for (const post of report.posts) {
    lines.push(`  - ${post.platform} ${post.postUrl} (machineAuthorized: false)`);
    lines.push(
      factLine("creative", post.creativeId), factLine("version", post.creativeVersion), factLine("published via", post.publishedVia),
      factLine("publishing-tool post id", post.aggregatorPostId), factLine("publishing-tool status", post.providerStatus),
      factLine("scheduled at (not proof of publication time)", post.scheduledAt), factLine("published at", post.publishedAt),
      factLine("platform account id", post.accountId), factLine("handle", post.handle), factLine("uploaded render sha256", post.sourceMediaSha256),
    );
    if (post.publishedCopySha256) lines.push(`      published copy sha256: ${post.publishedCopySha256} [file-measured]`);
    for (const correction of post.corrections) lines.push(`      correction ${correction.at}: ${correction.field} ${correction.from ?? "unknown"} -> ${correction.to ?? "unknown"} (${correction.reason})`);
    lines.push(`      trusted observations: ${post.observations.length}`);
    for (const record of post.observations) lines.push(`        ${record.metricId} = ${record.value ?? "(curve)"}${record.unit && record.unit !== "count" ? ` ${record.unit}` : ""} at ${record.publicationAgeHours}h; collected ${record.collectedAt}; ${record.source}; ${record.observationId}`);
    lines.push(`      not observed: ${post.notObserved.length}`);
    for (const metric of post.notObserved) lines.push(`        ${metric.metricId}${metric.providerField ? ` (${metric.providerField})` : ""}: ${metric.reason}`);
    lines.push(`      exploratory evidence (dashboard reads, relayed connector snapshots): ${post.exploratory.length ? "" : "none supplied"}`);
    for (const entry of post.exploratory) {
      lines.push(`        [${entry.label}] ${entry.dashboard}, read ${entry.readAt ?? `at an unknown time (${entry.readAtBasis})`}, ${entry.sourceReference}: ${entry.values.map(describe).join("; ")}`);
      for (const value of entry.unavailable) lines.push(`          unavailable: ${value.label} (${value.reason})`);
    }
  }
  for (const key of report.creativesWithoutPosts) lines.push(`  - ${key}: published, post URL not supplied`);
  lines.push("", "Observations (supplied by a person or relayed from a connector, measured from a file, or provider-reported; each says which):");
  for (const line of report.observations) lines.push(`  - ${line}`);
  lines.push("", "Exploratory context (user-read dashboards or relayed connector snapshots; unverified, not metrics, not ranked, not causal):");
  for (const line of report.exploratoryContext) lines.push(`  - ${line}`);
  if (!report.exploratoryContext.length) lines.push("  - None supplied.");
  lines.push("", "Hypotheses (not conclusions):");
  for (const line of report.hypotheses) lines.push(`  - ${line}`);
  if (!report.hypotheses.length) lines.push("  - None.");
  lines.push("", "Unknowns:");
  for (const line of report.unknowns) lines.push(`  - ${line}`);
  lines.push("", "One creative change to test:");
  const change = report.recommendation;
  if (change) lines.push(`  ${change.change}`, `  Applies to: ${change.appliesTo}`, `  Rests on: ${change.restsOn.join("; ")}`, `  Test with: ${change.testWith}`, `  Status: ${change.status}`);
  else lines.push("  None.");
  lines.push("", `Next-brief evidence: creatives ${report.nextBrief.evidence.creativeIds.join(", ") || "none"}; posts ${report.nextBrief.evidence.providerPostIds.join(", ") || "none"}; media ${report.nextBrief.evidence.mediaSha256s.map((hash) => hash.slice(0, 12)).join(", ") || "none"}; observations ${report.nextBrief.evidence.observationIds.length}.`);
  lines.push("", "This report cannot approve a claim, change benchmark data, schedule a post or authorize publishing.");
  return lines.join("\n");
}
