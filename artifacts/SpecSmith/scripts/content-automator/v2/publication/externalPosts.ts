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
//     `file-measured` (and the file's SHA-256), or `provider-reported` (and the
//     trusted observation it came from). Unknown facts are null with a reason.
//   - Facts are completed or corrected by appending a correction. The original
//     record and every correction are kept; the current value is the latest
//     correction for that field. A post's identity (platform, post id) is never
//     corrected: a different post is a different record.
//   - Numbers arrive two ways, kept apart:
//       * authenticated observations from a registered source, through
//         importExternalPostObservations (same trust check as any other);
//       * user-provided dashboard evidence (a screenshot, a pasted table), kept
//         through recordUnverifiedObservations and shown only as EXPLORATORY
//         context: not a verified metric, never compared, never causal.
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

/** Where a fact came from. */
export type FactSource = "user-provided" | "file-measured" | "provider-reported";

export interface SourcedFact<T> {
  readonly value: T | null;
  readonly source: FactSource | null;
  /** Who supplied it, which file it was measured from, which observation reported it; or why it is unknown. */
  readonly basis: string;
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
}

type Unknown = { readonly value: null; readonly basis: string };
type Supplied<T> = { readonly value: T; readonly source: FactSource; readonly basis: string };

export interface ExternalPostInput {
  readonly platform: VideoPlatform;
  readonly postUrl: string;
  /** Who supplied the URL. */
  readonly suppliedBy: string;
  /** Stable creative identifier, e.g. "fps-20-wins@ce47598". */
  readonly creativeId: Supplied<string> | Unknown;
  readonly publishedVia: Supplied<"metricool-auto" | "manual-upload"> | Unknown;
  readonly publishedAt: Supplied<string> | Unknown;
  /** The account (channel, profile) that owns the post, as the platform names it. */
  readonly accountId: Supplied<string> | Unknown;
  readonly creativeVersion: Supplied<string> | Unknown;
  /** SHA-256 of the render that was uploaded, when known. */
  readonly sourceMediaSha256: Supplied<string> | Unknown;
  /** A copy of the post as published (re-encoded by the platform), when supplied. */
  readonly media: MediaEvidence | null;
  readonly notes?: readonly string[];
}

export interface ExternalPostRecord {
  readonly version: typeof EXTERNAL_POST_VERSION;
  readonly kind: "EXTERNAL_PUBLICATION";
  /** Always false. These posts never passed MASTER #8's review and approval boundary. */
  readonly machineAuthorized: false;
  readonly recordId: string;
  readonly recordedAt: string;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  readonly postUrl: SourcedFact<string>;
  readonly creativeId: SourcedFact<string>;
  readonly publishedVia: SourcedFact<string>;
  readonly publishedAt: SourcedFact<string>;
  readonly accountId: SourcedFact<string>;
  readonly creativeVersion: SourcedFact<string>;
  readonly sourceMediaSha256: SourcedFact<string>;
  readonly media: MediaEvidence | null;
  readonly notes: readonly string[];
}

/** Facts that may be completed or corrected after the record is made. */
export const CORRECTABLE_FIELDS = ["creativeId", "publishedVia", "publishedAt", "accountId", "creativeVersion", "sourceMediaSha256"] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

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
export interface ResolvedExternalPost extends ExternalPostRecord {
  readonly corrections: readonly ExternalPostCorrection[];
}

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

function fact(input: Supplied<string> | Unknown, field: string): SourcedFact<string> {
  if (input.value === null) {
    if (!input.basis?.trim()) throw new ExternalPostError(`An unknown ${field} needs a reason.`);
    return { value: null, source: null, basis: input.basis };
  }
  const supplied = input as Supplied<string>;
  if (!supplied.basis?.trim()) throw new ExternalPostError(`${field} needs a basis: who supplied it, or what it was measured from.`);
  if (supplied.source === "provider-reported" && !/obs-[a-f0-9]{24}/.test(supplied.basis)) {
    throw new ExternalPostError(`A provider-reported ${field} must cite the trusted observation (obs-…) it came from.`);
  }
  if (field === "publishedAt") checkTimestamp(supplied.value, "Publication time");
  if (field === "sourceMediaSha256" && !/^[a-f0-9]{64}$/.test(supplied.value)) throw new ExternalPostError("A media hash must be a SHA-256 hex digest.");
  return { value: field === "publishedAt" ? new Date(supplied.value).toISOString() : supplied.value, source: supplied.source, basis: supplied.basis };
}

/** Record one externally published post. Refuses rather than guesses. */
export async function recordExternalPost(input: { readonly storeRoot: string; readonly post: ExternalPostInput; readonly now?: Date }): Promise<ExternalPostRecord> {
  const { post } = input;
  if (!post.suppliedBy?.trim()) throw new ExternalPostError("An external post must say who supplied its URL.");
  const nativeId = nativePostIdFromUrl(post.platform, post.postUrl);
  if (!nativeId) throw new ExternalPostError(`${post.postUrl} is not a ${post.platform} post URL; refusing to record it.`);
  const facts = {
    creativeId: fact(post.creativeId, "creativeId"),
    publishedVia: fact(post.publishedVia, "publishedVia"),
    publishedAt: fact(post.publishedAt, "publishedAt"),
    accountId: fact(post.accountId, "accountId"),
    creativeVersion: fact(post.creativeVersion, "creativeVersion"),
    sourceMediaSha256: fact(post.sourceMediaSha256, "sourceMediaSha256"),
  };
  if ([facts.creativeVersion, facts.creativeId].some((entry) => entry.source === "file-measured") && !post.media) {
    throw new ExternalPostError("A fact measured from a file must come with that file's evidence.");
  }
  const body = { platform: post.platform, nativeId, url: post.postUrl, facts, media: post.media?.sha256 ?? null };
  const record: ExternalPostRecord = {
    version: EXTERNAL_POST_VERSION,
    kind: "EXTERNAL_PUBLICATION",
    machineAuthorized: false,
    recordId: `external-${post.platform}-${nativeId}-${sha256Json(body).slice(0, 12)}`,
    recordedAt: (input.now ?? new Date()).toISOString(),
    platform: post.platform,
    nativePostId: nativeId,
    postUrl: { value: post.postUrl, source: "user-provided", basis: `supplied by ${post.suppliedBy}` },
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
 * earlier correction are kept. Changing a known value needs a reason; an
 * identical value is refused as a no-op rather than recorded twice.
 */
export async function correctExternalPost(input: {
  readonly storeRoot: string;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  readonly field: CorrectableField;
  readonly next: Supplied<string> | Unknown;
  readonly reason: string;
  readonly suppliedBy: string;
  readonly now?: Date;
}): Promise<ExternalPostCorrection> {
  if (!(CORRECTABLE_FIELDS as readonly string[]).includes(input.field)) {
    throw new ExternalPostError(`${input.field} cannot be corrected. A post's platform and id are its identity: a different post is a different record.`);
  }
  if (!input.reason?.trim() || !input.suppliedBy?.trim()) throw new ExternalPostError("A correction must give its reason and who supplied it.");
  const current = await resolveExternalPost(input.storeRoot, input.platform, input.nativePostId);
  if (!current) throw new ExternalPostError(`${input.platform} post ${input.nativePostId} is not recorded.`);
  const previous = current[input.field];
  const next = fact(input.next, input.field);
  if (previous.value === next.value && previous.source === next.source) throw new ExternalPostError(`${input.field} is already ${next.value ?? "unknown"}; nothing to correct.`);
  const sequence = current.corrections.length + 1;
  const at = (input.now ?? new Date()).toISOString();
  const correction: ExternalPostCorrection = {
    version: EXTERNAL_CORRECTION_VERSION,
    correctionId: `correction-${sha256Json({ recordId: current.recordId, sequence, field: input.field, next, at }).slice(0, 16)}`,
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
}

/** The post as currently known: the original record with its corrections applied in order. */
export async function resolveExternalPost(storeRoot: string, platform: VideoPlatform, nativePostId: string): Promise<ResolvedExternalPost | null> {
  let record: ExternalPostRecord;
  try { record = JSON.parse(await readFile(recordFile(storeRoot, platform, nativePostId), "utf8")) as ExternalPostRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  checkRecord(record);
  let names: string[] = [];
  try { names = (await readdir(correctionsDir(storeRoot, platform, nativePostId))).filter((name) => /^\d{4}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const corrections: ExternalPostCorrection[] = [];
  const resolved: Record<string, unknown> = { ...record };
  for (const name of names) {
    const correction = JSON.parse(await readFile(join(correctionsDir(storeRoot, platform, nativePostId), name), "utf8")) as ExternalPostCorrection;
    if (correction.version !== EXTERNAL_CORRECTION_VERSION || correction.recordId !== record.recordId || correction.sequence !== corrections.length + 1 ||
        !(CORRECTABLE_FIELDS as readonly string[]).includes(correction.field)) {
      throw new ExternalPostError(`Correction ${name} for ${record.recordId} is malformed or out of order; refusing to read the post.`);
    }
    corrections.push(correction);
    resolved[correction.field] = correction.next;
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

export interface DashboardEvidence {
  readonly kind: typeof DASHBOARD_EVIDENCE_KIND;
  readonly platform: VideoPlatform;
  readonly nativePostId: string;
  /** e.g. "YouTube Studio", "Metricool", "TikTok app analytics". */
  readonly dashboard: string;
  /** When the person read the dashboard (with timezone). */
  readonly readAt: string;
  /** What it was read from: a screenshot file name and its SHA-256, or "typed from the screen". */
  readonly sourceReference: string;
  readonly values: readonly DashboardValue[];
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
  checkTimestamp(evidence.readAt, "The time the dashboard was read");
  if (Date.parse(evidence.readAt) > (input.now ?? new Date()).getTime()) throw new ExternalPostError("The dashboard cannot have been read in the future.");
  if (!evidence.values.length || evidence.values.some((value) => !value.label?.trim() || (typeof value.value === "number" && !Number.isFinite(value.value)))) {
    throw new ExternalPostError("Each dashboard value needs its dashboard label and a finite value.");
  }
  return recordUnverifiedObservations({
    storeRoot: input.storeRoot,
    providerPostId: externalPostKey(evidence.platform, evidence.nativePostId),
    suppliedBy: input.suppliedBy,
    supplied: { kind: DASHBOARD_EVIDENCE_KIND, ...evidence },
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

export interface ExploratoryEvidence {
  readonly label: "EXPLORATORY: user-provided dashboard evidence, not verified, not a metric, not causal";
  readonly dashboard: string;
  readonly readAt: string;
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
  readonly publishedAt: SourcedFact<string>;
  readonly accountId: SourcedFact<string>;
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
  /** Recorded, measured or provider-reported facts. */
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
      return [{
        label: "EXPLORATORY: user-provided dashboard evidence, not verified, not a metric, not causal" as const,
        dashboard: supplied.dashboard!, readAt: supplied.readAt!, sourceReference: supplied.sourceReference!,
        suppliedBy: record.suppliedBy, receivedAt: record.receivedAt, evidenceSha256: record.sha256, values: supplied.values ?? [],
      }];
    });

    const publishedAt = post.publishedAt.value;
    const ageHours = publishedAt ? Math.round(((now.getTime() - Date.parse(publishedAt)) / 3_600_000) * 10) / 10 : null;
    reported.push({
      recordId: post.recordId, platform: post.platform, nativePostId: post.nativePostId, postUrl: post.postUrl.value!,
      creativeId: post.creativeId, creativeVersion: post.creativeVersion, publishedAt: post.publishedAt, accountId: post.accountId,
      sourceMediaSha256: post.sourceMediaSha256, publishedCopySha256: post.media?.sha256 ?? null, ageHours,
      corrections: post.corrections.map((entry) => ({ field: entry.field, from: entry.previous.value, to: entry.next.value, at: entry.at, reason: entry.reason })),
      observations: reportedObservations, notObserved, exploratory,
    });

    observations.push(`${label}: ${post.postUrl.value} (${post.postUrl.basis}); published outside the MASTER #8 authorization boundary${post.publishedVia.value ? ` via ${post.publishedVia.value}` : ""}.`);
    if (post.media) observations.push(`${label}: published copy ${post.media.fileName} (sha256 ${post.media.sha256}) is ${post.media.durationSeconds.toFixed(2)} s, ${post.media.frames} frames at ${post.media.width}x${post.media.height} (file-measured).`);
    for (const record of reportedObservations) {
      observations.push(`${label}: ${record.metricId} = ${record.value ?? "(curve)"}${record.unit && record.unit !== "count" ? ` ${record.unit}` : ""} at ${record.publicationAgeHours}h, collected ${record.collectedAt} by ${record.source} (${record.observationId}${record.definitionId ? `, ${record.definitionId}` : ""}).`);
    }
    for (const entry of exploratory) {
      exploratoryContext.push(`${label} [EXPLORATORY, user-provided, unverified]: ${entry.values.map(describe).join("; ")} — read from ${entry.dashboard} at ${entry.readAt} (${entry.sourceReference}; supplied by ${entry.suppliedBy}; evidence sha256 ${entry.evidenceSha256.slice(0, 16)}…). Not a verified metric; not comparable across platforms; says nothing about cause.`);
    }

    if (!publishedAt) unknowns.push(`${label}: publication time unknown (${post.publishedAt.basis}). Authenticated observations cannot be placed at a publication age until it is added with a correction.`);
    if (!post.accountId.value) unknowns.push(`${label}: owning account unknown (${post.accountId.basis}). Authenticated observations cannot be bound until it is added with a correction.`);
    if (!post.creativeId.value) unknowns.push(`${label}: which creative this post carries is unknown (${post.creativeId.basis}).`);
    if (!reportedObservations.length) unknowns.push(`${label}: no trusted observation is stored. ${status.missingCapability}`);
    const served = notObserved.filter((metric) => !metric.reason.startsWith("not served"));
    if (reportedObservations.length && served.length) unknowns.push(`${label}: not observed by the trusted source — ${served.map((metric) => metric.metricId).join(", ")}.`);
  }
  for (const creative of input.creativesWithoutPosts ?? []) {
    unknowns.push(`${creative.creativeId}: published, but no post URL was supplied for any platform (${creative.note}).`);
    if (creative.media) observations.push(`${creative.creativeId}: published copy ${creative.media.fileName} (sha256 ${creative.media.sha256}) is ${creative.media.durationSeconds.toFixed(2)} s, ${creative.media.frames} frames at ${creative.media.width}x${creative.media.height} (file-measured).`);
  }
  for (const measurement of input.measurements ?? []) observations.push(`${measurement.creativeId}: ${measurement.statement} (${measurement.evidence})`);
  if (reported.length && reported.every((post) => !post.observations.length)) {
    for (const finding of input.accessFindings ?? []) unknowns.push(`Access: ${finding}`);
  }
  if (posts.length === 0) unknowns.push("No externally published post is recorded.");
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
    lines.push(`  - ${post.platform} ${post.postUrl}`);
    lines.push(factLine("creative", post.creativeId), factLine("version", post.creativeVersion), factLine("published at", post.publishedAt), factLine("account", post.accountId), factLine("uploaded render sha256", post.sourceMediaSha256));
    if (post.publishedCopySha256) lines.push(`      published copy sha256: ${post.publishedCopySha256} [file-measured]`);
    for (const correction of post.corrections) lines.push(`      correction ${correction.at}: ${correction.field} ${correction.from ?? "unknown"} -> ${correction.to ?? "unknown"} (${correction.reason})`);
    lines.push(`      trusted observations: ${post.observations.length}`);
    for (const record of post.observations) lines.push(`        ${record.metricId} = ${record.value ?? "(curve)"}${record.unit && record.unit !== "count" ? ` ${record.unit}` : ""} at ${record.publicationAgeHours}h; collected ${record.collectedAt}; ${record.source}; ${record.observationId}`);
    lines.push(`      not observed: ${post.notObserved.length}`);
    for (const metric of post.notObserved) lines.push(`        ${metric.metricId}${metric.providerField ? ` (${metric.providerField})` : ""}: ${metric.reason}`);
    lines.push(`      exploratory dashboard evidence: ${post.exploratory.length ? "" : "none supplied"}`);
    for (const entry of post.exploratory) lines.push(`        [EXPLORATORY · user-provided · unverified] ${entry.dashboard}, read ${entry.readAt}, ${entry.sourceReference}: ${entry.values.map(describe).join("; ")}`);
  }
  for (const key of report.creativesWithoutPosts) lines.push(`  - ${key}: published, post URL not supplied`);
  lines.push("", "Observations (recorded, measured or provider-reported facts):");
  for (const line of report.observations) lines.push(`  - ${line}`);
  lines.push("", "Exploratory context (user-provided, unverified; not metrics, not causal):");
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
