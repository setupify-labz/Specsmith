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

function audioResponse(
  bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]),
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", ...headers } });
}

/** A subscription body with every billing field present and well typed. */
function subscriptionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier: "starter",
    character_count: 1_000,
    character_limit: 30_000,
    can_extend_character_limit: false,
    ...overrides,
  };
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
      return jsonResponse(options.subscriptionBody ?? subscriptionBody());
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

describe("voice selection stops rather than substituting", () => {
  it("uses Liam when the account has it", async () => {
    const voice = await resolveVoice(CONFIG, stubFetch());
    expect(voice.name).toBe(PREFERRED_VOICE_NAME);
    expect(voice.voiceId).toBe("liam-voice-id");
  });

  it("stops when Liam is absent instead of picking another voice", async () => {
    await expect(
      resolveVoice(CONFIG, stubFetch({ voices: [{ voice_id: CONFIG.voiceId, name: "George" }] })),
    ).rejects.toThrow(/is not on this ElevenLabs account/);
  });

  it("names the voices that ARE available, so the answer is actionable", async () => {
    await expect(
      resolveVoice(
        CONFIG,
        stubFetch({ voices: [{ voice_id: "a", name: "George" }, { voice_id: "b", name: "Rachel" }] }),
      ),
    ).rejects.toThrow(/George, Rachel/);
  });

  it("stops even when the account returns no voices at all", async () => {
    await expect(resolveVoice(CONFIG, stubFetch({ voices: [] }))).rejects.toThrow(/never substitutes another voice/);
  });

  it("does not fall back to the configured default voice id", async () => {
    // The adapter's DEFAULT_VOICE_ID is George. Before this rule, an account
    // without Liam would have silently auditioned George.
    await expect(
      resolveVoice(CONFIG, stubFetch({ voices: [{ voice_id: CONFIG.voiceId, name: "George" }] })),
    ).rejects.toThrow(VoiceSampleError);
  });

  it("spends nothing and writes nothing when Liam is absent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    const ttsCalls: string[] = [];
    try {
      await expect(
        generateVoiceSample({
          env: ENV,
          outputDir: directory,
          fetchImpl: stubFetch({
            voices: [{ voice_id: CONFIG.voiceId, name: "George" }],
            onTts: (url) => ttsCalls.push(url),
          }),
        }),
      ).rejects.toThrow(/is not on this ElevenLabs account/);

      // The generation endpoint is what costs money. It must never be reached.
      expect(ttsCalls).toEqual([]);
      expect(() => readFileSync(join(directory, "specsmith-voice-sample.mp3"))).toThrow();
      expect(() => readFileSync(join(directory, "specsmith-voice-sample.json"))).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

describe("billing fields must be explicit, and nothing generates until they are", () => {
  /** Runs the sample against a subscription body and records TTS calls. */
  async function attempt(body: Record<string, unknown> | undefined) {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    const ttsCalls: string[] = [];
    try {
      const error = await generateVoiceSample({
        env: ENV,
        outputDir: directory,
        fetchImpl: stubFetch({ subscriptionBody: body, onTts: (url) => ttsCalls.push(url) }),
      }).then(
        () => null,
        (caught: unknown) => caught as Error,
      );
      return {
        error,
        ttsCalls,
        wroteAudio: (() => {
          try {
            readFileSync(join(directory, "specsmith-voice-sample.mp3"));
            return true;
          } catch {
            return false;
          }
        })(),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("requires can_extend_character_limit to be exactly false", async () => {
    const result = await attempt(subscriptionBody());
    expect(result.error).toBeNull();
    expect(result.ttsCalls).toHaveLength(1);
  });

  it.each([
    ["missing", { can_extend_character_limit: undefined }],
    ["null", { can_extend_character_limit: null }],
    ["the string \"false\"", { can_extend_character_limit: "false" }],
    ["the number 0", { can_extend_character_limit: 0 }],
    ["an object", { can_extend_character_limit: {} }],
  ])("stops before any generation call when can_extend_character_limit is %s", async (_label, overrides) => {
    const body = subscriptionBody(overrides);
    if (overrides.can_extend_character_limit === undefined) delete body.can_extend_character_limit;

    const result = await attempt(body);
    expect(result.error?.message).toMatch(/can_extend_character_limit as a boolean/);
    expect(result.error?.message).toMatch(/not the same as knowing it does not/);
    expect(result.ttsCalls).toEqual([]);
    expect(result.wroteAudio).toBe(false);
  });

  it("stops before any generation call when the account can extend", async () => {
    const result = await attempt(subscriptionBody({ can_extend_character_limit: true }));
    expect(result.error?.message).toMatch(/overage here would be billed/);
    expect(result.ttsCalls).toEqual([]);
    expect(result.wroteAudio).toBe(false);
  });

  it.each([
    ["character_count missing", { character_count: undefined }],
    ["character_count as a string", { character_count: "1000" }],
    ["character_count null", { character_count: null }],
    ["character_limit missing", { character_limit: undefined }],
    ["character_limit as a string", { character_limit: "30000" }],
    ["character_limit NaN-ish", { character_limit: Number.NaN }],
  ])("stops before any generation call when %s", async (_label, overrides) => {
    const body = subscriptionBody(overrides);
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete body[key];

    const result = await attempt(body);
    expect(result.error?.message).toMatch(/Refusing to generate on an unreadable allowance|negative/);
    expect(result.ttsCalls).toEqual([]);
    expect(result.wroteAudio).toBe(false);
  });

  it("stops on a negative allowance rather than reasoning about it", async () => {
    const result = await attempt(subscriptionBody({ character_count: -5 }));
    expect(result.error?.message).toMatch(/negative character_count/);
    expect(result.ttsCalls).toEqual([]);
  });

  it("does not coerce a string tier into a usable one, but does not block on it either", async () => {
    // Tier is descriptive, not a billing control. It must not stop generation.
    const result = await attempt(subscriptionBody({ tier: 7 }));
    expect(result.error).toBeNull();
    expect(result.ttsCalls).toHaveLength(1);
  });
});

describe("cost is reported as what it is", () => {
  async function run(ttsHeaders: Record<string, string>) {
    const directory = mkdtempSync(join(tmpdir(), "voice-sample-"));
    try {
      const result = await generateVoiceSample({
        env: ENV,
        outputDir: directory,
        fetchImpl: stubFetch({ ttsResponse: () => audioResponse(undefined, ttsHeaders) }),
      });
      return {
        result,
        manifest: JSON.parse(readFileSync(result.manifestPath, "utf8")) as Record<string, unknown>,
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("records the provider's reported charge when it reports one", async () => {
    const { result, manifest } = await run({ "character-cost": "118" });
    expect(result.providerReportedCharacterCost).toBe(118);
    expect(manifest.providerReportedCharacterCost).toBe(118);
    expect(manifest.characterCostIsProviderReported).toBe(true);
  });

  it("records null, not the request length, when the provider reports nothing", async () => {
    const { result, manifest } = await run({});
    expect(result.providerReportedCharacterCost).toBeNull();
    expect(manifest.providerReportedCharacterCost).toBeNull();
    expect(manifest.characterCostIsProviderReported).toBe(false);
    // The crucial part: the estimate must not be laundered into the reported field.
    expect(manifest.providerReportedCharacterCost).not.toBe(manifest.estimatedCharacterCost);
  });

  it.each(["", "   ", "not-a-number", "-4"])(
    "treats an unusable character-cost header (%s) as unreported rather than guessing",
    async (header) => {
      const { manifest } = await run({ "character-cost": header });
      expect(manifest.providerReportedCharacterCost).toBeNull();
      expect(manifest.characterCostIsProviderReported).toBe(false);
    },
  );

  it("labels the request length as an estimate and says what it is based on", async () => {
    const { manifest } = await run({});
    expect(manifest.estimatedCharacterCost).toBe(SAMPLE_TEXT.length);
    expect(manifest.requestCharactersSent).toBe(SAMPLE_TEXT.length);
    expect(String(manifest.estimatedCharacterCostBasis)).toMatch(/may bill a different amount/);
  });

  it("no longer claims a figure for characters actually spent", async () => {
    const { manifest } = await run({});
    expect(manifest).not.toHaveProperty("spentIncludedCharacters");
  });
});
