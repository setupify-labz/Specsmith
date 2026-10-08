// The spending guards for a paid ElevenLabs take, shared by every guarded take.
//
// PROVENANCE. Everything from `VoiceSampleError` to `resolveVoice`, and
// `assertMp3Output`, is copied verbatim from
// scripts/content-automator/elevenLabsVoiceSample.ts on claude/fps-liam-voice
// (ce47598), the module the RAM-fit and FPS takes ran under. That module also
// carries the Compare video's narration and its fixtures, which this branch
// does not have, so the guards are kept here word for word rather than
// rewritten: a guard that spends money must not drift between takes.
//
// WHAT THEY REFUSE, BEFORE THE ONE PAID REQUEST
//  - text longer than MAX_SAMPLE_CHARACTERS;
//  - an unreadable subscription, or one that can extend its limit (an
//    overage would be billed);
//  - fewer included characters remaining than the text needs;
//  - any voice but the one "Liam" whose id is the reviewed Liam id;
//  - a non-mp3 output format.
// And the config reader below refuses a missing, blank, George or other voice
// id: there is no default voice.

import { requireReviewedLiamVoiceId, REVIEWED_LIAM_VOICE } from "./liamVoice.ts";
import type { ElevenLabsTtsConfig } from "./elevenLabsTts.ts";

export const PREFERRED_VOICE_NAME = "Liam";

/** One reviewed narration, not an arbitrary script supplied at dispatch time. */
export const MAX_SAMPLE_CHARACTERS = 360;

const DEFAULT_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/**
 * The provider configuration for a guarded take, or undefined when no key is
 * set. Unlike elevenLabsTtsConfigFromEnv on this branch, it never falls back
 * to a default voice: ELEVENLABS_VOICE_ID must be the reviewed Liam id.
 */
export function liamTakeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ElevenLabsTtsConfig | undefined {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return undefined;
  const timeout = Number(env.ELEVENLABS_TTS_TIMEOUT_MS);
  return {
    apiKey,
    endpoint: env.ELEVENLABS_TTS_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    voiceId: requireReviewedLiamVoiceId(env.ELEVENLABS_VOICE_ID, "ELEVENLABS_VOICE_ID"),
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    outputFormat: env.ELEVENLABS_OUTPUT_FORMAT?.trim() || DEFAULT_OUTPUT_FORMAT,
    timeoutMs: Number.isFinite(timeout) ? Math.max(1_000, Math.min(120_000, Math.floor(timeout))) : 60_000,
  };
}

export function assertMp3Output(config: ElevenLabsTtsConfig): void {
  if (!config.outputFormat.startsWith("mp3_")) {
    throw new VoiceSampleError("This review writes an .mp3 artifact and requires an mp3_* ElevenLabs output format.");
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
