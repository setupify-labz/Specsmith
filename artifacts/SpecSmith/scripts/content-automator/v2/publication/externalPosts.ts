// MASTER #8: posts that were published OUTSIDE the authorization boundary.
//
// The RAM-fit and FPS Shorts went out before MASTER #8's approval path existed
// in production: Metricool auto-published at least one of them. They are real
// posts, so the learning loop should know about them, but they never passed
// recordMachineReview -> authorizePublication -> confirmProviderState. Writing
// them into a publication ledger, or giving them an AuthorizedPublication, would
// claim an approval that did not happen.
//
// So they live in their own record, kept apart from the ledger:
//
//   - `machineAuthorized: false` is a literal, not a flag a caller can set.
//   - The record never touches publishingStore: creativeForProviderPost does not
//     resolve it, so the trusted observation import still refuses these posts
//     as `unknown-post`, and buildLearningReport (which reads only confirmed,
//     authorized publications) does not count them.
//   - Every fact carries where it came from. A URL, a publication time or a
//     creative version supplied by a person is `user-provided`; facts measured
//     from a media file are `file-measured` and name the file's SHA-256. Unknown
//     facts stay null with a reason, never a guess.
//   - Metrics: only a registered source can produce observations, and none is
//     registered. Numbers a person supplies go through
//     recordUnverifiedObservations and stay labelled UNVERIFIED.
//
// externalPostReport walks one complete path for these posts — post -> report
// -> next-brief input — and keeps observations, hypotheses and unknowns apart.
// It never publishes, schedules, approves a claim or moves a ledger.

import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoPlatform } from "../../types.ts";
import { sha256Json } from "../review/util.ts";
import type { NextBriefInput } from "./learningReport.ts";
import { loadObservations, loadUnverifiedObservations, PRODUCTION_OBSERVATION_SOURCES } from "./observations.ts";
import { metricsAccessFor, platformAccessStatus } from "./platformAccess.ts";

export const EXTERNAL_POST_VERSION = "external-post-v1";

export class ExternalPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalPostError";
  }
}

/** Where a fact came from. */
export type FactSource = "user-provided" | "file-measured";

export interface SourcedFact<T> {
  readonly value: T | null;
  readonly source: FactSource | null;
  /** Who supplied it, or which file it was measured from; or why it is unknown. */
  readonly basis: string;
}

/** What could be measured from a copy of the published video the user supplied. */
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

export interface ExternalPostInput {
  /** A stable key for the creative, e.g. "ram-fit" or "fps-20-wins". */
  readonly creativeKey: string;
  readonly platform: VideoPlatform;
  readonly postUrl: string;
  readonly publishedVia: "metricool-auto" | "manual-upload" | "unknown";
  readonly publishedAt: string | null;
  readonly publishedAtBasis: string;
  /** The creative version, as known: branch/commit/render that produced it. */
  readonly creativeVersion: string;
  readonly creativeVersionSource: FactSource;
  readonly creativeVersionBasis: string;
  readonly media: MediaEvidence | null;
  readonly suppliedBy: string;
  readonly notes?: readonly string[];
}

export interface ExternalPostRecord {
  readonly version: typeof EXTERNAL_POST_VERSION;
  readonly kind: "EXTERNAL_PUBLICATION";
  /** Always false. These posts never passed MASTER #8's review and approval boundary. */
  readonly machineAuthorized: false;
  readonly recordId: string;
  readonly recordedAt: string;
  readonly creativeKey: string;
  readonly platform: VideoPlatform;
  readonly postUrl: SourcedFact<string>;
  readonly nativePostId: SourcedFact<string>;
  readonly publishedVia: SourcedFact<ExternalPostInput["publishedVia"]>;
  readonly publishedAt: SourcedFact<string>;
  readonly creativeVersion: SourcedFact<string>;
  readonly media: MediaEvidence | null;
  readonly notes: readonly string[];
}

/** The platform's own post id, read from its URL. Null when the URL is not that platform's post URL. */
export function nativePostIdFromUrl(platform: VideoPlatform, url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^(www|m)\./, "");
  const path = parsed.pathname;
  if (platform === "youtube-shorts") {
    if (host === "youtube.com") return path.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? (path === "/watch" ? parsed.searchParams.get("v")?.match(/^[A-Za-z0-9_-]{11}$/)?.[0] ?? null : null);
    if (host === "youtu.be") return path.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    return null;
  }
  if (platform === "tiktok") return host === "tiktok.com" ? path.match(/^\/@[\w.-]+\/video\/(\d{8,25})\/?$/)?.[1] ?? null : null;
  if (platform === "instagram-reels") return host === "instagram.com" ? path.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]{5,40})\/?$/)?.[1] ?? null : null;
  return null;
}

function directory(storeRoot: string): string {
  return join(storeRoot, "external-posts");
}

/** Record one externally published post. Refuses rather than guesses. */
export async function recordExternalPost(input: { readonly storeRoot: string; readonly post: ExternalPostInput; readonly now?: Date }): Promise<ExternalPostRecord> {
  const { post } = input;
  if (!post.creativeKey?.trim() || !post.suppliedBy?.trim() || !post.creativeVersion?.trim()) {
    throw new ExternalPostError("An external post must name its creative, its creative version and who supplied the facts.");
  }
  const nativeId = nativePostIdFromUrl(post.platform, post.postUrl);
  if (!nativeId) throw new ExternalPostError(`${post.postUrl} is not a ${post.platform} post URL; refusing to record it.`);
  if (post.publishedAt !== null && !Number.isFinite(Date.parse(post.publishedAt))) {
    throw new ExternalPostError(`Publication time "${post.publishedAt}" is not a timestamp. Leave it null with a reason when it is not known.`);
  }
  if (post.publishedAt === null && !post.publishedAtBasis?.trim()) {
    throw new ExternalPostError("An unknown publication time needs a reason.");
  }
  if (post.creativeVersionSource === "file-measured" && !post.media) {
    throw new ExternalPostError("A creative version measured from a file must include that file's evidence.");
  }
  const now = input.now ?? new Date();
  const supplied = `supplied by ${post.suppliedBy}`;
  const body = {
    creativeKey: post.creativeKey, platform: post.platform, nativeId, publishedAt: post.publishedAt,
    creativeVersion: post.creativeVersion, media: post.media?.sha256 ?? null,
  };
  const record: ExternalPostRecord = {
    version: EXTERNAL_POST_VERSION,
    kind: "EXTERNAL_PUBLICATION",
    machineAuthorized: false,
    recordId: `external-${post.platform}-${nativeId}-${sha256Json(body).slice(0, 12)}`,
    recordedAt: now.toISOString(),
    creativeKey: post.creativeKey,
    platform: post.platform,
    postUrl: { value: post.postUrl, source: "user-provided", basis: supplied },
    nativePostId: { value: nativeId, source: "user-provided", basis: `read from the URL ${supplied}` },
    publishedVia: { value: post.publishedVia, source: post.publishedVia === "unknown" ? null : "user-provided", basis: post.publishedVia === "unknown" ? "not supplied" : supplied },
    publishedAt: post.publishedAt === null
      ? { value: null, source: null, basis: post.publishedAtBasis }
      : { value: new Date(post.publishedAt).toISOString(), source: "user-provided", basis: post.publishedAtBasis || supplied },
    creativeVersion: { value: post.creativeVersion, source: post.creativeVersionSource, basis: post.creativeVersionBasis },
    media: post.media,
    notes: [...(post.notes ?? [])],
  };
  await mkdir(directory(input.storeRoot), { recursive: true });
  const path = join(directory(input.storeRoot), `${post.platform}-${nativeId}.json`);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as ExternalPostRecord;
    if (existing.recordId !== record.recordId) {
      throw new ExternalPostError(`${post.platform} post ${nativeId} is already recorded with different facts (${existing.recordId}); records are not overwritten.`);
    }
    return existing;
  } finally {
    await handle?.close();
  }
  return record;
}

export async function loadExternalPosts(storeRoot: string): Promise<ExternalPostRecord[]> {
  let names: string[];
  try { names = await readdir(directory(storeRoot)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records = await Promise.all(names.filter((name) => name.endsWith(".json")).sort()
    .map(async (name) => JSON.parse(await readFile(join(directory(storeRoot), name), "utf8")) as ExternalPostRecord));
  for (const record of records) {
    if (record.version !== EXTERNAL_POST_VERSION || record.kind !== "EXTERNAL_PUBLICATION" || record.machineAuthorized !== false) {
      throw new ExternalPostError(`Malformed external post record ${record.recordId ?? "(no id)"}; refusing to read it.`);
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Post -> report -> next-brief input
// ---------------------------------------------------------------------------

export interface MetricAvailability {
  readonly metricId: string;
  readonly providerField: string | null;
  readonly state: "observed" | "unavailable";
  readonly reason: string;
}

/** A creative measurement taken from a file, made by a person or tool, kept beside its evidence. */
export interface CreativeMeasurement {
  readonly creativeKey: string;
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

export interface ExternalPostReport {
  readonly version: "external-post-report-v1";
  readonly reportId: string;
  readonly generatedAt: string;
  readonly posts: readonly {
    readonly recordId: string;
    readonly creativeKey: string;
    readonly platform: VideoPlatform;
    readonly postUrl: string | null;
    readonly publishedAt: string | null;
    readonly ageHours: number | null;
    readonly creativeVersion: string | null;
    readonly notes: readonly string[];
    readonly metrics: readonly MetricAvailability[];
    readonly userProvidedEvidence: readonly { readonly suppliedBy: string; readonly receivedAt: string; readonly sha256: string }[];
  }[];
  readonly creativesWithoutPosts: readonly string[];
  /** Facts: what was recorded and measured. No performance figure appears here without a trusted source. */
  readonly observations: readonly string[];
  /** Possible explanations or bets. Never conclusions. */
  readonly hypotheses: readonly string[];
  readonly unknowns: readonly string[];
  readonly recommendation: CreativeChange | null;
  readonly nextBrief: NextBriefInput;
}

const CONSTRAINTS = [
  "Every factual claim, figure and disclosure stays exactly as research and MASTER #7 require; performance data never changes what may be said.",
  "These posts were published outside the MASTER #8 authorization boundary; nothing here records or implies their approval.",
  "The recommended change is a creative execution choice to test, not an approved claim, a schedule, or an authorization to publish.",
  "The next concepts go through research, the creative workflow, rendering, MASTER #7 review and trusted human approval like any other.",
];

export async function externalPostReport(input: {
  readonly storeRoot: string;
  /** Creatives known to be published whose post locations were not supplied. */
  readonly creativesWithoutPosts?: readonly { readonly creativeKey: string; readonly media: MediaEvidence | null; readonly note: string }[];
  readonly measurements?: readonly CreativeMeasurement[];
  readonly recommendation?: CreativeChange | null;
  /** Access facts from a probe, reported as unknowns' causes. */
  readonly accessFindings?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
}): Promise<ExternalPostReport> {
  const now = input.now ?? new Date();
  const posts = await loadExternalPosts(input.storeRoot);
  const trusted = new Set(PRODUCTION_OBSERVATION_SOURCES.map((source) => source.sourceId));
  const observations: string[] = [];
  const unknowns: string[] = [];
  const reportPosts = [];
  for (const post of posts) {
    const nativeId = post.nativePostId.value!;
    const status = platformAccessStatus(post.platform, input.env ?? process.env);
    const stored = (await loadObservations(input.storeRoot, nativeId)).filter((record) => !record.simulated && trusted.has(record.source));
    const access = metricsAccessFor(post.platform);
    const metrics: MetricAvailability[] = access.metrics.map((metric) => {
      const found = [...stored].reverse().find((record) => record.metricId === metric.metricId && record.state === "observed");
      if (found) return { metricId: metric.metricId, providerField: metric.providerField, state: "observed", reason: `observation ${found.observationId}` };
      const reason = !metric.servedByProvider
        ? `not served by the ${post.platform} API: ${metric.absenceReason ?? "no such field"}`
        : `no trusted source today (${status.state}${status.blockedHosts.length ? `: ${status.blockedHosts.join(", ")} refused by the network policy` : ""}${status.missingCredentials.length ? `; missing ${status.missingCredentials.join(", ")}` : ""})`;
      return { metricId: metric.metricId, providerField: metric.providerField, state: "unavailable", reason };
    });
    const unverified = await loadUnverifiedObservations(input.storeRoot, nativeId);
    const publishedAt = post.publishedAt.value;
    const ageHours = publishedAt ? Math.round(((now.getTime() - Date.parse(publishedAt)) / 3_600_000) * 10) / 10 : null;
    reportPosts.push({
      recordId: post.recordId, creativeKey: post.creativeKey, platform: post.platform, postUrl: post.postUrl.value,
      publishedAt, ageHours, creativeVersion: post.creativeVersion.value, notes: post.notes, metrics,
      userProvidedEvidence: unverified.map((record) => ({ suppliedBy: record.suppliedBy, receivedAt: record.receivedAt, sha256: record.sha256 })),
    });
    observations.push(`${post.creativeKey} is on ${post.platform} at ${post.postUrl.value} (${post.postUrl.source}, ${post.postUrl.basis}); published outside the MASTER #8 authorization boundary${post.publishedVia.value && post.publishedVia.value !== "unknown" ? ` via ${post.publishedVia.value}` : ""}.`);
    if (post.media) observations.push(`${post.creativeKey}'s published copy (${post.media.fileName}, sha256 ${post.media.sha256.slice(0, 16)}…) is ${post.media.durationSeconds.toFixed(2)} s, ${post.media.frames} frames at ${post.media.width}x${post.media.height} (file-measured).`);
    if (!publishedAt) unknowns.push(`${post.creativeKey} on ${post.platform}: publication time unknown (${post.publishedAt.basis}), so no metric could be placed at a publication age.`);
    const missing = metrics.filter((metric) => metric.state === "unavailable");
    if (missing.length) unknowns.push(`${post.creativeKey} on ${post.platform}: ${missing.length} of ${metrics.length} metrics unavailable — ${missing.map((metric) => metric.metricId).join(", ")}. ${status.missingCapability}`);
    if (unverified.length) unknowns.push(`${post.creativeKey} on ${post.platform}: ${unverified.length} user-provided evidence record(s) kept UNVERIFIED and not used as performance.`);
  }
  for (const creative of input.creativesWithoutPosts ?? []) {
    unknowns.push(`${creative.creativeKey}: published, but no post URL or publication time was supplied for any platform (${creative.note}). Nothing can be collected or compared for it.`);
    if (creative.media) observations.push(`${creative.creativeKey}'s published copy (${creative.media.fileName}, sha256 ${creative.media.sha256.slice(0, 16)}…) is ${creative.media.durationSeconds.toFixed(2)} s, ${creative.media.frames} frames at ${creative.media.width}x${creative.media.height} (file-measured).`);
  }
  for (const measurement of input.measurements ?? []) observations.push(`${measurement.creativeKey}: ${measurement.statement} (${measurement.evidence})`);
  for (const finding of input.accessFindings ?? []) unknowns.push(`Access: ${finding}`);
  if (posts.length === 0) unknowns.push("No externally published post is recorded.");
  if (PRODUCTION_OBSERVATION_SOURCES.length === 0) unknowns.push("No performance observation exists for any post: no trusted metrics source is registered, so views, retention and viewed-versus-swiped are all unknown.");
  unknowns.push("Which video performed better, and why: there is no trusted metric for either, so no performance comparison is possible.");

  const recommendation = input.recommendation ?? null;
  const hypotheses = recommendation ? [recommendation.hypothesis] : [];
  const body = { generatedAt: now.toISOString(), posts: reportPosts.map((post) => post.recordId), observations, hypotheses };
  const reportId = `external-${sha256Json(body).slice(0, 16)}`;
  const memoryObservations = [
    ...observations.map((line) => `Observation about published SpecSmith videos (context, not a rule; report ${reportId}): ${line}`),
    ...(recommendation ? [`Creative change to test (report ${reportId}; a hypothesis with no performance evidence yet): ${recommendation.change} Rests on: ${recommendation.restsOn.join("; ")}. Test with: ${recommendation.testWith}`] : []),
  ];
  return {
    version: "external-post-report-v1",
    reportId,
    generatedAt: now.toISOString(),
    posts: reportPosts,
    creativesWithoutPosts: (input.creativesWithoutPosts ?? []).map((creative) => creative.creativeKey),
    observations,
    hypotheses,
    unknowns,
    recommendation,
    nextBrief: {
      version: "next-brief-input-v1",
      reportId,
      simulated: false,
      evidence: { creativeIds: [], providerPostIds: reportPosts.map((post) => `${post.platform}:${post.postUrl}`), mediaSha256s: [], reviewPacketIds: [], observationIds: [] },
      observations,
      hypotheses,
      unknowns,
      // The learning report's proposedChange is reserved for a valid single-variable
      // performance comparison. None exists, so it stays null; the craft change is
      // carried as a labelled hypothesis in memoryObservations instead.
      proposedChange: null,
      constraints: CONSTRAINTS,
      memoryObservations,
    },
  };
}

export function formatExternalPostReport(report: ExternalPostReport): string {
  const lines: string[] = [];
  lines.push(`PUBLISHED-POST REPORT ${report.reportId} — posts published outside the MASTER #8 authorization boundary`);
  lines.push(`Generated ${report.generatedAt}`, "", "Posts:");
  for (const post of report.posts) {
    lines.push(`  - ${post.creativeKey} on ${post.platform}: ${post.postUrl}`);
    lines.push(`      creative version: ${post.creativeVersion}`);
    lines.push(`      published at: ${post.publishedAt ?? "unknown"}${post.ageHours !== null ? ` (${post.ageHours}h ago)` : ""}`);
    lines.push(`      metrics: ${post.metrics.filter((metric) => metric.state === "observed").length} observed, ${post.metrics.filter((metric) => metric.state === "unavailable").length} unavailable`);
    for (const metric of post.metrics) lines.push(`        ${metric.metricId}${metric.providerField ? ` (${metric.providerField})` : ""}: ${metric.state} — ${metric.reason}`);
    for (const note of post.notes) lines.push(`      note: ${note}`);
    lines.push(`      user-provided evidence: ${post.userProvidedEvidence.length ? post.userProvidedEvidence.map((entry) => `${entry.suppliedBy} at ${entry.receivedAt} [UNVERIFIED]`).join("; ") : "none supplied"}`);
  }
  for (const key of report.creativesWithoutPosts) lines.push(`  - ${key}: published, post location not supplied`);
  lines.push("", "Observations (recorded or measured facts; no performance figures):");
  for (const line of report.observations) lines.push(`  - ${line}`);
  lines.push("", "Hypotheses (not conclusions):");
  for (const line of report.hypotheses) lines.push(`  - ${line}`);
  if (!report.hypotheses.length) lines.push("  - None.");
  lines.push("", "Unknowns:");
  for (const line of report.unknowns) lines.push(`  - ${line}`);
  lines.push("", "One creative change to test:");
  const change = report.recommendation;
  if (change) {
    lines.push(`  ${change.change}`, `  Applies to: ${change.appliesTo}`, `  Rests on: ${change.restsOn.join("; ")}`, `  Test with: ${change.testWith}`, `  Status: ${change.status}`);
  } else lines.push("  None.");
  lines.push("", "This report cannot approve a claim, change benchmark data, schedule a post or authorize publishing.");
  return lines.join("\n");
}
