#!/usr/bin/env tsx
/**
 * One exact Compare narration with reviewed Liam, for human review.
 *
 * WHAT THIS IS FOR
 *
 * The offline storyboard uses an espeak-ng fixture, which sounds robotic.
 * This produces the reviewed Compare script with Liam once and stops.
 *
 * WHAT THIS WILL NOT DO
 *
 * - It will NOT fall back to the espeak fixture. If ElevenLabs generation
 *   fails for any reason, this exits non-zero with the reason. A fixture voice
 *   silently standing in for a paid provider would make the sample a lie about
 *   what the provider sounds like.
 * - It will NOT spend beyond the included allowance. It reads the subscription
 *   first, refuses if the request would exceed the remaining included
 *   characters, and refuses outright if the account is configured to extend
 *   (top up) past its limit.
 * - It will NOT print, log or persist the API key.
 * - It renders no video and publishes nothing.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { elevenLabsTtsConfigFromEnv, type ElevenLabsTtsConfig } from "./elevenLabsTts.ts";
import { REVIEWED_LIAM_VOICE } from "./liamVoice.ts";
import { COMPARE_IDEA } from "./compareIdeaFixture.ts";
import { spokenFigures } from "./spokenWords.ts";
import {
  COMPARE_VIDEO_BEATS,
  COMPARE_VIDEO_BUILDS,
  COMPARE_VIDEO_NARRATION,
  compareCaptureSettings,
  type CompareBeatFigures,
} from "./compareVideoScript.ts";
import { buildContentPackage } from "./contentPackage.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { estimateFpsForBuild } from "../../src/lib/fps.ts";
import { getAverageFps } from "../../src/lib/compareValue.ts";

const here = dirname(fileURLToPath(import.meta.url));

export const VOICE_SAMPLE_OUTPUT_DIR = join(here, "..", "..", "render-output", "voice-sample");

/** The requested voice. Falls back only with a loud, recorded label. */
export const PREFERRED_VOICE_NAME = "Liam";

/**
 * The narration of the Compare video this branch renders: RTX 4080 Super vs
 * RTX 4080, both on a Ryzen 9 9950X3D, 24 seconds. It is the script in
 * compareVideoScript.ts, whose every beat also drives that beat's caption and
 * captured Compare setting, so voice, captions and pictures say one thing.
 *
 * Pinned here as the literal a person approved. The check below refuses if the
 * video's script, its captures or any figure it states has moved away from it.
 */
export const SAMPLE_TEXT =
  "Forty-eighty Super, or plain forty-eighty? " +
  "Same CPU. Super build: twenty of twenty modelled leads. " +
  "Model estimates, not measured benchmarks of these exact systems. " +
  "The catch: one sixty-four to one sixty at fourteen-forty. " +
  "Four-K Ultra: seventy-nine to seventy-seven. " +
  "A few frames apart. Try your games in SpecSmith Compare.";

/** One reviewed narration, not an arbitrary script supplied at dispatch time. */
export const MAX_SAMPLE_CHARACTERS = 360;

export function assertMp3Output(config: ElevenLabsTtsConfig): void {
  if (!config.outputFormat.startsWith("mp3_")) {
    throw new VoiceSampleError("This review writes an .mp3 artifact and requires an mp3_* ElevenLabs output format.");
  }
}

type Row = Record<string, unknown>;

/** The video's youtube-shorts storyboard and plan, generated exactly as the render generates them. */
function generatedCompareVideo() {
  const content = buildContentPackage(COMPARE_IDEA, new Date("2026-09-28T00:00:00Z"));
  const storyboard = buildScriptStoryboardPackage(COMPARE_IDEA, content);
  const production = buildProductionPlanPackage(storyboard);
  const script = storyboard.scripts.find((entry) => entry.platform === "youtube-shorts");
  const plan = production.platforms.find((entry) => entry.platform === "youtube-shorts");
  if (!script || !plan) throw new VoiceSampleError("The Compare storyboard no longer has a youtube-shorts video.");
  return { script, plan };
}

/** What Compare shows for the video's builds at one setting, from the page's own functions. */
export async function compareFiguresAt(resolution: string, preset: string): Promise<Required<Omit<CompareBeatFigures, "resolution" | "preset">>> {
  const [gpus, cpus, games] = await Promise.all([
    readFile(join(here, "..", "..", "src", "data", "gpus.json"), "utf8").then(JSON.parse),
    readFile(join(here, "..", "..", "src", "data", "cpus.json"), "utf8").then(JSON.parse),
    readFile(join(here, "..", "..", "src", "data", "games.json"), "utf8").then(JSON.parse),
  ]) as [Row[], Row[], Row[]];
  const { a, b } = COMPARE_VIDEO_BUILDS;
  const find = (rows: Row[], id: string) => rows.find((row) => row.id === id);
  const gpuA = find(gpus, a.gpu);
  const cpuA = find(cpus, a.cpu);
  const gpuB = find(gpus, b.gpu);
  const cpuB = find(cpus, b.cpu);
  if (!gpuA || !cpuA || !gpuB || !cpuB || games.length === 0) {
    throw new VoiceSampleError("The Compare video's parts or games are missing. Refusing stale narration.");
  }
  const pairs = games.map((game) => [
    estimateFpsForBuild(gpuA as never, cpuA as never, game as never, resolution as never, preset as never).estimated,
    estimateFpsForBuild(gpuB as never, cpuB as never, game as never, resolution as never, preset as never).estimated,
  ]);
  return {
    avgA: getAverageFps(pairs.map(([fpsA]) => fpsA)),
    avgB: getAverageFps(pairs.map(([, fpsB]) => fpsB)),
    // The page counts a tie as a lead for Build A (fpsA >= fpsB).
    leadsA: pairs.filter(([fpsA, fpsB]) => fpsA >= fpsB).length,
    leadsB: pairs.filter(([fpsA, fpsB]) => fpsA < fpsB).length,
    ties: pairs.filter(([fpsA, fpsB]) => fpsA === fpsB).length,
    games: pairs.length,
  };
}

/**
 * Refuse, before reading account data or spending credits, unless this
 * narration still narrates the video and every figure it states still holds:
 *
 *  - the text is the video's beat narration, verbatim;
 *  - each Compare capture shows the video's builds at the setting its beat's
 *    script names;
 *  - both builds really share one CPU ("Same CPU");
 *  - every figure a beat states is what Compare computes at that beat's setting.
 */
export async function assertReviewedCompareFacts(): Promise<void> {
  const { script, plan } = generatedCompareVideo();
  const spoken = script.beats.map((beat) => beat.narration).join(" ");
  if (spoken !== SAMPLE_TEXT || COMPARE_VIDEO_NARRATION !== SAMPLE_TEXT) {
    throw new VoiceSampleError("The video's narration no longer matches this reviewed Liam script. Refusing to narrate a different video.");
  }

  const captures = plan.tasks
    .map((task) => (task as { uiRenderState?: { state?: Row } }).uiRenderState?.state)
    .filter((state): state is Row => state !== undefined);
  const expected = compareCaptureSettings();
  const { a, b } = COMPARE_VIDEO_BUILDS;
  if (captures.length !== expected.length) {
    throw new VoiceSampleError(`The video captures ${captures.length} Compare states; its script names ${expected.length}.`);
  }
  captures.forEach((state, index) => {
    if (state.surface !== "compare" || state.gpuA !== a.gpu || state.cpuA !== a.cpu || state.gpuB !== b.gpu
        || state.cpuB !== b.cpu || state.resolution !== expected[index].resolution || state.preset !== expected[index].preset) {
      throw new VoiceSampleError(`Compare capture ${index + 1} shows ${JSON.stringify(state)}, not what its beat's script names.`);
    }
  });
  if (a.cpu !== b.cpu) throw new VoiceSampleError("The narration says \"Same CPU\"; the video's builds do not share one.");

  for (const beat of COMPARE_VIDEO_BEATS) {
    // What the voice will SAY: no digit left for it to read its own way, and
    // every spoken figure one the beat declares.
    if (/\d/.test(beat.narration)) {
      throw new VoiceSampleError(`The ${beat.purpose} line contains a digit; figures must be written as they are said.`);
    }
    const declared = beat.figures
      ? Object.values(beat.figures).filter((value): value is number => typeof value === "number")
      : [];
    for (const figure of spokenFigures(beat.narration)) {
      if (!declared.includes(figure)) {
        throw new VoiceSampleError(`The ${beat.purpose} line says ${figure}, which the beat does not declare. Refusing.`);
      }
    }
    if (!beat.figures) continue;
    const { resolution, preset, ...stated } = beat.figures;
    if (beat.capture?.resolution !== resolution || beat.capture?.preset !== preset) {
      throw new VoiceSampleError(`The ${beat.purpose} beat states ${resolution} ${preset} figures over a different capture. Refusing.`);
    }
    const actual = await compareFiguresAt(resolution, preset);
    for (const [key, value] of Object.entries(stated)) {
      if (actual[key as keyof typeof actual] !== value) {
        throw new VoiceSampleError(
          `The ${beat.purpose} beat states ${key} ${value} at ${resolution} ${preset}; Compare now computes ${actual[key as keyof typeof actual]}. Refusing stale narration.`,
        );
      }
    }
  }
}

export class VoiceSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceSampleError";
  }
}

export interface SubscriptionInfo {
  readonly tier: string;
  readonly characterCount: number;
  readonly characterLimit: number;
  readonly remaining: number;
  /**
   * Always the provider's explicit boolean. A missing or non-boolean field
   * never reaches here — `readSubscription` stops first — because "we could not
   * read whether this account bills overages" is not the same as "it does not".
   */
  readonly canExtend: false;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Strip anything token-shaped out of provider text before it is logged.
 *
 * Error bodies are descriptions, not credentials, but this runs in CI logs and
 * the cost of being wrong once is a leaked key. Any long opaque run of token
 * characters is replaced rather than trusted.
 */
export function redactTokens(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

/** The provider's own explanation, trimmed and redacted, or "" when absent. */
export async function failureDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body.trim() === "") return "";
  return ` Provider said: ${redactTokens(body.slice(0, 400))}`;
}

export function apiBase(config: ElevenLabsTtsConfig): string {
  // Derive the API root from the configured TTS endpoint so a self-hosted or
  // proxied endpoint stays consistent across both calls.
  return config.endpoint.replace(/\/v1\/text-to-speech\/?$/, "").replace(/\/$/, "");
}

export async function readSubscription(config: ElevenLabsTtsConfig, fetchImpl: FetchLike): Promise<SubscriptionInfo> {
  const response = await fetchImpl(`${apiBase(config)}/v1/user/subscription`, {
    headers: { "xi-api-key": config.apiKey, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new VoiceSampleError(
      `Could not read the ElevenLabs subscription (HTTP ${response.status}).${await failureDetail(response)} ` +
        "Refusing to generate without knowing the remaining allowance.",
    );
  }
  const body = (await response.json()) as Record<string, unknown>;

  // Every billing field is required to be present and well typed. A coerced
  // value would let a string, a null or an absent field pass as a number, and
  // the whole point of reading the subscription is to know the numbers.
  const characterCount = strictNumber(body.character_count, "character_count");
  const characterLimit = strictNumber(body.character_limit, "character_limit");

  // This one decides whether an overage is billable, so it must be an explicit
  // false. Missing, null, a string "false", or anything else stops here —
  // BEFORE any generation call — rather than being read as permission.
  const canExtend = body.can_extend_character_limit;
  if (typeof canExtend !== "boolean") {
    throw new VoiceSampleError(
      `The subscription response did not report can_extend_character_limit as a boolean (got ${describeType(canExtend)}). ` +
        "Refusing to generate: not knowing whether this account bills overages is not the same as knowing it does not.",
    );
  }
  if (canExtend) {
    throw new VoiceSampleError(
      "This account can extend its character limit, so an overage here would be billed. Refusing to generate.",
    );
  }

  return {
    tier: typeof body.tier === "string" && body.tier.trim() !== "" ? body.tier : "unknown",
    characterCount,
    characterLimit,
    remaining: characterLimit - characterCount,
    canExtend,
  };
}

/**
 * The provider's reported charge for one request, or null when it did not
 * report one in a form we can trust.
 *
 * Null is a real answer here and is recorded as such. Substituting the request
 * length would turn "we do not know what this cost" into a number.
 */
export function parseCharacterCost(header: string | null): number | null {
  if (header === null || header.trim() === "") return null;
  const value = Number(header);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  return typeof value;
}

function strictNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VoiceSampleError(
      `The subscription response did not report ${field} as a finite number (got ${describeType(value)}). ` +
        "Refusing to generate on an unreadable allowance.",
    );
  }
  if (value < 0) {
    throw new VoiceSampleError(`The subscription reported a negative ${field}, which cannot be reasoned about.`);
  }
  return value;
}

/**
 * Refuse anything that could cost money beyond the included allowance.
 *
 * Exported so the rule is testable without a network call.
 */
export function assertWithinIncludedAllowance(subscription: SubscriptionInfo, characters: number): void {
  if (characters > MAX_SAMPLE_CHARACTERS) {
    throw new VoiceSampleError(
      `Narration text is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}. Refusing a changed script.`,
    );
  }
  if (subscription.remaining < characters) {
    throw new VoiceSampleError(
      `Only ${subscription.remaining} included characters remain and this sample needs ${characters}. ` +
        "Refusing: this script never tops up, upgrades, or spends past the included allowance.",
    );
  }
  // `readSubscription` already refuses anything but an explicit false, so this
  // is a belt-and-braces check for callers that construct the value directly.
  if (subscription.canExtend !== false) {
    throw new VoiceSampleError(
      "This account is configured to extend its character limit, which means an overage here would be billed. " +
        "Refusing until that is turned off, so a sample cannot quietly cost money.",
    );
  }
}

export interface ResolvedVoice {
  readonly voiceId: string;
  readonly name: string;
}

/**
 * The voice's name without its descriptor.
 *
 * ElevenLabs library voices are commonly listed as "Liam - Energetic, Social
 * Media Creator": a name, a separator, then marketing copy. Matching the whole
 * string against "Liam" fails against a voice that is plainly present, so the
 * comparison is made on the part before the separator.
 *
 * Only a dash separator is stripped. A voice genuinely named "Liam Smith" keeps
 * its full name and will not match "Liam", which is the conservative behaviour:
 * a near-miss must not resolve to a different voice.
 */
export function baseVoiceName(name: string): string {
  return name.split(/\s[-–—]\s/)[0].trim();
}

/**
 * Find the requested voice, or stop.
 *
 * There is deliberately NO fallback. The sample exists so a human can decide
 * whether to narrate with a specific voice; generating a different one spends
 * credits producing an audition nobody asked for, and answers a question that
 * was not put. If the requested voice is not on the account, that is the
 * finding, and it is reported rather than worked around.
 */
export async function resolveVoice(
  config: ElevenLabsTtsConfig,
  fetchImpl: FetchLike,
  preferredName = PREFERRED_VOICE_NAME,
): Promise<ResolvedVoice> {
  const response = await fetchImpl(`${apiBase(config)}/v1/voices`, {
    headers: { "xi-api-key": config.apiKey, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new VoiceSampleError(`Could not list ElevenLabs voices (HTTP ${response.status}).${await failureDetail(response)}`);
  }
  const body = (await response.json()) as { voices?: { voice_id?: string; name?: string }[] };
  const voices = body.voices ?? [];

  const candidates = voices.filter(
    (voice) => baseVoiceName(voice.name ?? "").toLowerCase() === preferredName.trim().toLowerCase(),
  );

  if (candidates.length === 0) {
    const available = voices
      .map((voice) => (voice.name ?? "").trim())
      .filter(Boolean)
      .sort();
    throw new VoiceSampleError(
      `The requested voice "${preferredName}" is not on this ElevenLabs account, so nothing was generated and no ` +
        `credits were spent. This script never substitutes another voice. Voices available: ` +
        `${available.length > 0 ? available.join(", ") : "none returned"}.`,
    );
  }

  // Two voices sharing a first name is a real shape on this account (there are
  // two Georges). Picking one would be guessing which voice the human meant, so
  // it stops and names them. Prefer no match over an ambiguous match.
  if (candidates.length > 1) {
    throw new VoiceSampleError(
      `"${preferredName}" matches ${candidates.length} voices on this account, so nothing was generated and no ` +
        `credits were spent: ${candidates.map((voice) => `"${(voice.name ?? "").trim()}"`).join(", ")}. ` +
        "Name the voice exactly to disambiguate.",
    );
  }

  const match = candidates[0];
  if (match.voice_id === undefined || match.voice_id.trim() === "") {
    throw new VoiceSampleError(`The provider returned "${preferredName}" without a voice id, so it cannot be used.`);
  }
  if (match.voice_id !== REVIEWED_LIAM_VOICE.voiceId) {
    throw new VoiceSampleError(`The provider's Liam voice id does not match the reviewed SpecSmith Liam id. No credits were spent.`);
  }
  return { voiceId: match.voice_id, name: (match.name ?? preferredName).trim() };
}

export interface AccessVerification {
  readonly subscription: SubscriptionInfo;
  readonly voice: ResolvedVoice;
  readonly requestCharactersPlanned: number;
}

/**
 * Prove the key can read billing and find the voice, WITHOUT generating audio.
 *
 * This is the same code path `generateVoiceSample` runs, stopping immediately
 * before the one call that costs money. It is deliberately not a separate
 * reimplementation: a preflight that checks something other than what the real
 * run checks is worse than no preflight.
 */
export async function verifyVoiceSampleAccess(options: {
  readonly fetchImpl?: FetchLike;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<AccessVerification> {
  await assertReviewedCompareFacts();
  const config = elevenLabsTtsConfigFromEnv(options.env ?? process.env);
  if (config === undefined) {
    throw new VoiceSampleError("ELEVENLABS_API_KEY is not set in this environment, so there is nothing to verify.");
  }
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const characters = SAMPLE_TEXT.length;

  const subscription = await readSubscription(config, fetchImpl);
  assertWithinIncludedAllowance(subscription, characters);
  const voice = await resolveVoice(config, fetchImpl);

  return { subscription, voice, requestCharactersPlanned: characters };
}

export interface VoiceSampleResult {
  readonly audioPath: string;
  readonly manifestPath: string;
  readonly voice: ResolvedVoice;
  readonly subscription: SubscriptionInfo;
  readonly bytes: number;
  /** Characters submitted. An estimate of cost, not a measurement. */
  readonly requestCharactersSent: number;
  /** The provider's own reported charge, or null when it reported none. */
  readonly providerReportedCharacterCost: number | null;
}

export async function generateVoiceSample(options: {
  readonly outputDir?: string;
  readonly fetchImpl?: FetchLike;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<VoiceSampleResult> {
  await assertReviewedCompareFacts();
  const config = elevenLabsTtsConfigFromEnv(options.env ?? process.env);
  if (config === undefined) {
    throw new VoiceSampleError(
      "ELEVENLABS_API_KEY is not set in this environment. This script never substitutes the espeak fixture for a " +
        "real provider sample, so there is nothing to generate.",
    );
  }
  assertMp3Output(config);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? VOICE_SAMPLE_OUTPUT_DIR;
  const characters = SAMPLE_TEXT.length;

  const subscription = await readSubscription(config, fetchImpl);
  assertWithinIncludedAllowance(subscription, characters);

  const voice = await resolveVoice(config, fetchImpl);

  const url = new URL(`${apiBase(config)}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}`);
  url.searchParams.set("output_format", config.outputFormat);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg, audio/*;q=0.9",
      },
      body: JSON.stringify({ text: SAMPLE_TEXT, model_id: config.modelId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new VoiceSampleError(
      `ElevenLabs generation failed with HTTP ${response.status}.${await failureDetail(response)} ` +
        "No fixture audio is substituted.",
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("audio/mpeg") && !contentType.startsWith("audio/mp3")) {
    throw new VoiceSampleError(`ElevenLabs returned ${contentType || "no content type"} instead of MP3 audio. Refusing the artifact.`);
  }

  // What the provider says it charged. The request length is what we SENT, not
  // what was billed; the two can differ, and reporting one as the other would
  // be inventing a measurement.
  const reportedCharacterCost = parseCharacterCost(response.headers.get("character-cost"));

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new VoiceSampleError("ElevenLabs returned an empty audio body. No fixture audio is substituted.");
  }

  await mkdir(outputDir, { recursive: true });
  const audioPath = join(outputDir, "specsmith-compare-liam.mp3");
  await writeFile(audioPath, bytes);

  // The manifest records what a listener needs to judge the sample. It
  // deliberately contains no credential and no request headers.
  const manifest = {
    generatedBy: "elevenlabs-text-to-speech",
    isFixture: false,
    isPaidProvider: true,
    requestedVoice: PREFERRED_VOICE_NAME,
    voiceUsed: voice.name,
    voiceId: voice.voiceId,
    requestedVoiceAvailable: true,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    text: SAMPLE_TEXT,
    bytes: bytes.byteLength,
    subscriptionTier: subscription.tier,
    includedCharactersRemainingBefore: subscription.remaining,
    // What we sent. An ESTIMATE of the cost, not a measurement of it.
    requestCharactersSent: characters,
    estimatedCharacterCost: characters,
    estimatedCharacterCostBasis: "length of the submitted text; the provider may bill a different amount",
    // What the provider said it charged, or null when it reported nothing
    // usable. Never backfilled from the estimate.
    providerReportedCharacterCost: reportedCharacterCost,
    characterCostIsProviderReported: reportedCharacterCost !== null,
    toppedUp: false,
    upgraded: false,
    note:
      "Exact narration of the 24-second Compare video (RTX 4080 Super vs RTX 4080), from compareVideoScript.ts. Not a publish approval. The espeak-ng fixture remains " +
      "for offline tests only and must never substitute for this voice.",
  };
  const manifestPath = join(outputDir, "specsmith-compare-liam.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    audioPath,
    manifestPath,
    voice,
    subscription,
    bytes: bytes.byteLength,
    requestCharactersSent: characters,
    providerReportedCharacterCost: reportedCharacterCost,
  };
}

function reportVerification(verification: AccessVerification): void {
  console.log("Access verified. NO audio was generated and no credits were spent.");
  console.log(`  subscription read: ok (tier ${verification.subscription.tier})`);
  console.log(`  can extend limit:  ${verification.subscription.canExtend} (must be exactly false to proceed)`);
  console.log(`  included remaining: ${verification.subscription.remaining} characters`);
  console.log(`  voice "${PREFERRED_VOICE_NAME}": found (${verification.voice.voiceId})`);
  console.log(`  would send:        ${verification.requestCharactersPlanned} characters`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain && process.argv[2] === "verify") {
  verifyVoiceSampleAccess()
    .then(reportVerification)
    .catch((error: unknown) => {
      console.error("ACCESS VERIFICATION FAILED — nothing was generated:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
} else if (isMain) {
  generateVoiceSample()
    .then((result) => {
      console.log("ElevenLabs voice sample generated.");
      console.log(`  voice requested: ${PREFERRED_VOICE_NAME}`);
      console.log(`  voice used:      ${result.voice.name}`);
      console.log(`  characters sent: ${result.requestCharactersSent} (estimate of cost, not a measurement)`);
      console.log(
        `  provider charge: ${
          result.providerReportedCharacterCost === null
            ? "not reported by the provider"
            : `${result.providerReportedCharacterCost} characters`
        }`,
      );
      console.log(`  remaining before: ${result.subscription.remaining} on tier ${result.subscription.tier}`);
      console.log(`  audio:           ${result.audioPath} (${result.bytes} bytes)`);
      console.log(`  manifest:        ${result.manifestPath}`);
    })
    .catch((error: unknown) => {
      console.error("VOICE SAMPLE FAILED — no fixture audio was substituted:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
