// The guarded Liam take of the two-checks Short's SECOND approved narration: the exact approved
// words, the shared spending guards unchanged, nothing sent unless all of it
// holds, line timings from the provider's timestamps, and a loader that
// refuses a take that is not the approved one.

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { MAX_SAMPLE_CHARACTERS } from "../voiceSpendGuards.ts";
import { APPROVED_TAKE, assertTwoChecksV2Script, generateLiamTwoChecksV2Take, lineTimingsFromAlignment, loadTwoChecksV2Take, type Alignment, type TakePin } from "./liamTakeV2.ts";
import { APPROVED_TWO_CHECKS_V2_LINES, TWO_CHECKS_V2_TAKE_TEXT } from "./scriptV2.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "two-checks-v2-take-")); dirs.push(dir); return dir; };
const LIAM_ENV = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: REVIEWED_LIAM_VOICE.voiceId };

/** Evenly spaced character timestamps for the exact text: a test fixture, never a take. */
function uniformAlignment(text = TWO_CHECKS_V2_TAKE_TEXT, perChar = 0.06): Alignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => Math.round(i * perChar * 1000) / 1000),
    character_end_times_seconds: characters.map((_, i) => Math.round((i + 1) * perChar * 1000) / 1000),
  };
}

/** The pin of a fixture take written by these tests: never the approved take. */
function fixturePin(dir: string): TakePin {
  const manifest = JSON.parse(readFileSync(join(dir, "two-checks-v2-liam.json"), "utf8"));
  return { audioSha256: manifest.audio.sha256, alignmentSha256: createHash("sha256").update(JSON.stringify(manifest.alignment)).digest("hex") };
}

/** A stand-in provider: subscription, voices and one timestamped take. TEST RESPONSES, never a real take. */
function provider(options: { canExtend?: boolean; remaining?: number; voiceId?: string } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/v1/user/subscription")) {
      return new Response(JSON.stringify({ tier: "creator", character_count: 1000, character_limit: 1000 + (options.remaining ?? 5000), can_extend_character_limit: options.canExtend ?? false }));
    }
    if (url.endsWith("/v1/voices")) {
      return new Response(JSON.stringify({ voices: [{ voice_id: options.voiceId ?? REVIEWED_LIAM_VOICE.voiceId, name: "Liam - Energetic, Social Media Creator" }] }));
    }
    if (url.includes("/with-timestamps")) {
      return new Response(JSON.stringify({ audio_base64: Buffer.from("TEST AUDIO BYTES").toString("base64"), alignment: uniformAlignment() }), { headers: { "character-cost": "171" } });
    }
    return new Response("not found", { status: 404 });
  }) as never;
  return { calls, fetchImpl };
}

describe("the approved text", () => {
  it("is the owner's second, 171-character script, byte for byte, in plain ASCII, within the unchanged cap", () => {
    expect(TWO_CHECKS_V2_TAKE_TEXT).toBe("PC won't turn on? Check the power supply switch. If it's on O, flip it to I. PC on, but no picture? If you have a graphics card, make sure your monitor is plugged into it.");
    expect(TWO_CHECKS_V2_TAKE_TEXT).toHaveLength(171);
    expect(createHash("sha256").update(TWO_CHECKS_V2_TAKE_TEXT).digest("hex")).toBe("5fd951ad6408b0cb1e1d51e373512f6a2159a704780860ed145d92f7b9b0f7dc");
    expect(MAX_SAMPLE_CHARACTERS).toBe(360);
    expect(() => assertTwoChecksV2Script()).not.toThrow();
  });

  it("refuses any changed word before any request", async () => {
    const changed = APPROVED_TWO_CHECKS_V2_LINES.map((line) => ({ ...line }));
    changed[1] = { ...changed[1], spoken: "Check the power supply switch first." };
    expect(() => assertTwoChecksV2Script(changed)).toThrow(/Refusing to generate/);
    const { calls, fetchImpl } = provider();
    await expect(generateLiamTwoChecksV2Take({ env: LIAM_ENV, fetchImpl, outputDir: tempDir(), lines: changed })).rejects.toThrow(/not the approved script/);
    expect(calls).toEqual([]);
  });
});

describe("nothing is sent unless every guard holds", () => {
  it("with every guard satisfied, makes exactly one generation request with the approved text, and saves a take the loader accepts", async () => {
    const { calls, fetchImpl } = provider();
    const outputDir = tempDir();
    const result = await generateLiamTwoChecksV2Take({ env: LIAM_ENV, fetchImpl, outputDir });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain(`/v1/text-to-speech/${REVIEWED_LIAM_VOICE.voiceId}/with-timestamps`);
    expect(JSON.parse(posts[0].body!).text).toBe(TWO_CHECKS_V2_TAKE_TEXT);
    expect(result).toMatchObject({ charactersSent: 171, providerReportedCharacterCost: 171, alignmentError: null });
    expect(readdirSync(outputDir).sort()).toEqual(["two-checks-v2-liam.json", "two-checks-v2-liam.mp3", "two-checks-v2-liam.response.json"]);
    expect(readFileSync(join(outputDir, "two-checks-v2-liam.json"), "utf8")).not.toContain(LIAM_ENV.ELEVENLABS_API_KEY);
    // A fixture take is consistent with its own manifest, but it is not the approved take.
    await expect(loadTwoChecksV2Take(outputDir)).rejects.toThrow(/not the approved take/);
    const take = await loadTwoChecksV2Take(outputDir, fixturePin(outputDir));
    expect(take.sha256).toBe(result.sha256);
    expect(take.lineTimings.map((line) => line.id)).toEqual(["hook", "where", "flip", "symptom", "cable"]);
  });

  it("refuses before the generation request when an overage could be billed or the allowance is short", async () => {
    for (const options of [{ canExtend: true }, { remaining: 170 }]) {
      const { calls, fetchImpl } = provider(options);
      await expect(generateLiamTwoChecksV2Take({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow();
      expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    }
  });

  it("refuses a provider voice labelled Liam with another id, before the generation request", async () => {
    const { calls, fetchImpl } = provider({ voiceId: "not-liam" });
    await expect(generateLiamTwoChecksV2Take({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/does not match the reviewed SpecSmith Liam id/);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("makes no request at all without a key", async () => {
    const { calls, fetchImpl } = provider();
    await expect(generateLiamTwoChecksV2Take({ env: {}, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/No fixture voice is ever substituted/);
    expect(calls).toEqual([]);
  });
});

describe("line timings and the loader", () => {
  it("gives each line its own span, in order", () => {
    const timings = lineTimingsFromAlignment(uniformAlignment());
    expect(timings.map((timing) => timing.id)).toEqual(["hook", "where", "flip", "symptom", "cable"]);
    for (let i = 1; i < timings.length; i += 1) expect(timings[i].start).toBeGreaterThan(timings[i - 1].end);
  });

  it("refuses timestamps that do not spell the approved text", () => {
    expect(() => lineTimingsFromAlignment(uniformAlignment(TWO_CHECKS_V2_TAKE_TEXT.replace("into it", "onto it")))).toThrow(/do not spell the approved text/);
  });

  it("refuses a saved take whose audio bytes no longer match its manifest", async () => {
    const outputDir = tempDir();
    await generateLiamTwoChecksV2Take({ env: LIAM_ENV, fetchImpl: provider().fetchImpl, outputDir });
    const pin = fixturePin(outputDir);
    writeFileSync(join(outputDir, "two-checks-v2-liam.mp3"), "DIFFERENT BYTES");
    await expect(loadTwoChecksV2Take(outputDir, pin)).rejects.toThrow(/do not match its manifest/);
  });

  it("accepts the committed v2 take only as the pinned approved one", async () => {
    const committed = join(import.meta.dirname, "takeV2");
    const take = await loadTwoChecksV2Take(committed);
    expect(take.sha256).toBe(APPROVED_TAKE!.audioSha256);
    const dir = tempDir();
    const manifest = JSON.parse(readFileSync(join(committed, "two-checks-v2-liam.json"), "utf8"));
    writeFileSync(join(dir, "two-checks-v2-liam.mp3"), readFileSync(join(committed, "two-checks-v2-liam.mp3")));
    manifest.alignment.character_start_times_seconds = manifest.alignment.character_start_times_seconds.map((t: number) => t + 0.01);
    writeFileSync(join(dir, "two-checks-v2-liam.json"), JSON.stringify(manifest));
    await expect(loadTwoChecksV2Take(dir)).rejects.toThrow(/timestamps are not the approved take's/);
  });

  it("refuses everything when no take is pinned", async () => {
    await expect(loadTwoChecksV2Take(join(import.meta.dirname, "take"), null)).rejects.toThrow(/No two-checks v2 take is pinned/);
  });
});
