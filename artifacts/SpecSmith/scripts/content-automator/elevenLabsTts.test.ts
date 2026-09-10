import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElevenLabsTtsAdapter, elevenLabsTtsConfigFromEnv } from "./elevenLabsTts.ts";
import type { RenderTaskContext } from "./rendering.ts";

function context(): RenderTaskContext {
  return {
    packageId: "pkg-1",
    campaignId: "campaign-1",
    ideaId: "idea-1",
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    task: {
      taskId: "youtube-shorts-voice",
      capability: "text-to-speech",
      sourceBeat: null,
      purpose: "Generate narration",
      inputRequirements: ["Pick the GPU.", "Now reveal the winner."],
      outputRequirements: ["Clear narration"],
    },
    dependencyArtifacts: [],
  };
}

describe("ElevenLabs TTS render adapter", () => {
  it("reads a narrow TTS configuration from environment variables", () => {
    const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" });
    expect(config).toMatchObject({
      apiKey: "secret",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    });
    expect(elevenLabsTtsConfigFromEnv({})).toBeUndefined();
  });

  it("uses the ElevenLabs TTS contract and writes an audio artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-"));
    const calls: Array<{ url: URL; apiKey?: string; body?: Record<string, unknown> }> = [];
    try {
      const config = elevenLabsTtsConfigFromEnv({
        ELEVENLABS_API_KEY: "secret",
        ELEVENLABS_VOICE_ID: "voice-123",
        ELEVENLABS_MODEL_ID: "eleven_v3",
      })!;
      const adapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async (input, init) => {
          calls.push({
            url: new URL(String(input)),
            apiKey: new Headers(init?.headers).get("xi-api-key") ?? undefined,
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          });
          return new Response(new Uint8Array([73, 68, 51, 4, 0, 0]), {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "request-id": "req-123",
              "character-cost": "31",
            },
          });
        },
      });

      const artifacts = await adapter.render(context());
      expect(calls).toHaveLength(1);
      expect(calls[0].url.pathname).toBe("/v1/text-to-speech/voice-123");
      expect(calls[0].url.searchParams.get("output_format")).toBe("mp3_44100_128");
      expect(calls[0].apiKey).toBe("secret");
      expect(calls[0].body).toEqual({
        text: "Pick the GPU. Now reveal the winner.",
        model_id: "eleven_v3",
      });

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        kind: "audio",
        mimeType: "audio/mpeg",
        taskId: "youtube-shorts-voice",
        metadata: {
          provider: "elevenlabs",
          voiceId: "voice-123",
          modelId: "eleven_v3",
          characterCost: 31,
        },
      });
      const saved = await readFile(fileURLToPath(artifacts[0].uri));
      expect(saved.byteLength).toBe(6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when ElevenLabs rejects the request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-"));
    try {
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" })!;
      const adapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async () => new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 }),
      });
      await expect(adapter.render(context())).rejects.toThrow("ElevenLabs TTS request failed with HTTP 401");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to synthesize an empty narration task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-"));
    try {
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" })!;
      const adapter = createElevenLabsTtsAdapter({ config, outputDir: dir, fetchImpl: async () => new Response() });
      const empty = context();
      empty.task.inputRequirements = ["", "   "];
      await expect(adapter.render(empty)).rejects.toThrow("has no narration text");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
