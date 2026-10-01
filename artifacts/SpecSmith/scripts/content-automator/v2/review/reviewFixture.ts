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
import { YOUTUBE_SHORTS_1080X1920_30 } from "./platformVariants.ts";
import { narrationText, sha256Json, sha256Text } from "./util.ts";

export const FIXTURE_LABEL = "REVIEW TEST FIXTURE: generated shapes stand in for captures; narration is tones; research is synthetic. Not a creative.";

export const SHORTS_VARIANT: PlatformVariant = YOUTUBE_SHORTS_1080X1920_30;

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

export interface CaptureSpec {
  readonly path: string;
  readonly pairing: ComparePairing;
  readonly metadata?: Record<string, string | number | boolean>;
}

export interface FixtureCut {
  readonly videoPath: string;
  readonly manifestPath: string;
  readonly manifest: RenderManifest;
  /** A fresh copy of the submission for this cut: its storyboard, the clean claims, rights and research. */
  submission(): ReviewSubmission;
}

export interface ReviewFixture extends FixtureCut {
  readonly dir: string;
  readonly files: { readonly captures: readonly string[]; readonly panel: string; readonly voice: string };
  /** Write a manifest (mutated from the clean one) and return its path. */
  writeManifest(name: string, mutate: (manifest: RenderManifest) => RenderManifest): string;
  /** A new file derived from the clean video by ffmpeg, recorded in its own manifest as if the renderer made it. */
  derive(name: string, args: readonly string[]): { videoPath: string; manifestPath: string };
  /** Render another cut through the real compositor: a changed storyboard, or other captures. */
  renderCut(name: string, options: { storyboard?: PlatformScriptStoryboard; captures?: readonly CaptureSpec[] }): Promise<FixtureCut>;
  /** A distinct generated picture at the story band's size. */
  picture(name: string, color: string, box: number): string;
}

const artifact = (taskId: string, path: string, kind: RenderArtifact["kind"], mimeType: string): RenderArtifact =>
  ({ artifactId: `${taskId}-a`, taskId, kind, uri: pathToFileURL(path).toString(), mimeType });

export async function buildReviewFixture(dir: string): Promise<ReviewFixture> {
  mkdirSync(dir, { recursive: true });
  const { width, story, disclosure } = DISCLOSURE_BANDED_LAYOUT;
  const file = (name: string) => join(dir, name);
  const picture = (name: string, color: string, box: number) => {
    const path = file(`${name}.png`);
    ffmpeg("-f", "lavfi", "-i", `color=c=${color}:s=${width}x${story.height}`, "-frames:v", "1",
      "-vf", `drawbox=x=${100 + box * 250}:y=${200 + box * 150}:w=300:h=300:color=white:t=fill`, path);
    return path;
  };
  const captures = ["0x223355", "0x552233", "0x225533"].map((color, index) => picture(`capture-${index}`, color, index));
  const panel = file("disclosure-panel.png");
  ffmpeg("-f", "lavfi", "-i", `color=c=0x0b0c12:s=${width}x${disclosure.height}`, "-frames:v", "1",
    "-vf", "drawbox=x=36:y=80:w=900:h=28:color=white:t=fill,drawbox=x=36:y=150:w=820:h=28:color=white:t=fill", panel);
  const voice = file("voice.wav");
  const on = FIXTURE_SEGMENTS.map((segment) => `between(t\\,${segment.startSecond}\\,${segment.endSecond})`).join("+");
  ffmpeg("-f", "lavfi", "-i", `aevalsrc=0.25*sin(2*PI*220*t)*(${on}):d=6:s=22050`, voice);
  const disclosureLines = [CREATIVE_DISCLOSURES["disclosure.fps-estimate"]];
  const productionPlan = { fixture: FIXTURE_LABEL, layout: "banded", beats: 3 };
  const cleanCaptures: CaptureSpec[] = captures.map((path, index) => ({ path, pairing: PAIRINGS[index] }));
  let encode: RenderManifest["output"]["encode"] | null = null;

  const manifestFor = (outputPath: string, storyboard: PlatformScriptStoryboard, captions: string, specs: readonly CaptureSpec[]): RenderManifest => buildRenderManifest({
    variantId: SHORTS_VARIANT.variantId,
    outputPath,
    encode: encode!,
    storyboard,
    productionPlan,
    layout: DISCLOSURE_BANDED_LAYOUT,
    disclosurePanel: { assetId: "disclosure-panel", path: panel, metadata: {
      renderer: "review-test-fixture", fixture: true, textSha256: sha256Text(disclosureLines.join("\n")), fontPx: 36, contrastRatio: 19.52,
    } },
    captions: { assetId: "captions", path: captions, metadata: { renderer: "specsmith-ass-captions", placement: "caption-band" } },
    narration: { assetId: "narration", path: voice, metadata: {
      renderer: "review-test-fixture-tones", isFixture: true, textSha256: sha256Text(narrationText(storyboard)), beatTiming: "per-beat",
    } },
    narrationSegments: FIXTURE_SEGMENTS,
    beats: storyboard.beats.map((beat, index): { startSecond: number; endSecond: number; captures: ManifestFile[] } => ({
      startSecond: beat.startSecond, endSecond: beat.endSecond,
      captures: [{ assetId: `capture-${index}-${sha256Text(specs[index].path).slice(0, 8)}`, path: specs[index].path,
        metadata: fixtureCaptureMetadata(specs[index].pairing, specs[index].metadata) }],
    })),
  });

  const repoRecord = (assetId: string, kind: AssetRightsRecord["kind"], source: string, placeholderWhy: string | null): AssetRightsRecord => ({
    assetId, kind, source,
    license: { kind: "repo-owned", evidence: "Created by this repository's test fixture.", permittedUse: [REQUIRED_USE], attribution: null, expiresAt: null, scope: "SpecSmith" },
    generation: { generator: "v2/review/reviewFixture.ts (ffmpeg lavfi)", inputs: "fixed fixture parameters" },
    transformations: [],
    placeholder: { isPlaceholder: placeholderWhy !== null, why: placeholderWhy },
  });

  async function renderCut(name: string, options: { storyboard?: PlatformScriptStoryboard; captures?: readonly CaptureSpec[] }): Promise<FixtureCut> {
    const storyboard = options.storyboard ?? FIXTURE_STORYBOARD;
    const specs = options.captures ?? cleanCaptures;
    const captions = file(`${name}-captions.ass`);
    const cues = storyboard.beats.map((beat) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, text: beat.onScreenText }));
    writeFileSync(captions, buildAssDocument(parseCaptionRenderState({ durationSeconds: 6, cues, placement: "caption-band" })));
    const adapter = createMotionCompositorAdapter({ outputDir: file(`render-${name}`), preset: "ultrafast" });
    const [video] = await adapter.render({
      packageId: "review-fixture", campaignId: "c", ideaId: "i", platform: "youtube-shorts", targetDurationSeconds: 6,
      task: {
        taskId: "compose", capability: "motion-compositor", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
        compositorState: {
          durationSeconds: 6, fps: 30, voiceTaskId: "voice", captionTaskId: "captions", disclosureTaskId: "disclosure", layout: DISCLOSURE_BANDED_LAYOUT,
          visualTimeline: storyboard.beats.map((beat, index) => ({ visualTaskId: `v${index}`, startSecond: beat.startSecond, endSecond: beat.endSecond })),
        },
      } as never,
      dependencyArtifacts: [
        ...specs.map((spec, index) => artifact(`v${index}`, spec.path, "image", "image/png")),
        artifact("voice", voice, "audio", "audio/wav"),
        artifact("captions", captions, "captions", "text/x-ass"),
        artifact("disclosure", panel, "image", "image/png"),
      ],
    });
    const videoPath = fileURLToPath(video.uri);
    const meta = video.metadata ?? {};
    encode ??= {
      width: Number(meta.width), height: Number(meta.height), fps: Number(meta.fps),
      videoCodec: String(meta.videoCodec), audioCodec: meta.audioCodec ? String(meta.audioCodec) : null,
    };
    const manifest = manifestFor(videoPath, storyboard, captions, specs);
    const manifestPath = file(`${name}.manifest.json`);
    writeRenderManifest(manifestPath, manifest);
    const rights: AssetRightsRecord[] = [
      ...manifest.beats.flatMap((beat) => beat.captureAssetIds).filter((id, index, all) => all.indexOf(id) === index)
        .map((id) => repoRecord(id, "test-fixture", "generated shapes standing in for a Compare capture", "fixture image, not a SpecSmith capture")),
      repoRecord("disclosure-panel", "test-fixture", "drawn boxes standing in for the measured disclosure panel", "fixture panel, not browser-measured"),
      { ...repoRecord("captions", "caption-render", "captionRender.buildAssDocument from the storyboard", null),
        generation: { generator: "captionRender.buildAssDocument", inputs: `storyboard ${sha256Json(storyboard).slice(0, 12)}` } },
      repoRecord("narration", "narration", "sine tones standing in for narration", "tones, not a voice"),
    ];
    const submission: ReviewSubmission = {
      creativeId: "review-fixture/leads-vs-average",
      variant: SHORTS_VARIANT,
      research: { contract: FIXTURE_CONTRACT, declaredKind: "synthetic-fixture", evidenceSnapshotIds: [] },
      concept: { conceptId: "review-fixture-leads-vs-average", body: { label: FIXTURE_LABEL } },
      storyboard,
      title: "Ahead in more games, behind on average",
      description: "SpecSmith model estimates for two builds. Check your own pair at /compare.",
      approvedDestination: "/compare",
      disclosureLines,
      productionPlan,
      claims: FIXTURE_CLAIMS,
      graphics: [],
      renderManifestPath: manifestPath,
      rights,
    };
    return { videoPath, manifestPath, manifest, submission: () => structuredClone(submission) };
  }

  const clean = await renderCut("clean", {});
  return {
    ...clean,
    dir,
    files: { captures, panel, voice },
    renderCut,
    picture,
    writeManifest(name, mutate) {
      const path = file(`${name}.manifest.json`);
      writeRenderManifest(path, mutate(structuredClone(clean.manifest)));
      return path;
    },
    derive(name, args) {
      const derivedPath = file(`${name}.mp4`);
      ffmpeg("-i", clean.videoPath, ...args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", derivedPath);
      const manifestPathOut = file(`${name}.manifest.json`);
      const captionsPath = clean.manifest.assets.find((asset) => asset.role === "captions")!.path;
      writeRenderManifest(manifestPathOut, manifestFor(derivedPath, FIXTURE_STORYBOARD, captionsPath, cleanCaptures));
      return { videoPath: derivedPath, manifestPath: manifestPathOut };
    },
  };
}

export const FIXTURE_CLAIMS: ReviewSubmission["claims"] = [
  { claimId: "hook-tally-caption", beatIndex: 0, where: "caption", text: "10 games to 7 · 3 ties", basis: "model-estimate",
    statement: { kind: "tally", pairing: DEMO_PAIRING, leadsA: 10, leadsB: 7, ties: 3 } },
  { claimId: "hook-tally-narration", beatIndex: 0, where: "narration", text: "Ten games to seven, plus three ties", basis: "model-estimate",
    statement: { kind: "tally", pairing: DEMO_PAIRING, leadsA: 10, leadsB: 7, ties: 3 } },
  { claimId: "averages-caption", beatIndex: 1, where: "caption", text: "Est. average: 121 vs 123", basis: "model-estimate",
    statement: { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 } },
  { claimId: "averages-narration", beatIndex: 1, where: "narration", text: "the estimated average is 121 to 123", basis: "model-estimate",
    statement: { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 } },
];

/** Copy a file so a test can change the copy without touching the fixture. */
export const copy = (from: string, to: string) => { cpSync(from, to); return to; };
