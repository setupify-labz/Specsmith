#!/usr/bin/env tsx
/**
 * ONE Liam take of the GPU race draft's five narration lines, for review.
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertApprovedRaceScript + the shared
 * voice-sample guards):
 *  - the builds and setting are the approved ones, and Compare's own functions
 *    still compute the approved figures (1440p High: 164 vs 160, 20 of 20
 *    modelled leads, 0 ties);
 *  - the five lines the draft would speak are exactly the approved text, and
 *    every figure each line says is the figure it should say;
 *  - ELEVENLABS_VOICE_ID and the provider's "Liam" are the pinned Liam id;
 *  - the account cannot extend its limit and has the included characters.
 * Any failure stops before the generation request. There is no fallback voice.
 *
 * ONE REQUEST. The five lines are sent as one take, so Liam reads them as one
 * piece. The provider's character timestamps say where each line starts and
 * ends, so the draft can be cut to the real delivery.
 *
 * NOTHING PAID IS LOST TO A PARSE ERROR. The provider's raw response is
 * written to disk before it is parsed; if the timestamps cannot be read the
 * audio is still kept, the failure is recorded, and the draft falls back to
 * measuring pauses in the audio itself.
 *
 * It renders nothing and publishes nothing.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { elevenLabsTtsConfigFromEnv } from "../elevenLabsTts.ts";
import {
  apiBase,
  assertMp3Output,
  assertWithinIncludedAllowance,
  failureDetail,
  parseCharacterCost,
  PREFERRED_VOICE_NAME,
  readSubscription,
  resolveVoice,
  VoiceSampleError,
  type FetchLike,
} from "../elevenLabsVoiceSample.ts";
import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { spokenFigures } from "../spokenWords.ts";
import { RACE_BUILDS, RACE_SETTING, raceData } from "./raceData.ts";
import { narrationLines, type LineId } from "./timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const LIAM_TAKE_DIR = join(here, "..", "..", "..", "render-output", "liam-take");
export const LIAM_TAKE_AUDIO = "gpu-race-liam.mp3";
export const LIAM_TAKE_MANIFEST = "gpu-race-liam.json";
export const LIAM_TAKE_RAW = "gpu-race-liam.response.json";

/** The approved script, word for word, in order. Changing it is a reviewed change to this file. */
export const APPROVED_RACE_LINES: readonly { id: LineId; text: string }[] = Object.freeze([
  { id: "matchup", text: "Forty-eighty Super versus forty-eighty." },
  { id: "flips", text: "Game after game, the Super takes the lead." },
  { id: "leads", text: "Twenty of twenty modelled leads." },
  { id: "average", text: "Yet on average, one sixty-four to one sixty." },
  { id: "gap", text: "Just four FPS apart." },
]);

/** The figures the approved script states, as Compare computed them when it was approved. */
export const APPROVED_RACE_FIGURES = Object.freeze({
  resolution: "1440p", preset: "high", avgA: 164, avgB: 160, leadsA: 20, leadsB: 0, ties: 0, games: 20,
} as const);

export const LIAM_TAKE_TEXT = APPROVED_RACE_LINES.map((line) => line.text).join(" ");

/**
 * Refuses, before any spend, unless the draft would say exactly the approved
 * lines about exactly the approved builds, and Compare still computes the
 * figures those lines state.
 */
export async function assertApprovedRaceScript(): Promise<void> {
  const builds = JSON.stringify(RACE_BUILDS);
  if (builds !== JSON.stringify({ a: { gpu: "rtx4080s", cpu: "r9-9950x3d" }, b: { gpu: "rtx4080", cpu: "r9-9950x3d" } })) {
    throw new VoiceSampleError(`The race builds changed (${builds}). Refusing to narrate a script approved for other builds.`);
  }
  if (RACE_SETTING.resolution !== "1440p" || RACE_SETTING.preset !== "high") {
    throw new VoiceSampleError("The race setting is no longer 1440p High. Refusing stale narration.");
  }
  const { figures } = await raceData();
  for (const [key, value] of Object.entries(APPROVED_RACE_FIGURES)) {
    const actual = figures[key as keyof typeof figures];
    if (actual !== value) {
      throw new VoiceSampleError(`Compare now computes ${key} ${actual}; the approved script states ${value}. Refusing stale narration.`);
    }
  }
  const lines = narrationLines(figures);
  if (JSON.stringify(lines) !== JSON.stringify(APPROVED_RACE_LINES)) {
    throw new VoiceSampleError("The draft's narration is not the approved script word for word. Refusing to generate.");
  }
  const outright = figures.leadsA - figures.ties;
  const expected: Record<LineId, number[]> = {
    matchup: [], flips: [], leads: [outright, figures.games], average: [figures.avgA, figures.avgB], gap: [figures.avgA - figures.avgB],
  };
  for (const line of lines) {
    const said = spokenFigures(line.text);
    if (JSON.stringify(said) !== JSON.stringify(expected[line.id])) {
      throw new VoiceSampleError(`The "${line.id}" line says ${JSON.stringify(said)}; the figures give ${JSON.stringify(expected[line.id])}.`);
    }
  }
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface LineTiming {
  id: LineId;
  /** Seconds into the take where the line's first character starts. */
  start: number;
  /** Seconds into the take where its last character ends. */
  end: number;
}

/**
 * Each line's start and end in the take, from the provider's character
 * timestamps. Refuses unless the timestamps spell exactly the text sent.
 */
export function lineTimingsFromAlignment(alignment: Alignment, lines: readonly { id: LineId; text: string }[]): LineTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)
    || characters.length !== starts.length || characters.length !== ends.length) {
    throw new VoiceSampleError("The provider's timestamps are not three arrays of one length.");
  }
  const text = lines.map((line) => line.text).join(" ");
  if (characters.join("") !== text) throw new VoiceSampleError("The provider's timestamps do not spell the text that was sent.");
  const timings: LineTiming[] = [];
  let offset = 0;
  for (const line of lines) {
    const first = offset;
    const last = offset + line.text.length - 1;
    const start = starts[first];
    const end = ends[last];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new VoiceSampleError(`The provider's timestamps for the "${line.id}" line are not a forward span.`);
    }
    timings.push({ id: line.id, start, end });
    offset = last + 2; // the joining space
  }
  timings.slice(1).forEach((timing, index) => {
    if (timing.start < timings[index].end - 0.05) throw new VoiceSampleError("The provider's line timestamps overlap.");
  });
  return timings;
}

export interface LiamTakeResult {
  audioPath: string;
  manifestPath: string;
  bytes: number;
  sha256: string;
  voiceName: string;
  remainingBefore: number;
  tier: string;
  charactersSent: number;
  providerReportedCharacterCost: number | null;
  lineTimings: LineTiming[] | null;
  alignmentError: string | null;
}

export async function generateLiamRaceTake(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string } = {}): Promise<LiamTakeResult> {
  await assertApprovedRaceScript();
  const env = options.env ?? process.env;
  const config = elevenLabsTtsConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? LIAM_TAKE_DIR;
  const characters = LIAM_TAKE_TEXT.length;

  const subscription = await readSubscription(config, fetchImpl);
  assertWithinIncludedAllowance(subscription, characters);
  const voice = await resolveVoice(config, fetchImpl);

  // The one paid request.
  const url = new URL(`${apiBase(config)}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps`);
  url.searchParams.set("output_format", config.outputFormat);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text: LIAM_TAKE_TEXT, model_id: config.modelId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new VoiceSampleError(`ElevenLabs generation failed with HTTP ${response.status}.${await failureDetail(response)} No other voice is tried.`);
  }
  const reportedCost = parseCharacterCost(response.headers.get("character-cost"));

  // Keep the raw response before reading it: whatever happens next, the take exists.
  const raw = Buffer.from(await response.arrayBuffer());
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, LIAM_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: unknown };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${LIAM_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, LIAM_TAKE_AUDIO);
  await writeFile(audioPath, audio);
  const sha256 = createHash("sha256").update(audio).digest("hex");

  let lineTimings: LineTiming[] | null = null;
  let alignmentError: string | null = null;
  try {
    lineTimings = lineTimingsFromAlignment(body.alignment as Alignment, APPROVED_RACE_LINES);
  } catch (error) {
    alignmentError = error instanceof Error ? error.message : String(error);
  }

  const manifest = {
    generatedBy: "elevenlabs-text-to-speech-with-timestamps",
    isFixture: false,
    isPaidProvider: true,
    requestedVoice: PREFERRED_VOICE_NAME,
    voiceUsed: voice.name,
    voiceId: voice.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    text: LIAM_TAKE_TEXT,
    lines: APPROVED_RACE_LINES,
    figures: APPROVED_RACE_FIGURES,
    audio: { file: LIAM_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    lineTimings,
    alignmentError,
    subscriptionTier: subscription.tier,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    toppedUp: false,
    note: "One Liam take of the GPU race draft's approved five lines. Not a publish approval; nothing was listened to by automation.",
  };
  const manifestPath = join(outputDir, LIAM_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name,
    remainingBefore: subscription.remaining, tier: subscription.tier, charactersSent: characters,
    providerReportedCharacterCost: reportedCost, lineTimings, alignmentError,
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  generateLiamRaceTake()
    .then((result) => {
      console.log("Liam take generated (one request).");
      console.log(`  voice used:       ${result.voiceName}`);
      console.log(`  characters sent:  ${result.charactersSent}`);
      console.log(`  provider charge:  ${result.providerReportedCharacterCost === null ? "not reported" : `${result.providerReportedCharacterCost} characters`}`);
      console.log(`  remaining before: ${result.remainingBefore} on tier ${result.tier}`);
      console.log(`  audio:            ${result.audioPath} (${result.bytes} bytes, sha256 ${result.sha256})`);
      if (result.lineTimings) {
        for (const timing of result.lineTimings) {
          console.log(`  line ${timing.id.padEnd(8)} ${timing.start.toFixed(3)}-${timing.end.toFixed(3)}s (${(timing.end - timing.start).toFixed(3)}s)`);
        }
      } else {
        console.log(`  line timings:     unavailable (${result.alignmentError}); the render will measure pauses in the audio`);
      }
    })
    .catch((error: unknown) => {
      console.error("LIAM TAKE FAILED — no other voice was tried:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
