// MASTER #8 at the publishing boundary, against real MASTER #7 packets.
//
// The packets here are issued by reviewCreative for a fixture cut rendered by
// the real ffmpeg compositor (v2/review/reviewFixture.ts). Stores are labelled
// simulation stores with the simulated approval verifier and provider, except
// where a test shows what a production store does: there, nothing can be
// authorized, because no trusted approval mechanism exists.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStoredPublicationLedger, initPublicationStore, loadStoredPublicationLedger } from "../../publishingStore.ts";
import type { CreativeFingerprint } from "../../types.ts";
import { HUMAN_GATES } from "../review/humanGates.ts";
import type { ReviewSubmission } from "../review/inputs.ts";
import { buildReviewFixture, ffmpeg, type ReviewFixture } from "../review/reviewFixture.ts";
import { reviewCreative } from "../review/reviewCreative.ts";
import type { ReviewPacket } from "../review/types.ts";
import { sha256Json } from "../review/util.ts";
import {
  authorizePublication,
  buildProviderRequest,
  confirmProviderState,
  createSimulatedApprovalVerifier,
  loadAuthorization,
  MISSING_APPROVAL_CAPABILITY,
  reconcileSubmission,
  recordMachineReview,
  submitAuthorizedPublication,
  type PublicationDestination,
  type TrustedApprovalVerifier,
} from "./boundary.ts";
import { createSimulatedProvider } from "./simulatedProvider.ts";

let dir: string;
let fixture: ReviewFixture;
let clean: ReviewPacket;
const DESTINATION: PublicationDestination = { provider: "metricool", accountId: "specsmithpc-main", platform: "youtube-shorts" };
const verifier = createSimulatedApprovalVerifier();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master8-boundary-"));
  fixture = await buildReviewFixture(dir);
  clean = await reviewCreative(fixture.submission());
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fingerprint(creativeId: string): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1", creativeId, packageId: "review-fixture", campaignId: "c", ideaId: "i", platform: "youtube-shorts",
    format: "comparison", feature: "compare", subjectIds: [], hookFamily: "tally-question", hookText: "Ten games to seven", visualWorld: "ui",
    narrativeEngine: "tally-then-average", targetDurationSeconds: 6, beatCount: 3, plannedBeatChangesPer10Seconds: 5, editDensity: "medium",
    captionedBeatRatio: 1, captionDensity: "medium", firstVisualType: "deterministic-ui", sfxDensity: "low", ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late", hashtagStrategy: "intent-balanced-v1", hashtags: [], experimentId: "none", experimentPrimaryMetric: "retention",
    changedVariable: "none", contentFreshness: "evergreen",
  } as CreativeFingerprint;
}

async function store(mode: "simulation" | "production" = "simulation"): Promise<string> {
  const root = await mkdtemp(join(dir, "store-"));
  if (mode === "simulation") await initPublicationStore(root, "simulation", "MASTER #8 boundary test");
  await createStoredPublicationLedger(root, fingerprint(clean.creativeId));
  return root;
}

/** A store whose ledger recorded the clean packet's machine review: human review pending. */
async function reviewed(packet = clean, submission: ReviewSubmission = fixture.submission()): Promise<string> {
  const root = await store();
  await recordMachineReview({ storeRoot: root, packet, submission });
  return root;
}

/** What a reviewer approved, as the simulated verifier reads it. */
function decision(packet: ReviewPacket, overrides: Record<string, unknown> = {}) {
  return {
    simulatedReviewer: "editor", decisionId: "decision-1", decidedAt: new Date().toISOString(), outcome: "approved",
    gates: Object.fromEntries(HUMAN_GATES.map((gate) => [gate.gate, "approved"])),
    mediaSha256: packet.media.sha256, variantId: packet.platformVariantId, destination: DESTINATION,
    reviewPacketId: packet.packetId, reviewBindingsSha256: sha256Json(packet.bindings), ...overrides,
  };
}

const authorize = (root: string, claim: unknown, packet = clean, submission = fixture.submission(), extra: Partial<Parameters<typeof authorizePublication>[0]> = {}) =>
  authorizePublication({ storeRoot: root, packet, submission, destination: DESTINATION, decisionClaim: claim, verifier,
    simulationAcknowledgesFinalApprovalBlockers: true, ...extra });

async function authorized(): Promise<string> {
  const root = await reviewed();
  await authorize(root, decision(clean));
  return root;
}

async function request(root: string) {
  return buildProviderRequest({ authorization: (await loadAuthorization(root, clean.creativeId))!, submission: fixture.submission(),
    mediaUrl: "https://cdn.example.com/review-fixture.mp4", schedule: { localDateTime: "2026-10-05T18:00:00", timezone: "America/New_York" } });
}

const statuses = async (root: string) => (await loadStoredPublicationLedger(root, clean.creativeId))!.events.map((event) => event.status);

describe("MASTER #7 is unavoidable at the boundary", () => {
  it("records a real packet as machine-reviewed, then human-review-pending: review is not approval", async () => {
    const root = await reviewed();
    expect(await statuses(root)).toEqual(["generated", "machine-reviewed", "human-review-pending"]);
    const ledger = (await loadStoredPublicationLedger(root, clean.creativeId))!;
    expect(ledger.events[1].evidence).toMatchObject({ reviewPacketId: clean.packetId, reviewVerdict: "awaiting-human-review", mediaSha256: clean.media.sha256, variantId: clean.platformVariantId });
  });

  it("refuses a score, a Boolean, a copied packet or a hand-built one", async () => {
    const root = await store();
    for (const packet of [
      { publishable: true, overallScore: 9.8 },
      { ...clean },
      JSON.parse(JSON.stringify(clean)),
      { ...clean, verdict: "eligible-to-request-final-approval" },
    ]) {
      await expect(recordMachineReview({ storeRoot: root, packet: packet as ReviewPacket, submission: fixture.submission() })).rejects.toMatchObject({ code: "packet-not-issued" });
    }
    expect(await statuses(root)).toEqual(["generated"]);
  });

  it("refuses a valid packet whose title, description, destination, plan or platform cut changed", async () => {
    const changes: [string, (submission: ReviewSubmission) => ReviewSubmission][] = [
      ["title", (submission) => ({ ...submission, title: "Build A wins, decisively" })],
      ["description", (submission) => ({ ...submission, description: `${submission.description} Limited offer.` })],
      ["destination", (submission) => ({ ...submission, approvedDestination: "/builder" })],
      ["production plan", (submission) => ({ ...submission, productionPlan: { different: true } })],
      ["platform cut", (submission) => ({ ...submission, variant: { ...submission.variant, variantId: "tiktok-1080x1920-30" } })],
    ];
    for (const [name, change] of changes) {
      const root = await store();
      await expect(recordMachineReview({ storeRoot: root, packet: clean, submission: change(fixture.submission()) }), name).rejects.toMatchObject({ code: "packet-stale" });
      expect(await statuses(root), name).toEqual(["generated"]);
    }
  });

  it("refuses a packet once its media bytes or render manifest changed", async () => {
    const cut = fixture.derive("boundary-media", []);
    const submission = { ...fixture.submission(), renderManifestPath: cut.manifestPath };
    const packet = await reviewCreative(submission);
    const root = await store();
    ffmpeg("-i", fixture.videoPath, "-vf", "eq=brightness=0.03", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", join(dir, "other.mp4"));
    writeFileSync(cut.videoPath, readFileSync(join(dir, "other.mp4")));
    await expect(recordMachineReview({ storeRoot: root, packet, submission })).rejects.toThrow(/changed after it was verified/);

    const cut2 = fixture.derive("boundary-manifest", []);
    const submission2 = { ...fixture.submission(), renderManifestPath: cut2.manifestPath };
    const packet2 = await reviewCreative(submission2);
    const manifest = JSON.parse(readFileSync(cut2.manifestPath, "utf8"));
    manifest.layout.captions.y = 1610;
    writeFileSync(cut2.manifestPath, JSON.stringify(manifest));
    await expect(recordMachineReview({ storeRoot: root, packet: packet2, submission: submission2 })).rejects.toThrow(/band layout changed after review/);
    expect(await statuses(root)).toEqual(["generated"]);
  }, 120_000);

  it("refuses a decision once the reviewed title changed after review was recorded", async () => {
    const root = await reviewed();
    await expect(authorize(root, decision(clean), clean, { ...fixture.submission(), title: "A new, unreviewed title" })).rejects.toMatchObject({ code: "packet-stale" });
    expect(await statuses(root)).toEqual(["generated", "machine-reviewed", "human-review-pending"]);
  });

  it("records a blocked packet as rejected, and nothing can follow it", async () => {
    const storyboard = structuredClone(fixture.submission().storyboard);
    (storyboard.beats[0] as { onScreenText: string }).onScreenText = "13 games to 7";
    const cut = await fixture.renderCut("blocked-for-boundary", { storyboard });
    const submission = cut.submission();
    const blocked = await reviewCreative({ ...submission, claims: submission.claims.map((claim) => claim.claimId === "hook-tally-caption"
      ? { ...claim, text: "13 games to 7", statement: { ...claim.statement, leadsA: 13, ties: null } as never } : claim) });
    expect(blocked.verdict).toBe("blocked");
    const root = await store();
    const ledger = await recordMachineReview({ storeRoot: root, packet: blocked, submission: { ...submission, claims: submission.claims.map((claim) => claim.claimId === "hook-tally-caption"
      ? { ...claim, text: "13 games to 7", statement: { ...claim.statement, leadsA: 13, ties: null } as never } : claim) } });
    expect(ledger.events.at(-1)).toMatchObject({ status: "rejected" });
    expect(String(ledger.events.at(-1)!.evidence?.blockingCodes)).toContain("tie-counted-as-lead");
    await expect(authorize(root, decision(blocked), blocked)).rejects.toMatchObject({ code: "packet-stale" });
  }, 120_000);
});

describe("human review: open gates and rejections block, approvals must match exactly", () => {
  it("nothing can be sent while human review is pending", async () => {
    const root = await reviewed();
    await expect(submitAuthorizedPublication({ storeRoot: root, request: { creativeId: clean.creativeId } as never, mediaPath: fixture.videoPath, provider: createSimulatedProvider() }))
      .rejects.toMatchObject({ code: "not-authorized" });
  });

  it("an approval that leaves any gate undecided is refused", async () => {
    const root = await reviewed();
    const gates = Object.fromEntries(HUMAN_GATES.map((gate) => [gate.gate, "approved"]));
    delete gates["voice-and-mix"];
    await expect(authorize(root, decision(clean, { gates }))).rejects.toThrow(/still open: voice-and-mix/);
    expect((await statuses(root)).at(-1)).toBe("human-review-pending");
  });

  it("a rejection, of the whole cut or of one gate, is recorded and blocks for good", async () => {
    for (const claim of [decision(clean, { outcome: "rejected" }), decision(clean, { gates: { ...decision(clean).gates, pacing: "rejected" } })]) {
      const root = await reviewed();
      const ledger = await authorize(root, claim);
      expect(ledger.events.at(-1)!.status).toBe("human-rejected");
      await expect(authorize(root, decision(clean))).rejects.toMatchObject({ code: "wrong-state" });
      await expect(submitAuthorizedPublication({ storeRoot: root, request: { creativeId: clean.creativeId } as never, mediaPath: fixture.videoPath, provider: createSimulatedProvider() }))
        .rejects.toMatchObject({ code: "not-authorized" });
    }
  });

  it("a decision about other bytes, another cut, another account, another review version, or a future time cannot authorize", async () => {
    const forged: [string, Record<string, unknown>, RegExp][] = [
      ["other media", { mediaSha256: "f".repeat(64) }, /media .* is not the reviewed/],
      ["another cut", { variantId: "tiktok-1080x1920-30" }, /cut tiktok-1080x1920-30 is not/],
      ["another account", { destination: { ...DESTINATION, accountId: "someone-elses-account" } }, /destination .* is not/],
      ["another review", { reviewPacketId: "packet-from-another-review" }, /review packet-from-another-review is not packet/],
      ["changed inputs", { reviewBindingsSha256: sha256Json({ ...clean.bindings, title: "x" }) }, /reviewed inputs .* differ/],
      ["a future time", { decidedAt: "2099-01-01T00:00:00Z" }, /in the future/],
    ];
    for (const [name, overrides, message] of forged) {
      const root = await reviewed();
      await expect(authorize(root, decision(clean, overrides)), name).rejects.toThrow(message);
      expect((await statuses(root)).at(-1), name).toBe("human-review-pending");
    }
  });

  it("a caller-made verifier is not trusted, even one that says it is simulated", async () => {
    const root = await reviewed();
    const homemade: TrustedApprovalVerifier = { mechanism: "trust me", simulated: true, async verify() { return decision(clean) as never; } };
    await expect(authorize(root, decision(clean), clean, fixture.submission(), { verifier: homemade })).rejects.toMatchObject({ code: "untrusted-verifier" });
  });

  it("final-approval blockers (synthetic research, placeholders) cannot be waived by a reviewer", async () => {
    const root = await reviewed();
    await expect(authorize(root, decision(clean), clean, fixture.submission(), { simulationAcknowledgesFinalApprovalBlockers: false }))
      .rejects.toThrow(/Final approval is impossible while the packet carries: .*synthetic-research.*placeholder-asset/);
    // A simulation may proceed past them only by recording each one.
    const ledger = await authorize(root, decision(clean));
    expect(ledger.events.at(-1)!.evidence?.finalApprovalBlockersOverriddenInSimulation).toMatch(/synthetic-research/);
    expect(ledger.events.at(-1)!.note).toMatch(/SIMULATED authorization .* In production this would be refused/);
  });

  it("a production store cannot authorize at all: no trusted approval mechanism exists", async () => {
    const root = await store("production");
    await recordMachineReview({ storeRoot: root, packet: clean, submission: fixture.submission() });
    await expect(authorize(root, decision(clean))).rejects.toThrow(MISSING_APPROVAL_CAPABILITY);
    expect((await statuses(root)).at(-1)).toBe("human-review-pending");
  });
});

describe("the provider: built is not sent, sent is not accepted, unknown is not retried", () => {
  it("building a request changes nothing", async () => {
    const root = await authorized();
    await request(root);
    expect((await statuses(root)).at(-1)).toBe("publication-authorized");
  });

  it("refuses to build a request whose title or description is not the authorized text", async () => {
    const root = await authorized();
    const authorization = (await loadAuthorization(root, clean.creativeId))!;
    expect(() => buildProviderRequest({ authorization, submission: { ...fixture.submission(), description: "Revised after approval" }, mediaUrl: "https://x/y.mp4" }))
      .toThrow(/differs from the one reviewed and authorized/);
  });

  const failures = [
    ["a definite refusal", "reject", "submission-failed", "rejected"],
    ["a timeout before anything was created", "timeout-before-create", "submission-unknown", "unknown"],
    ["a success that names no post", "success-without-id", "submission-unknown", "unknown"],
    ["an answer for another request", "answer-for-other-request", "submission-unknown", "unknown"],
  ] as const;
  for (const [name, behaviour, status, kind] of failures) {
    it(`${name} never becomes scheduled or published`, async () => {
      const root = await authorized();
      const provider = createSimulatedProvider();
      provider.queue(behaviour);
      const report = await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
      expect(report.kind).toBe(kind);
      const all = await statuses(root);
      expect(all.at(-1)).toBe(status);
      expect(all.some((entry) => ["draft-submitted", "scheduled", "published"].includes(entry))).toBe(false);
    });
  }

  it("retrying after a lost answer creates no duplicate: the provider is asked first", async () => {
    const root = await authorized();
    const provider = createSimulatedProvider();
    provider.queue("timeout-after-create");
    const first = await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(first.kind).toBe("unknown");
    // A blind resend is refused.
    await expect(submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider })).rejects.toMatchObject({ code: "outcome-unknown" });
    // Asking the provider finds the post the lost answer created.
    const reconciled = await reconcileSubmission({ storeRoot: root, creativeId: clean.creativeId, provider });
    expect(reconciled).toMatchObject({ resolved: true, report: { kind: "accepted", status: "draft-submitted" } });
    // Retrying now returns that post instead of creating another.
    const retried = await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(retried).toMatchObject({ kind: "already-accepted", providerPostId: provider.posts[0].providerPostId });
    expect(provider.posts).toHaveLength(1);
    expect(provider.submissions).toHaveLength(1);
  });

  it("when the provider confirms no post exists, a retry is allowed and succeeds once", async () => {
    const root = await authorized();
    const provider = createSimulatedProvider();
    provider.queue("timeout-before-create", "accept-draft");
    await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(await reconcileSubmission({ storeRoot: root, creativeId: clean.creativeId, provider })).toMatchObject({ resolved: true, report: { kind: "rejected" } });
    const retry = await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(retry).toMatchObject({ kind: "accepted", status: "draft-submitted" });
    expect(provider.posts).toHaveLength(1);
    expect((await loadStoredPublicationLedger(root, clean.creativeId))!.events.filter((event) => event.status === "submission-started").map((event) => event.evidence?.attempt)).toEqual([1, 2]);
  });

  it("an unknown outcome stays unknown when the provider cannot be asked", async () => {
    const root = await authorized();
    const provider = createSimulatedProvider();
    provider.queue("timeout-after-create");
    provider.lookupsUnsupported = true;
    await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(await reconcileSubmission({ storeRoot: root, creativeId: clean.creativeId, provider })).toMatchObject({ resolved: false });
    expect((await statuses(root)).at(-1)).toBe("submission-unknown");
  });

  it("published is recorded only when the provider confirms it, with its URL", async () => {
    const root = await authorized();
    const provider = createSimulatedProvider();
    await submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: fixture.videoPath, provider });
    expect(await confirmProviderState({ storeRoot: root, creativeId: clean.creativeId, provider })).toMatchObject({ changed: false });
    provider.advance(provider.posts[0].providerPostId, "published");
    const confirmed = await confirmProviderState({ storeRoot: root, creativeId: clean.creativeId, provider });
    expect(confirmed.ledger.events.at(-1)).toMatchObject({ status: "published", providerUrl: expect.stringMatching(/^https:\/\/simulated\.invalid/), simulated: true });
  });

  it("the media sent must still be the authorized bytes", async () => {
    const root = await authorized();
    const copy = join(dir, "changed-before-send.mp4");
    ffmpeg("-i", fixture.videoPath, "-vf", "eq=brightness=0.05", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", copy);
    const provider = createSimulatedProvider();
    await expect(submitAuthorizedPublication({ storeRoot: root, request: await request(root), mediaPath: copy, provider })).rejects.toMatchObject({ code: "media-changed" });
    expect(provider.submissions).toHaveLength(0);
  });
});
