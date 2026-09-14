// The production Metricool transport: the one place SpecSmith actually sends a
// scheduling request to a third party.
//
// SERVER ONLY, AND STRUCTURALLY SO
// --------------------------------
// This module reads API credentials. It must never be reachable from bundled
// browser code, so it refuses to load in an environment that has a `window` —
// a build that accidentally pulls it into the client fails at import rather
// than shipping a token to every visitor. Credentials are read from the
// process environment, are never written to a returned object, never
// interpolated into an error message, and never logged.
//
// WHAT THIS MODULE IS NOT
// -----------------------
// It does not build the request, decide the schedule, compute a fingerprint,
// evaluate rights, or run quality review. Those are publishing.ts,
// creativeFingerprint.ts, assetRights.ts and qualityReviewer.ts, and this
// module deliberately takes their output as a finished, already-approved
// package rather than re-deriving any of it. The one thing it re-checks is the
// media digest, for the reason below.
//
// WHY THE DIGEST IS CHECKED AGAIN HERE
// ------------------------------------
// assertPublishGate already binds the reviewed digest to the rights-approved
// master when the REQUEST is built. Between that moment and this one the file
// on disk can change: a re-render writes the same path, a cache is repopulated,
// a sync clobbers it. Publishing is the irreversible step, so the bytes are
// re-hashed immediately before the call and compared against both the request
// and the rights registry. A mismatch is not repaired — it throws.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  assertNotAlreadyPublished,
  type MetricoolPublishingRequest,
  type PublicationLedger,
} from "./publishing.ts";
import {
  advanceStoredPublicationLedger,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import type { VideoPlatform } from "./types.ts";

if (typeof globalThis !== "undefined" && "window" in globalThis) {
  throw new Error(
    "metricoolClient is server-only: it reads API credentials and must never be bundled into browser code.",
  );
}

/** Every way a publication attempt can be refused. A closed set, so a test can name each one. */
export type MetricoolFailureCode =
  | "missing-credentials"
  | "media-missing"
  | "media-mismatch"
  | "already-published"
  | "unsupported-platform-state"
  | "auth-failed"
  | "malformed-response"
  | "scheduling-ambiguous"
  | "transport-failed";

export class MetricoolPublishError extends Error {
  readonly code: MetricoolFailureCode;
  constructor(code: MetricoolFailureCode, message: string) {
    super(message);
    this.name = "MetricoolPublishError";
    this.code = code;
  }
}

/**
 * Credentials, read from the environment only.
 *
 * Deliberately not accepted as a function argument anywhere a caller could pass
 * a literal: the only supported way to supply them is the process environment
 * of a server, which keeps them out of source, out of the bundle, and out of
 * any object this module returns.
 */
export interface MetricoolCredentials {
  readonly userToken: string;
  readonly userId: string;
}

export function metricoolCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MetricoolCredentials | undefined {
  const userToken = env.METRICOOL_USER_TOKEN?.trim();
  const userId = env.METRICOOL_USER_ID?.trim();
  if (!userToken || !userId) return undefined;
  return { userToken, userId };
}

/**
 * How far this call is allowed to go.
 *
 * "draft" is the default everywhere. It asks Metricool to store the post as a
 * draft for a human to review and release, which is what initial validation
 * needs: a real request, a real response, a real provider id, and nothing
 * visible to the public. "scheduled-live" is the only mode that queues a post
 * for automatic publication, and it has to be asked for by name — no flag
 * defaults to it and no code path infers it.
 */
export type MetricoolPublishMode = "draft" | "scheduled-live";

/**
 * The finished, already-approved unit of work.
 *
 * `request` is publishing.ts's output, unmodified. `mediaPath` is the local
 * file whose bytes are about to be published; `approvedMasterSha256` is the
 * digest the rights registry holds for that master. All three must agree.
 */
export interface ApprovedPublicationPackage {
  readonly request: MetricoolPublishingRequest;
  readonly mediaPath: string;
  readonly approvedMasterSha256: string;
}

/** The minimal HTTP surface this module needs, injected so tests never touch the network. */
export interface MetricoolTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
}

export interface PublishOptions {
  readonly storeRoot: string;
  readonly credentials: MetricoolCredentials;
  readonly transport: MetricoolTransport;
  /** Defaults to "draft". "scheduled-live" must be passed explicitly. */
  readonly mode?: MetricoolPublishMode;
  readonly baseUrl?: string;
  readonly now?: Date;
}

export interface PublishResult {
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly mode: MetricoolPublishMode;
  readonly providerPostId: string;
  readonly providerUuid?: string;
  readonly providerUrl?: string;
  readonly verifiedSha256: string;
  readonly ledger: PublicationLedger;
}

const DEFAULT_BASE_URL = "https://app.metricool.com/api";

/** Platforms this transport can schedule. A platform outside this set fails closed. */
const SCHEDULABLE: Record<VideoPlatform, true> = {
  "youtube-shorts": true,
  tiktok: true,
  "instagram-reels": true,
};

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

/**
 * Re-hashes the bytes about to be published and refuses anything but an exact
 * three-way match: the file on disk, the digest the request was built around,
 * and the digest the rights registry approved.
 */
async function verifyMediaDigest(pkg: ApprovedPublicationPackage): Promise<string> {
  let size: number;
  try {
    size = (await stat(pkg.mediaPath)).size;
  } catch {
    throw new MetricoolPublishError("media-missing", `Final media is not readable at ${pkg.mediaPath}.`);
  }
  if (size === 0) {
    throw new MetricoolPublishError("media-missing", `Final media at ${pkg.mediaPath} is empty.`);
  }

  const requested = pkg.request.finalMediaSha256.trim().toLowerCase();
  const approved = pkg.approvedMasterSha256.trim().toLowerCase();
  for (const [name, value] of [["request.finalMediaSha256", requested], ["approvedMasterSha256", approved]] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new MetricoolPublishError("media-mismatch", `${name} must be a 64-character SHA-256 hex digest.`);
    }
  }
  if (requested !== approved) {
    throw new MetricoolPublishError(
      "media-mismatch",
      `The request was built for ${requested} but the rights registry approved ${approved}. Clearance does not transfer across renders.`,
    );
  }

  const actual = await sha256OfFile(pkg.mediaPath);
  if (actual !== approved) {
    throw new MetricoolPublishError(
      "media-mismatch",
      `The bytes at ${pkg.mediaPath} hash to ${actual}, not the rights-approved ${approved}. The file changed after approval; refusing to publish it.`,
    );
  }
  return actual;
}

/**
 * Idempotency, checked against the durable ledger rather than in-memory state.
 *
 * Two distinct refusals: a creative already carrying a `published` event, and
 * one already carrying a `scheduled` event that holds a provider id — the
 * latter is a post already sitting in Metricool, and scheduling it again would
 * create a duplicate the ledger could not express.
 */
function assertNotAlreadyScheduled(ledger: PublicationLedger, platform: VideoPlatform): void {
  assertNotAlreadyPublished([ledger], ledger.creativeId);
  const scheduled = ledger.events.find((event: PublicationLedger["events"][number]) => event.status === "scheduled" && event.providerPostId);
  if (scheduled) {
    throw new MetricoolPublishError(
      "already-published",
      `Creative ${ledger.creativeId} already has ${platform} post ${scheduled.providerPostId} scheduled at ${scheduled.at}; refusing a duplicate.`,
    );
  }
}

/** Reads the provider identifiers out of a response, or refuses the response. */
function parseProviderIds(raw: string): { providerPostId: string; providerUuid?: string; providerUrl?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MetricoolPublishError("malformed-response", "Metricool returned a body that is not JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new MetricoolPublishError("malformed-response", "Metricool returned a non-object body.");
  }
  const body = parsed as Record<string, unknown>;
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;

  const id = data.id ?? data.postId ?? data.post_id;
  const providerPostId = typeof id === "string" ? id.trim() : typeof id === "number" ? String(id) : "";
  if (!providerPostId) {
    // A 2xx with no identifier is the dangerous case: the post may exist, but
    // nothing can be recorded against it, so it is treated as a failure rather
    // than written to the ledger as a success with a blank id.
    throw new MetricoolPublishError(
      "malformed-response",
      "Metricool accepted the request but returned no post identifier, so the publication cannot be recorded. Treating as failed.",
    );
  }
  const uuidRaw = data.uuid ?? data.postUuid;
  const urlRaw = data.url ?? data.permalink;
  return {
    providerPostId,
    providerUuid: typeof uuidRaw === "string" && uuidRaw.trim() ? uuidRaw.trim() : undefined,
    providerUrl: typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : undefined,
  };
}

/**
 * Schedules one already-approved publication and records the provider's
 * identifiers in the durable ledger.
 *
 * Every refusal below happens BEFORE the network call except the response
 * checks, so a rejected package costs nothing and cannot half-publish.
 */
export async function publishApprovedPackage(
  pkg: ApprovedPublicationPackage,
  options: PublishOptions,
): Promise<PublishResult> {
  const mode: MetricoolPublishMode = options.mode ?? "draft";
  const { request } = pkg;

  if (!SCHEDULABLE[request.platform]) {
    throw new MetricoolPublishError("unsupported-platform-state", `Platform ${request.platform} cannot be scheduled by this transport.`);
  }
  if (!options.credentials?.userToken || !options.credentials?.userId) {
    throw new MetricoolPublishError("missing-credentials", "Metricool credentials are not configured in this environment.");
  }
  if (!request.media.length) {
    throw new MetricoolPublishError("media-missing", `Request ${request.requestId} carries no media URL.`);
  }
  if (!request.date || !request.timezone) {
    throw new MetricoolPublishError("scheduling-ambiguous", `Request ${request.requestId} has no unambiguous local date/timezone pair.`);
  }
  // publishing.ts already rejects nonexistent and ambiguous wall-clock times
  // when the request is built. This re-asserts the invariant the transport
  // depends on rather than trusting a hand-assembled request object.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(request.date)) {
    throw new MetricoolPublishError("scheduling-ambiguous", `Request ${request.requestId} date must be local YYYY-MM-DDTHH:mm:ss.`);
  }
  // "draft" must never queue a live post. If a caller hands in a request whose
  // own draft flag disagrees with the requested mode, that is a contradiction,
  // not something to silently resolve in either direction.
  if (mode === "draft" && request.draft !== true) {
    throw new MetricoolPublishError(
      "unsupported-platform-state",
      `Request ${request.requestId} has draft=false but the publish mode is "draft". Refusing to guess which was intended.`,
    );
  }

  const ledger = await loadStoredPublicationLedger(options.storeRoot, request.creativeId);
  if (!ledger) {
    throw new MetricoolPublishError(
      "unsupported-platform-state",
      `No durable publication ledger exists for ${request.creativeId}; a publication must be ledgered before it can be scheduled.`,
    );
  }
  if (ledger.platform !== request.platform) {
    throw new MetricoolPublishError("unsupported-platform-state", `Ledger ${request.creativeId} is ${ledger.platform}, not ${request.platform}.`);
  }
  assertNotAlreadyScheduled(ledger, request.platform);

  // The last thing before the irreversible step.
  const verifiedSha256 = await verifyMediaDigest(pkg);

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/v2/scheduler/posts?blogId=${encodeURIComponent(request.blog_id)}&userId=${encodeURIComponent(options.credentials.userId)}`;
  const payload = {
    text: request.text,
    date: request.date,
    timezone: request.timezone,
    providers: request.networks.map((network) => ({ network })),
    media: request.media,
    ...(request.content_type ? { contentType: request.content_type } : {}),
    ...(request.youtube_title ? { youtubeTitle: request.youtube_title } : {}),
    ...(request.tiktok_title ? { tiktokTitle: request.tiktok_title } : {}),
    ...(request.youtube_made_for_kids !== undefined ? { youtubeMadeForKids: request.youtube_made_for_kids } : {}),
    // The safety-critical field. Draft mode always sends true.
    draft: mode === "draft" ? true : request.draft,
    autoPublish: mode === "scheduled-live",
  };

  let response: { status: number; text(): Promise<string> };
  try {
    response = await options.transport(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The only place the token is used. Never logged, never returned.
        "X-Mc-Auth": options.credentials.userToken,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new MetricoolPublishError("transport-failed", `Metricool request failed before a response was received: ${(error as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new MetricoolPublishError("auth-failed", `Metricool rejected the credentials (HTTP ${response.status}).`);
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new MetricoolPublishError("transport-failed", `Metricool returned HTTP ${response.status}: ${detail}`);
  }

  const ids = parseProviderIds(await response.text());

  // Recorded only after the provider confirmed an identifier, so the ledger
  // never claims a publication that does not exist.
  const advanced = await advanceStoredPublicationLedger(options.storeRoot, request.creativeId, {
    status: "scheduled",
    at: (options.now ?? new Date()).toISOString(),
    note: `metricool:${mode}`,
    providerPostId: ids.providerPostId,
    ...(ids.providerUuid ? { providerUuid: ids.providerUuid } : {}),
    ...(ids.providerUrl ? { providerUrl: ids.providerUrl } : {}),
  });

  return {
    creativeId: request.creativeId,
    platform: request.platform,
    mode,
    providerPostId: ids.providerPostId,
    providerUuid: ids.providerUuid,
    providerUrl: ids.providerUrl,
    verifiedSha256,
    ledger: advanced,
  };
}
