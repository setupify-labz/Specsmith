#!/usr/bin/env tsx
/**
 * ONE Liam take of the "PC won't turn on?" Short: the 66-character script the
 * owner approved word for word on 2026-10-09 (script.ts).
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertPowerSwitchScript + the shared
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
import { APPROVED_POWER_SWITCH_LINES, APPROVED_POWER_SWITCH_TEXT, POWER_SWITCH_TAKE_TEXT, type PowerSwitchLineId } from "./script.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const POWER_SWITCH_TAKE_DIR = join(here, "..", "..", "..", "render-output", "power-switch-liam-take");
export const POWER_SWITCH_TAKE_AUDIO = "power-switch-liam.mp3";
export const POWER_SWITCH_TAKE_MANIFEST = "power-switch-liam.json";
export const POWER_SWITCH_TAKE_RAW = "power-switch-liam.response.json";
/** SHA-256 of the approved text, pinned so any edit to the words is visible in review. */
export const APPROVED_TEXT_SHA256 = "0aa60d73f3aef3529629b1dab8b8d4d63d1adc21b97d194531f4df4366554c66";

/** Refuses unless the lines are exactly the approved words. */
export function assertPowerSwitchScript(lines: readonly { readonly spoken: string }[] = APPROVED_POWER_SWITCH_LINES): void {
  const text = lines.map((line) => line.spoken).join(" ");
  const problems: string[] = [];
  if (text !== APPROVED_POWER_SWITCH_TEXT) problems.push(`the lines say "${text}", not the approved "${APPROVED_POWER_SWITCH_TEXT}"`);
  if (createHash("sha256").update(text).digest("hex") !== APPROVED_TEXT_SHA256) problems.push("the text's SHA-256 is not the approved one");
  if (![...text].every((char) => char.charCodeAt(0) < 128)) problems.push("the text is not plain ASCII");
  if (problems.length) throw new VoiceSampleError(`The narration is not the approved script: ${problems.join("; ")}. Refusing to generate.`);
}

export interface Alignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}
export interface LineTiming { readonly id: PowerSwitchLineId; readonly start: number; readonly end: number }

/** Where each line starts and ends in the take, from the provider's character timestamps. */
export function lineTimingsFromAlignment(alignment: Alignment): LineTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.join("") !== POWER_SWITCH_TAKE_TEXT) throw new Error("The timestamps do not spell the approved text.");
  if (starts.length !== characters.length || ends.length !== characters.length) throw new Error("The timestamps are not one per character.");
  let offset = 0;
  return APPROVED_POWER_SWITCH_LINES.map((line) => {
    const first = offset, last = offset + line.spoken.length - 1;
    offset += line.spoken.length + 1;
    const start = starts[first], end = ends[last];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Line ${line.id} has no usable timing.`);
    return { id: line.id, start, end };
  });
}

export interface PowerSwitchTakeResult {
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

export async function generateLiamPowerSwitchTake(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string; lines?: readonly { readonly spoken: string }[] } = {}): Promise<PowerSwitchTakeResult> {
  assertPowerSwitchScript(options.lines);
  const characters = POWER_SWITCH_TAKE_TEXT.length;
  if (characters > MAX_SAMPLE_CHARACTERS) throw new VoiceSampleError(`The script is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}.`);
  const env = options.env ?? process.env;
  const config = liamTakeConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? POWER_SWITCH_TAKE_DIR;

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
      body: JSON.stringify({ text: POWER_SWITCH_TAKE_TEXT, model_id: config.modelId }),
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
  await writeFile(join(outputDir, POWER_SWITCH_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: Alignment };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${POWER_SWITCH_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, POWER_SWITCH_TAKE_AUDIO);
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
    text: POWER_SWITCH_TAKE_TEXT,
    textSha256: createHash("sha256").update(POWER_SWITCH_TAKE_TEXT).digest("hex"),
    lines: APPROVED_POWER_SWITCH_LINES,
    audio: { file: POWER_SWITCH_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    alignment: alignmentError ? null : body.alignment,
    alignmentError,
    lineTimings: lines,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    note: "One Liam take of the approved power-switch Short script. Not a publish approval.",
  };
  const manifestPath = join(outputDir, POWER_SWITCH_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name, remainingBefore: subscription.remaining, charactersSent: characters, providerReportedCharacterCost: reportedCost, alignmentError };
}

/**
 * The ONE approved take, pinned here so that replacing the saved audio and its
 * manifest together (another Liam rendering, new timestamps) is refused: the
 * manifest beside the take is not trusted to vouch for itself. Run 37992618639.
 */
export const APPROVED_TAKE = Object.freeze({
  audioSha256: "1aabe1884ccbe2f51aba32b0de310f6eb7ffaad2c8ad94facfc3495e70d20b85",
  /** SHA-256 of JSON.stringify(manifest.alignment): the provider's character timestamps. */
  alignmentSha256: "ed4736402ea7936cb2aebe17926487c17f84a143abcb87e05b57dc782ee2d123",
});
export interface TakePin { readonly audioSha256: string; readonly alignmentSha256: string }

export interface LoadedPowerSwitchTake {
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
export async function loadPowerSwitchTake(dir: string, pin: TakePin = APPROVED_TAKE): Promise<LoadedPowerSwitchTake> {
  const manifest = JSON.parse(await readFile(join(dir, POWER_SWITCH_TAKE_MANIFEST), "utf8")) as Record<string, unknown> & {
    text: string; isFixture: boolean; voiceId: string; audio: { file: string; sha256: string }; alignment: Alignment | null;
  };
  if (manifest.isFixture !== false) throw new Error("The saved take is a fixture, not a generated take.");
  if (manifest.text !== APPROVED_POWER_SWITCH_TEXT) throw new Error("The saved take is not of the approved text.");
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
  generateLiamPowerSwitchTake()
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
