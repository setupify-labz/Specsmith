import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "./rendering.ts";

export type ElevenLabsVideoModelId = "veo-3.1-fast-generate-001" | "veo-3.1-generate-001";
export type ElevenLabsVideoResolution = "720p" | "1080p" | "4K";
export type ElevenLabsVideoDuration = 4 | 6 | 8;

export interface ElevenLabsVideoGenerationState {
  prompt: string;
  durationSeconds: ElevenLabsVideoDuration;
  aspectRatio: "9:16";
  resolution?: ElevenLabsVideoResolution;
  generateAudio?: false;
}

export interface ElevenLabsVideoConfig {
  apiKey: string;
  endpoint: string;
  modelId: ElevenLabsVideoModelId;
  resolution: ElevenLabsVideoResolution;
  timeoutMs: number;
  pollInitialMs: number;
  pollMaxMs: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

interface PendingGeneration {
  id: string;
  status: "pending" | "generating";
}

interface CompletedGeneration {
  id: string;
  status: "completed";
  content_url: string;
  content_mime_type: string;
}

interface FailedGeneration {
  id: string;
  status: "failed";
  failure_reason?: string;
  error_message?: string;
}

type GenerationStatus = PendingGeneration | CompletedGeneration | FailedGeneration;

const DEFAULT_ENDPOINT = "https://api.elevenlabs.io/v1/flows/video";
const DEFAULT_MODEL_ID: ElevenLabsVideoModelId = "veo-3.1-fast-generate-001";
const DEFAULT_RESOLUTION: ElevenLabsVideoResolution = "1080p";
const DEFAULT_TIMEOUT_MS = 8 * 60_000;
const DEFAULT_POLL_INITIAL_MS = 10_000;
const DEFAULT_POLL_MAX_MS = 60_000;
const SUPPORTED_MODELS = new Set<ElevenLabsVideoModelId>([
  "veo-3.1-fast-generate-001",
  "veo-3.1-generate-001",
]);
const SUPPORTED_RESOLUTIONS = new Set<ElevenLabsVideoResolution>(["720p", "1080p", "4K"]);

export class ElevenLabsVideoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ElevenLabsVideoError";
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

function parseModelId(raw: string | undefined): ElevenLabsVideoModelId {
  const value = (raw?.trim() || DEFAULT_MODEL_ID) as ElevenLabsVideoModelId;
  if (!SUPPORTED_MODELS.has(value)) {
    throw new ElevenLabsVideoError(
      "unsupported-model",
      `ELEVENLABS_VIDEO_MODEL_ID must be one of ${[...SUPPORTED_MODELS].join(", ")}; got ${value}.`,
    );
  }
  return value;
}

function parseResolution(raw: string | undefined): ElevenLabsVideoResolution {
  const value = (raw?.trim() || DEFAULT_RESOLUTION) as ElevenLabsVideoResolution;
  if (!SUPPORTED_RESOLUTIONS.has(value)) {
    throw new ElevenLabsVideoError(
      "unsupported-resolution",
      `ELEVENLABS_VIDEO_RESOLUTION must be one of ${[...SUPPORTED_RESOLUTIONS].join(", ")}; got ${value}.`,
    );
  }
  return value;
}

export function elevenLabsVideoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ElevenLabsVideoConfig | undefined {
  // Prefer a separate key so the existing TTS-only key can remain least-privilege.
  const apiKey = env.ELEVENLABS_VIDEO_API_KEY?.trim() || env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return undefined;

  const pollInitialMs = boundedInteger(
    env.ELEVENLABS_VIDEO_POLL_INITIAL_MS,
    DEFAULT_POLL_INITIAL_MS,
    10_000,
    60_000,
  );
  const pollMaxMs = boundedInteger(
    env.ELEVENLABS_VIDEO_POLL_MAX_MS,
    DEFAULT_POLL_MAX_MS,
    pollInitialMs,
    120_000,
  );

  return {
    apiKey,
    endpoint: env.ELEVENLABS_VIDEO_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    modelId: parseModelId(env.ELEVENLABS_VIDEO_MODEL_ID),
    resolution: parseResolution(env.ELEVENLABS_VIDEO_RESOLUTION),
    timeoutMs: boundedInteger(env.ELEVENLABS_VIDEO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60_000, 20 * 60_000),
    pollInitialMs,
    pollMaxMs,
  };
}

function finiteDuration(value: unknown): ElevenLabsVideoDuration {
  if (value !== 4 && value !== 6 && value !== 8) {
    throw new ElevenLabsVideoError("malformed-state", "videoGenerationState.durationSeconds must be 4, 6, or 8.");
  }
  return value;
}

export function parseElevenLabsVideoGenerationState(input: unknown): ElevenLabsVideoGenerationState {
  if (!input || typeof input !== "object") {
    throw new ElevenLabsVideoError("malformed-state", "videoGenerationState must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.replace(/\s+/g, " ").trim() : "";
  if (!prompt) throw new ElevenLabsVideoError("malformed-state", "videoGenerationState.prompt is required.");
  if (prompt.length > 5_000) throw new ElevenLabsVideoError("malformed-state", "videoGenerationState.prompt is too long.");

  const aspectRatio = raw.aspectRatio ?? "9:16";
  if (aspectRatio !== "9:16") {
    throw new ElevenLabsVideoError("malformed-state", "SpecSmith automated video generation currently requires 9:16 output.");
  }
  if (raw.generateAudio === true) {
    throw new ElevenLabsVideoError(
      "audio-conflict",
      "Generated-model audio is disabled because narration/music are controlled by separate verified production tasks.",
    );
  }

  let resolution: ElevenLabsVideoResolution | undefined;
  if (raw.resolution !== undefined) {
    if (typeof raw.resolution !== "string" || !SUPPORTED_RESOLUTIONS.has(raw.resolution as ElevenLabsVideoResolution)) {
      throw new ElevenLabsVideoError("malformed-state", "videoGenerationState.resolution must be 720p, 1080p, or 4K.");
    }
    resolution = raw.resolution as ElevenLabsVideoResolution;
  }

  return {
    prompt,
    durationSeconds: finiteDuration(raw.durationSeconds),
    aspectRatio: "9:16",
    ...(resolution ? { resolution } : {}),
    generateAudio: false,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

function httpFailure(code: string, operation: string, response: Response, body: Record<string, unknown>): ElevenLabsVideoError {
  const detail = typeof body.detail === "string"
    ? body.detail
    : typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : typeof body.raw === "string"
          ? body.raw
          : JSON.stringify(body).slice(0, 1000);
  return new ElevenLabsVideoError(code, `${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function generationFromJson(body: Record<string, unknown>, operation: string): GenerationStatus {
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = body.status;
  if (!id || (status !== "pending" && status !== "generating" && status !== "completed" && status !== "failed")) {
    throw new ElevenLabsVideoError("malformed-response", `${operation} returned an unexpected generation payload.`);
  }
  if (status === "completed") {
    const contentUrl = typeof body.content_url === "string" ? body.content_url.trim() : "";
    const contentMimeType = typeof body.content_mime_type === "string" ? body.content_mime_type.trim() : "";
    if (!contentUrl || !contentMimeType) {
      throw new ElevenLabsVideoError("malformed-response", `${operation} completed without content_url/content_mime_type.`);
    }
    return { id, status, content_url: contentUrl, content_mime_type: contentMimeType };
  }
  if (status === "failed") {
    return {
      id,
      status,
      failure_reason: typeof body.failure_reason === "string" ? body.failure_reason : undefined,
      error_message: typeof body.error_message === "string" ? body.error_message : undefined,
    };
  }
  return { id, status };
}

async function submitGeneration(
  config: ElevenLabsVideoConfig,
  state: ElevenLabsVideoGenerationState,
  fetchImpl: FetchLike,
): Promise<PendingGeneration> {
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      "xi-api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model_id: config.modelId,
      prompt: state.prompt,
      duration_secs: state.durationSeconds,
      aspect_ratio: state.aspectRatio,
      resolution: state.resolution ?? config.resolution,
      // SpecSmith owns narration/music/captions. Keeping provider audio off avoids
      // conflicting speech, surprise copyrighted music, and an unmixable master.
      generate_audio: false,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) throw httpFailure("submit-failed", "ElevenLabs video submission", response, body);
  const generation = generationFromJson(body, "ElevenLabs video submission");
  if (generation.status !== "pending" && generation.status !== "generating") {
    throw new ElevenLabsVideoError("malformed-response", `New ElevenLabs generation unexpectedly returned ${generation.status}.`);
  }
  return generation;
}

async function getGeneration(
  config: ElevenLabsVideoConfig,
  generationId: string,
  fetchImpl: FetchLike,
): Promise<GenerationStatus> {
  const response = await fetchImpl(`${config.endpoint.replace(/\/$/, "")}/${encodeURIComponent(generationId)}`, {
    method: "GET",
    headers: {
      "xi-api-key": config.apiKey,
      Accept: "application/json",
    },
  });
  const body = await readJson(response);
  if (!response.ok) throw httpFailure("poll-failed", "ElevenLabs video status check", response, body);
  return generationFromJson(body, "ElevenLabs video status check");
}

async function waitForGeneration(
  config: ElevenLabsVideoConfig,
  generationId: string,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike,
  now: () => number,
): Promise<CompletedGeneration> {
  const startedAt = now();
  let pollMs = config.pollInitialMs;
  while (true) {
    if (now() - startedAt >= config.timeoutMs) {
      throw new ElevenLabsVideoError("generation-timeout", `ElevenLabs video generation ${generationId} exceeded ${config.timeoutMs}ms.`);
    }
    await sleepImpl(pollMs);
    const generation = await getGeneration(config, generationId, fetchImpl);
    if (generation.status === "completed") return generation;
    if (generation.status === "failed") {
      const reason = generation.failure_reason || "unknown";
      const message = generation.error_message || "No error message was returned.";
      throw new ElevenLabsVideoError("generation-failed", `ElevenLabs video generation ${generationId} failed (${reason}): ${message}`);
    }
    pollMs = Math.min(config.pollMaxMs, pollMs * 2);
  }
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
}

async function downloadVideo(generation: CompletedGeneration, fetchImpl: FetchLike): Promise<Uint8Array> {
  if (generation.content_mime_type !== "video/mp4") {
    throw new ElevenLabsVideoError(
      "unexpected-media",
      `ElevenLabs generation ${generation.id} returned ${generation.content_mime_type}, expected video/mp4.`,
    );
  }
  const response = await fetchImpl(generation.content_url, { method: "GET" });
  if (!response.ok) {
    const body = await readJson(response);
    throw httpFailure("download-failed", "ElevenLabs generated video download", response, body);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeMp4(bytes)) {
    throw new ElevenLabsVideoError("invalid-mp4", `ElevenLabs generation ${generation.id} did not download as a valid MP4 container.`);
  }
  return bytes;
}

export function createElevenLabsVideoAdapter(options: {
  config: ElevenLabsVideoConfig;
  outputDir: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  now?: () => number;
}): RenderAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)));
  const now = options.now ?? Date.now;

  return {
    name: "elevenlabs-video-veo",
    capability: "video-generation",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      if (typeof fetchImpl !== "function") throw new ElevenLabsVideoError("no-fetch", "No fetch implementation is available for ElevenLabs video generation.");
      const state = parseElevenLabsVideoGenerationState(context.task.videoGenerationState);
      const submitted = await submitGeneration(options.config, state, fetchImpl);
      const completed = await waitForGeneration(options.config, submitted.id, fetchImpl, sleepImpl, now);
      const bytes = await downloadVideo(completed, fetchImpl);

      await mkdir(options.outputDir, { recursive: true });
      const filename = [context.packageId, context.platform, context.task.taskId, completed.id]
        .map(safeFilePart)
        .join("-");
      const outputPath = resolve(options.outputDir, `${filename}.mp4`);
      await writeFile(outputPath, bytes);

      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-elevenlabs-video`,
        taskId: context.task.taskId,
        kind: "video",
        uri: pathToFileURL(outputPath).toString(),
        mimeType: "video/mp4",
        metadata: {
          provider: "elevenlabs",
          modelId: options.config.modelId,
          generationId: completed.id,
          durationSeconds: state.durationSeconds,
          aspectRatio: state.aspectRatio,
          resolution: state.resolution ?? options.config.resolution,
          generatedAudio: false,
          bytes: bytes.byteLength,
        },
      }];
    },
  };
}
