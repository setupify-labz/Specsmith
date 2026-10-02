// A SIMULATED publication provider, for tests and offline demonstrations.
//
// It stands in for Metricool behind the PublicationProvider interface and
// behaves like a provider that honours idempotency keys: a second submission
// with the same key returns the first post instead of creating another. Its
// failure modes are scripted so each can be exercised: a definite refusal, a
// timeout after the post was actually created, a success with no post id, an
// answer for another request. It touches no network and no account, and the
// boundary refuses it outside a simulation store.

import type { ProviderLookup, ProviderPublicationRequest, ProviderSubmitOutcome, PublicationProvider } from "./boundary.ts";

export type SimulatedBehaviour =
  | "accept-draft"
  | "accept-schedule"
  | "publish"
  | "reject"
  /** The provider creates the post, then the answer is lost. */
  | "timeout-after-create"
  /** The provider creates nothing and the answer is lost. */
  | "timeout-before-create"
  | "success-without-id"
  | "answer-for-other-request";

export interface SimulatedPost {
  readonly providerPostId: string;
  readonly idempotencyKey: string;
  readonly mediaSha256: string;
  readonly account: string;
  state: "draft" | "scheduled" | "published";
  providerUrl?: string;
  scheduledFor?: string;
}

export interface SimulatedProvider extends PublicationProvider {
  /** Every post the simulated provider holds. A duplicate would show here. */
  readonly posts: SimulatedPost[];
  /** Submissions received, including retries. */
  readonly submissions: ProviderPublicationRequest[];
  /** Script the next submissions; when empty, `fallback` applies. */
  queue(...behaviours: SimulatedBehaviour[]): void;
  /** Move a post forward, as a person releasing it in the provider's UI would. */
  advance(providerPostId: string, state: "scheduled" | "published"): void;
  /** Make lookups unavailable, as a provider without a lookup API would be. */
  lookupsUnsupported: boolean;
  /** A post a person created by hand in the provider (the handoff route), which SpecSmith never sent. */
  adopt(post: { providerPostId: string; mediaSha256: string; account: string; state: SimulatedPost["state"] }): void;
}

export function createSimulatedProvider(fallback: SimulatedBehaviour = "accept-draft"): SimulatedProvider {
  const scripted: SimulatedBehaviour[] = [];
  const posts: SimulatedPost[] = [];
  const submissions: ProviderPublicationRequest[] = [];
  let counter = 0;

  const create = (request: ProviderPublicationRequest, state: SimulatedPost["state"]): SimulatedPost => {
    const existing = posts.find((post) => post.idempotencyKey === request.idempotencyKey);
    if (existing) return existing;
    counter += 1;
    const post: SimulatedPost = {
      providerPostId: `SIM-POST-${counter}`, idempotencyKey: request.idempotencyKey, mediaSha256: request.mediaSha256,
      account: request.destination.accountId, state,
      ...(state === "scheduled" ? { scheduledFor: request.schedule?.localDateTime ?? "2026-10-03T18:00:00" } : {}),
      ...(state === "published" ? { providerUrl: `https://simulated.invalid/post/${counter}` } : {}),
    };
    posts.push(post);
    return post;
  };
  const found = (post: SimulatedPost): ProviderLookup => ({
    kind: "found", state: post.state, providerPostId: post.providerPostId, providerUrl: post.providerUrl,
    scheduledFor: post.scheduledFor, idempotencyKey: post.idempotencyKey, mediaSha256: post.mediaSha256,
  });

  const provider: SimulatedProvider = {
    providerId: "metricool",
    simulated: true,
    posts,
    submissions,
    lookupsUnsupported: false,
    queue(...behaviours) { scripted.push(...behaviours); },
    adopt(post) {
      posts.push({ ...post, idempotencyKey: "(created by hand in the provider)",
        ...(post.state === "published" ? { providerUrl: `https://simulated.invalid/post/${post.providerPostId}` } : {}),
        ...(post.state === "scheduled" ? { scheduledFor: "2026-09-20T10:00:00" } : {}) });
    },
    advance(providerPostId, state) {
      const post = posts.find((entry) => entry.providerPostId === providerPostId);
      if (!post) throw new Error(`No simulated post ${providerPostId}.`);
      post.state = state;
      if (state === "published") post.providerUrl = `https://simulated.invalid/post/${providerPostId}`;
      if (state === "scheduled") post.scheduledFor ??= "2026-10-03T18:00:00";
    },
    async submit(request): Promise<ProviderSubmitOutcome> {
      submissions.push(structuredClone(request));
      const behaviour = scripted.shift() ?? fallback;
      switch (behaviour) {
        case "accept-draft": { const post = create(request, "draft"); return { kind: "draft-accepted", providerPostId: post.providerPostId, echoedIdempotencyKey: request.idempotencyKey }; }
        case "accept-schedule": { const post = create(request, "scheduled"); return { kind: "schedule-accepted", providerPostId: post.providerPostId, scheduledFor: post.scheduledFor!, echoedIdempotencyKey: request.idempotencyKey }; }
        case "publish": { const post = create(request, "published"); return { kind: "published", providerPostId: post.providerPostId, providerUrl: post.providerUrl, echoedIdempotencyKey: request.idempotencyKey }; }
        case "reject": return { kind: "rejected", reason: "SIMULATED: the provider refused the media format." };
        case "timeout-after-create": create(request, "draft"); throw new Error("SIMULATED: connection timed out after the request was sent.");
        case "timeout-before-create": throw new Error("SIMULATED: connection timed out before the provider answered.");
        case "success-without-id": create(request, "draft"); return { kind: "draft-accepted", providerPostId: "" };
        case "answer-for-other-request": { const post = create(request, "draft"); return { kind: "draft-accepted", providerPostId: post.providerPostId, echoedIdempotencyKey: "specsmith-some-other-request" }; }
      }
    },
    async lookupByIdempotencyKey(idempotencyKey) {
      if (provider.lookupsUnsupported) return { kind: "unsupported", reason: "SIMULATED: this provider has no lookup API." };
      const post = posts.find((entry) => entry.idempotencyKey === idempotencyKey);
      return post ? found(post) : { kind: "absent" };
    },
    async lookupPost(providerPostId) {
      if (provider.lookupsUnsupported) return { kind: "unsupported", reason: "SIMULATED: this provider has no lookup API." };
      const post = posts.find((entry) => entry.providerPostId === providerPostId);
      return post ? found(post) : { kind: "absent" };
    },
  };
  return provider;
}
