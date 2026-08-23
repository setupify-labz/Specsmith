import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGeminiVeoVideoAdapter,
  GeminiVeoError,
  geminiVeoConfigFromEnv,
  parseGeminiVeoGenerationState,
  type GeminiVeoConfig,
} from "./geminiVeoVideo.ts";
import type { RenderTaskContext } from "./rendering.ts";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function config(overrides: Partial<GeminiVeoConfig> = {}): GeminiVeoConfig {
  return {
    apiKey: "test-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelId: "veo-3.1-lite-generate-preview",
    resolution: "720p",
    timeoutMs: 60_000,
    pollInitialMs: 10_000,
    pollMaxMs: 10_000,
    ...overrides,
  };
}

function context(): RenderTaskContext {
  return {
    packageId: "pkg-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform: "youtube-shorts",
    targetDurationSeconds: 20,
    dependencyArtifacts: [],
    task: {
      taskId: "hook-video",
      capability: "video-generation",
      fallbackCapability: "deterministic-ui-render",
      inputRequirements: [],
      outputContract: "video/mp4",
      videoGenerationState: {
        prompt: "Two futuristic graphics cards face each other in a dramatic dark arena. No readable text, no logos, no dialogue, no music.",
        durationSeconds: 4,
        aspectRatio: "9:16",
        generateAudio: false,
      },
    },
  };
}

function mp4Bytes(): Uint8Array {
  return new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
}

describe("Gemini Veo config/state", () => {
  it("defaults to low-cost Veo 3.1 Lite at 720p", () => {
    const value = geminiVeoConfigFromEnv({ GEMINI_API_KEY: "abc" });
    expect(value?.modelId).toBe("veo-3.1-lite-generate-preview");
    expect(value?.resolution).toBe("720p");
  });

  it("rejects non-portrait generation state", () => {
    expect(() => parseGeminiVeoGenerationState({
      prompt: "test",
      durationSeconds: 4,
      aspectRatio: "16:9",
    })).toThrow(GeminiVeoError);
  });

  it("rejects unsupported model configuration", () => {
    expect(() => geminiVeoConfigFromEnv({
      GEMINI_API_KEY: "abc",
      GEMINI_VEO_MODEL_ID: "veo-made-up",
    })).toThrow(/GEMINI_VEO_MODEL_ID/);
  });
});

describe("Gemini Veo adapter", () => {
  it("submits, polls, downloads, and writes a real MP4 artifact", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "specsmith-gemini-veo-"));
    tempDirs.push(outputDir);
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let pollCount = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (method === "POST") {
        return new Response(JSON.stringify({ name: "operations/video-op-1" }), { status: 200 });
      }
      if (url.endsWith("/operations/video-op-1")) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ name: "operations/video-op-1", done: false }), { status: 200 });
        }
        return new Response(JSON.stringify({
          name: "operations/video-op-1",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: "https://files.example.test/video.mp4" } }],
            },
          },
        }), { status: 200 });
      }
      if (url === "https://files.example.test/video.mp4") {
        return new Response(mp4Bytes(), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return new Response("not found", { status: 404 });
    };

    const adapter = createGeminiVeoVideoAdapter({
      config: config(),
      outputDir,
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 0,
    });
    const artifacts = await adapter.render(context());
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].mimeType).toBe("video/mp4");
    expect(artifacts[0].metadata?.provider).toBe("google-gemini-api");
    expect(artifacts[0].metadata?.providerAudioGenerated).toBe(true);
    expect(artifacts[0].metadata?.downstreamAudioPolicy).toBe("discard-provider-audio");
    const bytes = new Uint8Array(await readFile(fileURLToPath(artifacts[0].uri)));
    expect(Array.from(bytes)).toEqual(Array.from(mp4Bytes()));

    const post = calls.find((entry) => entry.method === "POST");
    expect(post?.url).toContain("veo-3.1-lite-generate-preview:predictLongRunning");
    const request = JSON.parse(post?.body ?? "{}") as { parameters?: Record<string, string> };
    expect(request.parameters).toMatchObject({ aspectRatio: "9:16", durationSeconds: "4", resolution: "720p" });
  });

  it("reuses an identical hook inside the same render batch", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "specsmith-gemini-veo-cache-"));
    tempDirs.push(outputDir);
    let postCount = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        postCount += 1;
        return new Response(JSON.stringify({ name: "operations/op-cache" }), { status: 200 });
      }
      if (url.endsWith("/operations/op-cache")) {
        return new Response(JSON.stringify({
          name: "operations/op-cache",
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example.test/cache.mp4" } }] } },
        }), { status: 200 });
      }
      return new Response(mp4Bytes(), { status: 200 });
    };
    const adapter = createGeminiVeoVideoAdapter({ config: config(), outputDir, fetchImpl, sleepImpl: async () => {}, now: () => 0 });
    const first = await adapter.render(context());
    const secondContext = context();
    secondContext.platform = "tiktok";
    secondContext.task.taskId = "hook-video-tiktok";
    const second = await adapter.render(secondContext);
    expect(postCount).toBe(1);
    expect(second[0].uri).toBe(first[0].uri);
    expect(second[0].metadata?.cacheHit).toBe(true);
  });

  it("fails closed when Google completes without a video", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "specsmith-gemini-veo-filter-"));
    tempDirs.push(outputDir);
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ name: "operations/op-filter" }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "operations/op-filter", done: true, response: { generateVideoResponse: { generatedSamples: [] } } }), { status: 200 });
    };
    const adapter = createGeminiVeoVideoAdapter({ config: config(), outputDir, fetchImpl, sleepImpl: async () => {}, now: () => 0 });
    await expect(adapter.render(context())).rejects.toThrow(/without a generated video URI/);
  });

  it("rejects expensive high-resolution combinations that Veo does not support", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "specsmith-gemini-veo-res-"));
    tempDirs.push(outputDir);
    const adapter = createGeminiVeoVideoAdapter({
      config: config({ resolution: "1080p" }),
      outputDir,
      fetchImpl: async () => new Response("should not call", { status: 500 }),
    });
    await expect(adapter.render(context())).rejects.toThrow(/requires an 8-second duration/);
  });
});
