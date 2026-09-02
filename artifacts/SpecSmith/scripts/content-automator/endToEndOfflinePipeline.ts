// One command: SpecSmith idea -> real script/storyboard -> real production
// plan contract -> real rendered 9:16 MP4 (real deterministic UI capture,
// offline fixture narration, real burned-in captions, real ffmpeg compose)
// -> rights-approved asset bundle -> quality-review gate -> tracked,
// draft-only Metricool-ready publishing request -> durable, fail-closed
// publication ledger -> analytics-identity wiring proof.
//
// WHAT THIS DOES AND DOES NOT DO (read this before trusting its output)
// -----------------------------------------------------------------------
// - It renders one real, non-placeholder MP4 via offlineCompositorSmoke.ts.
//   That render's narration comes from the local espeak-ng fixture, not paid
//   ElevenLabs — see localFixtureAdapters.ts for why and how it's labeled.
// - It builds the REAL content package / script-storyboard for the real
//   "compare-rtx4080s-rtx4080" idea using this repo's real, tested
//   buildContentPackage / buildScriptStoryboardPackage / buildProductionPlanPackage
//   functions — the production-plan package is used only to build a real
//   QualityReviewRequest CONTRACT (expected route, hard blockers, required
//   facts); it is not rendered through. The actual rendered MP4 comes from
//   offlineCompositorSmoke.ts's shorter, hand-authored 3-visual/8-second
//   timeline (the same one compositorSmoke.ts already proves against paid
//   ElevenLabs), not the full 6-beat automatic storyboard. That is a
//   deliberate scope reduction to avoid needing offline fixtures for every
//   production capability (video-generation, music-sfx, etc.) just to prove
//   the pipeline once end-to-end; see the PR description for what a fuller
//   run would still need.
// - The quality-review "observation" below is Claude's own recorded
//   inspection of the actual rendered frames and audio for this specific
//   run (see the PR body's Visual verification section) — not invented
//   scores. It found one real defect (an analytics-consent banner
//   overlapping the burned-in captions) and one real labeling gap (the
//   source page's on-screen "Avg FPS" has no "Estimated" qualifier); both
//   were fixed in this same change (capture.ts now suppresses the consent
//   banner; the caption track now says "ESTIMATED FPS...") rather than
//   scored around.
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

import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { buildQualityReviewRequest, reviewRenderedVideo, type RenderedVideoObservation } from "./qualityReviewer.ts";
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
const publishingStoreRoot = join(here, "..", "..", "content-ideas", "publishing-store");

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

  section("1. Real idea -> real content package -> real script/storyboard -> real production plan contract");
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

  section("2. Real render: deterministic UI capture + offline fixture narration + real captions + real ffmpeg compose");
  const { result } = await runOfflineCompositorSmoke();
  const finalArtifact = result.finalArtifacts[0];
  const mp4Path = fileUriToPath(finalArtifact.uri);
  const masterSha256 = await sha256File(mp4Path);
  const durationSeconds = Number(finalArtifact.metadata?.durationSeconds ?? 0);
  console.log(`Rendered MP4: ${mp4Path}`);
  console.log(`sha256: ${masterSha256}`);
  console.log(`duration: ${durationSeconds}s, ${finalArtifact.metadata?.width}x${finalArtifact.metadata?.height}, video=${finalArtifact.metadata?.videoCodec}, audio=${finalArtifact.metadata?.audioCodec}`);

  section("3. Quality review — Claude's own recorded inspection of this render's actual frames/audio");
  // These values are this session's real observation of the frames extracted
  // from THIS run's MP4 (see the PR body for the extracted PNGs) — not
  // template defaults. Where something was imperfect, it is scored honestly
  // rather than rounded up:
  //  - openingDecisionClearWithoutAudio: true. The first frame is the live,
  //    real Compare page already showing both full cards (names, prices, Avg
  //    FPS, the 20-0 "Build A Wins" tally) — understandable with sound off.
  //  - captionsLegibilityScore: 9, captionSafeAreaRatio: 0.97. All three cues
  //    render as large, high-contrast white-on-dark text with a solid
  //    outline/shadow, fully inside the frame. The third cue's second line
  //    ("...SEE THE FULL RESULT.") runs close to the right edge at this font
  //    size — legible in this run, but close enough to the edge that a
  //    longer cue at the same size could clip; not a defect in this specific
  //    render, so not scored as one, but worth a caption-layout follow-up.
  //  - audioClarityScore: 8. espeak-ng narration is clearly intelligible
  //    (every word distinguishable) but audibly synthetic/robotic — clarity,
  //    not naturalness, is what this dimension measures, and a real
  //    ElevenLabs render (once approved) would sound materially better.
  //  - visualCoherenceScore: 10, specSmithRelevanceScore: 10,
  //    genericAiBrollRatio: 0. Every visible pixel across all three shots is
  //    the real, live Compare page — no generated B-roll exists in this
  //    render at all.
  //  - claims: the on-screen "Avg FPS" numbers are SpecSmith's own
  //    estimateFpsForBuild() estimate (verified by reading Compare.tsx), and
  //    the live page carries no on-screen "Estimated" qualifier — so this
  //    render's own caption track was given one ("ESTIMATED FPS...", cue 3),
  //    which is why the claim below verifies as labeled.
  const observation: RenderedVideoObservation = {
    packageId: reviewRequest.packageId,
    platform: PLATFORM,
    masterSha256,
    durationSeconds,
    openingDecisionClearWithoutAudio: true,
    captionsLegibilityScore: 9,
    captionSafeAreaRatio: 0.97,
    audioClarityScore: 8,
    visualCoherenceScore: 10,
    pacingScore: 9,
    specSmithRelevanceScore: 10,
    genericAiBrollRatio: 0,
    observedCtaRoute: content.site.route,
    claims: [
      {
        text: "RTX 4080 Super and RTX 4080 Avg FPS values shown are SpecSmith's estimated FPS, not measured benchmark FPS.",
        kind: "estimated-fps",
        verification: "verified",
        evidenceRefs: ["live-compare-page-capture:estimateFpsForBuild"],
        displayLabel: "Estimated FPS",
      },
      {
        text: "The real Compare page state (both cards, prices, Avg FPS, per-game bars) is shown live.",
        kind: "other",
        verification: "verified",
        evidenceRefs: ["deterministic-ui-render:compare"],
      },
    ],
    uiShots: [
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "mp4-smoke-offline-visual-1" },
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "mp4-smoke-offline-visual-2" },
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "mp4-smoke-offline-visual-3" },
    ],
    missingRequiredFacts: [],
    failedTaskIds: [],
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
      // Genuinely reviewed: every frame in this render was extracted and
      // visually inspected this session (see the PR body). No third-party
      // logo, wordmark, watermark, artwork, serial/sticker text, retailer
      // mark, copied product photography, or distinctive third-party
      // industrial design appears anywhere in it — it is plain SpecSmith UI
      // chrome and this pipeline's own text overlays.
      restrictedFeatures: cleanRestrictedFeatureReview(),
      reviewedBy: "automated",
      notes: [
        "Rendered by scripts/content-automator/offlineCompositorSmoke.ts using local fixtures (no paid provider).",
        "Frames visually inspected by Claude Code this session; see PR body for the extracted PNGs and findings.",
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
  await rm(publishingStoreRoot, { recursive: true, force: true });
  const ledger = await createStoredPublicationLedger(publishingStoreRoot, fingerprint, generatedAt);
  console.log(`Ledger created for ${ledger.creativeId}, state: ${ledger.events.at(-1)?.status}`);
  const advanced = await advanceStoredPublicationLedger(publishingStoreRoot, fingerprint.creativeId, {
    status: "qc-passed",
    note: `Passed automated review at ${review.overallScore}/10.`,
  });
  console.log(`Ledger advanced to: ${advanced.events.at(-1)?.status}`);
  // Deliberately stops at qc-passed/scheduled — never "published", because
  // nothing here actually publishes anything (see step 5's header).
  const scheduled = await advanceStoredPublicationLedger(publishingStoreRoot, fingerprint.creativeId, {
    status: "scheduled",
    note: "Would-be Metricool schedule slot (draft request only; never sent).",
  });
  console.log(`Ledger advanced to: ${scheduled.events.at(-1)?.status}`);

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
  console.log("One real MP4 -> rights-approved bundle -> passing quality review -> tracked draft Metricool request -> durable ledger -> analytics-identity proof, all bound to the same sha256/creativeId. Nothing was published.");
}

main().catch((error) => {
  console.error("\nEND-TO-END OFFLINE PIPELINE FAILED:");
  console.error(error);
  process.exitCode = 1;
});
