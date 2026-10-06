#!/usr/bin/env tsx
/**
 * ONE Liam take of the GPU-upgrade Short ("Which game gets the bigger
 * percentage boost?"), Concept A, attempt 5: the trimmed 314-character
 * script approved for the take (2026-10-06), which fits the unchanged
 * 360-character cap.
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertGpuUpgradeStory + the shared
 * spending guards in voiceSpendGuards.ts, which are unchanged):
 *  - SpecSmith's Compare model, recomputed now from the catalogue, still says
 *    what the narration says: one Ryzen 5 7600 on both builds; at 1440p High
 *    the RTX 4060 -> RTX 5070 upgrade takes Alan Wake 2 from 43 to 65 and
 *    Valorant from 263 to 305 estimated FPS; the estimated boosts are 51% and
 *    16%, computed from those displayed figures;
 *  - each spoken line is the narration of its beat in the approved concept,
 *    with only the figures spelled out for speech;
 *  - ELEVENLABS_VOICE_ID and the provider's "Liam" are the pinned Liam id;
 *  - the text is within MAX_SAMPLE_CHARACTERS, the account cannot extend its
 *    limit, and it has the included characters.
 * Any failure stops before the generation request. There is no fallback voice.
 *
 * ONE REQUEST, with timestamps, so the edit can be timed to Liam's words. The
 * raw response is written to disk before it is parsed. It renders nothing and
 * publishes nothing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import {
  apiBase,
  assertMp3Output,
  assertWithinIncludedAllowance,
  failureDetail,
  liamTakeConfigFromEnv,
  MAX_SAMPLE_CHARACTERS,
  parseCharacterCost,
  PREFERRED_VOICE_NAME,
  readSubscription,
  resolveVoice,
  VoiceSampleError,
  type FetchLike,
} from "../voiceSpendGuards.ts";
import { GPU_UPGRADE_PAIRING, gpuUpgradeFacts, type GpuUpgradeFacts } from "./research.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const GPU_TAKE_DIR = join(here, "..", "..", "..", "render-output", "gpu-upgrade-liam-take");
export const GPU_TAKE_AUDIO = "gpu-upgrade-liam.mp3";
export const GPU_TAKE_MANIFEST = "gpu-upgrade-liam.json";
export const GPU_TAKE_RAW = "gpu-upgrade-liam.response.json";
/** The concept whose beats these lines narrate. */
export const GPU_TAKE_CONCEPT_FILE = join(here, "workflow-percent", "batches", "attempt-5", "01-guess-the-game.json");

/**
 * The approved lines, one per beat, written so the numbers are spoken
 * naturally. `beatNarration` is the beat's narration in the concept, which the
 * captions and checks use; `spoken` is what Liam says. Changing a word is a
 * reviewed change to this file and to the concept.
 */
export const APPROVED_GPU_UPGRADE_LINES = Object.freeze([
  { id: "hook", beatNarration: "Which game gets the bigger percentage boost?",
    spoken: "Which game gets the bigger percentage boost?" },
  { id: "fps-aw", beatNarration: "Alan Wake 2: 43 to 65 estimated FPS.",
    spoken: "Alan Wake Two: forty-three to sixty-five estimated FPS." },
  { id: "fps-val", beatNarration: "Valorant: 263 to 305.",
    spoken: "Valorant: two-sixty-three to three-oh-five." },
  { id: "percent", beatNarration: "That's an estimated 51% boost for Alan Wake 2, and 16% for Valorant.",
    spoken: "That's an estimated fifty-one percent boost for Alan Wake Two, and sixteen percent for Valorant." },
  { id: "explain", beatNarration: "Same upgrade, different gains by game.",
    spoken: "Same upgrade, different gains by game." },
  { id: "ask", beatNarration: "Which game would you upgrade for?",
    spoken: "Which game would you upgrade for?" },
] as const);
export type GpuLineId = (typeof APPROVED_GPU_UPGRADE_LINES)[number]["id"];

/** The one string sent: the spoken lines joined by single spaces. */
export const GPU_TAKE_TEXT = APPROVED_GPU_UPGRADE_LINES.map((line) => line.spoken).join(" ");

/**
 * Each spoken form of a figure, and the digits it stands for. The check below
 * replaces exactly these in the spoken line and requires the beat narration
 * back, so no other word can differ between what is said and what was approved.
 */
export const SPOKEN_FIGURES: readonly (readonly [string, string])[] = [
  ["Alan Wake Two", "Alan Wake 2"],
  ["forty-three", "43"],
  ["sixty-five", "65"],
  ["two-sixty-three", "263"],
  ["three-oh-five", "305"],
  ["fifty-one percent", "51%"],
  ["sixteen percent", "16%"],
];

/** What the narration claims, from the research's own pairing. */
export const GPU_STORY = Object.freeze({
  cpu: "r5-7600", beforeGpu: "rtx4060", afterGpu: "rtx5070", resolution: "1440p", preset: "high",
  gpuHeavy: { name: "Alan Wake 2", before: 43, after: 65, percent: 51 },
  cpuHeavy: { name: "Valorant", before: 263, after: 305, percent: 16 },
});

/** Refuses unless every figure the narration speaks is what the model computes now, and each line is its beat's. */
export function assertGpuUpgradeStory(
  facts: GpuUpgradeFacts = gpuUpgradeFacts(),
  conceptFile = GPU_TAKE_CONCEPT_FILE,
  lines: readonly { readonly spoken: string; readonly beatNarration: string }[] = APPROVED_GPU_UPGRADE_LINES,
): void {
  const problems: string[] = [];
  const pairing = GPU_UPGRADE_PAIRING;
  if (pairing.cpuA !== GPU_STORY.cpu || pairing.cpuB !== GPU_STORY.cpu) problems.push("the two builds no longer share the Ryzen 5 7600");
  if (pairing.gpuA !== GPU_STORY.afterGpu || pairing.gpuB !== GPU_STORY.beforeGpu) problems.push("the pairing is no longer RTX 4060 -> RTX 5070");
  if (pairing.resolution !== GPU_STORY.resolution || pairing.preset !== GPU_STORY.preset) problems.push("the setting is no longer 1440p High");
  for (const [key, expected] of [["gpuHeavy", GPU_STORY.gpuHeavy], ["cpuHeavy", GPU_STORY.cpuHeavy]] as const) {
    const row = facts[key];
    if (row.game !== expected.name) problems.push(`the ${key} game is ${row.game}, not ${expected.name}`);
    if (row.fpsB !== expected.before || row.fpsA !== expected.after) problems.push(`${expected.name} is ${row.fpsB} -> ${row.fpsA}, not ${expected.before} -> ${expected.after}`);
    if (row.percent !== expected.percent || Math.round(((row.fpsA - row.fpsB) / row.fpsB) * 100) !== expected.percent) {
      problems.push(`${expected.name}'s boost is ${row.percent}%, not ${expected.percent}%`);
    }
  }
  // Each spoken line must be its beat's approved narration, figures aside.
  const concept = JSON.parse(readFileSync(conceptFile, "utf8")) as { beats: { narration: string }[] };
  if (concept.beats.length !== lines.length) problems.push(`the concept has ${concept.beats.length} beats, not ${lines.length}`);
  lines.forEach((line, index) => {
    if (concept.beats[index]?.narration !== line.beatNarration) problems.push(`beat ${index + 1}'s narration is not the approved "${line.beatNarration}"`);
    let asDigits: string = line.spoken;
    for (const [spoken, digits] of SPOKEN_FIGURES) asDigits = asDigits.split(spoken).join(digits);
    if (asDigits !== line.beatNarration) problems.push(`line ${index + 1} says "${line.spoken}", which is not "${line.beatNarration}" spoken aloud`);
  });
  if (problems.length) throw new VoiceSampleError(`The narration no longer matches the model or the approved concept: ${problems.join("; ")}. Refusing to generate.`);
}

export interface Alignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

export interface LineTiming {
  readonly id: GpuLineId;
  /** Take seconds when the line's first character starts and its last ends. */
  readonly start: number;
  readonly end: number;
}

/** Where each line starts and ends in the take, from the provider's character timestamps. */
export function lineTimingsFromAlignment(alignment: Alignment): LineTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.join("") !== GPU_TAKE_TEXT) throw new Error("The timestamps do not spell the approved text.");
  if (starts.length !== characters.length || ends.length !== characters.length) throw new Error("The timestamps are not one per character.");
  let offset = 0;
  return APPROVED_GPU_UPGRADE_LINES.map((line) => {
    const first = offset, last = offset + line.spoken.length - 1;
    offset += line.spoken.length + 1;
    const start = starts[first], end = ends[last];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Line ${line.id} has no usable timing.`);
    return { id: line.id, start, end };
  });
}

export interface GpuTakeResult {
  readonly audioPath: string;
  readonly manifestPath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly voiceName: string;
  readonly remainingBefore: number;
  readonly charactersSent: number;
  readonly providerReportedCharacterCost: number | null;
  readonly alignmentError: string | null;
}

export async function generateLiamGpuUpgradeTake(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string; facts?: GpuUpgradeFacts } = {}): Promise<GpuTakeResult> {
  assertGpuUpgradeStory(options.facts);
  const characters = GPU_TAKE_TEXT.length;
  if (characters > MAX_SAMPLE_CHARACTERS) throw new VoiceSampleError(`The script is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}.`);
  const env = options.env ?? process.env;
  const config = liamTakeConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? GPU_TAKE_DIR;

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
      body: JSON.stringify({ text: GPU_TAKE_TEXT, model_id: config.modelId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new VoiceSampleError(`ElevenLabs generation failed with HTTP ${response.status}.${await failureDetail(response)} No other voice is tried.`);
  const reportedCost = parseCharacterCost(response.headers.get("character-cost"));

  // Keep the raw response before reading it: whatever happens next, the take exists.
  const raw = Buffer.from(await response.arrayBuffer());
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, GPU_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: Alignment };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${GPU_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, GPU_TAKE_AUDIO);
  await writeFile(audioPath, audio);
  const sha256 = createHash("sha256").update(audio).digest("hex");
  let alignmentError: string | null = null;
  let lines: LineTiming[] | null = null;
  try {
    if (!body.alignment) throw new Error("The response has no character timestamps.");
    lines = lineTimingsFromAlignment(body.alignment);
  } catch (error) {
    alignmentError = error instanceof Error ? error.message : String(error);
  }

  const manifest = {
    generatedBy: "elevenlabs-text-to-speech-with-timestamps",
    isFixture: false,
    requestedVoice: PREFERRED_VOICE_NAME,
    voiceUsed: voice.name,
    voiceId: voice.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    text: GPU_TAKE_TEXT,
    textSha256: createHash("sha256").update(GPU_TAKE_TEXT).digest("hex"),
    lines: APPROVED_GPU_UPGRADE_LINES,
    audio: { file: GPU_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    alignment: alignmentError ? null : body.alignment,
    alignmentError,
    lineTimings: lines,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    note: "One Liam take of the approved GPU-upgrade Short script. Not a publish approval.",
  };
  const manifestPath = join(outputDir, GPU_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name, remainingBefore: subscription.remaining, charactersSent: characters, providerReportedCharacterCost: reportedCost, alignmentError };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  generateLiamGpuUpgradeTake()
    .then((result) => {
      console.log("Liam take generated (one request).");
      console.log(`  voice used:       ${result.voiceName}`);
      console.log(`  characters sent:  ${result.charactersSent}`);
      console.log(`  provider charge:  ${result.providerReportedCharacterCost ?? "not reported"}`);
      console.log(`  remaining before: ${result.remainingBefore}`);
      console.log(`  audio:            ${result.bytes} bytes, sha256 ${result.sha256}`);
      console.log(`  timestamps:       ${result.alignmentError ?? "spell the approved text"}`);
      if (result.alignmentError) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error("LIAM TAKE FAILED — no other voice was tried:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
