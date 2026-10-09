// The guarded Liam take of the "PC won't turn on?" Short: the exact approved
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
import { assertPowerSwitchScript, generateLiamPowerSwitchTake, lineTimingsFromAlignment, loadPowerSwitchTake, type Alignment } from "./liamTake.ts";
import { COPY } from "./openingTest.ts";
import { APPROVED_POWER_SWITCH_LINES, POWER_SWITCH_TAKE_TEXT } from "./script.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "power-take-")); dirs.push(dir); return dir; };
const LIAM_ENV = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: REVIEWED_LIAM_VOICE.voiceId };

/** Evenly spaced character timestamps for the exact text: a test fixture, never a take. */
function uniformAlignment(text = POWER_SWITCH_TAKE_TEXT, perChar = 0.06): Alignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => Math.round(i * perChar * 1000) / 1000),
    character_end_times_seconds: characters.map((_, i) => Math.round((i + 1) * perChar * 1000) / 1000),
  };
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
      return new Response(JSON.stringify({ audio_base64: Buffer.from("TEST AUDIO BYTES").toString("base64"), alignment: uniformAlignment() }), { headers: { "character-cost": "66" } });
    }
    return new Response("not found", { status: 404 });
  }) as never;
  return { calls, fetchImpl };
}

describe("the approved text", () => {
  it("is the owner's 66-character script, byte for byte, in plain ASCII, within the unchanged cap", () => {
    expect(POWER_SWITCH_TAKE_TEXT).toBe("PC won't turn on? Check the switch on the back. O is off. I is on.");
    expect(POWER_SWITCH_TAKE_TEXT).toHaveLength(66);
    expect(createHash("sha256").update(POWER_SWITCH_TAKE_TEXT).digest("hex")).toBe("0aa60d73f3aef3529629b1dab8b8d4d63d1adc21b97d194531f4df4366554c66");
    expect(MAX_SAMPLE_CHARACTERS).toBe(360);
    expect(() => assertPowerSwitchScript()).not.toThrow();
    expect(readFileSync(join(import.meta.dirname, "VOICE_SCRIPT.md"), "utf8")).toContain(`\`\`\`text\n${POWER_SWITCH_TAKE_TEXT}\n\`\`\``);
  });

  it("is what the cut's captions say, line for line", () => {
    expect(COPY.captions.map((caption) => caption.text)).toEqual(APPROVED_POWER_SWITCH_LINES.map((line) => line.spoken));
  });

  it("refuses any changed word before any request", async () => {
    const changed = APPROVED_POWER_SWITCH_LINES.map((line) => ({ ...line }));
    changed[1] = { ...changed[1], spoken: "Check the switch on the back first." };
    expect(() => assertPowerSwitchScript(changed)).toThrow(/Refusing to generate/);
    const { calls, fetchImpl } = provider();
    await expect(generateLiamPowerSwitchTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir(), lines: changed })).rejects.toThrow(/not the approved script/);
    expect(calls).toEqual([]);
  });
});

describe("nothing is sent unless every guard holds", () => {
  it("with every guard satisfied, makes exactly one generation request with the approved text, and saves a take the loader accepts", async () => {
    const { calls, fetchImpl } = provider();
    const outputDir = tempDir();
    const result = await generateLiamPowerSwitchTake({ env: LIAM_ENV, fetchImpl, outputDir });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain(`/v1/text-to-speech/${REVIEWED_LIAM_VOICE.voiceId}/with-timestamps`);
    expect(JSON.parse(posts[0].body!).text).toBe(POWER_SWITCH_TAKE_TEXT);
    expect(result).toMatchObject({ charactersSent: 66, providerReportedCharacterCost: 66, alignmentError: null });
    expect(readdirSync(outputDir).sort()).toEqual(["power-switch-liam.json", "power-switch-liam.mp3", "power-switch-liam.response.json"]);
    expect(readFileSync(join(outputDir, "power-switch-liam.json"), "utf8")).not.toContain(LIAM_ENV.ELEVENLABS_API_KEY);
    const take = await loadPowerSwitchTake(outputDir);
    expect(take.sha256).toBe(result.sha256);
    expect(take.lineTimings.map((line) => line.id)).toEqual(["hook", "where", "off", "on"]);
  });

  it("refuses before the generation request when an overage could be billed or the allowance is short", async () => {
    for (const options of [{ canExtend: true }, { remaining: 65 }]) {
      const { calls, fetchImpl } = provider(options);
      await expect(generateLiamPowerSwitchTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow();
      expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    }
  });

  it("refuses a provider voice labelled Liam with another id, before the generation request", async () => {
    const { calls, fetchImpl } = provider({ voiceId: "not-liam" });
    await expect(generateLiamPowerSwitchTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/does not match the reviewed SpecSmith Liam id/);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("makes no request at all without a key", async () => {
    const { calls, fetchImpl } = provider();
    await expect(generateLiamPowerSwitchTake({ env: {}, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/No fixture voice is ever substituted/);
    expect(calls).toEqual([]);
  });
});

describe("line timings and the loader", () => {
  it("gives each line its own span, in order", () => {
    const timings = lineTimingsFromAlignment(uniformAlignment());
    expect(timings.map((timing) => timing.id)).toEqual(["hook", "where", "off", "on"]);
    for (let i = 1; i < timings.length; i += 1) expect(timings[i].start).toBeGreaterThan(timings[i - 1].end);
  });

  it("refuses timestamps that do not spell the approved text", () => {
    expect(() => lineTimingsFromAlignment(uniformAlignment(POWER_SWITCH_TAKE_TEXT.replace("back", "side")))).toThrow(/do not spell the approved text/);
  });

  it("refuses a saved take whose audio bytes no longer match its manifest", async () => {
    const outputDir = tempDir();
    await generateLiamPowerSwitchTake({ env: LIAM_ENV, fetchImpl: provider().fetchImpl, outputDir });
    writeFileSync(join(outputDir, "power-switch-liam.mp3"), "DIFFERENT BYTES");
    await expect(loadPowerSwitchTake(outputDir)).rejects.toThrow(/do not match its manifest/);
  });
});
