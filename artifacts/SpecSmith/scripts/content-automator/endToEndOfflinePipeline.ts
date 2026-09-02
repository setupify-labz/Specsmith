// One command, proving one honest chain of custody — NOT full automatic
// idea->storyboard->render automation; read the next paragraph before
// trusting what this proves:
//
// real SpecSmith idea -> real generated storyboard/production-plan CONTRACT
// -> a real, separately-authored, already-proven render timeline (real
// deterministic UI capture, offline fixture narration, real burned-in
// captions, real ffmpeg compose) -> rights gate -> quality gate -> tracked,
// draft-only Metricool-ready publishing request -> durable, fail-closed
// publication ledger -> analytics-identity wiring proof.
//
// WHAT THIS DOES AND DOES NOT DO (read this before trusting its output)
// -----------------------------------------------------------------------
// - This does NOT prove the automatic idea->storyboard->MP4 handoff. It
//   builds the REAL content package / script-storyboard for the real
//   "compare-rtx4080s-rtx4080" idea using this repo's real, tested
//   buildContentPackage / buildScriptStoryboardPackage / buildProductionPlanPackage
//   functions — but the generated production-plan package is used ONLY to
//   build a real QualityReviewRequest CONTRACT (expected route, hard
//   blockers, required facts); it is never rendered through. The MP4 that
//   actually gets rendered and carried through the rest of this script comes
//   from offlineCompositorSmoke.ts's separate, hand-authored, already-proven
//   3-visual/8-second timeline (the same one compositorSmoke.ts already
//   proves against paid ElevenLabs) — not the full generated 6-beat
//   automatic storyboard. A prior attempt to wire the actual generated
//   6-beat storyboard through offline fixtures (for the video-generation and
//   music-sfx beats it also needs) was deliberately reverted, because it was
//   never exercised by a real render; wiring the real generated storyboard
//   through to a real render remains separate, tracked future work, not
//   something this script does. What this script proves end-to-end is the
//   chain of custody AFTER a render exists: real render bytes -> rights gate
//   -> quality gate -> tracked draft publish request -> durable ledger ->
//   analytics-identity binding, all bound to the same sha256/creativeId.
// - It renders one real, non-placeholder MP4 via offlineCompositorSmoke.ts.
//   That render's narration comes from the local espeak-ng fixture, not paid
//   ElevenLabs — see localFixtureTts.ts for why and how it's labeled.
// - The quality-review observation is NOT a hardcoded object literal in this
//   script. It is loaded from fixtures/mp4-smoke-offline-observation.json —
//   a committed, versioned record of a genuine one-time human/Claude visual
//   inspection of one exact render's bytes — and this run's actual rendered
//   sha256 must match that file's recorded sha256 before the observation is
//   trusted at all (see section 3, and matchRenderToRecordedEvidence in
//   qualityReviewer.ts). A render whose bytes do not match the recorded
//   evidence stops here as awaiting-review/not-publishable, rather than
//   reusing scores that were never actually about those bytes. The original
//   inspection found one real defect (an analytics-consent banner
//   overlapping the burned-in captions) and one real labeling gap (the
//   source page's on-screen "Avg FPS" had no "Estimated" qualifier, and it
//   appeared several seconds before any caption qualified it); both were
//   fixed in this repository (capture.ts now suppresses the consent banner;
//   offlineCompositorSmoke.ts's estimated-FPS caption is now the FIRST cue,
//   on screen from t=0) rather than scored around.
// - The Metricool publishing request needs an https:// URL Metricool could
//   fetch. This sandbox has nothing to upload the test render to, and
//   nothing here should actually publish anything, so the "approved master
//   URI" below is a clearly fake, non-resolving https://*.example placeholder
//   — RFC 2606 reserves .example for exactly this. buildMetricoolPublishingRequest
//   makes no network call of its own; it only returns a plain object shaped
//   like a Metricool request, always with draft: true.
// - No performance/engagement/analytics numbers are invented anywhere. The
//   analytics-identity section only proves that the SAME creativeId a real
//   snapshot would be filed under is the one already bound to the media hash,
//   the rights bundle, and the publishing ledger — it never calls
//   recordAnalyticsSnapshot with fabricated view/engagement data.

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import {
  buildQualityReviewRequest,
  reviewRenderedVideo,
  matchRenderToRecordedEvidence,
  parseRecordedRenderEvidence,
  type RenderedVideoObservation,
} from "./qualityReviewer.ts";
import { buildCreativeFingerprint } from "./creativeFingerprint.ts";
import {
  buildProductVisualAssetRegistry,
  evaluatePublicationAssetBundle,
  type ProductVisualAssetRecord,
} from "./productVisualAssets.ts";
import { cleanRestrictedFeatureReview } from "./assetRights.ts";
import { buildMetricoolPublishingRequest, buildTrackedWebsiteUrl, type PublishingConfig } from "./publishing.ts";
import { createStoredPublicationLedger, advanceStoredPublicationLedger } from "./publishingStore.ts";
import type { ContentIdea, VideoPlatform } from "./types.ts";
import {
  runOfflineCompositorSmoke,
  OFFLINE_SMOKE_PLATFORM,
} from "./offlineCompositorSmoke.ts";

const here = dirname(fileURLToPath(import.meta.url));
// This demo/smoke script must never touch content-ideas/publishing-store —
// that is the real, shared, durable publication ledger a production run
// would use, and it holds every other creative's publication history.
// Reusing the same hardcoded idea.id across repeated local runs of this
// script is a demo convenience, not a reason to delete production data, so
// this run gets its own private, ephemeral store instead: a fresh directory
// under content-ideas/.e2e-demo-store, namespaced by timestamp+random so
// back-to-back runs never collide either. The in-run "duplicate publish
// fails closed" demonstration in section 6 still proves the same thing
// against this fresh store, because writeJsonExclusive's `wx` flag fails
// closed on a second write regardless of what else is already in the store.
const publishingStoreRoot = join(
  here,
  "..",
  "..",
  "content-ideas",
  ".e2e-demo-store",
  `run-${generatedAtStamp()}-${randomUUID()}`,
);

function generatedAtStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Committed, versioned record of a genuine one-time human/Claude visual
// inspection of one exact render's bytes (see matchRenderToRecordedEvidence
// in qualityReviewer.ts for why this exists). Regenerate this file — with a
// fresh genuine inspection — whenever offlineCompositorSmoke.ts's render
// actually changes; do not hand-edit its masterSha256 to make a mismatch
// disappear.
const renderEvidencePath = join(here, "fixtures", "mp4-smoke-offline-observation.json");

// The real SpecSmith idea this whole run is about. Copied verbatim from
// mediaRender.test.ts's fixture — a real, already-relied-upon ContentIdea,
// not invented for this script. requiredFacts is deliberately just
// ["comparison state"]: the one fact the actual rendered evidence (the live
// Compare page, captured through a real browser) substantiates.
const idea: ContentIdea = {
  id: "compare-rtx4080s-rtx4080",
  format: "comparison",
  title: "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080",
  hook: "Can you pick the faster card before the names show?",
  angle: "Use Compare as the evidence and reveal.",
  targetAudience: "PC builders",
  requiredFacts: ["comparison state"],
  subjectIds: ["rtx4080s", "rtx4080"],
  productConnection: {
    feature: "compare",
    route: "/compare",
    userProblem: "Buyers cannot tell which near-name GPU is the better choice.",
    whySpecSmith: "SpecSmith Compare holds the rest of the build constant.",
    continuationAction: "Open Compare and change the cards.",
    sitePayoff: "The viewer can continue the exact comparison.",
  },
  creativeDNA: {
    conceptName: "Blind Compare",
    visualWorld: "real SpecSmith comparison",
    narrativeEngine: "blind choice -> evidence -> reveal",
    openingImage: "Two anonymous cards",
    patternInterrupt: "Names hidden",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Reveal the winner",
    audioDirection: "Tight",
    originalityConstraint: "Compare is essential",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9, usefulness: 9, visualPotential: 9, purchaseIntent: 8, novelty: 8,
    originality: 9, retentionPotential: 9, shareability: 8, productFit: 10, siteContinuation: 10, total: 9,
  },
};

const PLATFORM: VideoPlatform = OFFLINE_SMOKE_PLATFORM;

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function fileUriToPath(uri: string): string {
  return fileURLToPath(new URL(uri));
}

async function main(): Promise<void> {
  const generatedAt = new Date();

  section("1. Real idea -> real content package -> real script/storyboard -> real generated production-plan CONTRACT (not rendered through — see header comment)");
  const content = buildContentPackage(idea, generatedAt);
  const storyboard = buildScriptStoryboardPackage(idea, content);
  const production = buildProductionPlanPackage(storyboard);
  const script = storyboard.scripts.find((entry) => entry.platform === PLATFORM);
  if (!script) throw new Error(`No ${PLATFORM} script in the storyboard.`);
  console.log(`Idea: ${idea.id} ("${idea.title}")`);
  console.log(`Content package: ${content.packageId} (campaign ${content.campaignId})`);
  console.log(`Storyboard for ${PLATFORM}: ${script.beats.length} beats, target ${script.targetDurationSeconds}s`);
  console.log(`CTA route: ${content.site.route}`);

  const reviewRequest = buildQualityReviewRequest(content, storyboard, production, PLATFORM);
  console.log(`Quality-review contract built with ${reviewRequest.hardBlockers.length} hard blockers and ${reviewRequest.requiredFacts.length} required fact(s): ${reviewRequest.requiredFacts.join(", ")}`);

  section("2. Real render of a separate, already-proven, hand-authored timeline (NOT the generated storyboard above): deterministic UI capture + offline fixture narration + real captions + real ffmpeg compose");
  const { result } = await runOfflineCompositorSmoke();
  const finalArtifact = result.finalArtifacts[0];
  const mp4Path = fileUriToPath(finalArtifact.uri);
  const masterSha256 = await sha256File(mp4Path);
  const durationSeconds = Number(finalArtifact.metadata?.durationSeconds ?? 0);
  console.log(`Rendered MP4: ${mp4Path}`);
  console.log(`sha256: ${masterSha256}`);
  console.log(`duration: ${durationSeconds}s, ${finalArtifact.metadata?.width}x${finalArtifact.metadata?.height}, video=${finalArtifact.metadata?.videoCodec}, audio=${finalArtifact.metadata?.audioCodec}`);

  section("3. Quality review — bound to a committed record of a genuine one-time inspection of THESE exact bytes");
  // The scores/claims below are NOT a hardcoded object literal trusted
  // blindly. They come from fixtures/mp4-smoke-offline-observation.json — a
  // committed, versioned record of a genuine one-time human/Claude visual
  // inspection of one exact render's bytes (see that file's own notes for
  // what was actually watched). Before that recorded observation may be
  // trusted for THIS run, this run's actual rendered sha256 must match the
  // sha256 the evidence file says was inspected. If this run rendered
  // different bytes than what was ever inspected — which a fresh render of
  // this compositor can genuinely do; the UI-capture sequence step drives
  // real, timing-sensitive browser interactions, so byte-for-byte
  // reproducibility across runs is not guaranteed even though the
  // application STATE at each step is deterministic — this stops here,
  // before the rights/publishing gate, rather than reusing a stale
  // observation for content nobody has actually looked at.
  const rawEvidence = JSON.parse(await readFile(renderEvidencePath, "utf8"));
  const evidence = parseRecordedRenderEvidence(rawEvidence);
  const evidenceMatch = matchRenderToRecordedEvidence(masterSha256, evidence);
  if (!evidenceMatch.matched) {
    console.log(`Evidence check: NO MATCH — ${evidenceMatch.reason}`);
    console.log(`Committed evidence file: ${renderEvidencePath}`);
    console.log("Status: awaiting-review / not publishable. This render has not been inspected — regenerate the evidence file with a genuine fresh inspection before it can pass the quality gate.");
    throw new Error(evidenceMatch.reason);
  }
  console.log(`Evidence check: MATCH — this run's render (sha256 ${masterSha256}) is the exact bytes recorded as inspected by ${evidence.reviewedBy} at ${evidence.reviewedAt}.`);
  const observation: RenderedVideoObservation = {
    ...evidenceMatch.observation,
    packageId: reviewRequest.packageId,
    platform: PLATFORM,
    masterSha256,
    durationSeconds,
    observedCtaRoute: content.site.route,
  };
  const review = reviewRenderedVideo(reviewRequest, observation);
  console.log(`Decision: ${review.decision} (publishable=${review.publishable}, overallScore=${review.overallScore}/10)`);
  console.log(`Issues: ${review.issues.length === 0 ? "none" : review.issues.map((i) => `${i.severity}:${i.code}`).join(", ")}`);
  if (!review.publishable) {
    throw new Error(`Quality review did not pass (decision=${review.decision}); stopping before the rights/publishing gate, as designed.`);
  }

  section("4. Rights-approved asset bundle — the rendered master, registered and evaluated");
  const masterAssetId = `asset-${masterSha256.slice(0, 16)}`;
  const masterRecord: ProductVisualAssetRecord = {
    assetId: masterAssetId,
    role: "specsmith-evidence",
    // Every pixel is either the real SpecSmith Compare UI (Playwright
    // capture) or this pipeline's own overlays (captions, silence bed) — no
    // third-party reference of any kind went into producing it.
    uri: pathToFileURL(mp4Path).toString(),
    mimeType: "video/mp4",
    sha256: masterSha256,
    version: 1,
    createdAt: generatedAt.toISOString(),
    createdBy: "specsmith",
    rights: {
      assetId: masterAssetId,
      assetType: "video",
      intendedUse: "internal-experiment",
      generationMode: "original",
      sourceGrants: [{
        sourceKind: "specsmith-owned",
        commercialUseAllowed: true,
        derivativeUseAllowed: true,
        designUseAuthorized: true,
        trademarkUseAuthorized: true,
        attributionRequired: false,
      }],
      parentAssetIds: [],
      productIdentityMode: "none",
      // Genuinely reviewed: every frame in the exact evidence-matched render
      // above was extracted and visually inspected — see
      // fixtures/mp4-smoke-offline-observation.json's notes for what was
      // actually watched. No third-party logo, wordmark, watermark, artwork,
      // serial/sticker text, retailer mark, copied product photography, or
      // distinctive third-party industrial design appears anywhere in it —
      // it is plain SpecSmith UI chrome and this pipeline's own text
      // overlays. reviewedBy is deliberately NOT "automated" — no automated
      // scorer reviewed this; a human/Claude did, once, off-line, and that
      // review is what fixtures/mp4-smoke-offline-observation.json records.
      restrictedFeatures: cleanRestrictedFeatureReview(),
      reviewedBy: "claude-code-manual-review",
      notes: [
        "Rendered by scripts/content-automator/offlineCompositorSmoke.ts using local fixtures (no paid provider).",
        `Frames visually inspected by ${evidence.reviewedBy} at ${evidence.reviewedAt}; see fixtures/mp4-smoke-offline-observation.json for the full record.`,
      ],
    },
  };
  const registry = buildProductVisualAssetRegistry([masterRecord]);
  const assetBundle = evaluatePublicationAssetBundle(registry, {
    usedAssetIds: [],
    expectedVisualAssetIds: [],
    masterAssetId,
  });
  console.log(`Asset bundle publishable: ${assetBundle.publishable}`);
  console.log(`Approved master sha256: ${assetBundle.approvedMasterSha256}`);
  if (!assetBundle.publishable || assetBundle.approvedMasterSha256 !== masterSha256) {
    throw new Error("Rights bundle did not approve the rendered master; stopping before publishing, as designed.");
  }

  section("5. Tracked, draft-only Metricool-ready publishing request (no network call, never auto-publishes)");
  // Metricool needs an https:// URL it could fetch. Nothing in this sandbox
  // is uploaded anywhere reachable, and nothing here should ever cause a
  // real publish — so this is a clearly fake, non-resolving *.example URL
  // (RFC 2606) standing in for "wherever the approved master would actually
  // be hosted." buildMetricoolPublishingRequest itself makes no network
  // call; it only returns a plain, draft:true request object.
  const placeholderHostedMasterUrl = `https://cdn.specsmithpc.example/render-output/${masterSha256}.mp4`;
  const registryWithPlaceholderUri = buildProductVisualAssetRegistry([{ ...masterRecord, uri: placeholderHostedMasterUrl }]);
  const assetBundleForPublishing = evaluatePublicationAssetBundle(registryWithPlaceholderUri, {
    usedAssetIds: [],
    expectedVisualAssetIds: [],
    masterAssetId,
  });

  const fingerprint = buildCreativeFingerprint(
    { rank: 1, idea, qualityScore: review.overallScore, learningAdjustment: 0, experiment: { hypothesis: "Real UI evidence out-converts generic B-roll for near-name GPU comparisons.", primaryMetric: "site-clicks", holdConstant: ["cpu", "resolution-ladder"] } },
    content,
    script,
    { voiceName: "local-espeak-tts-fixture (offline, not production voice)", firstVisualType: "deterministic-ui", uiProofRatio: 1, generatedVisualRatio: 0, exactProductAssetRatio: 1 },
  );
  console.log(`Creative id: ${fingerprint.creativeId}`);

  const publishingConfig: PublishingConfig = {
    blogId: "specsmithpc-main",
    timezone: "America/New_York",
    siteBaseUrl: "https://specsmithpc.com",
    connectedNetworks: ["youtube", "tiktok", "instagram"],
    // autoPublish intentionally omitted -> draft stays true. See step 5's
    // header: nothing here is allowed to auto-publish.
  };
  const publishAt = new Date(generatedAt.getTime() + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "");
  const publishingRequest = buildMetricoolPublishingRequest(
    idea,
    content,
    fingerprint,
    { qualityReview: review, assetBundle: assetBundleForPublishing },
    publishingConfig,
    publishAt,
    generatedAt,
  );
  console.log(`Metricool request id: ${publishingRequest.requestId} (draft=${publishingRequest.draft})`);
  console.log(`finalMediaSha256: ${publishingRequest.finalMediaSha256}`);
  console.log(`Tracked website URL (utm_content=creativeId): ${publishingRequest.trackedWebsiteUrl}`);
  if (publishingRequest.draft !== true) throw new Error("Publishing request must always be draft:true here.");
  if (publishingRequest.finalMediaSha256 !== masterSha256) throw new Error("Publishing request media hash does not match the rendered master.");

  section("6. Durable publication ledger — and a live demonstration that a second publish fails closed");
  console.log(`Ephemeral demo store (never the production publishing-store): ${publishingStoreRoot}`);
  const ledger = await createStoredPublicationLedger(publishingStoreRoot, fingerprint, generatedAt);
  console.log(`Ledger created for ${ledger.creativeId}, state: ${ledger.events.at(-1)?.status}`);
  const advanced = await advanceStoredPublicationLedger(publishingStoreRoot, fingerprint.creativeId, {
    status: "qc-passed",
    note: `Passed automated review at ${review.overallScore}/10.`,
  });
  console.log(`Ledger advanced to: ${advanced.events.at(-1)?.status}`);
  // Deliberately stops here. "scheduled" is a real production status other
  // code treats as meaning Metricool actually accepted a schedule slot for
  // this creative — and nothing in this pipeline ever calls Metricool (see
  // step 5's header): the "approved master URI" fed into the publishing
  // request above is a non-resolving *.example placeholder, not a real
  // hosted file Metricool (or anyone) could fetch. Advancing to "scheduled"
  // without a real Metricool API call accepting a slot would be a false
  // status on a real production ledger field. A genuinely "scheduled" state
  // requires an actual Metricool API call, which is out of scope for this
  // offline demo, so the ledger for this run stays at qc-passed — a state
  // that genuinely happened, once the quality gate is honestly evidenced
  // (see section 3).

  let duplicateBlocked = false;
  try {
    await createStoredPublicationLedger(publishingStoreRoot, fingerprint, generatedAt);
  } catch (error) {
    duplicateBlocked = true;
    console.log(`Duplicate publish attempt correctly failed closed: ${(error as Error).message}`);
  }
  if (!duplicateBlocked) throw new Error("A second createStoredPublicationLedger call for the same creative should have failed closed but did not.");

  section("7. Analytics identity — same creativeId, no fabricated metrics");
  // No recordAnalyticsSnapshot call here: nothing was published, so there is
  // no real snapshot to record, and issue #82 explicitly forbids inventing
  // engagement/analytics data. This only proves the KEY a real snapshot would
  // use is already the same key everything else above is bound to.
  const analyticsContext = {
    creativeId: fingerprint.creativeId,
    ideaId: idea.id,
    platform: PLATFORM,
    durationSeconds,
    fingerprintCampaignId: fingerprint.campaignId,
  };
  const identityChain = {
    finalMediaSha256: masterSha256,
    assetBundleApprovedMasterSha256: assetBundleForPublishing.approvedMasterSha256,
    qualityReviewReviewedMediaSha256: review.reviewedMediaSha256,
    publishingRequestFinalMediaSha256: publishingRequest.finalMediaSha256,
    creativeId: fingerprint.creativeId,
    publishingRequestCreativeId: publishingRequest.creativeId,
    ledgerCreativeId: ledger.creativeId,
    analyticsContextCreativeId: analyticsContext.creativeId,
    utmContentInTrackedUrl: new URL(publishingRequest.trackedWebsiteUrl).searchParams.get("utm_content"),
  };
  const allHashesMatch = new Set([
    identityChain.finalMediaSha256,
    identityChain.assetBundleApprovedMasterSha256,
    identityChain.qualityReviewReviewedMediaSha256,
    identityChain.publishingRequestFinalMediaSha256,
  ]).size === 1;
  const allCreativeIdsMatch = new Set([
    identityChain.creativeId,
    identityChain.publishingRequestCreativeId,
    identityChain.ledgerCreativeId,
    identityChain.analyticsContextCreativeId,
    identityChain.utmContentInTrackedUrl,
  ]).size === 1;
  console.log(JSON.stringify(identityChain, null, 2));
  console.log(`All media-hash identities match: ${allHashesMatch}`);
  console.log(`All creative-id identities match (including tracked-URL utm_content): ${allCreativeIdsMatch}`);
  if (!allHashesMatch || !allCreativeIdsMatch) {
    throw new Error("Identity chain is broken — final media, rights bundle, publishing request, ledger, and analytics context do not all refer to the same artifact.");
  }

  section("Done");
  console.log("Real idea -> real generated storyboard/production-plan contract -> real (separately-authored) render -> rights-approved bundle -> passing evidence-bound quality review -> tracked draft Metricool request -> durable ledger stopped at qc-passed -> analytics-identity proof, all bound to the same sha256/creativeId. Nothing was published or scheduled. Wiring the generated storyboard through to a real render is separate future work — see the header comment.");
}

main().catch((error) => {
  console.error("\nEND-TO-END OFFLINE PIPELINE FAILED:");
  console.error(error);
  process.exitCode = 1;
});
