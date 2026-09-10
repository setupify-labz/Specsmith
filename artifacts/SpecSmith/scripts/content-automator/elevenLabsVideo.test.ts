import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createElevenLabsVideoAdapter,
  elevenLabsVideoConfigFromEnv,
  ElevenLabsVideoError,
  parseElevenLabsVideoGenerationState,
  type ElevenLabsVideoConfig,
} from "./elevenLabsVideo.ts";
import type { RenderTaskContext } from "./rendering.ts";

function mp4Bytes(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32,
  ]);
}

function context(): RenderTaskContext {
  return {
    packageId: "pkg-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    task: {
      taskId: "youtube-shorts-beat-1-visual",
      capability: "video-generation",
      sourceBeat: 0,
      purpose: "Generate cinematic hook.",
      inputRequirements: ["Two graphics cards face off."],
      outputRequirements: ["9:16"],
      videoGenerationState: {
        prompt: "Two generic premium graphics cards face off in a cinematic arena. No text or logos.",
        durationSeconds: 4,
        aspectRatio: "9:16",
        generateAudio: false,
      },
    },
    dependencyArtifacts: [],
  };
}

function config(): ElevenLabsVideoConfig {
  return {
    apiKey: "video-secret",
    endpoint: "https://api.elevenlabs.io/v1/flows/video",
    modelId: "veo-3.1-fast-generate-001",
    resolution: "1080p",
    timeoutMs: 120_000,
    pollInitialMs: 10_000,
    pollMaxMs: 60_000,
  };
}

describe("ElevenLabs video generation", () => {
  it("prefers a separate Image & Video key while preserving the existing TTS key", () => {
    const parsed = elevenLabsVideoConfigFromEnv({
      ELEVENLABS_API_KEY: "tts-only",
      ELEVENLABS_VIDEO_API_KEY: "video-key",
    });
    expect(parsed?.apiKey).toBe("video-key");
    expect(parsed?.modelId).toBe("veo-3.1-fast-generate-001");
    expect(parsed?.resolution).toBe("1080p");
    expect(parsed?.pollInitialMs).toBe(10_000);
  });

  it("validates provider-safe vertical state and refuses generated provider audio", () => {
    expect(parseElevenLabsVideoGenerationState({
      prompt: "  Cinematic GPU reveal   with no readable text. ",
      durationSeconds: 6,
      aspectRatio: "9:16",
    })).toEqual({
      prompt: "Cinematic GPU reveal with no readable text.",
      durationSeconds: 6,
      aspectRatio: "9:16",
      generateAudio: false,
    });

    expect(() => parseElevenLabsVideoGenerationState({
      prompt: "GPU reveal",
      durationSeconds: 5,
      aspectRatio: "9:16",
    })).toThrow(/4, 6, or 8/);

    expect(() => parseElevenLabsVideoGenerationState({
      prompt: "GPU reveal",
      durationSeconds: 4,
      aspectRatio: "9:16",
      generateAudio: true,
    })).toThrow(/separate verified production tasks/);
  });

  it("submits, polls with bounded backoff, downloads MP4, and returns a real video artifact", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      new Response(JSON.stringify({ id: "gen-123", status: "pending" }), { status: 200 }),
      new Response(JSON.stringify({ id: "gen-123", status: "generating" }), { status: 200 }),
      new Response(JSON.stringify({
        id: "gen-123",
        status: "completed",
        content_url: "https://signed.example/video.mp4",
        content_mime_type: "video/mp4",
      }), { status: 200 }),
      new Response(mp4Bytes(), { status: 200, headers: { "Content-Type": "video/mp4" } }),
    ];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch");
      return response;
    };
    const sleeps: number[] = [];
    const outputDir = join(tmpdir(), `specsmith-eleven-video-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(outputDir, { recursive: true });

    try {
      const adapter = createElevenLabsVideoAdapter({
        config: config(),
        outputDir,
        fetchImpl,
        sleepImpl: async (ms) => { sleeps.push(ms); },
        now: () => 1_000,
      });
      const artifacts = await adapter.render(context());

      expect(sleeps).toEqual([10_000, 20_000]);
      expect(calls).toHaveLength(4);
      expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/flows/video");
      expect(calls[0].init?.method).toBe("POST");
      expect((calls[0].init?.headers as Record<string, string>)["xi-api-key"]).toBe("video-secret");
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        model_id: "veo-3.1-fast-generate-001",
        prompt: "Two generic premium graphics cards face off in a cinematic arena. No text or logos.",
        duration_secs: 4,
        aspect_ratio: "9:16",
        resolution: "1080p",
        generate_audio: false,
      });
      expect(calls[1].url).toBe("https://api.elevenlabs.io/v1/flows/video/gen-123");
      expect(calls[3].url).toBe("https://signed.example/video.mp4");

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].kind).toBe("video");
      expect(artifacts[0].mimeType).toBe("video/mp4");
      expect(artifacts[0].uri.startsWith("file:")).toBe(true);
      expect(artifacts[0].metadata).toMatchObject({
        provider: "elevenlabs",
        modelId: "veo-3.1-fast-generate-001",
        generationId: "gen-123",
        durationSeconds: 4,
        aspectRatio: "9:16",
        resolution: "1080p",
        generatedAudio: false,
        cacheHit: false,
      });
      const saved = await readFile(new URL(artifacts[0].uri));
      expect(saved.byteLength).toBe(mp4Bytes().byteLength);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("reuses an identical cinematic hook across platform variants instead of spending credits twice", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "gen-shared", status: "pending" }), { status: 200 }),
      new Response(JSON.stringify({
        id: "gen-shared",
        status: "completed",
        content_url: "https://signed.example/shared.mp4",
        content_mime_type: "video/mp4",
      }), { status: 200 }),
      new Response(mp4Bytes(), { status: 200 }),
    ];
    let fetchCalls = 0;
    const outputDir = join(tmpdir(), `specsmith-eleven-video-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const adapter = createElevenLabsVideoAdapter({
      config: config(),
      outputDir,
      fetchImpl: async () => {
        fetchCalls += 1;
        const response = responses.shift();
        if (!response) throw new Error("unexpected paid provider call");
        return response;
      },
      sleepImpl: async () => {},
      now: () => 1_000,
    });

    try {
      const first = await adapter.render(context());
      const secondContext = context();
      secondContext.platform = "tiktok";
      secondContext.task = { ...secondContext.task, taskId: "tiktok-beat-1-visual" };
      const second = await adapter.render(secondContext);

      expect(fetchCalls).toBe(3);
      expect(second[0].uri).toBe(first[0].uri);
      expect(second[0].taskId).toBe("tiktok-beat-1-visual");
      expect(second[0].metadata?.cacheHit).toBe(true);
      expect(first[0].metadata?.generationId).toBe(second[0].metadata?.generationId);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the provider rejects the plan/permission instead of falling through silently", async () => {
    const fetchImpl = async (): Promise<Response> => new Response(
      JSON.stringify({ detail: { status: "paid_plan_required", message: "Image & Video requires Pro" } }),
      { status: 402 },
    );
    const adapter = createElevenLabsVideoAdapter({
      config: config(),
      outputDir: join(tmpdir(), "unused-eleven-video"),
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(adapter.render(context())).rejects.toMatchObject({
      name: "ElevenLabsVideoError",
      code: "submit-failed",
    } satisfies Partial<ElevenLabsVideoError>);
  });

  it("surfaces terminal generation failures and never downloads a fake result", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "gen-fail", status: "pending" }), { status: 200 }),
      new Response(JSON.stringify({
        id: "gen-fail",
        status: "failed",
        failure_reason: "moderated",
        error_message: "Prompt rejected",
      }), { status: 200 }),
    ];
    let calls = 0;
    const adapter = createElevenLabsVideoAdapter({
      config: config(),
      outputDir: join(tmpdir(), "unused-eleven-video-fail"),
      fetchImpl: async () => {
        calls += 1;
        const response = responses.shift();
        if (!response) throw new Error("unexpected fetch");
        return response;
      },
      sleepImpl: async () => {},
      now: () => 1_000,
    });

    await expect(adapter.render(context())).rejects.toThrow(/moderated.*Prompt rejected/);
    expect(calls).toBe(2);
  });
});
