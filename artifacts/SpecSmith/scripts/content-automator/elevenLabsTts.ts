import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";
import { assertProductionNarrationLength, normalizeNarrationText } from "./narrationPolicy.ts";

export interface ElevenLabsTtsConfig {
  apiKey: string;
  endpoint: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  timeoutMs: number;
  subscriptionEndpoint: string;
  monthlyCreditLimit: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George, used in ElevenLabs' current API quickstart.
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription";
const DEFAULT_MONTHLY_CREDIT_LIMIT = 28_000;

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "render";
}

function extensionForOutputFormat(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) return "mp3";
  if (outputFormat.startsWith("pcm_")) return "pcm";
  if (outputFormat.startsWith("ulaw_")) return "ulaw";
  if (outputFormat.startsWith("alaw_")) return "alaw";
  if (outputFormat.startsWith("opus_")) return "opus";
  return "bin";
}

function mimeTypeForOutputFormat(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) return "audio/mpeg";
  if (outputFormat.startsWith("pcm_")) return "audio/L16";
  if (outputFormat.startsWith("opus_")) return "audio/opus";
  return "application/octet-stream";
}

export function elevenLabsTtsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ElevenLabsTtsConfig | undefined {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return undefined;

  return {
    apiKey,
    endpoint: env.ELEVENLABS_TTS_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    outputFormat: env.ELEVENLABS_OUTPUT_FORMAT?.trim() || DEFAULT_OUTPUT_FORMAT,
    timeoutMs: boundedNumber(env.ELEVENLABS_TTS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    subscriptionEndpoint: env.ELEVENLABS_SUBSCRIPTION_ENDPOINT?.trim() || DEFAULT_SUBSCRIPTION_ENDPOINT,
    monthlyCreditLimit: boundedNumber(
      env.ELEVENLABS_MONTHLY_CREDIT_LIMIT,
      DEFAULT_MONTHLY_CREDIT_LIMIT,
      1,
      DEFAULT_MONTHLY_CREDIT_LIMIT,
    ),
  };
}

export function narrationTextFromRenderContext(context: RenderTaskContext): string {
  const text = normalizeNarrationText(context.task.inputRequirements);

  if (!text) throw new Error(`TTS task ${context.task.taskId} has no narration text`);
  return text;
}

interface ElevenLabsSubscriptionUsage {
  tier: string;
  characterCount: number;
  characterLimit: number;
  nextResetUnix?: number;
}

interface GeneratedSpeech {
  bytes: Uint8Array;
  requestId?: string;
  characterCost?: number;
  estimatedCreditCost: number;
  monthlyCreditsUsedBefore: number;
  effectiveMonthlyCreditLimit: number;
  nextResetUnix?: number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`ElevenLabs subscription response has invalid ${field}.`);
  }
  return Math.floor(value);
}

function estimatedCreditCost(modelId: string, textCharacters: number): number {
  // ElevenLabs documents Flash v2.5 API generations at 50% lower cost per
  // character. Unknown/overridden models use the conservative full rate.
  const multiplier = modelId === "eleven_flash_v2_5" ? 0.5 : 1;
  return Math.ceil(textCharacters * multiplier);
}

async function fetchSubscriptionUsage(config: ElevenLabsTtsConfig, fetchImpl: FetchLike): Promise<ElevenLabsSubscriptionUsage> {
  const response = await fetchImpl(config.subscriptionEndpoint, {
    method: "GET",
    headers: {
      "xi-api-key": config.apiKey,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ElevenLabs budget preflight failed with HTTP ${response.status}${body ? `: ${body.slice(0, 320)}` : ""}`);
  }

  const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new Error("ElevenLabs subscription response is malformed.");
  const tier = typeof raw.tier === "string" ? raw.tier.trim() : "";
  if (!tier) throw new Error("ElevenLabs subscription response has no tier.");
  const nextResetUnix = raw.next_character_count_reset_unix === null || raw.next_character_count_reset_unix === undefined
    ? undefined
    : nonNegativeInteger(raw.next_character_count_reset_unix, "next_character_count_reset_unix");
  return {
    tier,
    characterCount: nonNegativeInteger(raw.character_count, "character_count"),
    characterLimit: nonNegativeInteger(raw.character_limit, "character_limit"),
    nextResetUnix,
  };
}

async function requestSpeech(
  config: ElevenLabsTtsConfig,
  text: string,
  fetchImpl: FetchLike,
): Promise<{ bytes: Uint8Array; requestId?: string; characterCost?: number }> {
  const url = new URL(`${config.endpoint.replace(/\/$/, "")}/${encodeURIComponent(config.voiceId)}`);
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
        Accept: "audio/mpeg, audio/*;q=0.9, application/octet-stream;q=0.8",
      },
      body: JSON.stringify({
        text,
        model_id: config.modelId,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 320)}` : ""}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("ElevenLabs TTS returned an empty audio response");

  const characterCostRaw = response.headers.get("character-cost");
  const parsedCost = characterCostRaw === null ? undefined : Number(characterCostRaw);
  return {
    bytes,
    requestId: response.headers.get("request-id") ?? undefined,
    characterCost: parsedCost !== undefined && Number.isFinite(parsedCost) ? parsedCost : undefined,
  };
}

export function createElevenLabsTtsAdapter(options: {
  config: ElevenLabsTtsConfig;
  outputDir: string;
  fetchImpl?: FetchLike;
  mode?: "production" | "smoke";
}): RenderAdapter {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const mode = options.mode ?? "production";
  const generationCache = new Map<string, Promise<GeneratedSpeech>>();
  let budgetQueue: Promise<void> = Promise.resolve();
  let localUsageFloor = 0;

  function generateWithinBudget(text: string): Promise<GeneratedSpeech> {
    const operation = budgetQueue.then(async () => {
      const usage = await fetchSubscriptionUsage(config, fetchImpl);
      if (mode === "production" && usage.tier.toLowerCase() === "free") {
        throw new Error("Production ElevenLabs narration requires a paid tier with commercial rights; the connected account is free.");
      }

      const estimated = estimatedCreditCost(config.modelId, text.length);
      const effectiveLimit = Math.min(config.monthlyCreditLimit, usage.characterLimit);
      // Provider usage can be briefly eventually consistent. The in-process
      // floor reserves every successful request immediately so a fast batch
      // cannot spend against a stale subscription response.
      const usedBefore = Math.max(usage.characterCount, localUsageFloor);
      if (usedBefore + estimated > effectiveLimit) {
        throw new Error(
          `ElevenLabs monthly safety limit would be exceeded (${usedBefore} used + ${estimated} estimated > ${effectiveLimit}).`,
        );
      }

      const speech = await requestSpeech(config, text, fetchImpl);
      localUsageFloor = usedBefore + estimated;
      return {
        ...speech,
        estimatedCreditCost: estimated,
        monthlyCreditsUsedBefore: usedBefore,
        effectiveMonthlyCreditLimit: effectiveLimit,
        nextResetUnix: usage.nextResetUnix,
      };
    });
    // Serialize paid requests so two simultaneous renders cannot both pass the
    // same provider-usage check and overspend the cap.
    budgetQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    name: "elevenlabs-tts",
    capability: "text-to-speech",
    async render(context): Promise<RenderArtifact[]> {
      if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for ElevenLabs TTS");
      const text = narrationTextFromRenderContext(context);
      if (mode === "production") assertProductionNarrationLength(text);

      const cacheKey = JSON.stringify([config.voiceId, config.modelId, config.outputFormat, text]);
      const reusedNarration = generationCache.has(cacheKey);
      let pending = generationCache.get(cacheKey);
      if (!pending) {
        pending = generateWithinBudget(text);
        generationCache.set(cacheKey, pending);
      }

      let generated: GeneratedSpeech;
      try {
        generated = await pending;
      } catch (error) {
        if (generationCache.get(cacheKey) === pending) generationCache.delete(cacheKey);
        throw error;
      }

      const extension = extensionForOutputFormat(config.outputFormat);
      const filename = [context.packageId, context.platform, context.task.taskId]
        .map(safeFilePart)
        .join("-");
      const outputPath = resolve(options.outputDir, `${filename}.${extension}`);
      await mkdir(options.outputDir, { recursive: true });
      await writeFile(outputPath, generated.bytes);

      const metadata: Record<string, string | number | boolean> = {
        provider: "elevenlabs",
        voiceId: config.voiceId,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
        bytes: generated.bytes.byteLength,
        textCharacters: text.length,
        estimatedCreditCost: generated.estimatedCreditCost,
        monthlyCreditsUsedBefore: generated.monthlyCreditsUsedBefore,
        monthlyCreditLimit: generated.effectiveMonthlyCreditLimit,
        reusedNarration,
      };
      if (generated.requestId) metadata.requestId = generated.requestId;
      if (generated.characterCost !== undefined) metadata.characterCost = generated.characterCost;
      if (generated.nextResetUnix !== undefined) metadata.nextCreditResetUnix = generated.nextResetUnix;

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-elevenlabs`,
        taskId: context.task.taskId,
        kind: "audio",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: mimeTypeForOutputFormat(config.outputFormat),
        metadata,
      }];
    },
  };
}
