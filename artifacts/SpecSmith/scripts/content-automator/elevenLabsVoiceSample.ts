#!/usr/bin/env tsx
/**
 * One short ElevenLabs voice sample, for human approval.
 *
 * WHAT THIS IS FOR
 *
 * The rendered narration currently comes from the local espeak-ng fixture,
 * which sounds robotic. Before any real narration is commissioned, a human has
 * to hear the candidate voice. This produces exactly one short sample and
 * stops.
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

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { elevenLabsTtsConfigFromEnv, type ElevenLabsTtsConfig } from "./elevenLabsTts.ts";

const here = dirname(fileURLToPath(import.meta.url));

export const VOICE_SAMPLE_OUTPUT_DIR = join(here, "..", "..", "render-output", "voice-sample");

/** The requested voice. Falls back only with a loud, recorded label. */
export const PREFERRED_VOICE_NAME = "Liam";

/**
 * The sample line.
 *
 * Taken verbatim from the authored concept's hook beat, so the sample is judged
 * on words the narration would actually say. It states no fact, so it carries
 * no disclosure obligation of its own.
 *
 * Length is capped hard below; at ElevenLabs' typical pace this is roughly
 * seven to eight seconds.
 */
export const SAMPLE_TEXT =
  "Two part lists, one comparison page. Before you read the bars, say out loud which side you expect to come out ahead.";

/** A sample is a sample. Anything longer is a narration job, not an audition. */
export const MAX_SAMPLE_CHARACTERS = 200;

export class VoiceSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceSampleError";
  }
}

interface SubscriptionInfo {
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

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function apiBase(config: ElevenLabsTtsConfig): string {
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
      `Could not read the ElevenLabs subscription (HTTP ${response.status}). Refusing to generate without knowing the remaining allowance.`,
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
      `Sample text is ${characters} characters; the cap is ${MAX_SAMPLE_CHARACTERS}. This script generates auditions, not narration.`,
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
    throw new VoiceSampleError(`Could not list ElevenLabs voices (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { voices?: { voice_id?: string; name?: string }[] };
  const voices = body.voices ?? [];
  const match = voices.find((voice) => (voice.name ?? "").trim().toLowerCase() === preferredName.toLowerCase());
  if (match?.voice_id === undefined) {
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
  return { voiceId: match.voice_id, name: match.name ?? preferredName };
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
  const config = elevenLabsTtsConfigFromEnv(options.env ?? process.env);
  if (config === undefined) {
    throw new VoiceSampleError(
      "ELEVENLABS_API_KEY is not set in this environment. This script never substitutes the espeak fixture for a " +
        "real provider sample, so there is nothing to generate.",
    );
  }

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
    const detail = await response.text().catch(() => "");
    throw new VoiceSampleError(
      `ElevenLabs generation failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}. ` +
        "No fixture audio is substituted.",
    );
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
  const audioPath = join(outputDir, "specsmith-voice-sample.mp3");
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
      "One approval sample. Not narration for any published video. The local espeak-ng fixture remains the offline " +
      "test narrator and is labelled isFixture: true in its own artifacts.",
  };
  const manifestPath = join(outputDir, "specsmith-voice-sample.json");
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

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain) {
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
