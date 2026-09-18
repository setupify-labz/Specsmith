// OPTIONAL FUTURE ADAPTER: direct Metricool REST.
//
// NOT THE ACTIVE PUBLICATION PATH. The founder's current Metricool plan does
// not expose REST API access, so nothing in this repository can use this
// module today and `metricoolRestAvailability()` reports it unavailable unless
// REST credentials are present in the environment. The active route is
// readyToPublishHandoff.ts, which produces a manifest a human releases through
// the ChatGPT/Metricool connector.
//
// It is kept, isolated and tested, because the plan may change and because the
// wire format is worth preserving while it is fresh. It is deliberately inert:
// no workflow references it, no script invokes it, and it cannot act without
// credentials that do not currently exist.
//
// WHAT MOVED OUT OF THIS FILE
// ---------------------------
// The integrity guarantees — SHA-256 re-verification, rights-approved master
// binding, duplicate refusal, gate checks — used to live here, which made them
// REST-shaped. They are transport-independent properties of the content and
// the ledger, so they now live in publicationIntegrity.ts and BOTH routes call
// the same implementation. This file is now only the wire: credentials, the
// HTTP call, response parsing, and recording what the provider returned.
//
// SERVER ONLY. It reads API credentials, so it refuses to load in an
// environment with a `window`; a build that pulls it toward the browser fails
// at import rather than shipping a token. Credentials come from the process
// environment, are never returned in a result, and are never logged.

import {
  assertPublicationGatesPassed,
  PublicationIntegrityError,
  verifyApprovedMedia,
  type ApprovedPublicationPackage,
} from "./publicationIntegrity.ts";
import type { PublicationLedger } from "./publishing.ts";

// Re-exported so existing importers of the REST adapter keep one import site
// for the package shape. The type itself is owned by publicationIntegrity.ts.
export type { ApprovedPublicationPackage };
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
/**
 * REST-specific failures. Integrity failures keep their own codes and are
 * raised as PublicationIntegrityError by publicationIntegrity.ts, so a caller
 * can tell "the content is not fit to publish" from "the wire did not work".
 */
export type MetricoolFailureCode =
  | "rest-unavailable"
  | "missing-credentials"
  | "auth-failed"
  | "malformed-response"
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

export interface MetricoolRestAvailability {
  readonly available: boolean;
  readonly reason: string;
}

/**
 * Whether direct Metricool REST can be used at all.
 *
 * The founder's current plan does not include REST API access, so on that plan
 * this always reports unavailable and publishApprovedPackage refuses before
 * touching anything. Availability is decided solely by whether REST
 * credentials exist: there is no override flag, and no code path treats
 * "unavailable" as a soft warning to continue past.
 */
export function metricoolRestAvailability(
  credentials: MetricoolCredentials | undefined = metricoolCredentialsFromEnv(),
): MetricoolRestAvailability {
  if (!credentials?.userToken?.trim() || !credentials?.userId?.trim()) {
    return {
      available: false,
      reason:
        "Metricool REST is unavailable: no REST credentials are configured. The current Metricool plan does not expose REST API access, so the active route is the READY_TO_PUBLISH handoff manifest (readyToPublishHandoff.ts).",
    };
  }
  return { available: true, reason: "Metricool REST credentials are configured." };
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

  // Availability first. On the current Metricool plan this is where every call
  // stops, which is the intended state: REST is a future adapter, not a route
  // anything falls back to.
  const availability = metricoolRestAvailability(options.credentials);
  if (!availability.available) {
    throw new MetricoolPublishError("rest-unavailable", availability.reason);
  }
  if (!options.credentials?.userToken || !options.credentials?.userId) {
    throw new MetricoolPublishError("missing-credentials", "Metricool credentials are not configured in this environment.");
  }

  // "draft" must never queue a live post. A request whose own draft flag
  // disagrees with the requested mode is a contradiction, not something to
  // silently resolve in either direction. REST-specific, because only this
  // route has a mode.
  if (mode === "draft" && request.draft !== true) {
    throw new MetricoolPublishError(
      "unsupported-platform-state" as MetricoolFailureCode,
      `Request ${request.requestId} has draft=false but the publish mode is "draft". Refusing to guess which was intended.`,
    );
  }

  const ledger = await loadStoredPublicationLedger(options.storeRoot, request.creativeId);
  if (!ledger) {
    throw new PublicationIntegrityError(
      "unsupported-platform-state",
      `No durable publication ledger exists for ${request.creativeId}; a publication must be ledgered before it can be released.`,
    );
  }

  // Every content and ledger guarantee, shared with the handoff route so the
  // two can never drift apart.
  assertPublicationGatesPassed(pkg, ledger);
  const verifiedSha256 = await verifyApprovedMedia(pkg);

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
