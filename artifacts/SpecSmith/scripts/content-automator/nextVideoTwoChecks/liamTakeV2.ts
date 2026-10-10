#!/usr/bin/env tsx
/**
 * ONE Liam take of the "New PC not working?" two-checks Short: the second, 171-character
 * script the owner approved word for word on 2026-10-10 (scriptV2.ts).
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertTwoChecksV2Script + the shared
 * spending guards in voiceSpendGuards.ts, which are unchanged):
 *  - the lines, joined, are exactly the approved text, in plain ASCII;
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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { APPROVED_TWO_CHECKS_V2_LINES, APPROVED_TWO_CHECKS_V2_TEXT, TWO_CHECKS_V2_TAKE_TEXT, type TwoChecksV2LineId } from "./scriptV2.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const TWO_CHECKS_V2_TAKE_DIR = join(here, "..", "..", "..", "render-output", "two-checks-v2-liam-take");
export const TWO_CHECKS_V2_TAKE_AUDIO = "two-checks-v2-liam.mp3";
export const TWO_CHECKS_V2_TAKE_MANIFEST = "two-checks-v2-liam.json";
export const TWO_CHECKS_V2_TAKE_RAW = "two-checks-v2-liam.response.json";
/** SHA-256 of the approved text, pinned so any edit to the words is visible in review. */
export const APPROVED_TEXT_SHA256 = "5fd951ad6408b0cb1e1d51e373512f6a2159a704780860ed145d92f7b9b0f7dc";

/** Refuses unless the lines are exactly the approved words. */
export function assertTwoChecksV2Script(lines: readonly { readonly spoken: string }[] = APPROVED_TWO_CHECKS_V2_LINES): void {
  const text = lines.map((line) => line.spoken).join(" ");
  const problems: string[] = [];
  if (text !== APPROVED_TWO_CHECKS_V2_TEXT) problems.push(`the lines say "${text}", not the approved "${APPROVED_TWO_CHECKS_V2_TEXT}"`);
  if (createHash("sha256").update(text).digest("hex") !== APPROVED_TEXT_SHA256) problems.push("the text's SHA-256 is not the approved one");
  if (![...text].every((char) => char.charCodeAt(0) < 128)) problems.push("the text is not plain ASCII");
  if (problems.length) throw new VoiceSampleError(`The narration is not the approved script: ${problems.join("; ")}. Refusing to generate.`);
}

export interface Alignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}
export interface LineTiming { readonly id: TwoChecksV2LineId; readonly start: number; readonly end: number }

/** Where each line starts and ends in the take, from the provider's character timestamps. */
export function lineTimingsFromAlignment(alignment: Alignment): LineTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.join("") !== TWO_CHECKS_V2_TAKE_TEXT) throw new Error("The timestamps do not spell the approved text.");
  if (starts.length !== characters.length || ends.length !== characters.length) throw new Error("The timestamps are not one per character.");
  let offset = 0;
  return APPROVED_TWO_CHECKS_V2_LINES.map((line) => {
    const first = offset, last = offset + line.spoken.length - 1;
    offset += line.spoken.length + 1;
    const start = starts[first], end = ends[last];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Line ${line.id} has no usable timing.`);
    return { id: line.id, start, end };
  });
}

export interface TwoChecksV2TakeResult {
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

export async function generateLiamTwoChecksV2Take(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string; lines?: readonly { readonly spoken: string }[] } = {}): Promise<TwoChecksV2TakeResult> {
  assertTwoChecksV2Script(options.lines);
  const characters = TWO_CHECKS_V2_TAKE_TEXT.length;
  if (characters > MAX_SAMPLE_CHARACTERS) throw new VoiceSampleError(`The script is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}.`);
  const env = options.env ?? process.env;
  const config = liamTakeConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? TWO_CHECKS_V2_TAKE_DIR;

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
      body: JSON.stringify({ text: TWO_CHECKS_V2_TAKE_TEXT, model_id: config.modelId }),
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
  await writeFile(join(outputDir, TWO_CHECKS_V2_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: Alignment };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${TWO_CHECKS_V2_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, TWO_CHECKS_V2_TAKE_AUDIO);
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
    text: TWO_CHECKS_V2_TAKE_TEXT,
    textSha256: createHash("sha256").update(TWO_CHECKS_V2_TAKE_TEXT).digest("hex"),
    lines: APPROVED_TWO_CHECKS_V2_LINES,
    audio: { file: TWO_CHECKS_V2_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    alignment: alignmentError ? null : body.alignment,
    alignmentError,
    lineTimings: lines,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    note: "One Liam take of the second approved two-checks Short script. Not a publish approval.",
  };
  const manifestPath = join(outputDir, TWO_CHECKS_V2_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name, remainingBefore: subscription.remaining, charactersSent: characters, providerReportedCharacterCost: reportedCost, alignmentError };
}

/**
 * The ONE approved v2 take, pinned here so that replacing the saved audio and
 * its manifest together (another Liam rendering, new timestamps) is refused.
 * Run 38022470641.
 */
export const APPROVED_TAKE: TakePin | null = Object.freeze({
  audioSha256: "9893c21bab90ba2899ded254c1e7fc20453a9ee2a53e5ab944f25ec0d445a796",
  /** SHA-256 of JSON.stringify(manifest.alignment): the provider's character timestamps. */
  alignmentSha256: "33e7e5a2873be0d4aa9cf37d932a056c1d8cb674f5f1ce4f4d0db8cf87f254f1",
});
export interface TakePin { readonly audioSha256: string; readonly alignmentSha256: string }

export interface LoadedTwoChecksV2Take {
  readonly audioPath: string;
  readonly sha256: string;
  readonly lineTimings: readonly LineTiming[];
  readonly manifest: Record<string, unknown>;
}

/**
 * Loads a saved take, refusing one whose bytes, text, voice or timings are not
 * the approved take's. `pin` defaults to the approved take; tests pass their
 * own fixture take's pin, and the production cut never does.
 */
export async function loadTwoChecksV2Take(dir: string, pin: TakePin | null = APPROVED_TAKE): Promise<LoadedTwoChecksV2Take> {
  if (pin === null) throw new Error("No two-checks v2 take is pinned yet; refusing to load one.");
  const manifest = JSON.parse(await readFile(join(dir, TWO_CHECKS_V2_TAKE_MANIFEST), "utf8")) as Record<string, unknown> & {
    text: string; isFixture: boolean; voiceId: string; audio: { file: string; sha256: string }; alignment: Alignment | null;
  };
  if (manifest.isFixture !== false) throw new Error("The saved take is a fixture, not a generated take.");
  if (manifest.text !== APPROVED_TWO_CHECKS_V2_TEXT) throw new Error("The saved take is not of the approved text.");
  if (manifest.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new Error("The saved take is not in the pinned Liam voice.");
  const audioPath = join(dir, manifest.audio.file);
  const sha256 = createHash("sha256").update(await readFile(audioPath)).digest("hex");
  if (sha256 !== manifest.audio.sha256) throw new Error("The saved audio's bytes do not match its manifest.");
  if (sha256 !== pin.audioSha256) throw new Error("The saved audio is not the approved take.");
  if (!manifest.alignment) throw new Error("The saved take has no timestamps to time the edit to.");
  if (createHash("sha256").update(JSON.stringify(manifest.alignment)).digest("hex") !== pin.alignmentSha256) {
    throw new Error("The saved timestamps are not the approved take's.");
  }
  return { audioPath, sha256, lineTimings: lineTimingsFromAlignment(manifest.alignment), manifest };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  generateLiamTwoChecksV2Take()
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
