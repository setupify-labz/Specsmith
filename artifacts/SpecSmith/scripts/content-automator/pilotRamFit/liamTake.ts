#!/usr/bin/env tsx
/**
 * ONE Liam take of the RAM-fit pilot's five narration lines, for review.
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertApprovedRamFitScript + the shared
 * voice-sample guards, used unchanged):
 *  - SpecSmith's catalog and Builder checker still support every claim the
 *    video makes (facts.ts: the Builder flags DDR4 on the DDR5 board as a
 *    certain error, its fix names DDR5 memory and a DDR4 motherboard, and it
 *    passes both fixes);
 *  - the five lines the video would speak are exactly the approved text;
 *  - ELEVENLABS_VOICE_ID and the provider's "Liam" are the pinned Liam id;
 *  - the account cannot extend its limit and has the included characters.
 * Any failure stops before the generation request. There is no fallback voice.
 *
 * ONE REQUEST, with timestamps, so Liam reads the lines as one piece and the
 * cut can be timed to his delivery. The raw response is written to disk
 * before it is parsed, so nothing paid is lost to a parse error.
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
import { ramFitFacts } from "./facts.ts";
import { pilotScenes, type SceneId } from "./storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const RAM_FIT_TAKE_DIR = join(here, "..", "..", "..", "render-output", "ram-fit-liam-take");
export const RAM_FIT_TAKE_AUDIO = "ram-fit-liam.mp3";
export const RAM_FIT_TAKE_MANIFEST = "ram-fit-liam.json";
export const RAM_FIT_TAKE_RAW = "ram-fit-liam.response.json";

/** The approved script, word for word, in order. Changing it is a reviewed change to this file. */
export const APPROVED_RAM_FIT_LINES: readonly { id: SceneId; text: string }[] = Object.freeze([
  { id: "fail", text: "DDR4 RAM won't fit a DDR5 slot." },
  { id: "notch", text: "The notch doesn't line up." },
  { id: "choice", text: "Use DDR5 RAM here, or a DDR4 board compatible with your CPU." },
  { id: "payoff", text: "SpecSmith catches it." },
  { id: "cta", text: "Check yours at SpecSmith." },
]);

export const RAM_FIT_TAKE_TEXT = APPROVED_RAM_FIT_LINES.map((line) => line.text).join(" ");

/**
 * Refuses, before any spend, unless the catalog and the Builder still support
 * the video and the video would say exactly the approved lines.
 */
export function assertApprovedRamFitScript(): void {
  let facts;
  try {
    facts = ramFitFacts();
  } catch (error) {
    throw new VoiceSampleError(`The Builder no longer supports this video: ${error instanceof Error ? error.message : String(error)} Refusing to narrate it.`);
  }
  const lines = pilotScenes(facts).map((scene) => ({ id: scene.id, text: scene.narration }));
  if (JSON.stringify(lines) !== JSON.stringify(APPROVED_RAM_FIT_LINES)) {
    throw new VoiceSampleError("The video's narration is not the approved script word for word. Refusing to generate.");
  }
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface LineTiming {
  id: SceneId;
  /** Seconds into the take where the line's first character starts. */
  start: number;
  /** Seconds into the take where its last character ends. */
  end: number;
}

/**
 * Each line's start and end in the take, from the provider's character
 * timestamps. Refuses unless the timestamps spell exactly the text sent.
 */
export function lineTimingsFromAlignment(alignment: Alignment, lines: readonly { id: SceneId; text: string }[] = APPROVED_RAM_FIT_LINES): LineTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment ?? ({} as Alignment);
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

export interface RamFitTakeResult {
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

export async function generateLiamRamFitTake(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string } = {}): Promise<RamFitTakeResult> {
  assertApprovedRamFitScript();
  const env = options.env ?? process.env;
  const config = elevenLabsTtsConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? RAM_FIT_TAKE_DIR;
  const characters = RAM_FIT_TAKE_TEXT.length;

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
      body: JSON.stringify({ text: RAM_FIT_TAKE_TEXT, model_id: config.modelId }),
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
  await writeFile(join(outputDir, RAM_FIT_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: unknown };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${RAM_FIT_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, RAM_FIT_TAKE_AUDIO);
  await writeFile(audioPath, audio);
  const sha256 = createHash("sha256").update(audio).digest("hex");

  let lineTimings: LineTiming[] | null = null;
  let alignmentError: string | null = null;
  try {
    lineTimings = lineTimingsFromAlignment(body.alignment as Alignment);
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
    text: RAM_FIT_TAKE_TEXT,
    lines: APPROVED_RAM_FIT_LINES,
    audio: { file: RAM_FIT_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    lineTimings,
    // Kept so captions and visual beats can be timed to the words, not just the lines.
    alignment: alignmentError ? null : body.alignment,
    alignmentError,
    subscriptionTier: subscription.tier,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    toppedUp: false,
    note: "One Liam take of the RAM-fit pilot's approved five lines. Not a publish approval; nothing was listened to by automation.",
  };
  const manifestPath = join(outputDir, RAM_FIT_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name,
    remainingBefore: subscription.remaining, tier: subscription.tier, charactersSent: characters,
    providerReportedCharacterCost: reportedCost, lineTimings, alignmentError,
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  generateLiamRamFitTake()
    .then((result) => {
      console.log("Liam take generated (one request).");
      console.log(`  voice used:       ${result.voiceName}`);
      console.log(`  characters sent:  ${result.charactersSent}`);
      console.log(`  provider charge:  ${result.providerReportedCharacterCost === null ? "not reported" : `${result.providerReportedCharacterCost} characters`}`);
      console.log(`  remaining before: ${result.remainingBefore} on tier ${result.tier}`);
      console.log(`  audio:            ${result.audioPath} (${result.bytes} bytes, sha256 ${result.sha256})`);
      if (result.lineTimings) {
        for (const timing of result.lineTimings) {
          console.log(`  line ${timing.id.padEnd(7)} ${timing.start.toFixed(3)}-${timing.end.toFixed(3)}s (${(timing.end - timing.start).toFixed(3)}s)`);
        }
      } else {
        console.log(`  line timings:     unavailable (${result.alignmentError}); the render will refuse this take`);
      }
    })
    .catch((error: unknown) => {
      console.error("LIAM TAKE FAILED — no other voice was tried:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
