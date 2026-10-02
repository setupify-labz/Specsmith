// The shared integrity core, tested DIRECTLY rather than only through a route.
//
// Why this file exists: both release routes rely on this one gate. Pinning the
// guarantees where they actually live is what stops a regression here from
// reaching a route silently.
//
// The ledgers below are histories as the store reads them back. Writing the
// protected states needs the publication boundary's receipts (see
// v2/publication/ledgerAuthority.test.ts); this file tests what the gate
// accepts once they exist.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { assertPublicationGatesPassed, assertNotAlreadyReleased } from "./publicationIntegrity.ts";
import type { ApprovedPublicationPackage } from "./publicationIntegrity.ts";
import type { MetricoolPublishingRequest, PublicationEvent, PublicationLedger } from "./publishing.ts";
import type { VideoPlatform } from "./types.ts";

const DIGEST = "a".repeat(64);

function request(overrides: Partial<MetricoolPublishingRequest> = {}): MetricoolPublishingRequest {
  return {
    requestId: "request-1",
    creativeId: "creative-1",
    packageId: "package-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform: "youtube-shorts",
    blog_id: "blog-1",
    networks: ["youtube"],
    text: "caption",
    date: "2026-09-20T10:00:00",
    timezone: "America/New_York",
    media: ["https://cdn.example.com/master.mp4"],
    draft: true,
    trackedWebsiteUrl: "https://specsmithpc.com/compare",
    websiteCtaMode: "profile-link",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC"],
    finalMediaSha256: DIGEST,
    ...overrides,
  } as MetricoolPublishingRequest;
}

function pkg(overrides: Partial<ApprovedPublicationPackage> = {}): ApprovedPublicationPackage {
  return { request: request(), mediaPath: "/tmp/does-not-matter.mp4", approvedMasterSha256: DIGEST, ...overrides };
}

function ledger(events: PublicationEvent[], platform: VideoPlatform = "youtube-shorts"): PublicationLedger {
  return { creativeId: "creative-1", packageId: "package-1", platform, events };
}

const GENERATED: PublicationEvent = { status: "generated", at: "2026-09-14T10:00:00.000Z" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const REVIEWED: PublicationEvent[] = [
  { status: "machine-reviewed", at: "2026-09-14T10:30:00.000Z", evidence: { reviewPacketId: "pk", reviewPacketVersion: "v1", reviewVerdict: "awaiting-human-review", mediaSha256: DIGEST, variantId: "v", reviewBindingsSha256: "b" } },
  { status: "human-review-pending", at: "2026-09-14T10:30:00.000Z", evidence: { reviewPacketId: "pk" } },
];
function authorizedEvent(overrides: Record<string, string> = {}): PublicationEvent {
  return { status: "publication-authorized", at: "2026-09-14T11:00:00.000Z", evidence: {
    reviewPacketId: "pk", reviewBindingsSha256: "b", mediaSha256: DIGEST, variantId: "v", destinationProvider: "metricool",
    destinationAccount: "blog-1", destinationPlatform: "youtube-shorts", decisionId: "d", reviewerId: "r", approvalMechanism: "m",
    decidedAt: "2026-09-14T11:00:00.000Z", idempotencyKey: "k", titleSha256: sha("title"), descriptionSha256: sha("caption"), ...overrides,
  } };
}
const AUTHORIZED: PublicationEvent[] = [GENERATED, ...REVIEWED, authorizedEvent()];

describe("publication must have been authorized", () => {
  it("accepts a ledger authorized for exactly this request", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger(AUTHORIZED))).not.toThrow();
  });

  it("refuses a ledger that was only machine-reviewed: review is not approval", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger([GENERATED, ...REVIEWED]))).toThrow(/no publication authorization/);
  });

  it("refuses a legacy qc-passed ledger", () => {
    const legacy = { ...ledger([GENERATED, { status: "qc-passed", at: "2026-09-14T11:00:00.000Z" }]), legacy: { since: "2026-09-14T11:00:00.000Z", reason: "score-based" } };
    expect(() => assertPublicationGatesPassed(pkg(), legacy)).toThrow(/legacy ledger/);
  });

  it("refuses a creative that was rejected or failed, even after authorization", () => {
    for (const status of ["rejected", "failed"] as const) {
      expect(() => assertPublicationGatesPassed(pkg(), ledger([...AUTHORIZED, { status, at: "2026-09-14T12:00:00.000Z" }]))).toThrow(/may not be released/);
    }
  });

  it("refuses a request for other media, another account, or different text than was authorized", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ finalMediaSha256: "b".repeat(64) }), approvedMasterSha256: "b".repeat(64) }), ledger(AUTHORIZED)))
      .toThrow(/names other media than was authorized/);
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ blog_id: "blog-2" }) }), ledger(AUTHORIZED))).toThrow(/account blog-2 was not authorized/);
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ text: "caption, revised" }) }), ledger(AUTHORIZED))).toThrow(/not the reviewed and authorized description/);
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ youtube_title: "A new title" }) }), ledger(AUTHORIZED))).toThrow(/title is not the reviewed/);
  });
});

describe("rights must be approved", () => {
  it("refuses an empty approved-master digest", () => {
    expect(() => assertPublicationGatesPassed(pkg({ approvedMasterSha256: "" }), ledger(AUTHORIZED)))
      .toThrow(/no rights-approved master digest/);
  });

  it("refuses a malformed approved-master digest", () => {
    expect(() => assertPublicationGatesPassed(pkg({ approvedMasterSha256: "not-a-digest" }), ledger(AUTHORIZED)))
      .toThrow(/no rights-approved master digest/);
  });
});

describe("identity and schedule must be coherent", () => {
  it("refuses a ledger describing a different platform", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger(AUTHORIZED, "tiktok")))
      .toThrow(/is tiktok, not youtube-shorts/);
  });

  it("refuses a ledger describing a different creative", () => {
    const other = { ...ledger(AUTHORIZED), creativeId: "creative-other" };
    expect(() => assertPublicationGatesPassed(pkg(), other)).toThrow(/does not describe creative/);
  });

  it("refuses a request with no media reference", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ media: [] }) }), ledger(AUTHORIZED)))
      .toThrow(/carries no media reference/);
  });

  it("refuses a UTC instant where a local wall-clock time is required", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ date: "2026-09-20T10:00:00Z" }) }), ledger(AUTHORIZED)))
      .toThrow(/local YYYY-MM-DDTHH:mm:ss/);
  });

  it("refuses a missing timezone", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ timezone: "" }) }), ledger(AUTHORIZED)))
      .toThrow(/unambiguous local date\/timezone pair/);
  });
});

describe("a released creative is never released again", () => {
  const STARTED: PublicationEvent = { status: "submission-started", at: "2026-09-14T11:30:00.000Z", evidence: { idempotencyKey: "k", requestSha256: "q", attempt: 1 } };
  it("refuses one already published", () => {
    expect(() => assertNotAlreadyReleased(ledger([...AUTHORIZED, STARTED,
      { status: "scheduled", at: "2026-09-14T12:00:00.000Z", providerPostId: "post-1", evidence: { idempotencyKey: "k", confirmedBy: "provider-response", scheduledFor: "x" } },
      { status: "published", at: "2026-09-14T13:00:00.000Z", providerPostId: "post-1", evidence: { idempotencyKey: "k", confirmedBy: "provider-lookup" } }]), "youtube-shorts")).toThrow(/already published/);
  });

  it("refuses one whose draft or schedule the provider already accepted", () => {
    for (const status of ["draft-submitted", "scheduled"] as const) {
      expect(() => assertNotAlreadyReleased(ledger([...AUTHORIZED, STARTED,
        { status, at: "2026-09-14T12:00:00.000Z", providerPostId: "post-1", evidence: { idempotencyKey: "k", confirmedBy: "provider-response", scheduledFor: "x" } }]), "youtube-shorts"))
        .toThrow(/already has youtube-shorts post post-1/);
    }
  });

  it("allows one that is authorized and not yet sent", () => {
    expect(() => assertNotAlreadyReleased(ledger(AUTHORIZED), "youtube-shorts")).not.toThrow();
  });
});
