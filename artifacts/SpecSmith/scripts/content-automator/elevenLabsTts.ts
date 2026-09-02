import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export interface ElevenLabsTtsConfig {
  apiKey: string;
  endpoint: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  timeoutMs: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George, used in ElevenLabs' current API quickstart.
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_TIMEOUT_MS = 30_000;

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
  };
}

export function narrationTextFromRenderContext(context: RenderTaskContext): string {
  const text = context.task.inputRequirements
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) throw new Error(`TTS task ${context.task.taskId} has no narration text`);
  return text;
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
}): RenderAdapter {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    name: "elevenlabs-tts",
    capability: "text-to-speech",
    async render(context): Promise<RenderArtifact[]> {
      if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for ElevenLabs TTS");
      const text = narrationTextFromRenderContext(context);
      const generated = await requestSpeech(config, text, fetchImpl);

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
      };
      if (generated.requestId) metadata.requestId = generated.requestId;
      if (generated.characterCost !== undefined) metadata.characterCost = generated.characterCost;

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
