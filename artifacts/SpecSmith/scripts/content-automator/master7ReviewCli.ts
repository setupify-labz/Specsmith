// Review the real MASTER #6 render with MASTER #7, and a defective derivative of it.
//
//   pnpm content:creative:render        # renders the concept and writes render-manifest.json
//   pnpm content:review [renderDir]     # reviews it; writes two packets next to it
//
// The clean packet reviews the render as produced. The defective packet is a
// clearly labelled derivative: the same render with its disclosure blanked
// after two seconds, and a title and description that call a tie-inflated
// tally a measured result. Both are written as JSON for tools and as text for
// an editor. Neither is an approval; nothing is published, scheduled or sent.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "./creativeFileWorkflowCli.ts";
import { DISCLOSURE_BANDED_LAYOUT } from "./bandedLayout.ts";
import { DEMO_PAIRING } from "./leadsVsAverage/facts.ts";
import { evaluateAuthoredBatch } from "./v2/creative/fileWorkflowPass.ts";
import { buildCreativeProposalProductionPlan } from "./v2/creative/proposalPass.ts";
import { REQUIRED_USE, type AssetRightsRecord, type RenderManifest, type ReviewSubmission } from "./v2/review/inputs.ts";
import { YOUTUBE_SHORTS_1080X1920_30 } from "./v2/review/platformVariants.ts";
import { buildRenderManifest, writeRenderManifest } from "./v2/review/renderManifest.ts";
import { formatReviewPacket, reviewCreative } from "./v2/review/reviewCreative.ts";
import type { ReviewPacket } from "./v2/review/types.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const ffmpegPath = process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.SPECSMITH_FFPROBE_PATH ?? "ffprobe";
const CONCEPT_ID = "claude-batch-three-checks";

/** The submission for the #6 concept, rebuilt from the workflow rather than read from the render's report. */
async function submissionFor(renderDir: string): Promise<ReviewSubmission> {
  const evaluation = await evaluateAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, DEMO_MISSION);
  const proposal = evaluation.pass.result.proposals.find((entry) => entry.concept.conceptId === CONCEPT_ID);
  if (!proposal) throw new Error(`${CONCEPT_ID} is not in attempt ${evaluation.attempts}.`);
  const plan = buildCreativeProposalProductionPlan({
    packageId: `master6-${CONCEPT_ID}`, ideaId: CONCEPT_ID, campaignId: DEMO_MISSION.missionId,
    feature: "compare", route: DEMO_MISSION.productDestination, subjectIds: [],
  }, proposal).platforms[0];
  const overlay = plan.tasks.find((task) => task.capability === "disclosure-overlay") as { disclosureOverlayState?: { lines: string[] } } | undefined;
  const manifest = JSON.parse(readFileSync(join(renderDir, "render-manifest.json"), "utf8")) as RenderManifest;
  const storyboard = proposal.storyboard;
  const rangeBeat = storyboard.beats.findIndex((beat) => beat.factDependencies.includes("SYNTHETIC_ENGINEERING_FIXTURE-estimate-range-limit"));
  const repo = (assetId: string, kind: AssetRightsRecord["kind"], source: string, generator: string, placeholderWhy: string | null): AssetRightsRecord => ({
    assetId, kind, source,
    license: { kind: "repo-owned", evidence: "Rendered by this repository from its own app and data.", permittedUse: [REQUIRED_USE], attribution: null, expiresAt: null, scope: "SpecSmith" },
    generation: { generator, inputs: `storyboard and production plan of ${CONCEPT_ID}` },
    transformations: ["scaled into the banded layout by the ffmpeg compositor"],
    placeholder: { isPlaceholder: placeholderWhy !== null, why: placeholderWhy },
  });
  const rights: AssetRightsRecord[] = manifest.assets.map((asset) => {
    switch (asset.role) {
      case "capture": return repo(asset.assetId, "specsmith-ui-capture", `SpecSmith Compare, ${String(asset.metadata.route)}`, "deterministic-ui-render (Playwright Chromium against the locally served build)", null);
      case "disclosure-panel": return repo(asset.assetId, "disclosure-panel", "disclosureOverlay.ts, browser-measured", "disclosure-overlay (Chromium)", null);
      case "captions": return repo(asset.assetId, "caption-render", "captionRender.buildAssDocument", "caption-render (ASS)", null);
      case "narration": return repo(asset.assetId, "narration", "espeak-ng, offline", "local-espeak-tts-fixture", "espeak-ng fixture voice; no production voice has been approved");
      default: throw new Error(`No rights record is written for ${asset.role} ${asset.assetId}; add one rather than letting it pass unrecorded.`);
    }
  });
  return {
    creativeId: `${DEMO_MISSION.missionId}/${CONCEPT_ID}`,
    variant: YOUTUBE_SHORTS_1080X1920_30,
    research: { contract: DEMO_MISSION.research, declaredKind: "synthetic-fixture", evidenceSnapshotIds: ["SYNTHETIC_ENGINEERING_FIXTURE-snapshot"] },
    concept: { conceptId: CONCEPT_ID, body: proposal.concept },
    storyboard,
    title: storyboard.title,
    description: "Three checks to run on any SpecSmith comparison. FPS values are SpecSmith model estimates. Try it at /compare.",
    approvedDestination: DEMO_MISSION.productDestination,
    disclosureLines: overlay?.disclosureOverlayState?.lines ?? [],
    productionPlan: plan,
    claims: rangeBeat < 0 ? [] : [{
      claimId: "range-limit", beatIndex: rangeBeat, where: "narration",
      text: "every per-game gap on this page is smaller than the range the model declares for its own estimates",
      basis: "research-claim", statement: { kind: "research", researchClaimId: "SYNTHETIC_ENGINEERING_FIXTURE-estimate-range-limit" },
    }],
    graphics: [],
    renderManifestPath: join(renderDir, "render-manifest.json"),
    rights,
  };
}

/** The defective derivative: the disclosure gone after two seconds, and a misleading title and description. */
function defectiveFrom(renderDir: string, clean: ReviewSubmission): ReviewSubmission {
  const manifest = JSON.parse(readFileSync(clean.renderManifestPath, "utf8")) as RenderManifest;
  const out = join(renderDir, "review", "DEFECTIVE-disclosure-blanked.mp4");
  const result = spawnSync(ffmpegPath, ["-v", "error", "-y", "-i", manifest.output.path,
    "-vf", `drawbox=x=0:y=0:w=iw:h=${DISCLOSURE_BANDED_LAYOUT.disclosure.height}:color=black:t=fill:enable='gte(t,2)'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", out]);
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString() ?? result.error?.message}`);
  const manifestPath = join(renderDir, "review", "DEFECTIVE-render-manifest.json");
  const byId = (id: string | null) => manifest.assets.find((asset) => asset.assetId === id)!;
  const file = (id: string | null) => ({ assetId: byId(id).assetId, path: byId(id).path, metadata: byId(id).metadata });
  writeRenderManifest(manifestPath, buildRenderManifest({
    variantId: manifest.variantId, outputPath: out, encode: manifest.output.encode, storyboard: clean.storyboard,
    productionPlan: clean.productionPlan, layout: manifest.layout,
    disclosurePanel: file(manifest.disclosurePanelAssetId), captions: file(manifest.captionsAssetId), narration: file(manifest.narrationAssetId),
    narrationSegments: manifest.narrationSegments,
    beats: manifest.beats.map((beat) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, captures: beat.captureAssetIds.map((id) => file(id)) })),
  }));
  const title = "RTX 5060 Ti build wins 13 games to 7: measured";
  return {
    ...clean,
    creativeId: `${clean.creativeId}/DEFECTIVE-derivative`,
    title,
    description: "Measured: the RTX 5060 Ti build is exactly 2 FPS slower on average. See /compare-deals.",
    claims: [...clean.claims,
      { claimId: "title-tally", beatIndex: 0, where: "title", text: "wins 13 games to 7", basis: "measured-benchmark",
        statement: { kind: "tally", pairing: DEMO_PAIRING, leadsA: 13, leadsB: 7, ties: null } },
      { claimId: "description-gap", beatIndex: 0, where: "description", text: "exactly 2 FPS slower on average", basis: "model-estimate",
        statement: { kind: "average-difference", pairing: DEMO_PAIRING, leader: "B", difference: 2 } },
    ],
    renderManifestPath: manifestPath,
  };
}

export async function runMaster7Review(renderDir: string): Promise<{ clean: ReviewPacket; defective: ReviewPacket; outDir: string }> {
  const outDir = join(renderDir, "review");
  mkdirSync(outDir, { recursive: true });
  const cleanSubmission = await submissionFor(renderDir);
  const options = { ffmpegPath, ffprobePath };
  const clean = await reviewCreative(cleanSubmission, options);
  const defective = await reviewCreative(defectiveFrom(renderDir, cleanSubmission), options);
  for (const [name, packet] of [["clean", clean], ["defective", defective]] as const) {
    writeFileSync(join(outDir, `review-packet.${name}.json`), `${JSON.stringify(packet, null, 2)}\n`);
    writeFileSync(join(outDir, `review-packet.${name}.txt`), `${formatReviewPacket(packet)}\n`);
  }
  return { clean, defective, outDir };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const renderDir = resolve(process.argv[2] ?? join(here, "..", "..", "render-output", `master6-${CONCEPT_ID}`));
  runMaster7Review(renderDir).then(({ clean, defective, outDir }) => {
    console.log(`clean:     ${clean.verdict} — ${clean.summary}`);
    console.log(`defective: ${defective.verdict} — ${defective.summary}`);
    console.log(`packets:   ${outDir}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
