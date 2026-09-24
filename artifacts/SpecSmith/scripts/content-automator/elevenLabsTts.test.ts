import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElevenLabsTtsAdapter, elevenLabsTtsConfigFromEnv, type ElevenLabsTtsConfig } from "./elevenLabsTts.ts";
import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "./liamVoice.ts";
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

const LIAM = REVIEWED_LIAM_VOICE.voiceId;

describe("ElevenLabs TTS render adapter", () => {
  it("reads a narrow TTS configuration from environment variables", () => {
    const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: LIAM });
    expect(config).toMatchObject({
      apiKey: "secret",
      voiceId: LIAM,
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
        ELEVENLABS_VOICE_ID: LIAM,
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
      expect(calls[0].url.pathname).toBe(`/v1/text-to-speech/${LIAM}`);
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
          voiceId: LIAM,
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
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: LIAM })!;
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
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: LIAM })!;
      const adapter = createElevenLabsTtsAdapter({ config, outputDir: dir, fetchImpl: async () => new Response() });
      const empty = context();
      empty.task.inputRequirements = ["", "   "];
      await expect(adapter.render(empty)).rejects.toThrow("has no narration text");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// THE GEORGE FALLBACK IS GONE, AND LIAM IS NOT DECLARED BY THE CALLER.
// Every wrong voice below must fail before a single provider request: each
// case counts the calls its fetch receives and requires zero.
describe("narration voice is the reviewed Liam, with no fallback", () => {
  const WRONG_VOICES: Array<[label: string, env: NodeJS.ProcessEnv, code: RegExp]> = [
    ["missing", { ELEVENLABS_API_KEY: "secret" }, /voice-missing/],
    ["George", { ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: GEORGE_VOICE_ID }, /voice-george/],
    ["blank", { ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "   " }, /voice-blank/],
    ["arbitrary", { ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "pNInz6obpgDQGcFmaJgB" }, /voice-not-liam/],
  ];

  function countingFetch() {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(new Uint8Array([73, 68, 51]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    };
    return { calls, fetchImpl };
  }

  const base: ElevenLabsTtsConfig = {
    apiKey: "secret",
    endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
    voiceId: LIAM,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    timeoutMs: 1_000,
  };

  for (const [label, env, code] of WRONG_VOICES) {
    it(`refuses a ${label} ELEVENLABS_VOICE_ID from the environment`, () => {
      expect(() => elevenLabsTtsConfigFromEnv(env)).toThrow(code);
    });

    it(`refuses a ${label} voice id handed straight to the adapter, with zero provider calls`, async () => {
      const { calls, fetchImpl } = countingFetch();
      const voiceId = env.ELEVENLABS_VOICE_ID as string;
      expect(() => createElevenLabsTtsAdapter({ config: { ...base, voiceId }, outputDir: tmpdir(), fetchImpl })).toThrow(code);
      expect(calls).toHaveLength(0);
    });
  }

  it("never falls back to George: no default voice exists anywhere in the adapter", () => {
    const source = readFileSync(new URL("./elevenLabsTts.ts", import.meta.url), "utf-8");
    expect(source).not.toContain(GEORGE_VOICE_ID);
    expect(source).not.toMatch(/DEFAULT_VOICE_ID/);
  });

  it("ignores a caller mutating its config after the adapter was built", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-"));
    try {
      const { calls, fetchImpl } = countingFetch();
      const config = { ...base };
      const adapter = createElevenLabsTtsAdapter({ config, outputDir: dir, fetchImpl });
      config.voiceId = GEORGE_VOICE_ID;
      await adapter.render(context());
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]).pathname).toBe(`/v1/text-to-speech/${LIAM}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps genuine Liam working: one request, to Liam's voice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "specsmith-elevenlabs-"));
    try {
      const { calls, fetchImpl } = countingFetch();
      const config = elevenLabsTtsConfigFromEnv({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: ` ${LIAM} ` })!;
      const [artifact] = await createElevenLabsTtsAdapter({ config, outputDir: dir, fetchImpl }).render(context());
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]).pathname).toBe(`/v1/text-to-speech/${LIAM}`);
      expect(artifact.metadata?.voiceId).toBe(LIAM);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the reviewed identity immutable", () => {
    expect(Object.isFrozen(REVIEWED_LIAM_VOICE)).toBe(true);
    expect(() => {
      (REVIEWED_LIAM_VOICE as { voiceId: string }).voiceId = GEORGE_VOICE_ID;
    }).toThrow(TypeError);
    expect(REVIEWED_LIAM_VOICE.voiceId).toBe("TX3LPaxmHKxFdv7VOQHJ");
  });
});
