// Voice sample guards.
//
// The two rules that matter here cannot be tested by running the real thing:
// "never spend past the included allowance" and "never quietly substitute the
// fixture voice". Both are tested against a stub fetch, so no credit is spent
// and no key is needed.

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  assertWithinIncludedAllowance,
  generateVoiceSample,
  MAX_SAMPLE_CHARACTERS,
  PREFERRED_VOICE_NAME,
  resolveVoice,
  SAMPLE_TEXT,
  VoiceSampleError,
} from "./elevenLabsVoiceSample.ts";
import { elevenLabsTtsConfigFromEnv } from "./elevenLabsTts.ts";

const ENV = { ELEVENLABS_API_KEY: "test-key-not-a-real-credential" } as NodeJS.ProcessEnv;
const CONFIG = elevenLabsTtsConfigFromEnv(ENV)!;

function subscription(overrides: Partial<Parameters<typeof assertWithinIncludedAllowance>[0]> = {}) {
  return {
    tier: "starter",
    characterCount: 1_000,
    characterLimit: 30_000,
    remaining: 29_000,
    canExtend: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function audioResponse(bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04])): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
}

/** A fetch stub that answers the three calls the script makes. */
function stubFetch(options: {
  readonly subscriptionBody?: unknown;
  readonly voices?: { voice_id: string; name: string }[];
  readonly ttsResponse?: () => Response;
  readonly onTts?: (url: string) => void;
} = {}) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v1/user/subscription")) {
      return jsonResponse(
        options.subscriptionBody ?? { tier: "starter", character_count: 1_000, character_limit: 30_000, can_extend_character_limit: false },
      );
    }
    if (url.includes("/v1/voices")) {
      return jsonResponse({ voices: options.voices ?? [{ voice_id: "liam-voice-id", name: "Liam" }] });
    }
    options.onTts?.(url);
    return (options.ttsResponse ?? audioResponse)();
  };
}

describe("the sample stays inside the included allowance", () => {
  it("accepts a short sample with credits to spare", () => {
    expect(() => assertWithinIncludedAllowance(subscription(), SAMPLE_TEXT.length)).not.toThrow();
  });

  it("refuses text longer than an audition", () => {
    expect(() => assertWithinIncludedAllowance(subscription(), MAX_SAMPLE_CHARACTERS + 1)).toThrow(
      /generates auditions, not narration/,
    );
  });

  it("refuses when the remaining included characters would not cover it", () => {
    expect(() => assertWithinIncludedAllowance(subscription({ remaining: 10 }), SAMPLE_TEXT.length)).toThrow(
      /never tops up, upgrades, or spends past the included allowance/,
    );
  });

  it("refuses outright when the account can extend its limit, because an overage would be billed", () => {
    expect(() => assertWithinIncludedAllowance(subscription({ canExtend: true }), SAMPLE_TEXT.length)).toThrow(
      /cannot quietly cost money/,
    );
  });

  it("keeps the shipped sample text within the cap", () => {
    expect(SAMPLE_TEXT.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARACTERS);
  });
});

describe("no silent substitution", () => {
  it("refuses to generate at all without a key, rather than using the fixture", async () => {
    await expect(generateVoiceSample({ env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      /never substitutes the espeak fixture/,
    );
  });

  it("fails loudly when generation errors, with no audio written", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    try {
      await expect(
        generateVoiceSample({
          env: ENV,
          outputDir: directory,
          fetchImpl: stubFetch({ ttsResponse: () => new Response("quota exhausted", { status: 401 }) }),
        }),
      ).rejects.toThrow(/No fixture audio is substituted/);
      expect(() => readFileSync(join(directory, "specsmith-voice-sample.mp3"))).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an empty audio body instead of writing a zero-byte sample", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    try {
      await expect(
        generateVoiceSample({
          env: ENV,
          outputDir: directory,
          fetchImpl: stubFetch({ ttsResponse: () => audioResponse(new Uint8Array()) }),
        }),
      ).rejects.toThrow(/empty audio body/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to generate when the subscription cannot be read", async () => {
    await expect(
      generateVoiceSample({
        env: ENV,
        fetchImpl: async (input) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/v1/user/subscription")) return new Response("nope", { status: 500 });
          return audioResponse();
        },
      }),
    ).rejects.toThrow(/Refusing to generate without knowing the remaining allowance/);
  });
});

describe("voice selection", () => {
  it("uses Liam when the account has it", async () => {
    const voice = await resolveVoice(CONFIG, stubFetch());
    expect(voice.name).toBe(PREFERRED_VOICE_NAME);
    expect(voice.voiceId).toBe("liam-voice-id");
    expect(voice.isFallback).toBe(false);
  });

  it("marks a fallback loudly rather than passing another voice off as Liam", async () => {
    const voice = await resolveVoice(CONFIG, stubFetch({ voices: [{ voice_id: CONFIG.voiceId, name: "George" }] }));
    expect(voice.isFallback).toBe(true);
    expect(voice.name).not.toBe(PREFERRED_VOICE_NAME);
  });
});

describe("the written sample", () => {
  it("records what a listener needs and no credential", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    try {
      const result = await generateVoiceSample({ env: ENV, outputDir: directory, fetchImpl: stubFetch() });
      const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as Record<string, unknown>;

      expect(manifest.isFixture).toBe(false);
      expect(manifest.isPaidProvider).toBe(true);
      expect(manifest.requestedVoiceAvailable).toBe(true);
      expect(manifest.toppedUp).toBe(false);
      expect(manifest.upgraded).toBe(false);
      expect(manifest.text).toBe(SAMPLE_TEXT);

      const serialized = JSON.stringify(manifest);
      expect(serialized).not.toContain(ENV.ELEVENLABS_API_KEY);
      expect(serialized.toLowerCase()).not.toContain("xi-api-key");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("asks the provider for the resolved voice, not the configured default", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    const requested: string[] = [];
    try {
      await generateVoiceSample({
        env: ENV,
        outputDir: directory,
        fetchImpl: stubFetch({ onTts: (url) => requested.push(url) }),
      });
      expect(requested).toHaveLength(1);
      expect(requested[0]).toContain("liam-voice-id");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("the offline fixture narrator is untouched", () => {
  it("still labels itself a fixture", () => {
    const source = readFileSync(join(import.meta.dirname, "localFixtureTts.ts"), "utf8");
    expect(source).toContain("isFixture: true");
    expect(source).toContain("isPaidProvider: false");
  });
});
