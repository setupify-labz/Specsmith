import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export type GeminiVeoModelId =
  | "veo-3.1-lite-generate-preview"
  | "veo-3.1-fast-generate-preview"
  | "veo-3.1-generate-preview";
export type GeminiVeoResolution = "720p" | "1080p" | "4k";
export type GeminiVeoDuration = 4 | 6 | 8;

export interface GeminiVeoGenerationState {
  prompt: string;
  durationSeconds: GeminiVeoDuration;
  aspectRatio: "9:16";
  resolution?: GeminiVeoResolution;
  generateAudio?: false;
}

export interface GeminiVeoConfig {
  apiKey: string;
  baseUrl: string;
  modelId: GeminiVeoModelId;
  resolution: GeminiVeoResolution;
  timeoutMs: number;
  pollInitialMs: number;
  pollMaxMs: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

type JsonObject = Record<string, unknown>;

interface PendingOperation {
  name: string;
  done: false;
}

interface CompletedOperation {
  name: string;
  done: true;
  videoUri: string;
}

type OperationStatus = PendingOperation | CompletedOperation;

interface CachedVideo {
  uri: string;
  metadata: Record<string, string | number | boolean>;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
// Start with Lite at 720p because the hook is an attention layer, not the factual
// evidence layer. This keeps automated experiments cheap while we validate quality.
const DEFAULT_MODEL_ID: GeminiVeoModelId = "veo-3.1-lite-generate-preview";
const DEFAULT_RESOLUTION: GeminiVeoResolution = "720p";
const DEFAULT_TIMEOUT_MS = 7 * 60_000;
const DEFAULT_POLL_INITIAL_MS = 10_000;
const DEFAULT_POLL_MAX_MS = 60_000;
const SUPPORTED_MODELS = new Set<GeminiVeoModelId>([
  "veo-3.1-lite-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-generate-preview",
]);
const SUPPORTED_RESOLUTIONS = new Set<GeminiVeoResolution>(["720p", "1080p", "4k"]);

export class GeminiVeoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GeminiVeoError";
    this.code = code;
  }
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "video";
}

function parseModelId(raw: string | undefined): GeminiVeoModelId {
  const value = (raw?.trim() || DEFAULT_MODEL_ID) as GeminiVeoModelId;
  if (!SUPPORTED_MODELS.has(value)) {
    throw new GeminiVeoError(
      "unsupported-model",
      `GEMINI_VEO_MODEL_ID must be one of ${[...SUPPORTED_MODELS].join(", ")}; got ${value}.`,
    );
  }
  return value;
}

function parseResolution(raw: string | undefined): GeminiVeoResolution {
  const normalized = raw?.trim().toLowerCase();
  const value = (normalized || DEFAULT_RESOLUTION) as GeminiVeoResolution;
  if (!SUPPORTED_RESOLUTIONS.has(value)) {
    throw new GeminiVeoError(
      "unsupported-resolution",
      `GEMINI_VEO_RESOLUTION must be one of ${[...SUPPORTED_RESOLUTIONS].join(", ")}; got ${value}.`,
    );
  }
  return value;
}

export function geminiVeoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiVeoConfig | undefined {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return undefined;
  const pollInitialMs = boundedInteger(env.GEMINI_VEO_POLL_INITIAL_MS, DEFAULT_POLL_INITIAL_MS, 10_000, 60_000);
  const pollMaxMs = boundedInteger(env.GEMINI_VEO_POLL_MAX_MS, DEFAULT_POLL_MAX_MS, pollInitialMs, 120_000);
  return {
    apiKey,
    baseUrl: (env.GEMINI_VEO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    modelId: parseModelId(env.GEMINI_VEO_MODEL_ID),
    resolution: parseResolution(env.GEMINI_VEO_RESOLUTION),
    timeoutMs: boundedInteger(env.GEMINI_VEO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60_000, 10 * 60_000),
    pollInitialMs,
    pollMaxMs,
  };
}

function finiteDuration(value: unknown): GeminiVeoDuration {
  if (value !== 4 && value !== 6 && value !== 8) {
    throw new GeminiVeoError("malformed-state", "videoGenerationState.durationSeconds must be 4, 6, or 8.");
  }
  return value;
}

export function parseGeminiVeoGenerationState(input: unknown): GeminiVeoGenerationState {
  if (!input || typeof input !== "object") {
    throw new GeminiVeoError("malformed-state", "videoGenerationState must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.replace(/\s+/g, " ").trim() : "";
  if (!prompt) throw new GeminiVeoError("malformed-state", "videoGenerationState.prompt is required.");
  if (prompt.length > 5_000) throw new GeminiVeoError("malformed-state", "videoGenerationState.prompt is too long.");
  const aspectRatio = raw.aspectRatio ?? "9:16";
  if (aspectRatio !== "9:16") {
    throw new GeminiVeoError("malformed-state", "SpecSmith automated video generation currently requires 9:16 output.");
  }
  if (raw.generateAudio === true) {
    throw new GeminiVeoError(
      "audio-conflict",
      "SpecSmith narration/music are controlled downstream; videoGenerationState must not request provider dialogue/music.",
    );
  }

  let resolution: GeminiVeoResolution | undefined;
  if (raw.resolution !== undefined) {
    if (typeof raw.resolution !== "string") {
      throw new GeminiVeoError("malformed-state", "videoGenerationState.resolution must be 720p, 1080p, or 4k.");
    }
    const normalized = raw.resolution.toLowerCase() as GeminiVeoResolution;
    if (!SUPPORTED_RESOLUTIONS.has(normalized)) {
      throw new GeminiVeoError("malformed-state", "videoGenerationState.resolution must be 720p, 1080p, or 4k.");
    }
    resolution = normalized;
  }

  return {
    prompt,
    durationSeconds: finiteDuration(raw.durationSeconds),
    aspectRatio: "9:16",
    ...(resolution ? { resolution } : {}),
    generateAudio: false,
  };
}

function validateProviderCombination(modelId: GeminiVeoModelId, resolution: GeminiVeoResolution, duration: GeminiVeoDuration): void {
  if (modelId === "veo-3.1-lite-generate-preview" && resolution === "4k") {
    throw new GeminiVeoError("unsupported-combination", "Veo 3.1 Lite does not support 4k output.");
  }
  if ((resolution === "1080p" || resolution === "4k") && duration !== 8) {
    throw new GeminiVeoError(
      "unsupported-combination",
      `${resolution} Veo 3.1 generation requires an 8-second duration; got ${duration}s.`,
    );
  }
}

async function readJson(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text.slice(0, 1200) };
  }
}

function errorDetail(body: JsonObject): string {
  const error = body.error;
  if (error && typeof error === "object") {
    const record = error as JsonObject;
    const message = typeof record.message === "string" ? record.message : "";
    const status = typeof record.status === "string" ? record.status : "";
    return [status, message].filter(Boolean).join(": ");
  }
  if (typeof body.message === "string") return body.message;
  if (typeof body.raw === "string") return body.raw;
  return JSON.stringify(body).slice(0, 1200);
}

function httpFailure(code: string, operation: string, response: Response, body: JsonObject): GeminiVeoError {
  const detail = errorDetail(body);
  return new GeminiVeoError(code, `${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

async function submitGeneration(
  config: GeminiVeoConfig,
  state: GeminiVeoGenerationState,
  resolution: GeminiVeoResolution,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(`${config.baseUrl}/models/${config.modelId}:predictLongRunning`, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      instances: [{ prompt: state.prompt }],
      parameters: {
        aspectRatio: state.aspectRatio,
        durationSeconds: state.durationSeconds,
        resolution,
      },
    }),
  });
  const body = await readJson(response);
  if (!response.ok) throw httpFailure("submit-failed", "Gemini Veo submission", response, body);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new GeminiVeoError("malformed-response", "Gemini Veo submission returned no operation name.");
  return name;
}

function completedVideoUri(body: JsonObject): string | undefined {
  const response = body.response;
  if (!response || typeof response !== "object") return undefined;
  const generateVideoResponse = (response as JsonObject).generateVideoResponse;
  if (!generateVideoResponse || typeof generateVideoResponse !== "object") return undefined;
  const samples = (generateVideoResponse as JsonObject).generatedSamples;
  if (!Array.isArray(samples) || samples.length === 0) return undefined;
  const first = samples[0];
  if (!first || typeof first !== "object") return undefined;
  const video = (first as JsonObject).video;
  if (!video || typeof video !== "object") return undefined;
  const uri = (video as JsonObject).uri;
  return typeof uri === "string" && uri.trim() ? uri.trim() : undefined;
}

async function getOperation(config: GeminiVeoConfig, operationName: string, fetchImpl: FetchLike): Promise<OperationStatus> {
  const response = await fetchImpl(`${config.baseUrl}/${operationName.replace(/^\//, "")}`, {
    method: "GET",
    headers: { "x-goog-api-key": config.apiKey, Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) throw httpFailure("poll-failed", "Gemini Veo status check", response, body);
  const name = typeof body.name === "string" ? body.name : operationName;
  if (body.error && typeof body.error === "object") {
    throw new GeminiVeoError("generation-failed", `Gemini Veo operation ${name} failed: ${errorDetail(body)}`);
  }
  if (body.done !== true) return { name, done: false };
  const videoUri = completedVideoUri(body);
  if (!videoUri) {
    throw new GeminiVeoError(
      "no-generated-video",
      `Gemini Veo operation ${name} completed without a generated video URI (possibly filtered or failed).`,
    );
  }
  return { name, done: true, videoUri };
}

async function waitForGeneration(
  config: GeminiVeoConfig,
  operationName: string,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike,
  now: () => number,
): Promise<CompletedOperation> {
  const startedAt = now();
  let pollMs = config.pollInitialMs;
  while (true) {
    if (now() - startedAt >= config.timeoutMs) {
      throw new GeminiVeoError("generation-timeout", `Gemini Veo operation ${operationName} exceeded ${config.timeoutMs}ms.`);
    }
    await sleepImpl(pollMs);
    const operation = await getOperation(config, operationName, fetchImpl);
    if (operation.done) return operation;
    pollMs = Math.min(config.pollMaxMs, pollMs * 2);
  }
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
}

async function downloadVideo(config: GeminiVeoConfig, uri: string, fetchImpl: FetchLike): Promise<Uint8Array> {
  const response = await fetchImpl(uri, {
    method: "GET",
    headers: { "x-goog-api-key": config.apiKey },
    redirect: "follow",
  });
  if (!response.ok) {
    const body = await readJson(response);
    throw httpFailure("download-failed", "Gemini Veo video download", response, body);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeMp4(bytes)) throw new GeminiVeoError("invalid-mp4", "Gemini Veo download was not a valid MP4 container.");
  return bytes;
}

export function createGeminiVeoVideoAdapter(options: {
  config: GeminiVeoConfig;
  outputDir: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  now?: () => number;
}): RenderAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)));
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedVideo>();

  return {
    name: "google-gemini-veo",
    capability: "video-generation",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      if (typeof fetchImpl !== "function") throw new GeminiVeoError("no-fetch", "No fetch implementation is available for Gemini Veo.");
      const state = parseGeminiVeoGenerationState(context.task.videoGenerationState);
      const resolution = state.resolution ?? options.config.resolution;
      validateProviderCombination(options.config.modelId, resolution, state.durationSeconds);
      const cacheKey = JSON.stringify({
        modelId: options.config.modelId,
        resolution,
        prompt: state.prompt,
        durationSeconds: state.durationSeconds,
        aspectRatio: state.aspectRatio,
      });
      const cached = cache.get(cacheKey);
      if (cached) {
        return [{
          artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-gemini-veo`,
          taskId: context.task.taskId,
          kind: "video",
          uri: cached.uri,
          mimeType: "video/mp4",
          metadata: { ...cached.metadata, cacheHit: true },
        }];
      }

      const operationName = await submitGeneration(options.config, state, resolution, fetchImpl);
      const completed = await waitForGeneration(options.config, operationName, fetchImpl, sleepImpl, now);
      const bytes = await downloadVideo(options.config, completed.videoUri, fetchImpl);
      await mkdir(options.outputDir, { recursive: true });
      const filename = `${safeFilePart(context.packageId)}-${safeFilePart(context.platform)}-${safeFilePart(context.task.taskId)}-gemini-veo.mp4`;
      const outputPath = resolve(options.outputDir, filename);
      await writeFile(outputPath, bytes);
      const uri = pathToFileURL(outputPath).href;
      const metadata: Record<string, string | number | boolean> = {
        provider: "google-gemini-api",
        modelId: options.config.modelId,
        operationName: completed.name,
        resolution,
        aspectRatio: state.aspectRatio,
        requestedDurationSeconds: state.durationSeconds,
        bytes: bytes.byteLength,
        cacheHit: false,
        providerAudioGenerated: true,
        downstreamAudioPolicy: "discard-provider-audio",
      };
      cache.set(cacheKey, { uri, metadata });
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-gemini-veo`,
        taskId: context.task.taskId,
        kind: "video",
        uri,
        mimeType: "video/mp4",
        metadata,
      }];
    },
  };
}
