#!/usr/bin/env tsx
/**
 * Voice auditions for the GPU race draft: the same short excerpt, read once by
 * each of two named voices, so a person can choose by ear.
 *
 *   tsx voiceAuditions.ts list                      list the account's voices (no audio, no spend)
 *   AUDITION_VOICE_IDS=id1,id2 tsx voiceAuditions.ts   one audition per voice
 *
 * AN AUDITION IS NOT A NARRATOR CHANGE. SpecSmith narration may use only the
 * reviewed voice in liamVoice.ts; changing it is a reviewed source change.
 * These files exist for listening and are labelled so.
 *
 * BEFORE ANY SPEND: the excerpt is exactly the approved race lines it quotes,
 * and Compare still computes their figures (assertApprovedRaceScript); both
 * ids are well formed, distinct, not the current Liam voice, and on this
 * account; the account cannot extend its limit and has the included
 * characters for BOTH auditions. One request per voice, no retries, no
 * substitute voice: a failure stops the run and is reported.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { elevenLabsTtsConfigFromEnv, type ElevenLabsTtsConfig } from "../elevenLabsTts.ts";
import {
  apiBase,
  assertMp3Output,
  assertWithinIncludedAllowance,
  failureDetail,
  parseCharacterCost,
  readSubscription,
  VoiceSampleError,
  type FetchLike,
} from "../elevenLabsVoiceSample.ts";
import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { APPROVED_RACE_LINES, assertApprovedRaceScript } from "./liamTake.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const AUDITION_DIR = join(here, "..", "..", "..", "render-output", "voice-auditions");

/** The excerpt every voice reads: the race draft's last three approved lines. */
export const AUDITION_TEXT = "Twenty of twenty modelled leads. Yet on average, one sixty-four to one sixty. Just four FPS apart.";

export interface AccountVoice {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description: string;
}

const VOICE_ID = /^[A-Za-z0-9]{16,32}$/;

/** The approved lines the excerpt quotes, checked against Compare before any spend. */
export async function assertApprovedExcerpt(): Promise<void> {
  await assertApprovedRaceScript();
  const quoted = APPROVED_RACE_LINES.filter((line) => ["leads", "average", "gap"].includes(line.id)).map((line) => line.text).join(" ");
  if (quoted !== AUDITION_TEXT) throw new VoiceSampleError("The audition excerpt is not the approved race lines it quotes. Refusing.");
}

export async function listAccountVoices(config: ElevenLabsTtsConfig, fetchImpl: FetchLike): Promise<AccountVoice[]> {
  const response = await fetchImpl(`${apiBase(config)}/v1/voices`, { headers: { "xi-api-key": config.apiKey, Accept: "application/json" } });
  if (!response.ok) throw new VoiceSampleError(`Could not list ElevenLabs voices (HTTP ${response.status}).${await failureDetail(response)}`);
  const body = (await response.json()) as { voices?: Record<string, unknown>[] };
  return (body.voices ?? []).map((voice) => ({
    voiceId: String(voice.voice_id ?? ""),
    name: String(voice.name ?? "").trim(),
    category: String(voice.category ?? ""),
    labels: Object.fromEntries(Object.entries((voice.labels ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)])),
    description: String(voice.description ?? "").replace(/\s+/g, " ").trim(),
  })).filter((voice) => voice.voiceId && voice.name);
}

/** Two well-formed, distinct ids, neither the current Liam voice, both on the account. */
export function chooseAuditionVoices(requested: string, voices: AccountVoice[]): AccountVoice[] {
  const ids = requested.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length !== 2) throw new VoiceSampleError(`Exactly two voice ids are needed; got ${ids.length}.`);
  if (ids[0] === ids[1]) throw new VoiceSampleError("The two voice ids are the same voice.");
  return ids.map((id) => {
    if (!VOICE_ID.test(id)) throw new VoiceSampleError(`"${id}" is not a voice id.`);
    if (id === REVIEWED_LIAM_VOICE.voiceId) throw new VoiceSampleError("Liam already has a take; auditions are for other voices.");
    const voice = voices.find((entry) => entry.voiceId === id);
    if (!voice) throw new VoiceSampleError(`Voice ${id} is not on this account. Nothing was generated; no voice is substituted.`);
    return voice;
  });
}

const slug = (name: string) => name.split(/\s[-–—]\s/)[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface Audition {
  voice: AccountVoice;
  file: string;
  bytes: number;
  sha256: string;
  charactersSent: number;
  providerReportedCharacterCost: number | null;
}

export async function generateAuditions(options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv; outputDir?: string } = {}): Promise<{ auditions: Audition[]; remainingBefore: number; tier: string }> {
  await assertApprovedExcerpt();
  const env = options.env ?? process.env;
  const config = elevenLabsTtsConfigFromEnv(env);
  if (config === undefined) throw new VoiceSampleError("ELEVENLABS_API_KEY is not set. No fixture voice is ever substituted.");
  assertMp3Output(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputDir = options.outputDir ?? AUDITION_DIR;

  const voices = chooseAuditionVoices(env.AUDITION_VOICE_IDS ?? "", await listAccountVoices(config, fetchImpl));
  const subscription = await readSubscription(config, fetchImpl);
  // Both auditions are paid for from the included allowance, checked together before the first.
  assertWithinIncludedAllowance(subscription, AUDITION_TEXT.length * voices.length);

  await mkdir(outputDir, { recursive: true });
  const auditions: Audition[] = [];
  for (const voice of voices) {
    const url = new URL(`${apiBase(config)}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}`);
    url.searchParams.set("output_format", config.outputFormat);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: AUDITION_TEXT, model_id: config.modelId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new VoiceSampleError(`The ${voice.name} audition failed with HTTP ${response.status}.${await failureDetail(response)} ` +
        `${auditions.length} audition(s) were kept; nothing is retried and no voice is substituted.`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("audio/mpeg") && !contentType.startsWith("audio/mp3")) {
      throw new VoiceSampleError(`The ${voice.name} audition returned ${contentType || "no content type"}, not MP3.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new VoiceSampleError(`The ${voice.name} audition returned no audio.`);
    const file = `audition-${slug(voice.name)}-${voice.voiceId}.mp3`;
    await writeFile(join(outputDir, file), bytes);
    auditions.push({
      voice, file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      charactersSent: AUDITION_TEXT.length, providerReportedCharacterCost: parseCharacterCost(response.headers.get("character-cost")),
    });
  }

  await writeFile(join(outputDir, "auditions.json"), `${JSON.stringify({
    kind: "voice-auditions",
    isPaidProvider: true,
    note: "Auditions for choosing by ear. Not approved narration: SpecSmith narration may use only the reviewed voice in liamVoice.ts.",
    text: AUDITION_TEXT,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    subscriptionTier: subscription.tier,
    includedCharactersRemainingBefore: subscription.remaining,
    toppedUp: false,
    auditions,
  }, null, 2)}\n`);
  return { auditions, remainingBefore: subscription.remaining, tier: subscription.tier };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain && process.argv[2] === "list") {
  const config = elevenLabsTtsConfigFromEnv(process.env);
  if (!config) {
    console.error("ELEVENLABS_API_KEY is not set.");
    process.exitCode = 1;
  } else {
    listAccountVoices(config, globalThis.fetch)
      .then((voices) => {
        console.log(`Voices on this account (${voices.length}). Nothing was generated; no credits were spent.`);
        for (const voice of voices) {
          const labels = Object.entries(voice.labels).map(([key, value]) => `${key}=${value}`).join(", ");
          console.log(`  ${voice.voiceId}  ${voice.name}  [${voice.category}]  ${labels}${voice.description ? `  — ${voice.description.slice(0, 120)}` : ""}`);
        }
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
} else if (isMain) {
  generateAuditions()
    .then(({ auditions, remainingBefore, tier }) => {
      console.log(`Auditions generated: ${auditions.length}. Included characters remaining before: ${remainingBefore} on tier ${tier}.`);
      for (const audition of auditions) {
        console.log(`  ${audition.voice.name} (${audition.voice.voiceId}): ${audition.file}, ${audition.bytes} bytes, sha256 ${audition.sha256}`);
        console.log(`    characters sent ${audition.charactersSent}; provider charge ${audition.providerReportedCharacterCost ?? "not reported"}`);
      }
    })
    .catch((error: unknown) => {
      console.error("AUDITIONS FAILED — nothing retried, no voice substituted:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
