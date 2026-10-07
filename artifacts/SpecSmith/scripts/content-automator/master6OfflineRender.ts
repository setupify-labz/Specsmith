// Render one MASTER #6 concept offline through the real production path, then
// check the frames and prove the checks can fail.
//
//   pnpm content:creative:render [directory] [conceptId]
//
// Needs the built app served locally (SPECSMITH_RENDER_BASE_URL, default
// http://localhost:5178), Chromium, ffmpeg and espeak-ng. No network beyond
// localhost, no credential, no paid service, no publishing.
//
// WHAT RUNS
// ---------
// 1. The workflow's full checks (#6 and MASTER #1's storyboard review). The
//    concept must have no finding of any kind; its batch need not be ready,
//    and this render does not make it so.
// 2. buildCreativeProposalProductionPlan: one validated Compare view per beat,
//    the disclosure panel, captions in their band, no music.
// 3. The production adapters: deterministic Playwright UI capture, disclosure
//    panel, local espeak-ng narration (a labelled fixture, not a voice), ASS
//    captions, ffmpeg compositor.
// 4. bandedFrameCheck on the real MP4, and on three deliberately broken
//    derivatives of it, each of which must be refused.
// 5. Inspection frames: opening, both sides of every cut, final frame.
//
// WHAT IT DOES NOT DO
// -------------------
// Approve anything. The report lists what a person still has to judge.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "./creativeFileWorkflowCli.ts";
import { createCaptionRenderAdapter } from "./captionRender.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import { createMotionCompositorAdapter, type LoudnessTarget } from "./motionCompositor.ts";
import { RenderAdapterRegistry, renderPlatformPlan } from "./rendering.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";
import { createDisclosureOverlayAdapter } from "./uiRender/disclosureOverlay.ts";
import { createDataMotionGraphicAdapter } from "./v2/creative/dataMotionGraphicRender.ts";
import { createSilentNarrationAdapter } from "./silentNarration.ts";
import { createSavedTakeNarrationAdapter, type SavedTake } from "./savedTakeNarration.ts";
import { createSoundEffectsAdapter, type SoundCue } from "./soundEffects.ts";
import type { CreativeMissionInput } from "./v2/creative/proposalPass.ts";
import { checkBandedFrames, type BandedFrameExpectation } from "./bandedFrameCheck.ts";
import { DISCLOSURE_BANDED_LAYOUT } from "./bandedLayout.ts";
import { verifyRenderedMedia } from "./v2/mediaVerification.ts";
import { buildRenderManifest, writeRenderManifest } from "./v2/review/renderManifest.ts";
import { YOUTUBE_SHORTS_1080X1920_30 } from "./v2/review/platformVariants.ts";
import { evaluateAuthoredBatch } from "./v2/creative/fileWorkflowPass.ts";
import { buildCreativeProposalProductionPlan } from "./v2/creative/proposalPass.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const baseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";
const ffmpegPath = process.env.SPECSMITH_FFMPEG_PATH ?? "ffmpeg";

async function ffmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath, ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(Buffer.concat(err).toString("utf8").slice(-800))));
  });
}

export interface OfflineRenderOptions {
  /** The mission the batch was authored against. Defaults to the engineering fixture. */
  readonly mission?: Omit<CreativeMissionInput, "concepts">;
  /**
   * "fixture-voice": local espeak-ng, a labelled robotic fixture (default).
   * "silent": no speech at all; a silent track of the planned length, with the
   * planned narration and its timing recorded beside it.
   */
  readonly narration?: "fixture-voice" | "silent" | "saved-take";
  /** narration "saved-take": the saved provider take, re-hashed before use. Never generated here. */
  readonly savedTake?: SavedTake;
  /** Where each beat's line sits in the narration, when it is known (a saved take's timestamps). */
  readonly narrationSegments?: readonly { readonly beatIndex: number; readonly startSecond: number; readonly endSecond: number }[];
  /** Synthesized sound effects under the narration (soundEffects.ts). None by default. */
  readonly soundEffects?: readonly SoundCue[];
  /** Master the final mix to this loudness (motionCompositor). Unmastered by default. */
  readonly loudness?: LoudnessTarget;
}

export async function renderProposalOffline(directory: string, conceptId: string, outputRoot?: string, options: OfflineRenderOptions = {}) {
  const mission = options.mission ?? DEMO_MISSION;
  const narration = options.narration ?? "fixture-voice";
  const outputDir = resolve(outputRoot ?? join(here, "..", "..", "render-output", `master6-${conceptId}`));

  // 1. The concept must pass everything the workflow checks.
  const evaluation = await evaluateAuthoredBatch(directory, mission);
  const proposal = evaluation.pass.result.proposals.find((entry) => entry.concept.conceptId === conceptId);
  const feedback = evaluation.feedback?.concepts.find((entry) => entry.conceptId === conceptId);
  if (!proposal || !feedback) throw new Error(`Concept ${conceptId} is not in attempt ${evaluation.attempts}.`);
  const open = [...feedback.required, ...feedback.missionBlockers, ...feedback.blockedOutsideAuthor];
  if (!proposal.contractEligible || open.length > 0) {
    throw new Error(`Concept ${conceptId} does not pass the #6 and #1 checks; refusing to render it:\n- ${open.join("\n- ") || "not contract eligible"}`);
  }

  // 2 and 3. The production plan, rendered by the production adapters.
  const pkg = buildCreativeProposalProductionPlan({
    packageId: `master6-${conceptId}`, ideaId: conceptId, campaignId: mission.missionId,
    feature: "compare", route: mission.productDestination, subjectIds: [],
  }, proposal, { soundEffects: options.soundEffects, loudness: options.loudness });
  const plan = pkg.platforms[0];
  if (narration === "saved-take" && !options.savedTake) throw new Error("narration \"saved-take\" needs the saved take; nothing is generated here.");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const registry = new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl, outputDir: join(outputDir, "ui") }))
    .register(createDisclosureOverlayAdapter({ outputDir: join(outputDir, "disclosure") }))
    .register(createDataMotionGraphicAdapter({ outputDir: join(outputDir, "motion") }))
    .register(narration === "saved-take"
      ? createSavedTakeNarrationAdapter({ outputDir: join(outputDir, "audio"), take: options.savedTake! })
      : narration === "silent"
      ? createSilentNarrationAdapter({ outputDir: join(outputDir, "audio"), ffmpegPath,
          plannedLines: proposal.storyboard.beats.map((beat) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, text: beat.narration })) })
      : createLocalFixtureTtsAdapter({ outputDir: join(outputDir, "audio") }))
    .register(createSoundEffectsAdapter({ outputDir: join(outputDir, "sfx"), ffmpegPath }))
    .register(createCaptionRenderAdapter({ outputDir: join(outputDir, "captions") }))
    .register(createMotionCompositorAdapter({ outputDir, ffmpegPath, ffprobePath: process.env.SPECSMITH_FFPROBE_PATH }));
  const result = await renderPlatformPlan(pkg, plan, registry, { maxAttemptsPerCapability: 1 });
  if (result.status !== "succeeded" || result.finalArtifacts.length !== 1) {
    const failed = result.taskResults.filter((task) => task.status !== "succeeded").map((task) => `${task.taskId}: ${task.status} ${task.error ?? ""}`);
    throw new Error(`Render failed:\n${failed.join("\n")}`);
  }
  const video = result.finalArtifacts[0];
  const videoPath = fileURLToPath(video.uri);
  const artifactOf = (taskId: string) => result.taskResults.find((task) => task.taskId === taskId)!.artifacts[0];

  // 4. Frame checks on the real render.
  const storyboard = proposal.storyboard;
  const visualTasks = plan.tasks.filter((task) => task.sourceBeat !== null);
  const expectation: BandedFrameExpectation = {
    videoPath,
    layout: DISCLOSURE_BANDED_LAYOUT,
    disclosurePanelPath: fileURLToPath(artifactOf(`${plan.platform}-disclosure-overlay`).uri),
    beats: storyboard.beats.map((beat, index) => {
      const artifact = artifactOf(visualTasks[index].taskId);
      // A motion graphic is checked against its own clip at the same moment.
      return artifact.kind === "video"
        ? { startSecond: beat.startSecond, endSecond: beat.endSecond, sources: [], clip: fileURLToPath(artifact.uri) }
        : { startSecond: beat.startSecond, endSecond: beat.endSecond, sources: [fileURLToPath(artifact.uri)] };
    }),
    // The cues the plan actually captions: a beat whose line its graphic carries has none.
    captionCues: ((plan.tasks.find((task) => task.capability === "caption-render") as { captionRenderState?: { cues?: { startSecond: number; endSecond: number }[] } } | undefined)
      ?.captionRenderState?.cues ?? storyboard.beats).map((cue) => ({ startSecond: cue.startSecond, endSecond: cue.endSecond })),
    durationSeconds: Number(video.metadata?.durationSeconds),
  };
  const frameCheck = await checkBandedFrames(expectation, { ffmpegPath });

  // ...and on broken derivatives, each of which must be refused.
  const controlsDir = join(outputDir, "controls");
  await mkdir(controlsDir, { recursive: true });
  const { disclosure, story } = DISCLOSURE_BANDED_LAYOUT;
  let firstSource = expectation.beats[0].sources[0];
  if (!firstSource && expectation.beats[0].clip) {
    // A still of beat 1's clip, for the repeated-picture control.
    firstSource = join(controlsDir, "beat-1-still.png");
    await ffmpeg(["-ss", "1.000", "-i", expectation.beats[0].clip, "-frames:v", "1", firstSource]);
  }
  const second = expectation.beats[1];
  const controls = [
    {
      name: "disclosure-blanked-after-2s",
      args: ["-i", videoPath, "-vf", `drawbox=x=0:y=${disclosure.y}:w=iw:h=${disclosure.height}:color=black:t=fill:enable='gte(t,2)'`, "-c:a", "copy"],
    },
    {
      name: "disclosure-drawn-over-story",
      args: ["-i", videoPath, "-i", expectation.disclosurePanelPath, "-filter_complex", `[0:v][1:v]overlay=0:${story.y + 500}`, "-c:a", "copy"],
    },
    {
      name: "beat-2-repeats-beat-1-capture",
      args: ["-i", videoPath, "-loop", "1", "-i", firstSource, "-filter_complex",
        `[1:v]scale=${DISCLOSURE_BANDED_LAYOUT.width}:${story.height}[first];[0:v][first]overlay=0:${story.y}:shortest=1:enable='between(t,${second.startSecond},${second.endSecond})'`, "-c:a", "copy"],
      repeated: true,
    },
  ];
  const controlResults = [];
  for (const control of controls) {
    const path = join(controlsDir, `${control.name}.mp4`);
    await ffmpeg([...control.args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", path]);
    const report = await checkBandedFrames({ ...expectation, videoPath: path,
      // The repeated-visual control claims what the plan claims; the check must notice the picture did not change.
      beats: expectation.beats }, { ffmpegPath });
    controlResults.push({ control: control.name, refused: !report.ok, failures: report.failures.slice(0, 4) });
  }

  // 5. Inspection frames.
  const framesDir = join(outputDir, "inspection");
  await mkdir(framesDir, { recursive: true });
  const moments = [{ label: "00-opening", at: 0 }];
  storyboard.beats.slice(1).forEach((beat, index) => {
    moments.push({ label: `cut-${index + 1}-before`, at: beat.startSecond - 0.15 });
    moments.push({ label: `cut-${index + 1}-after`, at: beat.startSecond + 0.15 });
  });
  moments.push({ label: "99-final", at: expectation.durationSeconds - 0.05 });
  const framePaths: string[] = [];
  for (const moment of moments) {
    const path = join(framesDir, `${moment.label}.png`);
    await ffmpeg(["-ss", moment.at.toFixed(3), "-i", videoPath, "-frames:v", "1", path]);
    framePaths.push(path);
  }
  const sheetPath = join(outputDir, "inspection-sheet.png");
  await ffmpeg([...framePaths.flatMap((path) => ["-i", path]), "-filter_complex",
    `${framePaths.map((_, index) => `[${index}:v]scale=270:480[s${index}]`).join(";")};${framePaths.map((_, index) => `[s${index}]`).join("")}xstack=inputs=${framePaths.length}:layout=${framePaths.map((_, index) => `${(index % 5) * 270}_${Math.floor(index / 5) * 480}`).join("|")}:fill=black`,
    "-frames:v", "1", sheetPath]);

  // The render manifest: what these bytes were made from, each by its own file's hash.
  const meta = video.metadata ?? {};
  const manifestPath = join(outputDir, "render-manifest.json");
  const fileOf = (taskId: string) => {
    const artifact = artifactOf(taskId);
    return { assetId: taskId, path: fileURLToPath(artifact.uri), metadata: artifact.metadata ?? {} };
  };
  writeRenderManifest(manifestPath, buildRenderManifest({
    variantId: YOUTUBE_SHORTS_1080X1920_30.variantId,
    outputPath: videoPath,
    encode: { width: Number(meta.width), height: Number(meta.height), fps: Number(meta.fps), videoCodec: String(meta.videoCodec), audioCodec: meta.audioCodec ? String(meta.audioCodec) : null },
    storyboard,
    productionPlan: plan,
    layout: DISCLOSURE_BANDED_LAYOUT,
    disclosurePanel: fileOf(`${plan.platform}-disclosure-overlay`),
    captions: fileOf(`${plan.platform}-captions`),
    narration: fileOf(`${plan.platform}-voice`),
    // Known only from a saved take's timestamps. The local voice reads every
    // beat as one continuous take, and a silent track has nothing to time.
    narrationSegments: options.narrationSegments ? [...options.narrationSegments] : null,
    beats: storyboard.beats.map((beat, index) => ({ startSecond: beat.startSecond, endSecond: beat.endSecond, captures: [fileOf(visualTasks[index].taskId)] })),
    otherAssets: plan.tasks.filter((task) => task.capability === "music-sfx").map((task) => ({ ...fileOf(task.taskId), role: "sound-effect" as const })),
  }));

  const media = verifyRenderedMedia(videoPath);
  const report = {
    label: mission.researchSynthetic
      ? "ENGINEERING RENDER of a synthetic-research concept. Not reviewed, not approved, not for publication."
      : narration === "saved-take"
      ? "FINAL CUT of a production-research concept, narrated by the saved provider take. Not approved, not for publication."
      : `VISUAL DRAFT of a production-research concept${narration === "silent" ? ", silent: narration is planned, not spoken" : ""}. Not reviewed, not approved, not for publication.`,
    conceptId,
    attempt: evaluation.attempts,
    batchHash: evaluation.packet.batchHash,
    syntheticResearch: evaluation.packet.syntheticResearch,
    batchReadyForHumanReview: evaluation.packet.humanReviewReady,
    video: { path: videoPath, sha256: media.sha256, bytes: media.bytes, metadata: video.metadata },
    beats: storyboard.beats.map((beat, index) => ({
      purpose: beat.purpose, startSecond: beat.startSecond, endSecond: beat.endSecond,
      caption: beat.onScreenText, narration: beat.narration, claims: beat.factDependencies,
      view: (visualTasks[index].uiRenderState as { state: { resolution: string; preset: string } } | undefined)?.state ?? null,
      visualCapability: visualTasks[index].capability,
      capture: artifactOf(visualTasks[index].taskId).metadata,
    })),
    disclosurePanel: artifactOf(`${plan.platform}-disclosure-overlay`).metadata,
    narration: artifactOf(`${plan.platform}-voice`).metadata,
    soundEffects: plan.tasks.some((task) => task.capability === "music-sfx") ? { cues: options.soundEffects ?? [], artifact: artifactOf(`${plan.platform}-audio`).metadata } : null,
    frameCheck,
    controls: controlResults,
    inspectionFrames: framePaths,
    inspectionSheet: sheetPath,
    renderManifest: manifestPath,
    planQualityChecks: plan.qualityChecks,
    stillNeedsAPerson: [
      "Whether the video is worth a viewer's time: hook, pacing, and whether the three checks land.",
      "Whether the disclosure panel is comfortable to read on a real phone, not only above the measured minimums.",
      "Whether switching between Compare views reads as deliberate or as jumpy.",
      narration === "saved-take"
        ? "The narration and mix: a listening review of the saved take under the sound effects, at phone volume."
        : narration === "silent"
        ? "The narration: none was generated. The audio is silence of the planned length; the planned lines and timings are recorded beside it."
        : "The narration: espeak-ng is a robotic fixture used because no paid voice was approved; voice and audio are unreviewed.",
      mission.researchSynthetic
        ? "Rights and disclosure sign-off, and any publishing decision. The research is a synthetic engineering fixture."
        : "Rights and disclosure sign-off, and any publishing decision.",
    ],
  };
  const reportPath = join(outputDir, "render-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  const [directory = DEMO_WORKFLOW_DIRECTORY, conceptId = "claude-batch-three-checks"] = process.argv.slice(2);
  renderProposalOffline(directory, conceptId).then(({ report, reportPath }) => {
    console.log(report.label);
    console.log(`video: ${report.video.path}`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`frame check: ${report.frameCheck.ok ? "passed" : "FAILED"} (${report.frameCheck.samples.length} samples)`);
    for (const failure of report.frameCheck.failures) console.log(`  - ${failure}`);
    for (const control of report.controls) console.log(`control ${control.control}: ${control.refused ? "refused" : "NOT REFUSED"}`);
    console.log(`report: ${reportPath}`);
    if (!report.frameCheck.ok || report.controls.some((control) => !control.refused)) process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
