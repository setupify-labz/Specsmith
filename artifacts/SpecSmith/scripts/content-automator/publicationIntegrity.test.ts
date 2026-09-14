// The shared integrity core, tested DIRECTLY rather than only through a route.
//
// Why this file exists: the handoff route keeps its own redundant qc-passed
// check, so a handoff test goes on passing even when the shared gate's QC check
// is disabled — proven by a negative control. The REST adapter has no such
// redundancy and relies on this module alone. Pinning the guarantees where they
// actually live is what stops a regression here from reaching a route silently.

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
const QC_PASSED: PublicationEvent = { status: "qc-passed", at: "2026-09-14T11:00:00.000Z" };

describe("quality review must have passed", () => {
  it("accepts a ledger that reached qc-passed", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger([GENERATED, QC_PASSED]))).not.toThrow();
  });

  it("refuses a ledger that never reached qc-passed", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger([GENERATED])))
      .toThrow(/no qc-passed event/);
  });

  it("refuses a creative that was rejected", () => {
    // qc-passed -> rejected is a real transition, so the rejection must be
    // caught on its own terms rather than incidentally by the qc-passed check.
    expect(() => assertPublicationGatesPassed(
      pkg(),
      ledger([GENERATED, QC_PASSED, { status: "rejected", at: "2026-09-14T12:00:00.000Z" }]),
    )).toThrow(/may not be released/);
  });

  it("refuses a creative that failed, even if it had passed QC earlier", () => {
    expect(() => assertPublicationGatesPassed(
      pkg(),
      ledger([GENERATED, QC_PASSED, { status: "failed", at: "2026-09-14T12:00:00.000Z" }]),
    )).toThrow(/may not be released/);
  });
});

describe("rights must be approved", () => {
  it("refuses an empty approved-master digest", () => {
    expect(() => assertPublicationGatesPassed(pkg({ approvedMasterSha256: "" }), ledger([GENERATED, QC_PASSED])))
      .toThrow(/no rights-approved master digest/);
  });

  it("refuses a malformed approved-master digest", () => {
    expect(() => assertPublicationGatesPassed(pkg({ approvedMasterSha256: "not-a-digest" }), ledger([GENERATED, QC_PASSED])))
      .toThrow(/no rights-approved master digest/);
  });
});

describe("identity and schedule must be coherent", () => {
  it("refuses a ledger describing a different platform", () => {
    expect(() => assertPublicationGatesPassed(pkg(), ledger([GENERATED, QC_PASSED], "tiktok")))
      .toThrow(/is tiktok, not youtube-shorts/);
  });

  it("refuses a ledger describing a different creative", () => {
    const other = { ...ledger([GENERATED, QC_PASSED]), creativeId: "creative-other" };
    expect(() => assertPublicationGatesPassed(pkg(), other)).toThrow(/does not describe creative/);
  });

  it("refuses a request with no media reference", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ media: [] }) }), ledger([GENERATED, QC_PASSED])))
      .toThrow(/carries no media reference/);
  });

  it("refuses a UTC instant where a local wall-clock time is required", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ date: "2026-09-20T10:00:00Z" }) }), ledger([GENERATED, QC_PASSED])))
      .toThrow(/local YYYY-MM-DDTHH:mm:ss/);
  });

  it("refuses a missing timezone", () => {
    expect(() => assertPublicationGatesPassed(pkg({ request: request({ timezone: "" }) }), ledger([GENERATED, QC_PASSED])))
      .toThrow(/unambiguous local date\/timezone pair/);
  });
});

describe("a released creative is never released again", () => {
  it("refuses one already published", () => {
    expect(() => assertNotAlreadyReleased(
      ledger([GENERATED, QC_PASSED, { status: "scheduled", at: "2026-09-14T12:00:00.000Z" }, { status: "published", at: "2026-09-14T13:00:00.000Z" }]),
      "youtube-shorts",
    )).toThrow(/already published/);
  });

  it("refuses one already scheduled with a provider id", () => {
    expect(() => assertNotAlreadyReleased(
      ledger([GENERATED, QC_PASSED, { status: "scheduled", at: "2026-09-14T12:00:00.000Z", providerPostId: "post-1" }]),
      "youtube-shorts",
    )).toThrow(/already has youtube-shorts post post-1/);
  });

  it("allows one that has only passed QC", () => {
    expect(() => assertNotAlreadyReleased(ledger([GENERATED, QC_PASSED]), "youtube-shorts")).not.toThrow();
  });
});
