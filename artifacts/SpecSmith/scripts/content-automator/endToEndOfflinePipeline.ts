// One command, proving one honest chain of custody, end to end:
//
// real SpecSmith idea -> real generated six-beat storyboard/production-plan
// -> that EXACT generated plan rendered (real deterministic UI capture for
// 5 of the 6 beats, a labeled offline fixture card for the hook beat, offline
// fixture narration and silence, real burned-in captions, real ffmpeg
// compose) -> rights gate -> quality gate -> tracked, draft-only
// Metricool-ready publishing request -> durable, fail-closed publication
// ledger -> analytics-identity wiring proof.
//
// WHAT THIS DOES AND DOES NOT DO (read this before trusting its output)
// -----------------------------------------------------------------------
// - This proves the automatic idea->storyboard->MP4 handoff issue #89 asked
//   for. It builds the REAL content package / script-storyboard / six-beat
//   production plan for the real "compare-rtx4080s-rtx4080" idea using this
//   repo's real, tested buildContentPackage / buildScriptStoryboardPackage /
//   buildProductionPlanPackage functions, and section 2 below renders that
//   SAME production-plan package object — the one section 1 also used to
//   build the QualityReviewRequest contract — through
//   offlineGeneratedPlanRender.ts. There is no separate, parallel,
//   hand-authored timeline standing in for it: every beat the plan generated
//   is rendered, in the exact order and identity the plan generated it (see
//   generatedPlanRenderWiring.test.ts for the automated check that a
//   hand-authored substitute cannot silently return). An earlier attempt at
//   this wiring was deliberately reverted for being unexercised by any real
//   render before offline fixtures existed for the video-generation and
//   music-sfx beats the plan also needs — offlineGeneratedPlanRender.ts adds
//   those two fixtures (localFixtureVideo.ts, localFixtureMusic.ts) and is
//   the exercised, tested version of that same idea.
// - It renders one real, non-placeholder MP4 via
//   offlineGeneratedPlanRender.ts. Narration comes from the local espeak-ng
//   fixture, not paid ElevenLabs (localFixtureTts.ts); the hook beat's
//   visual is a plainly labeled offline fixture card, not a paid Veo
//   generation (localFixtureVideo.ts); the always-present music-sfx beat is
//   digital silence, not licensed music (localFixtureMusic.ts). All three
//   are labeled `isFixture: true` / `isPaidProvider: false` in their
//   artifact metadata.
// - The quality-review observation is NOT a hardcoded object literal in this
//   script. It is loaded from
//   fixtures/generated-plan-offline-observation.json — a committed,
//   versioned record of a genuine one-time human/Claude visual inspection of
//   one exact render's bytes — and this run's actual rendered sha256 must
//   match that file's recorded sha256 before the observation is trusted at
//   all (see section 3, and matchRenderToRecordedEvidence in
//   qualityReviewer.ts). A render whose bytes do not match the recorded
//   evidence stops here as awaiting-review/not-publishable, rather than
//   reusing scores that were never actually about those bytes. That
//   inspection also found and recorded a genuine limitation, not scored
//   around: 5 of the 6 beats show the same static Compare-page capture (the
//   generated plan derives one UI state per beat and productionPlan.ts's
//   deriveUiRenderState always requests a static, not sequence, capture for
//   this feature/idea), so the visuals are repetitive rather than varied —
//   see that file's notes for the full record.
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
// - The quality gate also fails closed on audio: a passing verdict requires
//   the recorded observation's audioReviewMethod to be "listened-full", not
//   just a healthy ffmpeg silence/volume-level reading. The committed
//   evidence file honestly records "signal-analysis-only" — no environment
//   this script has ever run in can actually listen — so THIS RUN IS
//   EXPECTED TO STOP at section 3 with decision=hold-for-human-review,
//   before reaching the rights bundle, publishing request, or ledger. Those
//   later sections' own logic is real and exercised (see
//   qualityReviewer.test.ts and publishing.test.ts), but this script will
//   only walk them for real once a human genuinely listens to this exact
//   sha256-bound master and updates the evidence file accordingly.

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildQualityReviewRequest, reviewRenderedVideo, matchRenderToRecordedEvidence, parseRecordedRenderEvidence, type RenderedVideoObservation } from "./qualityReviewer.ts";
import { buildCreativeFingerprint } from "./creativeFingerprint.ts";
import { GENERATED_PLAN_CREATIVE_RUNTIME_METADATA } from "./generatedPlanCreativeRuntime.ts";
import {
  buildProductVisualAssetRegistry,
  evaluatePublicationAssetBundle,
  type ProductVisualAssetRecord,
} from "./productVisualAssets.ts";
import { cleanRestrictedFeatureReview } from "./assetRights.ts";
import { buildMetricoolPublishingRequest, buildTrackedWebsiteUrl, type PublishingConfig } from "./publishing.ts";
import { createStoredPublicationLedger, advanceStoredPublicationLedger } from "./publishingStore.ts";
import type { VideoPlatform } from "./types.ts";
import {
  buildGeneratedPlanPackages,
  renderGeneratedProductionPlan,
  GENERATED_PLAN_IDEA,
  GENERATED_PLAN_PLATFORM,
} from "./offlineGeneratedPlanRender.ts";

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
// fresh genuine inspection — whenever offlineGeneratedPlanRender.ts's render
// actually changes; do not hand-edit its masterSha256 to make a mismatch
// disappear.
const renderEvidencePath = join(here, "fixtures", "generated-plan-offline-observation.json");

// The real SpecSmith idea this whole run is about — the shared fixture idea
// reused across this pipeline (see fixtures/compareRtx4080sRtx4080Idea.ts).
const idea = GENERATED_PLAN_IDEA;

const PLATFORM: VideoPlatform = GENERATED_PLAN_PLATFORM;

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

  section("1. Real idea -> real content package -> real script/storyboard -> real generated six-beat production plan");
  const { content, storyboard, production } = buildGeneratedPlanPackages(generatedAt);
  const script = storyboard.scripts.find((entry) => entry.platform === PLATFORM);
  if (!script) throw new Error(`No ${PLATFORM} script in the storyboard.`);
  console.log(`Idea: ${idea.id} ("${idea.title}")`);
  console.log(`Content package: ${content.packageId} (campaign ${content.campaignId})`);
  console.log(`Storyboard for ${PLATFORM}: ${script.beats.length} beats, target ${script.targetDurationSeconds}s`);
  console.log(`CTA route: ${content.site.route}`);

  const reviewRequest = buildQualityReviewRequest(content, storyboard, production, PLATFORM);
  console.log(`Quality-review contract built with ${reviewRequest.hardBlockers.length} hard blockers and ${reviewRequest.requiredFacts.length} required fact(s): ${reviewRequest.requiredFacts.join(", ")}`);

  section("2. Real render of the EXACT generated plan from step 1 — no hand-authored substitute timeline: deterministic UI capture (5 beats) + offline fixture video card (hook beat) + offline fixture narration + offline silence + real captions + real ffmpeg compose");
  const { result } = await renderGeneratedProductionPlan(production, PLATFORM);
  const finalArtifact = result.finalArtifacts[0];
  const mp4Path = fileUriToPath(finalArtifact.uri);
  const masterSha256 = await sha256File(mp4Path);
  const durationSeconds = Number(finalArtifact.metadata?.durationSeconds ?? 0);
  console.log(`Rendered MP4: ${mp4Path}`);
  console.log(`sha256: ${masterSha256}`);
  console.log(`duration: ${durationSeconds}s, ${finalArtifact.metadata?.width}x${finalArtifact.metadata?.height}, video=${finalArtifact.metadata?.videoCodec}, audio=${finalArtifact.metadata?.audioCodec}`);

  section("3. Quality review — bound to a committed record of a genuine one-time inspection of THESE exact bytes");
  // The scores/claims below are NOT a hardcoded object literal trusted
  // blindly. They come from fixtures/generated-plan-offline-observation.json
  // — a committed, versioned record of a genuine one-time human/Claude
  // visual inspection of one exact render's bytes (see that file's own
  // notes for what was actually watched). Before that recorded observation
  // may be trusted for THIS run, this run's actual rendered sha256 must
  // match the sha256 the evidence file says was inspected. If this run
  // rendered different bytes than what was ever inspected — every UI beat
  // here is a static capture (no interactive sequence step), but ffmpeg's
  // own encode/mux is not guaranteed byte-identical run to run even for
  // identical inputs (container timestamps, encoder scheduling) — this
  // stops here, before the rights/publishing gate, rather than reusing a
  // stale observation for content nobody has actually looked at.
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
  // As of this fix, the quality gate also fails closed on audio: a passing
  // verdict requires observation.audioReviewMethod === "listened-full" — see
  // qualityReviewer.ts's audio-not-genuinely-reviewed check. The committed
  // fixtures/generated-plan-offline-observation.json honestly records
  // "signal-analysis-only" (ffmpeg silence/volume stats, not a real listen —
  // no environment running this script has listening capability today), so
  // this run is expected to stop here with decision=hold-for-human-review
  // until someone genuinely listens to this exact sha256-bound master and
  // updates that fixture. That is this gate working as designed, the same
  // way an evidence-sha256 mismatch stops the run above — not a regression.
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
    // capture, 5 of 6 beats), this pipeline's own plain text-only offline
    // fixture card (the hook beat), or this pipeline's own overlays
    // (captions, silence bed) — no third-party reference of any kind went
    // into producing it.
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
      // fixtures/generated-plan-offline-observation.json's notes for what
      // was actually watched. No third-party logo, wordmark, watermark,
      // artwork, serial/sticker text, retailer mark, copied product
      // photography, or distinctive third-party industrial design appears
      // anywhere in it — every beat is either plain SpecSmith UI chrome, this
      // pipeline's own text-only offline fixture card (the hook beat), or
      // this pipeline's own caption overlays. reviewedBy is deliberately NOT
      // "automated" — no automated scorer reviewed this; a human/Claude did,
      // once, off-line, and that review is what
      // fixtures/generated-plan-offline-observation.json records.
      restrictedFeatures: cleanRestrictedFeatureReview(),
      reviewedBy: "claude-code-manual-review",
      notes: [
        "Rendered by scripts/content-automator/offlineGeneratedPlanRender.ts from the actual generated six-beat production plan, using local fixtures (no paid provider).",
        `Frames visually inspected by ${evidence.reviewedBy} at ${evidence.reviewedAt}; see fixtures/generated-plan-offline-observation.json for the full record.`,
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
    // 5 of the video's 6 beats are the real deterministic Compare-page
    // capture; the hook beat is this pipeline's own offline fixture card,
    // not a real product capture or a paid generated visual — "mixed" is
    // the honest classification for the finished video. See
    // generatedPlanCreativeRuntime.ts for why generatedVisualRatio and
    // exactProductAssetRatio are 0, not fractions that merely look
    // plausible — that was a fabricated asset-mix classification
    // independent review flagged, and it is unit tested directly there.
    GENERATED_PLAN_CREATIVE_RUNTIME_METADATA,
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
    // Not "automated review": no automated scorer produced the
    // scores/claims behind this decision. They come from a committed,
    // evidence-bound record of a genuine one-time human/Claude inspection
    // (see step 3's comment and fixtures/generated-plan-offline-observation.json),
    // matched to these exact bytes by sha256. The ledger note must say that,
    // not invent an "automated" provenance the run never had.
    note: `Passed evidence-bound quality review (manual/Claude inspection by ${evidence.reviewedBy} at ${evidence.reviewedAt}, matched to sha256 ${masterSha256}) at ${review.overallScore}/10.`,
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
  console.log("Real idea -> real generated six-beat storyboard/production plan -> that EXACT plan rendered (no hand-authored substitute) -> rights-approved bundle -> passing evidence-bound quality review -> tracked draft Metricool request -> durable ledger stopped at qc-passed -> analytics-identity proof, all bound to the same sha256/creativeId. Nothing was published or scheduled.");
}

main().catch((error) => {
  console.error("\nEND-TO-END OFFLINE PIPELINE FAILED:");
  console.error(error);
  process.exitCode = 1;
});
