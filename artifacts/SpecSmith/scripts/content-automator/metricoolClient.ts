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
  submitAuthorizedPublication,
  type ProviderPublicationRequest,
  type ProviderSubmitOutcome,
  type PublicationProvider,
  type SubmissionReport,
} from "./v2/publication/boundary.ts";

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

/** The minimal HTTP surface this module needs, injected so tests never touch the network. */
export interface MetricoolTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
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
 * Metricool REST behind the MASTER #8 boundary's PublicationProvider interface.
 *
 * It only sends drafts (draft=true, autoPublish=false: going live is a human
 * act in Metricool), and maps every answer to what it proves:
 *   - no credentials, a missing schedule, 401/403, other 4xx: rejected (nothing created)
 *   - a thrown transport error, 5xx, a 2xx with no post id: unknown (a post may exist)
 *   - a 2xx naming a post: draft accepted
 * Metricool exposes no lookup by our idempotency key that this repository has
 * verified, so lookups report "unsupported" and an unknown outcome must be
 * resolved by a person in Metricool, never by resending.
 *
 * `simulated` is true only for a test transport; the boundary refuses a
 * simulated provider on a production store and a real one on a simulation store.
 */
export function createMetricoolRestProvider(options: {
  readonly credentials: MetricoolCredentials | undefined;
  readonly transport: MetricoolTransport;
  readonly baseUrl?: string;
  readonly simulated?: boolean;
}): PublicationProvider {
  const NETWORK: Record<string, string> = { "youtube-shorts": "youtube", tiktok: "tiktok", "instagram-reels": "instagram" };
  return {
    providerId: "metricool",
    simulated: options.simulated === true,
    async submit(request: ProviderPublicationRequest): Promise<ProviderSubmitOutcome> {
      const credentials = options.credentials;
      if (!metricoolRestAvailability(credentials).available || !credentials) {
        return { kind: "rejected", reason: "Metricool REST credentials are not configured; nothing was sent." };
      }
      if (!request.schedule) return { kind: "rejected", reason: "Metricool needs a local date and timezone for a draft; nothing was sent." };
      const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
      const url = `${baseUrl}/v2/scheduler/posts?blogId=${encodeURIComponent(request.destination.accountId)}&userId=${encodeURIComponent(credentials.userId)}`;
      const payload = {
        text: request.description,
        date: request.schedule.localDateTime,
        timezone: request.schedule.timezone,
        providers: [{ network: NETWORK[request.platform] }],
        media: [request.mediaUrl],
        ...(request.platform === "youtube-shorts" ? { youtubeTitle: request.title } : {}),
        ...(request.platform === "tiktok" ? { tiktokTitle: request.title } : {}),
        ...(request.platform === "instagram-reels" ? { contentType: "REEL" } : {}),
        draft: true,
        autoPublish: false,
      };
      // Thrown transport errors propagate: the boundary records them as unknown,
      // because the request may have reached Metricool.
      const response = await options.transport(url, {
        method: "POST",
        // The only place the token is used. Never logged, never returned, never written to the ledger.
        headers: { "Content-Type": "application/json", "X-Mc-Auth": credentials.userToken },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) return { kind: "rejected", reason: `Metricool rejected the credentials (HTTP ${response.status}).` };
      if (response.status >= 400 && response.status < 500) {
        return { kind: "rejected", reason: `Metricool refused the draft (HTTP ${response.status}): ${(await response.text().catch(() => "")).slice(0, 200)}` };
      }
      if (response.status < 200 || response.status >= 300) return { kind: "unknown", reason: `Metricool returned HTTP ${response.status}; the draft may or may not exist.` };
      try {
        const ids = parseProviderIds(await response.text());
        return { kind: "draft-accepted", providerPostId: ids.providerPostId };
      } catch (error) {
        return { kind: "unknown", reason: (error as Error).message };
      }
    },
    async lookupByIdempotencyKey() {
      return { kind: "unsupported", reason: "No Metricool endpoint that finds a post by SpecSmith's idempotency key is verified in this repository." };
    },
    async lookupPost() {
      return { kind: "unsupported", reason: "No Metricool post-status endpoint is verified in this repository." };
    },
  };
}

/**
 * Send an authorized creative to Metricool as a draft, through the boundary.
 * Refuses before anything is written when REST is unavailable (the current plan).
 */
export async function publishAuthorizedDraft(
  request: ProviderPublicationRequest,
  options: {
    readonly storeRoot: string;
    readonly mediaPath: string;
    readonly credentials: MetricoolCredentials | undefined;
    readonly transport: MetricoolTransport;
    readonly baseUrl?: string;
    readonly simulated?: boolean;
    readonly now?: Date;
  },
): Promise<SubmissionReport> {
  const availability = metricoolRestAvailability(options.credentials);
  if (!availability.available) throw new MetricoolPublishError("rest-unavailable", availability.reason);
  return submitAuthorizedPublication({
    storeRoot: options.storeRoot,
    request,
    mediaPath: options.mediaPath,
    provider: createMetricoolRestProvider(options),
    now: options.now,
  });
}
