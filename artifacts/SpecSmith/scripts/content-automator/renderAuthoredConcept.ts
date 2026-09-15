#!/usr/bin/env tsx
/**
 * MASTER #6 — Render a Claude-authored concept with the real render pipeline.
 *
 * This renders attempt 3's `claude-batch-commit-first` from its ACTUAL
 * storyboard: the beats it declares, the exact Compare capture state its one
 * visual names, local espeak-ng narration, and real burned-in captions composed
 * by real ffmpeg.
 *
 * It is NOT the pre-existing offline smoke video. That video is a different,
 * hand-authored 8-second timeline about two other GPUs. Nothing here reuses it.
 *
 * No paid provider, no credential, no network beyond the local preview server,
 * no publishing.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createCaptionRenderAdapter,
  CAPTION_LINE_MAX_CHARS,
  CAPTION_MAX_LINES,
  DISCLOSURE_LINE_MAX_CHARS,
  DISCLOSURE_MAX_LINES,
} from "./captionRender.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import { createMotionCompositorAdapter } from "./motionCompositor.ts";
import { RenderAdapterRegistry, renderPlatformPlan, type PlatformRenderResult } from "./rendering.ts";
import type { PlatformProductionPlan, ProductionPlanPackage, ProductionTask } from "./types.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";

export const AUTHORED_CONCEPT_PATH = join(
  here,
  "fixtures",
  "creative-file-workflow",
  "batches",
  "attempt-3",
  "01-commit-first.json",
);

export const AUTHORED_RENDER_OUTPUT_DIR = join(here, "..", "..", "render-output", "claude-batch-commit-first");

interface AuthoredBeat {
  readonly purpose: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly narration: string;
  readonly onScreenText: string;
  readonly visualIds: readonly string[];
  readonly factDependencies: readonly string[];
}

interface AuthoredVisual {
  readonly kind: string;
  readonly visualId: string;
  readonly surface: string;
  readonly stateIdentifier: string;
}

export interface AuthoredConcept {
  readonly conceptId: string;
  readonly beats: readonly AuthoredBeat[];
  readonly visuals: readonly AuthoredVisual[];
  readonly disclosureTextByBeat?: Readonly<Record<string, readonly string[]>>;
}

export async function loadAuthoredConcept(path = AUTHORED_CONCEPT_PATH): Promise<AuthoredConcept> {
  return JSON.parse(await readFile(path, "utf8")) as AuthoredConcept;
}

/**
 * The capture state the concept's visual names, expressed as a render request.
 *
 * The concept carries the state IDENTIFIER, which is a fingerprint rather than
 * a parseable request, so the request is written here and then checked against
 * the identifier the concept declares. A mismatch throws instead of rendering
 * some other page.
 */
export const AUTHORED_UI_STATE = {
  state: {
    surface: "compare",
    gpuA: "rtx5060ti",
    cpuA: "i3-13100f",
    gpuB: "rtx4060ti",
    cpuB: "r5-9600x",
    resolution: "1440p",
    preset: "high",
  },
  captureType: "static",
} as const;

export interface CaptionFitFinding {
  readonly beatIndex: number;
  readonly kind: "on-screen-text" | "disclosure";
  readonly text: string;
  readonly lines: readonly string[];
  readonly longestLine: number;
}

/**
 * Wrap exactly as the burned-in renderer wraps, so fit is judged on the lines a
 * viewer actually sees.
 *
 * The renderer does not truncate: when text needs more than two lines it joins
 * the remainder onto line two, which runs off the frame. So "does it fit" has
 * to be asked here, before anything is burned in.
 */
export function wrapLikeRenderer(
  text: string,
  maxChars = CAPTION_LINE_MAX_CHARS,
  maxLines = CAPTION_MAX_LINES,
): readonly string[] {
  const cleaned = text.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return [cleaned];
  const lines: string[] = [];
  let line = "";
  for (const word of cleaned.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")];
}

export function assessCaptionFit(concept: AuthoredConcept): readonly CaptionFitFinding[] {
  const findings: CaptionFitFinding[] = [];

  concept.beats.forEach((beat, index) => {
    const lines = wrapLikeRenderer(beat.onScreenText, CAPTION_LINE_MAX_CHARS, CAPTION_MAX_LINES);
    const longestLine = Math.max(...lines.map((line) => line.length));
    if (longestLine > CAPTION_LINE_MAX_CHARS) {
      findings.push({ beatIndex: index, kind: "on-screen-text", text: beat.onScreenText, lines, longestLine });
    }
  });

  // Disclosures render in the smaller persistent band, so they are measured
  // against that budget rather than the beat-caption one.
  for (const text of uniqueDisclosures(concept)) {
    const lines = wrapLikeRenderer(text, DISCLOSURE_LINE_MAX_CHARS, DISCLOSURE_MAX_LINES);
    const longestLine = Math.max(...lines.map((line) => line.length));
    if (longestLine > DISCLOSURE_LINE_MAX_CHARS) {
      findings.push({ beatIndex: -1, kind: "disclosure", text, lines, longestLine });
    }
  }

  return findings;
}

/**
 * Every distinct disclosure the concept attaches to any beat.
 *
 * The concept lists them per beat; the renderer holds them for the whole
 * duration, so the set is what matters rather than the per-beat repetition.
 */
export function uniqueDisclosures(concept: AuthoredConcept): readonly string[] {
  const seen = new Set<string>();
  for (const texts of Object.values(concept.disclosureTextByBeat ?? {})) {
    for (const text of texts) seen.add(text);
  }
  return [...seen];
}

export function buildAuthoredPlan(
  concept: AuthoredConcept,
  durationSeconds: number,
): { pkg: ProductionPlanPackage; plan: PlatformProductionPlan } {
  const packageId = concept.conceptId;
  const visual = concept.visuals[0];
  if (visual === undefined) throw new Error("The concept declares no visual.");

  // One static capture held for the whole piece: that is what the concept
  // declares (single-surface-hold, one real-product-capture, captureType
  // static). Cutting to other shots would be rendering a different concept.
  const visualTask: ProductionTask = {
    taskId: `${packageId}-visual`,
    capability: "deterministic-ui-render",
    sourceBeat: null,
    purpose: `Capture the exact Compare state the concept names: ${visual.stateIdentifier}.`,
    inputRequirements: ["Real SpecSmith Compare UI only."],
    outputRequirements: ["1080x1920 deterministic SpecSmith UI capture."],
    uiRenderState: AUTHORED_UI_STATE,
  };

  const narration = concept.beats.map((beat) => beat.narration.trim()).join(" ");
  const voice: ProductionTask = {
    taskId: `${packageId}-voice`,
    capability: "text-to-speech",
    sourceBeat: null,
    purpose: "Narrate the authored beats with the local offline fixture voice.",
    inputRequirements: [narration],
    outputRequirements: ["Preserve the authored wording exactly, including the disclosure sentences."],
  };

  // Caption cues come from the authored beats' own on-screen text, on the
  // authored beat boundaries, scaled if the piece had to be lengthened to fit
  // the narration.
  const authoredEnd = concept.beats[concept.beats.length - 1].endSecond;
  const scale = durationSeconds / authoredEnd;
  const cues = concept.beats.map((beat) => ({
    startSecond: Number((beat.startSecond * scale).toFixed(3)),
    endSecond: Number((beat.endSecond * scale).toFixed(3)),
    text: beat.onScreenText,
  }));

  const captions: ProductionTask = {
    taskId: `${packageId}-captions`,
    capability: "caption-render",
    sourceBeat: null,
    purpose: "Burn in the authored on-screen text on the authored beat boundaries.",
    inputRequirements: cues.map((cue) => cue.text),
    outputRequirements: ["Keep captions inside short-form safe areas."],
  };
  // The concept requires both disclosures on every beat. They cannot be beat
  // captions: cues may not overlap, and neither sentence fits the caption
  // style. They render as a persistent band instead, on screen for the whole
  // piece, which is strictly stronger than "on every beat".
  const disclosures = uniqueDisclosures(concept);
  (captions as ProductionTask & { captionRenderState?: unknown }).captionRenderState = {
    durationSeconds,
    cues,
    disclosures: disclosures.map((text) => ({ text })),
  };

  const compose: ProductionTask = {
    taskId: `${packageId}-compose`,
    capability: "motion-compositor",
    sourceBeat: null,
    purpose: "Compose one real 1080x1920 H.264/AAC MP4 from the real capture, fixture narration and real captions.",
    inputRequirements: [visualTask.taskId, voice.taskId, captions.taskId],
    outputRequirements: ["Real video/mp4 artifact, not a dry-run placeholder."],
  };
  (compose as ProductionTask & { compositorState?: unknown }).compositorState = {
    durationSeconds,
    fps: 30,
    visualTimeline: [{ visualTaskId: visualTask.taskId, startSecond: 0, endSecond: durationSeconds }],
    voiceTaskId: voice.taskId,
    captionTaskId: captions.taskId,
  };

  const tasks = [visualTask, voice, captions, compose];
  const plan: PlatformProductionPlan = {
    platform: "youtube-shorts",
    targetDurationSeconds: durationSeconds,
    tasks,
    renderOrder: tasks.map((task) => task.taskId),
    qualityChecks: [
      "Final artifact is a real 1080x1920 MP4.",
      "The only product UI is the exact Compare capture the concept names.",
      "Narration is the authored beat text, spoken by the local offline TTS fixture (no paid provider).",
      "Captions carry the authored on-screen text on the authored beat boundaries.",
    ],
  };

  return {
    pkg: { packageId, ideaId: packageId, campaignId: packageId, platforms: [plan] },
    plan,
  };
}

async function probeDurationSeconds(path: string): Promise<number> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const ffprobe = process.env.SPECSMITH_FFPROBE_PATH ?? "ffprobe";
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  return Number(stdout.trim());
}

export interface AuthoredRenderResult {
  readonly result: PlatformRenderResult;
  readonly outputDir: string;
  readonly durationSeconds: number;
  readonly narrationSeconds: number;
  readonly captionFit: readonly CaptionFitFinding[];
}

export async function renderAuthoredConcept(options: { outputDir?: string } = {}): Promise<AuthoredRenderResult> {
  const outputDir = options.outputDir ?? AUTHORED_RENDER_OUTPUT_DIR;
  const concept = await loadAuthoredConcept();

  const declaredState = concept.visuals[0]?.stateIdentifier ?? "";
  const { stateIdentifier, parseUiRenderRequest } = await import("./uiRender/uiRenderState.ts");
  const actualState = stateIdentifier(parseUiRenderRequest(AUTHORED_UI_STATE));
  if (actualState !== declaredState) {
    throw new Error(
      `The capture state this renderer would produce (${actualState}) is not the state the concept declares ` +
        `(${declaredState}). Refusing to render a different page than the concept promised.`,
    );
  }

  const captionFit = assessCaptionFit(concept);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const registry = new RenderAdapterRegistry()
    .register(createDeterministicUiRenderAdapter({ baseUrl, outputDir: join(outputDir, "ui") }))
    .register(createLocalFixtureTtsAdapter({ outputDir: join(outputDir, "audio") }))
    .register(createCaptionRenderAdapter({ outputDir: join(outputDir, "captions") }))
    .register(
      createMotionCompositorAdapter({
        outputDir,
        ffmpegPath: process.env.SPECSMITH_FFMPEG_PATH,
        ffprobePath: process.env.SPECSMITH_FFPROBE_PATH,
      }),
    );

  // The authored piece declares 42s. Local espeak-ng paces differently from a
  // human read, and the compositor hard-cuts at durationSeconds, so rendering
  // the declared 42s would clip the narration mid-sentence — including, at this
  // length, the disclosure-bearing lines. Measure the narration first and hold
  // the piece open long enough to say all of it.
  const probeRegistry = new RenderAdapterRegistry().register(
    createLocalFixtureTtsAdapter({ outputDir: join(outputDir, "audio-probe") }),
  );
  const narration = concept.beats.map((beat) => beat.narration.trim()).join(" ");
  const probePackageId = `${concept.conceptId}-probe`;
  const probeVoice: ProductionTask = {
    taskId: `${probePackageId}-voice`,
    capability: "text-to-speech",
    sourceBeat: null,
    purpose: "Measure the authored narration's real spoken length before fixing the timeline.",
    inputRequirements: [narration],
    outputRequirements: ["Preserve the authored wording exactly."],
  };
  const probePlan: PlatformProductionPlan = {
    platform: "youtube-shorts",
    targetDurationSeconds: 1,
    tasks: [probeVoice],
    renderOrder: [probeVoice.taskId],
    qualityChecks: [],
  };
  const probe = await renderPlatformPlan(
    { packageId: probePackageId, ideaId: probePackageId, campaignId: probePackageId, platforms: [probePlan] },
    probePlan,
    probeRegistry,
    { maxAttemptsPerCapability: 1 },
  );
  const probeArtifact = probe.taskResults.find((task) => task.taskId === probeVoice.taskId)?.artifacts?.[0];
  if (probeArtifact === undefined) {
    throw new Error("The local TTS fixture produced no artifact, so the narration length cannot be measured.");
  }
  // The fixture does not report a duration in its metadata, so measure the
  // rendered wav itself rather than assuming one.
  const narrationSeconds = await probeDurationSeconds(fileURLToPath(probeArtifact.uri));
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0) {
    throw new Error("Could not measure the narration length, so the timeline cannot be set honestly.");
  }

  const authoredEnd = concept.beats[concept.beats.length - 1].endSecond;
  const durationSeconds = Math.max(authoredEnd, Math.ceil(narrationSeconds * 10) / 10);

  const { pkg, plan } = buildAuthoredPlan(concept, durationSeconds);
  console.log(`Rendering ${concept.conceptId} against ${baseUrl} with local espeak-ng narration (no paid provider).`);
  console.log(`Authored length ${authoredEnd}s; measured narration ${narrationSeconds.toFixed(2)}s; rendering ${durationSeconds}s.`);

  const result = await renderPlatformPlan(pkg, plan, registry, { maxAttemptsPerCapability: 1 });
  if (result.status !== "succeeded" || result.finalArtifacts.length !== 1) {
    for (const task of result.taskResults) {
      if (task.status !== "succeeded") console.error(`${task.taskId}: ${task.status} ${task.error ?? ""}`);
    }
    throw new Error("Authored-concept render failed.");
  }
  const final = result.finalArtifacts[0];
  if (final.mimeType !== "video/mp4" || final.uri.startsWith("dry-run://")) {
    throw new Error(`Compositor returned ${final.mimeType} at ${final.uri}, not a real MP4.`);
  }

  return { result, outputDir, durationSeconds, narrationSeconds, captionFit };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain) {
  renderAuthoredConcept()
    .then((rendered) => {
      const final = rendered.result.finalArtifacts[0];
      console.log("\nReal MP4 render of the authored concept succeeded.");
      console.log(`Output: ${final.uri}`);
      console.log(`Metadata: ${JSON.stringify(final.metadata)}`);
      if (rendered.captionFit.length > 0) {
        console.log("\nRENDERER BLOCKERS — text that will not fit the burned-in caption renderer:");
        for (const finding of rendered.captionFit) {
          console.log(`  beat ${finding.beatIndex} ${finding.kind}: longest line ${finding.longestLine} chars (limit ${CAPTION_LINE_MAX_CHARS})`);
          console.log(`    "${finding.text}"`);
        }
      }
    })
    .catch((error: unknown) => {
      console.error("\nAUTHORED CONCEPT RENDER FAILED:");
      console.error(error);
      process.exitCode = 1;
    });
}
