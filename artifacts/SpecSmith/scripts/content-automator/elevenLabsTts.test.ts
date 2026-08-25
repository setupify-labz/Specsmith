import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElevenLabsTtsAdapter, elevenLabsTtsConfigFromEnv } from "./elevenLabsTts.ts";
import type { RenderTaskContext } from "./rendering.ts";

const PRODUCTION_TEXT = "S".repeat(330);

function subscriptionResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tier: "starter",
    character_count: 100,
    character_limit: 30_000,
    next_character_count_reset_unix: 1_788_000_000,
    ...overrides,
  });
}

function context(overrides: Partial<RenderTaskContext> = {}): RenderTaskContext {
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
      inputRequirements: [PRODUCTION_TEXT],
      outputRequirements: ["Clear narration"],
    },
    dependencyArtifacts: [],
    ...overrides,
  };
}

describe("ElevenLabs TTS render adapter", () => {
  it("reads a narrow TTS configuration from environment variables", () => {
    const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" });
    expect(config).toMatchObject({
      apiKey: "secret",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      monthlyCreditLimit: 28_000,
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
          const url = new URL(String(input));
          if (url.pathname === "/v1/user/subscription") return subscriptionResponse();
          calls.push({
            url,
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
        text: PRODUCTION_TEXT,
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
          estimatedCreditCost: 330,
          monthlyCreditLimit: 28000,
          reusedNarration: false,
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
        fetchImpl: async (input) => new URL(String(input)).pathname === "/v1/user/subscription"
          ? subscriptionResponse()
          : new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 }),
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

  it("blocks paid production calls outside the 330-360 character narration contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-length-"));
    let calls = 0;
    try {
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" })!;
      const adapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async () => {
          calls += 1;
          return subscriptionResponse();
        },
      });
      const short = context();
      short.task.inputRequirements = ["Too short."];
      await expect(adapter.render(short)).rejects.toThrow("330-360 characters");
      expect(calls).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed before synthesis on a free tier or exhausted monthly safety budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-budget-"));
    try {
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" })!;
      let paidCalls = 0;
      const freeAdapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async () => subscriptionResponse({ tier: "free", character_count: 0, character_limit: 10_000 }),
      });
      await expect(freeAdapter.render(context())).rejects.toThrow("commercial rights");

      const budgetAdapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async (input) => {
          if (new URL(String(input)).pathname === "/v1/user/subscription") {
            return subscriptionResponse({ character_count: 27_900 });
          }
          paidCalls += 1;
          return new Response(new Uint8Array([1]));
        },
      });
      await expect(budgetAdapter.render(context())).rejects.toThrow("monthly safety limit");
      expect(paidCalls).toBe(0);

      const staleUsageAdapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async (input) => new URL(String(input)).pathname === "/v1/user/subscription"
          ? subscriptionResponse({ character_count: 27_700 })
          : new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 }),
      });
      await expect(staleUsageAdapter.render(context())).resolves.toHaveLength(1);
      const secondCreative = context();
      secondCreative.task.inputRequirements = ["T".repeat(330)];
      await expect(staleUsageAdapter.render(secondCreative)).rejects.toThrow("monthly safety limit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("synthesizes identical cross-platform narration once and reuses the audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-reuse-"));
    let subscriptionCalls = 0;
    let paidCalls = 0;
    try {
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret" })!;
      const adapter = createElevenLabsTtsAdapter({
        config,
        outputDir: dir,
        fetchImpl: async (input) => {
          if (new URL(String(input)).pathname === "/v1/user/subscription") {
            subscriptionCalls += 1;
            return subscriptionResponse();
          }
          paidCalls += 1;
          return new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 });
        },
      });

      const youtube = await adapter.render(context());
      const tiktok = await adapter.render(context({ platform: "tiktok" }));
      const instagram = await adapter.render(context({ platform: "instagram-reels" }));

      expect(subscriptionCalls).toBe(1);
      expect(paidCalls).toBe(1);
      expect(youtube[0].metadata?.reusedNarration).toBe(false);
      expect(tiktok[0].metadata?.reusedNarration).toBe(true);
      expect(instagram[0].metadata?.reusedNarration).toBe(true);
      expect(await readFile(fileURLToPath(youtube[0].uri))).toEqual(await readFile(fileURLToPath(tiktok[0].uri)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
