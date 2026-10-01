// TEST FIXTURE: a short creative built through the real banded compositor, for
// exercising the review in CI (where there is no browser and no served app).
//
// What is real here: the ffmpeg compositor and its output bytes, the caption
// file the renderer burns in, every figure (computed from the shipped model),
// the disclosure text, and the review itself.
// What is a fixture, and labelled as one everywhere it appears: the "captures"
// are generated shapes standing in for Compare screenshots, the disclosure
// panel is drawn boxes with claimed measurements, the narration is sine tones,
// and the research contract is synthetic. The rights records say so, the
// manifest metadata says so, and the review keeps final approval impossible
// because of it. None of this is mocked inside the review.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DISCLOSURE_BANDED_LAYOUT } from "../../bandedLayout.ts";
import { buildAssDocument, parseCaptionRenderState } from "../../captionRender.ts";
import { createMotionCompositorAdapter } from "../../motionCompositor.ts";
import { modelSnapshotSha256 } from "../../modelSnapshot.ts";
import type { RenderArtifact } from "../../rendering.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import { compareAverageFpsText, compareTiesText } from "../../uiRender/surfaces.ts";
import { CREATIVE_DISCLOSURES } from "../creative/concept.ts";
import { SYNTHETIC_EVIDENCE_LIMITATION, type ResearchCreativeContract } from "../research/creativeContract.ts";
import { DEMO_PAIRING, type ComparePairing } from "../../leadsVsAverage/facts.ts";
import { REQUIRED_USE, type AssetRightsRecord, type RenderManifest, type ReviewSubmission } from "./inputs.ts";
import { buildRenderManifest, writeRenderManifest, type ManifestFile } from "./renderManifest.ts";
import type { PlatformVariant } from "./types.ts";
import { narrationText, sha256Json, sha256Text } from "./util.ts";

export const FIXTURE_LABEL = "REVIEW TEST FIXTURE: generated shapes stand in for captures; narration is tones; research is synthetic. Not a creative.";

export const SHORTS_VARIANT: PlatformVariant = {
  variantId: "youtube-shorts-1080x1920-30",
  platform: "youtube-shorts",
  width: 1080, height: 1920, fps: 30,
  minDurationSeconds: 1, maxDurationSeconds: 60,
  requiresAudio: true,
  safeArea: null,
};

export const FIXTURE_STORYBOARD: PlatformScriptStoryboard = {
  platform: "youtube-shorts",
  targetDurationSeconds: 6,
  title: "Ahead in more games, behind on average",
  narrationStyle: "Plain, curious, unhurried.",
  beats: [
    { startSecond: 0, endSecond: 2, purpose: "hook", narration: "Ten games to seven, plus three ties.",
      visualDirection: "[fixture] Compare at 1440p High", onScreenText: "10 games to 7 · 3 ties", factDependencies: [] },
    { startSecond: 2, endSecond: 4, purpose: "payoff", narration: "Yet the estimated average is 121 to 123.",
      visualDirection: "[fixture] Compare averages at 1440p High", onScreenText: "Est. average: 121 vs 123", factDependencies: [] },
    { startSecond: 4, endSecond: 6, purpose: "cta", narration: "Check your own pair at SpecSmith slash compare.",
      visualDirection: "[fixture] Compare at 1080p Low", onScreenText: "Your pair: /compare", factDependencies: [] },
  ],
  finalCta: "Check your own pair at SpecSmith slash compare.",
  factualGuardrails: ["Every figure is a SpecSmith model estimate, not a measured benchmark."],
};

export const FIXTURE_CONTRACT: ResearchCreativeContract = {
  version: "research-creative-contract-v1",
  questionId: "SYNTHETIC_ENGINEERING_FIXTURE-review-fixture",
  generatedAt: "2026-09-30T00:00:00.000Z",
  safeClaims: [],
  unsafeClaims: [],
  disputedClaims: [],
  groundedHookMaterial: [],
  openQuestions: [],
  limitations: [SYNTHETIC_EVIDENCE_LIMITATION],
  overallState: "known",
};

const LOW_1080: ComparePairing = { ...DEMO_PAIRING, resolution: "1080p", preset: "low" };
const PAIRINGS = [DEMO_PAIRING, DEMO_PAIRING, LOW_1080];
/** Each beat's narration placed inside its beat, as a per-beat narration renderer would record it. */
export const FIXTURE_SEGMENTS = [
  { beatIndex: 0, startSecond: 0.2, endSecond: 1.8 },
  { beatIndex: 1, startSecond: 2.2, endSecond: 3.8 },
  { beatIndex: 2, startSecond: 4.2, endSecond: 5.6 },
];

export const routeFor = (pairing: ComparePairing) =>
  `/compare?gpuA=${pairing.gpuA}&cpuA=${pairing.cpuA}&gpuB=${pairing.gpuB}&cpuB=${pairing.cpuB}&res=${pairing.resolution}&preset=${pairing.preset}`;

/** What the real capture adapter would have verified on the page for this state, from today's model. */
export function fixtureCaptureMetadata(pairing: ComparePairing, overrides: Record<string, string | number | boolean> = {}) {
  const verified = [...compareAverageFpsText(pairing), compareTiesText(pairing)];
  return {
    renderer: "review-test-fixture",
    fixture: true,
    feature: "compare",
    route: routeFor(pairing),
    verifiedText: verified.join("\n"),
    pageText: `Compare\n${verified.join("\n")}\nShare Comparison`,
    modelSnapshotSha256: modelSnapshotSha256(),
    capturedAt: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

export function ffmpeg(...args: string[]): void {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. The review tests need ffmpeg installed.`);
  if (result.status !== 0) throw new Error(result.stderr.toString());
}

export interface ReviewFixture {
  readonly dir: string;
  readonly videoPath: string;
  readonly manifestPath: string;
  readonly manifest: RenderManifest;
  readonly files: { readonly captures: readonly string[]; readonly panel: string; readonly voice: string; readonly captions: string };
  /** A fresh, independent copy of the clean submission. */
  submission(): ReviewSubmission;
  /** Write a manifest (mutated from the clean one) and return its path. */
  writeManifest(name: string, mutate: (manifest: RenderManifest) => RenderManifest): string;
  /** A new file derived from the clean video by ffmpeg, recorded in its own manifest as if the renderer made it. */
  derive(name: string, args: readonly string[]): { videoPath: string; manifestPath: string };
}

const artifact = (taskId: string, path: string, kind: RenderArtifact["kind"], mimeType: string): RenderArtifact =>
  ({ artifactId: `${taskId}-a`, taskId, kind, uri: pathToFileURL(path).toString(), mimeType });

export async function buildReviewFixture(dir: string): Promise<ReviewFixture> {
  mkdirSync(dir, { recursive: true });
  const { width, story, disclosure } = DISCLOSURE_BANDED_LAYOUT;
  const file = (name: string) => join(dir, name);
  const colors = ["0x223355", "0x552233", "0x225533"];
  const captures = colors.map((color, index) => {
    const path = file(`capture-${index}.png`);
    ffmpeg("-f", "lavfi", "-i", `color=c=${color}:s=${width}x${story.height}`, "-frames:v", "1",
      "-vf", `drawbox=x=${100 + index * 250}:y=${200 + index * 150}:w=300:h=300:color=white:t=fill`, path);
    return path;
  });
  const panel = file("disclosure-panel.png");
  ffmpeg("-f", "lavfi", "-i", `color=c=0x0b0c12:s=${width}x${disclosure.height}`, "-frames:v", "1",
    "-vf", "drawbox=x=36:y=80:w=900:h=28:color=white:t=fill,drawbox=x=36:y=150:w=820:h=28:color=white:t=fill", panel);
  const voice = file("voice.wav");
  const on = FIXTURE_SEGMENTS.map((segment) => `between(t\\,${segment.startSecond}\\,${segment.endSecond})`).join("+");
  ffmpeg("-f", "lavfi", "-i", `aevalsrc=0.25*sin(2*PI*220*t)*(${on}):d=6:s=22050`, voice);
  const captions = file("captions.ass");
  const cues = FIXTURE_STORYBOARD.beats.map((beat) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, text: beat.onScreenText }));
  writeFileSync(captions, buildAssDocument(parseCaptionRenderState({ durationSeconds: 6, cues, placement: "caption-band" })));

  const adapter = createMotionCompositorAdapter({ outputDir: file("render"), preset: "ultrafast" });
  const [video] = await adapter.render({
    packageId: "review-fixture", campaignId: "c", ideaId: "i", platform: "youtube-shorts", targetDurationSeconds: 6,
    task: {
      taskId: "compose", capability: "motion-compositor", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
      compositorState: {
        durationSeconds: 6, fps: 30, voiceTaskId: "voice", captionTaskId: "captions", disclosureTaskId: "disclosure", layout: DISCLOSURE_BANDED_LAYOUT,
        visualTimeline: FIXTURE_STORYBOARD.beats.map((beat, index) => ({ visualTaskId: `v${index}`, startSecond: beat.startSecond, endSecond: beat.endSecond })),
      },
    } as never,
    dependencyArtifacts: [
      ...captures.map((path, index) => artifact(`v${index}`, path, "image", "image/png")),
      artifact("voice", voice, "audio", "audio/wav"),
      artifact("captions", captions, "captions", "text/x-ass"),
      artifact("disclosure", panel, "image", "image/png"),
    ],
  });
  const videoPath = fileURLToPath(video.uri);
  const meta = video.metadata ?? {};
  const encode = {
    width: Number(meta.width), height: Number(meta.height), fps: Number(meta.fps),
    videoCodec: String(meta.videoCodec), audioCodec: meta.audioCodec ? String(meta.audioCodec) : null,
  };
  const disclosureLines = [CREATIVE_DISCLOSURES["disclosure.fps-estimate"]];
  const productionPlan = { fixture: FIXTURE_LABEL, layout: "banded", beats: 3 };

  const manifestFor = (outputPath: string): RenderManifest => buildRenderManifest({
    variantId: SHORTS_VARIANT.variantId,
    outputPath,
    encode,
    storyboard: FIXTURE_STORYBOARD,
    productionPlan,
    layout: DISCLOSURE_BANDED_LAYOUT,
    disclosurePanel: { assetId: "disclosure-panel", path: panel, metadata: {
      renderer: "review-test-fixture", fixture: true, textSha256: sha256Text(disclosureLines.join("\n")), fontPx: 36, contrastRatio: 19.52,
    } },
    captions: { assetId: "captions", path: captions, metadata: { renderer: "specsmith-ass-captions", placement: "caption-band" } },
    narration: { assetId: "narration", path: voice, metadata: {
      renderer: "review-test-fixture-tones", isFixture: true, textSha256: sha256Text(narrationText(FIXTURE_STORYBOARD)), beatTiming: "per-beat",
    } },
    narrationSegments: FIXTURE_SEGMENTS,
    beats: FIXTURE_STORYBOARD.beats.map((beat, index): { startSecond: number; endSecond: number; captures: ManifestFile[] } => ({
      startSecond: beat.startSecond, endSecond: beat.endSecond,
      captures: [{ assetId: `capture-${index}`, path: captures[index], metadata: fixtureCaptureMetadata(PAIRINGS[index]) }],
    })),
  });
  const manifest = manifestFor(videoPath);
  const manifestPath = file("render-manifest.json");
  writeRenderManifest(manifestPath, manifest);

  const repoRecord = (assetId: string, kind: AssetRightsRecord["kind"], source: string, placeholderWhy: string | null): AssetRightsRecord => ({
    assetId, kind, source,
    license: { kind: "repo-owned", evidence: "Created by this repository's test fixture.", permittedUse: [REQUIRED_USE], attribution: null, expiresAt: null, scope: "SpecSmith" },
    generation: { generator: "v2/review/reviewFixture.ts (ffmpeg lavfi)", inputs: "fixed fixture parameters" },
    transformations: [],
    placeholder: { isPlaceholder: placeholderWhy !== null, why: placeholderWhy },
  });
  const rights: AssetRightsRecord[] = [
    ...captures.map((_, index) => repoRecord(`capture-${index}`, "test-fixture", "generated shapes standing in for a Compare capture", "fixture image, not a SpecSmith capture")),
    repoRecord("disclosure-panel", "test-fixture", "drawn boxes standing in for the measured disclosure panel", "fixture panel, not browser-measured"),
    { ...repoRecord("captions", "caption-render", "captionRender.buildAssDocument from the storyboard", null),
      generation: { generator: "captionRender.buildAssDocument", inputs: `storyboard ${sha256Json(FIXTURE_STORYBOARD).slice(0, 12)}` } },
    repoRecord("narration", "narration", "sine tones standing in for narration", "tones, not a voice"),
  ];

  const clean: ReviewSubmission = {
    creativeId: "review-fixture/leads-vs-average",
    variant: SHORTS_VARIANT,
    research: { contract: FIXTURE_CONTRACT, declaredKind: "synthetic-fixture", evidenceSnapshotIds: [] },
    concept: { conceptId: "review-fixture-leads-vs-average", body: { label: FIXTURE_LABEL } },
    storyboard: FIXTURE_STORYBOARD,
    title: "Ahead in more games, behind on average",
    description: "SpecSmith model estimates for two builds. Check your own pair at /compare.",
    approvedDestination: "/compare",
    disclosureLines,
    productionPlan,
    claims: [
      { claimId: "hook-tally-caption", beatIndex: 0, where: "caption", text: "10 games to 7 · 3 ties", basis: "model-estimate",
        statement: { kind: "tally", pairing: DEMO_PAIRING, leadsA: 10, leadsB: 7, ties: 3 } },
      { claimId: "hook-tally-narration", beatIndex: 0, where: "narration", text: "Ten games to seven, plus three ties", basis: "model-estimate",
        statement: { kind: "tally", pairing: DEMO_PAIRING, leadsA: 10, leadsB: 7, ties: 3 } },
      { claimId: "averages-caption", beatIndex: 1, where: "caption", text: "Est. average: 121 vs 123", basis: "model-estimate",
        statement: { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 } },
      { claimId: "averages-narration", beatIndex: 1, where: "narration", text: "the estimated average is 121 to 123", basis: "model-estimate",
        statement: { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 } },
    ],
    graphics: [],
    renderManifestPath: manifestPath,
    rights,
  };

  return {
    dir, videoPath, manifestPath, manifest,
    files: { captures, panel, voice, captions },
    submission: () => structuredClone(clean),
    writeManifest(name, mutate) {
      const path = file(`${name}.manifest.json`);
      writeRenderManifest(path, mutate(structuredClone(manifest)));
      return path;
    },
    derive(name, args) {
      const derivedPath = file(`${name}.mp4`);
      ffmpeg("-i", videoPath, ...args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", derivedPath);
      const manifestPathOut = file(`${name}.manifest.json`);
      writeRenderManifest(manifestPathOut, manifestFor(derivedPath));
      return { videoPath: derivedPath, manifestPath: manifestPathOut };
    },
  };
}

/** Copy a file so a test can change the copy without touching the fixture. */
export const copy = (from: string, to: string) => { cpSync(from, to); return to; };
