#!/usr/bin/env tsx
/**
 * ONE Liam take of the "20 wins, only 4 FPS apart" Short, approved 2026-10-06.
 *
 * WHAT MUST BE TRUE BEFORE ANY SPEND (assertFpsStory + the shared voice guards):
 *  - SpecSmith's Compare model, recomputed now from the catalogue, still says
 *    what the narration says: both builds share the Ryzen 9 9950X3D; at 1440p
 *    High the RTX 4080 Super leads all 20 games (0 ties, 0 for the RTX 4080);
 *    the estimated averages are 164 vs 160; and each spotlighted game is in
 *    the catalogue under its id and is a Super lead;
 *  - ELEVENLABS_VOICE_ID and the provider's "Liam" are the pinned Liam id;
 *  - the account cannot extend its limit and has the included characters.
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

import { getAverageFps } from "../../../src/lib/compareValue.ts";
import { estimateFpsForBuild } from "../../../src/lib/fps.ts";
import { elevenLabsTtsConfigFromEnv } from "../elevenLabsTts.ts";
import {
  apiBase,
  assertMp3Output,
  assertWithinIncludedAllowance,
  failureDetail,
  MAX_SAMPLE_CHARACTERS,
  parseCharacterCost,
  PREFERRED_VOICE_NAME,
  readSubscription,
  resolveVoice,
  VoiceSampleError,
  type FetchLike,
} from "../elevenLabsVoiceSample.ts";
import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "..", "src", "data");
export const FPS_TAKE_DIR = join(here, "..", "..", "..", "render-output", "fps-20-wins-liam-take");
export const FPS_TAKE_AUDIO = "fps-20-wins-liam.mp3";
export const FPS_TAKE_MANIFEST = "fps-20-wins-liam.json";
export const FPS_TAKE_RAW = "fps-20-wins-liam.response.json";

/**
 * The approved script, written so the numbers are spoken naturally. Captions
 * show the verified digits. Changing a word is a reviewed change to this file.
 */
export const APPROVED_FPS_TEXT =
  "The RTX forty-eighty Super leads all twenty games at fourteen-forty-p High: " +
  "Cyberpunk twenty-seventy-seven, Counter-Strike 2, Call of Duty: Warzone, Baldur's Gate 3. " +
  "Sounds like a blowout. " +
  "But the model estimates one-sixty-four versus one-sixty FPS. " +
  "That's only four FPS apart. " +
  "Model estimates, not measured benchmarks. " +
  "Would you have guessed four?";

/** What the narration claims, and the catalogue ids it rests on. */
export const FPS_STORY = Object.freeze({
  resolution: "1440p",
  preset: "high",
  buildA: { gpu: "rtx4080s", cpu: "r9-9950x3d" },
  buildB: { gpu: "rtx4080", cpu: "r9-9950x3d" },
  games: 20,
  leadsA: 20,
  leadsB: 0,
  ties: 0,
  avgA: 164,
  avgB: 160,
  spotlights: [
    { id: "cyberpunk2077", title: "Cyberpunk 2077" },
    { id: "cs2", title: "Counter-Strike 2" },
    { id: "warzone", title: "Call of Duty: Warzone" },
    { id: "bg3", title: "Baldur's Gate 3" },
  ],
});

type Row = { id: string; name: string };
export interface FpsFigures {
  readonly sameCpu: boolean;
  readonly games: number;
  readonly leadsA: number;
  readonly leadsB: number;
  readonly ties: number;
  readonly avgA: number;
  readonly avgB: number;
  readonly perGame: readonly { id: string; name: string; a: number; b: number }[];
}

/** The Compare model's answer for the story's builds, from the page's own functions. */
export async function fpsFigures(): Promise<FpsFigures> {
  const [gpus, cpus, games] = (await Promise.all(
    ["gpus.json", "cpus.json", "games.json"].map((file) => readFile(join(dataDir, file), "utf8").then(JSON.parse)),
  )) as [Row[], Row[], Row[]];
  const find = (rows: Row[], id: string) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new VoiceSampleError(`${id} is not in the catalogue. Refusing stale narration.`);
    return row;
  };
  const { buildA, buildB, resolution, preset } = FPS_STORY;
  const gpuA = find(gpus, buildA.gpu), cpuA = find(cpus, buildA.cpu), gpuB = find(gpus, buildB.gpu), cpuB = find(cpus, buildB.cpu);
  const perGame = games.map((game) => ({
    id: game.id,
    name: game.name,
    a: estimateFpsForBuild(gpuA as never, cpuA as never, game as never, resolution as never, preset as never).estimated,
    b: estimateFpsForBuild(gpuB as never, cpuB as never, game as never, resolution as never, preset as never).estimated,
  }));
  return {
    sameCpu: cpuA.id === cpuB.id,
    games: perGame.length,
    // Strict counts: a tie is not a lead for either build.
    leadsA: perGame.filter((row) => row.a > row.b).length,
    leadsB: perGame.filter((row) => row.a < row.b).length,
    ties: perGame.filter((row) => row.a === row.b).length,
    avgA: getAverageFps(perGame.map((row) => row.a)),
    avgB: getAverageFps(perGame.map((row) => row.b)),
    perGame,
  };
}

/** Refuses unless every figure the narration speaks is what the model computes. */
export function assertFpsStory(figures: FpsFigures): void {
  const problems: string[] = [];
  if (!figures.sameCpu) problems.push("the two builds no longer share one CPU");
  if (figures.games !== FPS_STORY.games) problems.push(`the catalogue has ${figures.games} games, not ${FPS_STORY.games}`);
  if (figures.leadsA !== FPS_STORY.leadsA || figures.leadsB !== FPS_STORY.leadsB || figures.ties !== FPS_STORY.ties) {
    problems.push(`leads are ${figures.leadsA}/${figures.leadsB} with ${figures.ties} ties, not ${FPS_STORY.leadsA}/${FPS_STORY.leadsB} with ${FPS_STORY.ties}`);
  }
  if (figures.avgA !== FPS_STORY.avgA || figures.avgB !== FPS_STORY.avgB) {
    problems.push(`averages are ${figures.avgA} vs ${figures.avgB}, not ${FPS_STORY.avgA} vs ${FPS_STORY.avgB}`);
  }
  for (const spot of FPS_STORY.spotlights) {
    const row = figures.perGame.find((entry) => entry.id === spot.id);
    if (!row || !row.name.includes(spot.title)) problems.push(`"${spot.title}" is not the catalogue's ${spot.id}`);
    else if (!(row.a > row.b)) problems.push(`"${spot.title}" is not a Super lead`);
  }
  if (problems.length) throw new VoiceSampleError(`The narration no longer matches the Compare model: ${problems.join("; ")}. Refusing to generate.`);
}

export interface FpsTakeResult {
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

export async function generateLiamFpsTake(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string; figures?: FpsFigures } = {}): Promise<FpsTakeResult> {
  assertFpsStory(options.figures ?? (await fpsFigures()));
  const characters = APPROVED_FPS_TEXT.length;
  if (characters > MAX_SAMPLE_CHARACTERS) throw new VoiceSampleError(`The script is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}.`);
  const env = options.env ?? process.env;
  const config = elevenLabsTtsConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  if (config.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("ELEVENLABS_VOICE_ID is not the pinned Liam id.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? FPS_TAKE_DIR;

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
      body: JSON.stringify({ text: APPROVED_FPS_TEXT, model_id: config.modelId }),
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
  await writeFile(join(outputDir, FPS_TAKE_RAW), raw);

  const body = JSON.parse(raw.toString("utf8")) as { audio_base64?: unknown; alignment?: { characters?: unknown } };
  if (typeof body.audio_base64 !== "string" || body.audio_base64.length === 0) {
    throw new VoiceSampleError(`The provider's response has no audio. The raw response is kept at ${FPS_TAKE_RAW}.`);
  }
  const audio = Buffer.from(body.audio_base64, "base64");
  const audioPath = join(outputDir, FPS_TAKE_AUDIO);
  await writeFile(audioPath, audio);
  const sha256 = createHash("sha256").update(audio).digest("hex");
  const chars = body.alignment?.characters;
  const alignmentError = Array.isArray(chars) && chars.join("") === APPROVED_FPS_TEXT ? null : "The provider's timestamps do not spell the text that was sent.";

  const manifest = {
    generatedBy: "elevenlabs-text-to-speech-with-timestamps",
    isFixture: false,
    requestedVoice: PREFERRED_VOICE_NAME,
    voiceUsed: voice.name,
    voiceId: voice.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    text: APPROVED_FPS_TEXT,
    audio: { file: FPS_TAKE_AUDIO, bytes: audio.byteLength, sha256 },
    alignment: alignmentError ? null : body.alignment,
    alignmentError,
    includedCharactersRemainingBefore: subscription.remaining,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCost,
    note: "One Liam take of the approved FPS Short script. Not a publish approval.",
  };
  const manifestPath = join(outputDir, FPS_TAKE_MANIFEST);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { audioPath, manifestPath, bytes: audio.byteLength, sha256, voiceName: voice.name, remainingBefore: subscription.remaining, charactersSent: characters, providerReportedCharacterCost: reportedCost, alignmentError };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  generateLiamFpsTake()
    .then((result) => {
      console.log("Liam take generated (one request).");
      console.log(`  voice used:       ${result.voiceName}`);
      console.log(`  characters sent:  ${result.charactersSent}`);
      console.log(`  provider charge:  ${result.providerReportedCharacterCost ?? "not reported"}`);
      console.log(`  remaining before: ${result.remainingBefore}`);
      console.log(`  audio:            ${result.bytes} bytes, sha256 ${result.sha256}`);
      console.log(`  timestamps:       ${result.alignmentError ?? "spell the approved text"}`);
    })
    .catch((error: unknown) => {
      console.error("LIAM TAKE FAILED — no other voice was tried:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
