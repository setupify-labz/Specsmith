// TEST SUPPORT ONLY. Renders a tiny, real master through the real compositor
// so publish-boundary tests exercise genuine receipts rather than hand-built
// provenance.
//
// Every file here is written to a fresh temporary directory and every byte is
// produced by ffmpeg, espeak-ng or the real caption/fixture/ElevenLabs
// adapters. The clean narration goes through the REAL ElevenLabs adapter, but
// against publishBoundary.fakeNetwork.ts, which answers for
// api.elevenlabs.io with an ffmpeg tone: no paid provider is ever called.
// The music bed is an ffmpeg tone with a clean label (no licensed-music
// adapter exists to issue evidence for it). These are CONSTRUCTED CONTROLS
// proving the gate CAN be satisfied — a gate nothing can pass gets loosened —
// and never a claim that a real production asset exists.
//
// Test files using this kit must import ./publishBoundary.fakeNetwork.ts
// FIRST, as a side-effect import (`import "./publishBoundary.fakeNetwork.ts"`):
// esbuild drops a named import whose binding is unused. renderControl() verifies the clean control really obtained
// ElevenLabs evidence and throws if the import order was wrong.

import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createCaptionRenderAdapter } from "./captionRender.ts";
import { createElevenLabsTtsAdapter, type ElevenLabsTtsConfig } from "./elevenLabsTts.ts";
import { uploadAndVerifyMaster, type HostedMaster, type MasterUploader } from "./hostedMaster.ts";
import { CONTROL_HOST_ORIGIN, fakeNetwork } from "./publishBoundary.fakeNetwork.ts";
import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import {
  createMotionCompositorAdapter,
  renderReceiptFor,
  type RenderReceipt,
} from "./motionCompositor.ts";
import { createOfflineCardVideoAdapter, createOfflineSilentBedAdapter } from "./offlineBeatFixtures.ts";
import type { RenderArtifact, RenderTaskContext } from "./rendering.ts";
import type { ContentIdea, ContentPackage, CreativeFingerprint, ProductionTask, VideoPlatform } from "./types.ts";

const run = promisify(execFile);

export const CONTROL_LIAM_VOICE_ID = "test-liam-voice-id";
export const CONTROL_PACKAGE_ID = "pkg-ss-20260823-rtx-value";
const WIDTH = 320;
const HEIGHT = 568;
const DURATION = 3;

export const CONTROL_TASKS = {
  hook: "beat-1-visual",
  evidence: "beat-2-visual",
  voice: "voice",
  captions: "captions",
  music: "music",
  unused: "unused-visual",
} as const;

export interface ControlOptions {
  /** Narration from the real espeak-ng fixture adapter. */
  fixtureNarration?: boolean;
  /** Music bed from the real silent-bed fixture adapter. */
  fixtureMusic?: boolean;
  /** Hook from the real offline placeholder card adapter. */
  fixtureHook?: boolean;
  /**
   * THE METADATA FORGERY: arbitrary ffmpeg audio, never seen by the ElevenLabs
   * adapter, labelled exactly as that adapter labels its output
   * (`provider: "elevenlabs"`, the Liam voice id, a model id).
   */
  forgedNarration?: boolean;
  /** The real ElevenLabs adapter, but with an injected fetchImpl. */
  injectedTransportNarration?: boolean;
  /** The real ElevenLabs adapter, requesting this voice id instead of Liam's. */
  narrationVoiceId?: string;
  /** Runs after the narration artifact exists and before the compositor consumes it. */
  afterNarration?: (artifact: RenderArtifact) => Promise<void>;
  /** A caption file written by the caller and labelled as the caption adapter's. */
  forgedCaptions?: boolean;
  /** Extra metadata merged onto the clean evidence visual. */
  evidenceMetadata?: Record<string, string | number | boolean>;
}

export interface ControlRender {
  dir: string;
  master: RenderArtifact;
  receipt: RenderReceipt;
  /** Every dependency artifact handed to the compositor, by task id. */
  artifacts: Record<string, RenderArtifact>;
  /** A real file offered to the compositor that its state never references. */
  unused: RenderArtifact;
}

const task = (taskId: string, over: Partial<ProductionTask> & Record<string, unknown> = {}): ProductionTask => ({
  taskId, capability: "video-generation", sourceBeat: 0, purpose: "control",
  inputRequirements: [], outputRequirements: [], ...over,
} as ProductionTask);

const context = (t: ProductionTask, dependencyArtifacts: RenderArtifact[] = []): RenderTaskContext => ({
  packageId: CONTROL_PACKAGE_ID, campaignId: "ss-20260823-rtx-value", ideaId: "rtx-value",
  platform: "tiktok", targetDurationSeconds: DURATION, task: t, dependencyArtifacts,
});

async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function fileArtifact(
  taskId: string,
  path: string,
  kind: RenderArtifact["kind"],
  mimeType: string,
  metadata: Record<string, string | number | boolean>,
): RenderArtifact {
  return { artifactId: `${taskId}-control`, taskId, kind, uri: pathToFileURL(path).toString(), mimeType, metadata };
}

async function still(dir: string, taskId: string, colour: string): Promise<RenderArtifact> {
  const path = join(dir, `${taskId}.png`);
  await ffmpeg(["-f", "lavfi", "-i", `color=c=${colour}:s=${WIDTH}x${HEIGHT}`, "-frames:v", "1", path]);
  return fileArtifact(taskId, path, "image", "image/png", {
    renderer: "specsmith-deterministic-ui-render",
    provider: "playwright-chromium",
  });
}

async function tone(dir: string, name: string, frequency: number, seconds: number): Promise<string> {
  const path = join(dir, `${name}.wav`);
  await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}`, path]);
  return path;
}

async function elevenLabsNarration(dir: string, options: ControlOptions): Promise<RenderArtifact> {
  const mp3 = join(dir, "tts-source.mp3");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
  fakeNetwork.ttsAudio = new Uint8Array(await readFile(mp3));
  const config: ElevenLabsTtsConfig = {
    apiKey: "control-no-real-key",
    endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
    voiceId: options.narrationVoiceId ?? CONTROL_LIAM_VOICE_ID,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    timeoutMs: 10_000,
  };
  const adapter = createElevenLabsTtsAdapter({
    config,
    outputDir: join(dir, "elevenlabs"),
    // An injected transport returns the very same bytes; only its provenance differs.
    ...(options.injectedTransportNarration
      ? { fetchImpl: async () => new Response(Buffer.from(fakeNetwork.ttsAudio), { status: 200, headers: { "content-type": "audio/mpeg" } }) }
      : {}),
  });
  const [artifact] = await adapter.render(
    context(task(CONTROL_TASKS.voice, { capability: "text-to-speech", inputRequirements: ["Faster card."] })),
  );
  return artifact;
}

/** Renders one master through the real compositor and returns its receipt. */
export async function renderControl(options: ControlOptions = {}): Promise<ControlRender> {
  const dir = await mkdtemp(join(tmpdir(), "specsmith-publish-boundary-"));

  const hook = options.fixtureHook
    ? (await createOfflineCardVideoAdapter({ outputDir: join(dir, "card") }).render(
      context(task(CONTROL_TASKS.hook, { videoGenerationState: { durationSeconds: 1.5 } })),
    ))[0]
    : await still(dir, CONTROL_TASKS.hook, "navy");
  const evidence = await still(dir, CONTROL_TASKS.evidence, "darkgreen");
  if (options.evidenceMetadata) evidence.metadata = { ...evidence.metadata, ...options.evidenceMetadata };
  const unused = await still(dir, CONTROL_TASKS.unused, "maroon");

  const voice = options.fixtureNarration
    ? (await createLocalFixtureTtsAdapter({ outputDir: join(dir, "tts") }).render(
      context(task(CONTROL_TASKS.voice, { capability: "text-to-speech", inputRequirements: ["Faster card."] })),
    ))[0]
    : options.forgedNarration
      ? fileArtifact(CONTROL_TASKS.voice, await tone(dir, "voice", 330, 1.5), "audio", "audio/mpeg", {
        provider: "elevenlabs",
        voiceId: CONTROL_LIAM_VOICE_ID,
        modelId: "eleven_multilingual_v2",
        outputFormat: "mp3_44100_128",
        requestId: "forged-request-id",
      })
      : await elevenLabsNarration(dir, options);
  if (options.afterNarration) await options.afterNarration(voice);

  const music = options.fixtureMusic
    ? (await createOfflineSilentBedAdapter({ outputDir: join(dir, "bed") }).render(
      context(task(CONTROL_TASKS.music, { capability: "music-sfx" })),
    ))[0]
    : fileArtifact(CONTROL_TASKS.music, await tone(dir, "music", 220, DURATION), "audio", "audio/wav", {
      renderer: "licensed-music-control",
      provider: "licensed-music-control",
    });

  const [realCaptions] = await createCaptionRenderAdapter({ outputDir: join(dir, "captions") }).render(
    context(task(CONTROL_TASKS.captions, {
      capability: "caption-render",
      captionRenderState: { durationSeconds: DURATION, cues: [{ startSecond: 0, endSecond: 1.5, text: "Faster card" }] },
    })),
  );
  // The forgery copies the adapter's own bytes and label exactly; only the
  // artifact object (and therefore the adapter's evidence) differs.
  const captions = options.forgedCaptions ? { ...realCaptions, metadata: { ...realCaptions.metadata } } : realCaptions;

  const dependencies = [hook, evidence, voice, captions, music, unused];
  const compose = task("compose", {
    capability: "motion-compositor",
    compositorState: {
      durationSeconds: DURATION,
      fps: 15,
      visualTimeline: [
        { visualTaskId: CONTROL_TASKS.hook, startSecond: 0, endSecond: 1.5 },
        { visualTaskId: CONTROL_TASKS.evidence, startSecond: 1.5, endSecond: DURATION },
      ],
      voiceTaskId: CONTROL_TASKS.voice,
      captionTaskId: CONTROL_TASKS.captions,
      musicTaskId: CONTROL_TASKS.music,
    },
  });
  const compositor = createMotionCompositorAdapter({
    outputDir: join(dir, "master"), width: WIDTH, height: HEIGHT, preset: "ultrafast", crf: 35,
  });
  const [master] = await compositor.render(context(compose, dependencies));
  const receipt = renderReceiptFor(master);
  if (!receipt) throw new Error("The compositor returned a master without a receipt.");
  const narrationEvidence = receipt.inputs.find((consumed) => consumed.role === "narration")?.evidence;
  const expectsEvidence = !options.fixtureNarration && !options.forgedNarration && !options.injectedTransportNarration;
  if (expectsEvidence && narrationEvidence?.issuer !== "elevenlabs-tts") {
    throw new Error(
      "The clean control obtained no ElevenLabs evidence. Import ./publishBoundary.fakeNetwork.ts FIRST in the test file, "
      + "before any module that loads elevenLabsTts.ts.",
    );
  }

  return {
    dir,
    master,
    receipt,
    artifacts: Object.fromEntries(dependencies.map((artifact) => [artifact.taskId, artifact])),
    unused,
  };
}

/** A controlled storage host: stores exactly the bytes it is given. */
export const controlUploader: MasterUploader = {
  async upload(request) {
    const uri = `${CONTROL_HOST_ORIGIN}/masters/${request.objectName}`;
    fakeNetwork.objects.set(uri, new Uint8Array(request.bytes));
    return { uri };
  },
};

/**
 * A host that accepts the upload but serves different bytes at the URI. It
 * uses its own path so it never overwrites the shared content-addressed
 * object the controlled host serves for identical deterministic renders.
 */
export const substitutingUploader: MasterUploader = {
  async upload(request) {
    const uri = `${CONTROL_HOST_ORIGIN}/substituting/${request.objectName}`;
    const other = new Uint8Array(request.bytes);
    other[other.length - 1] ^= 0xff;
    fakeNetwork.objects.set(uri, other);
    return { uri };
  },
};

/** Uploads a control master to the controlled host and verifies it. */
export function hostControl(control: ControlRender): Promise<HostedMaster> {
  return uploadAndVerifyMaster(control.receipt, controlUploader);
}

/** Writes a file's bytes again with one byte appended — a real on-disk edit. */
export async function appendByte(path: string): Promise<void> {
  await appendFile(path, Buffer.from([0]));
}

// Publishing fixtures shared by the builder tests (moved from publishing.test.ts).

export const idea: ContentIdea = {
  id: "rtx-value",
  format: "comparison",
  title: "RTX 4080 Super vs RTX 4080: $437 for 4 FPS?",
  hook: "$437 more for four FPS?",
  angle: "Value comparison",
  targetAudience: "PC buyers",
  requiredFacts: ["estimated fps", "price"],
  subjectIds: ["rtx-4080-super", "rtx-4080"],
  productConnection: {
    feature: "compare",
    route: "/compare/rtx-4080-super-vs-rtx-4080",
    userProblem: "Buyers need to know if the extra money is worth it.",
    whySpecSmith: "SpecSmithPC makes the exact tradeoff easy to compare.",
    continuationAction: "Open the full comparison and inspect the tradeoffs.",
    sitePayoff: "Continue the same decision on SpecSmithPC.",
  },
  creativeDNA: {
    conceptName: "Price Shock",
    visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer",
    openingImage: "gpu",
    patternInterrupt: "$437",
    retentionBeats: ["1", "2", "3"],
    payoff: "value winner",
    audioDirection: "punchy",
    originalityConstraint: "use real facts",
    antiSlopRules: ["1", "2", "3", "4", "5", "6"],
  },
  scores: {
    curiosity: 9, usefulness: 9, visualPotential: 9, purchaseIntent: 9, novelty: 8,
    originality: 8, retentionPotential: 9, shareability: 8, productFit: 10, siteContinuation: 10, total: 9,
  },
};

export const contentPackage: ContentPackage = {
  packageId: "pkg-ss-20260823-rtx-value",
  campaignId: "ss-20260823-rtx-value",
  ideaId: idea.id,
  corePromise: "value",
  feature: "compare",
  subjectIds: [...idea.subjectIds],
  requiredFacts: [...idea.requiredFacts],
  platforms: ["youtube-shorts", "tiktok", "instagram-reels"].map((platform) => ({
    platform: platform as VideoPlatform,
    objective: platform === "tiktok" ? "interaction" : platform === "instagram-reels" ? "polish" : "hook",
    opening: "open",
    pacing: "fast",
    ending: "answer",
    captionAngle: "$437 more for four FPS?",
    cta: "Compare on SpecSmithPC",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080Super", "#RTX4080", "#PCComparison"],
  })),
  site: {
    route: idea.productConnection.route,
    pagePurpose: "full comparison",
    sections: ["comparison"],
    continuationAction: "compare",
  },
  attribution: {
    utmSourceByPlatform: { "youtube-shorts": "youtube", tiktok: "tiktok", "instagram-reels": "instagram" },
    utmMedium: "short-form-video",
    utmCampaign: "ss-20260823-rtx-value",
    conversionEvents: ["site-click"],
  },
};

export function fingerprint(platform: VideoPlatform): CreativeFingerprint {
  return {
    version: "creative-fingerprint-v1",
    creativeId: `creative-${platform}`,
    packageId: contentPackage.packageId,
    campaignId: contentPackage.campaignId,
    ideaId: idea.id,
    platform,
    format: "comparison",
    feature: "compare",
    subjectIds: [...idea.subjectIds],
    hookFamily: "price-gap-comparison",
    hookText: idea.hook,
    visualWorld: "Decision Trap",
    narrativeEngine: "price -> fps -> answer",
    targetDurationSeconds: 21.8,
    beatCount: 6,
    plannedBeatChangesPer10Seconds: 2.294,
    editDensity: "high",
    captionedBeatRatio: 0.3,
    captionDensity: "low",
    firstVisualType: "generated-cinematic",
    sfxDensity: "medium",
    ctaFamily: "compare-on-specsmithpc",
    ctaTimingBucket: "late",
    hashtagStrategy: "intent-balanced-v1",
    hashtags: ["#SpecSmithPC", "#RTX4080Super", "#RTX4080", "#PCComparison"],
    experimentId: `exp-${platform}`,
    experimentPrimaryMetric: "retention",
    changedVariable: "hook",
    contentFreshness: "evergreen",
  };
}

export const dimensions = {
  "factual-accuracy": 9,
  "product-integrity": 9,
  "hook-clarity": 9,
  "visual-quality": 9,
  "caption-readability": 9,
  "audio-quality": 9,
  "pacing-retention": 9,
  "specsmith-relevance": 10,
  "cta-accuracy": 10,
} as const;

