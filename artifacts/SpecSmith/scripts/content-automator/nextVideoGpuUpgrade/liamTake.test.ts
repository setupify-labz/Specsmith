// The guarded Liam take of the GPU-upgrade Short: the exact approved text, the
// model recomputed before any spend, each spoken line tied to its beat, the
// shared spending guards unchanged, and nothing sent unless all of it holds.

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { MAX_SAMPLE_CHARACTERS } from "../voiceSpendGuards.ts";
import {
  APPROVED_GPU_UPGRADE_LINES,
  assertGpuUpgradeStory,
  generateLiamGpuUpgradeTake,
  GPU_TAKE_CONCEPT_FILE,
  GPU_TAKE_TEXT,
  lineTimingsFromAlignment,
  type Alignment,
} from "./liamTake.ts";
import { gpuUpgradeFacts } from "./research.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "gpu-take-")); dirs.push(dir); return dir; };
const LIAM_ENV = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: REVIEWED_LIAM_VOICE.voiceId };
const countingFetch = () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => { calls.push(String(url)); throw new Error("no network in tests"); }) as never;
  return { calls, fetchImpl };
};

/** Evenly spaced character timestamps for the exact text: a test fixture, never a take. */
function uniformAlignment(text = GPU_TAKE_TEXT, perChar = 0.05): Alignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => Math.round(i * perChar * 1000) / 1000),
    character_end_times_seconds: characters.map((_, i) => Math.round((i + 1) * perChar * 1000) / 1000),
  };
}

describe("the approved text", () => {
  it("is the trimmed 314-character script approved for the take, byte for byte, within the unchanged cap", () => {
    expect(GPU_TAKE_TEXT).toHaveLength(314);
    expect(GPU_TAKE_TEXT.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARACTERS);
    expect(createHash("sha256").update(GPU_TAKE_TEXT).digest("hex")).toBe("fd154a03bcda906e7901b6a97be7d879c9ae4d1e0098ec1777364e692a82d19e");
    expect([...GPU_TAKE_TEXT].every((char) => char.charCodeAt(0) < 128)).toBe(true);
    const script = readFileSync(join(import.meta.dirname, "VOICE_SCRIPT.md"), "utf8");
    expect(script).toContain(`\`\`\`text\n${GPU_TAKE_TEXT}\n\`\`\``);
  });

  it("passes its factual check against the model and the approved concept", () => {
    expect(() => assertGpuUpgradeStory()).not.toThrow();
  });

  it("refuses before any spend if a figure the narration speaks has moved", () => {
    const facts = gpuUpgradeFacts();
    const moved = { ...facts, gpuHeavy: { ...facts.gpuHeavy, fpsA: 66 } };
    expect(() => assertGpuUpgradeStory(moved)).toThrow(/Alan Wake 2 is 43 -> 66, not 43 -> 65/);
    const boost = { ...facts, cpuHeavy: { ...facts.cpuHeavy, percent: 15 } };
    expect(() => assertGpuUpgradeStory(boost)).toThrow(/Valorant's boost is 15%/);
  });

  it("refuses if a beat's approved narration no longer matches its spoken line", () => {
    const concept = JSON.parse(readFileSync(GPU_TAKE_CONCEPT_FILE, "utf8"));
    concept.beats[2].narration = "Valorant: 263 to 306.";
    const file = join(tempDir(), "concept.json");
    writeFileSync(file, JSON.stringify(concept));
    expect(() => assertGpuUpgradeStory(undefined, file)).toThrow(/beat 3's narration is not the approved/);
  });

  it("refuses a spoken line that says anything but its beat's narration with the figures spelled out", () => {
    const lines = APPROVED_GPU_UPGRADE_LINES.map((line) => ({ ...line }));
    lines[1] = { ...lines[1], spoken: lines[1].spoken.replace("sixty-five", "seventy-five") };
    expect(() => assertGpuUpgradeStory(undefined, undefined, lines)).toThrow(/line 2 says .* which is not "Alan Wake 2: 43 to 65 estimated FPS\."/);
    lines[1] = { ...APPROVED_GPU_UPGRADE_LINES[1], spoken: `${APPROVED_GPU_UPGRADE_LINES[1].spoken} Easily.` };
    expect(() => assertGpuUpgradeStory(undefined, undefined, lines)).toThrow(/line 2 says/);
  });

  it("speaks each beat's narration with only the figures spelled out", () => {
    const concept = JSON.parse(readFileSync(GPU_TAKE_CONCEPT_FILE, "utf8")) as { beats: { narration: string }[] };
    expect(APPROVED_GPU_UPGRADE_LINES.map((line) => line.beatNarration)).toEqual(concept.beats.map((beat) => beat.narration));
  });
});

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
      return new Response(JSON.stringify({ audio_base64: Buffer.from("TEST AUDIO BYTES").toString("base64"), alignment: uniformAlignment() }), { headers: { "character-cost": "314" } });
    }
    return new Response("not found", { status: 404 });
  }) as never;
  return { calls, fetchImpl };
}

describe("nothing is sent unless every guard holds", () => {
  it("with every guard satisfied, makes exactly one generation request with the approved text, and saves a take the loader accepts", async () => {
    const { calls, fetchImpl } = provider();
    const outputDir = tempDir();
    const result = await generateLiamGpuUpgradeTake({ env: LIAM_ENV, fetchImpl, outputDir });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain(`/v1/text-to-speech/${REVIEWED_LIAM_VOICE.voiceId}/with-timestamps`);
    expect(JSON.parse(posts[0].body!).text).toBe(GPU_TAKE_TEXT);
    expect(result).toMatchObject({ charactersSent: 314, providerReportedCharacterCost: 314, alignmentError: null });
    expect(readdirSync(outputDir).sort()).toEqual(["gpu-upgrade-liam.json", "gpu-upgrade-liam.mp3", "gpu-upgrade-liam.response.json"]);
    const manifest = readFileSync(join(outputDir, "gpu-upgrade-liam.json"), "utf8");
    expect(manifest).not.toContain(LIAM_ENV.ELEVENLABS_API_KEY);
    const { loadGpuUpgradeTake } = await import("./takeTiming.ts");
    const take = await loadGpuUpgradeTake(outputDir);
    expect(take.take.sha256).toBe(result.sha256);
  });

  it("refuses before the generation request when an overage could be billed or the allowance is short", async () => {
    for (const options of [{ canExtend: true }, { remaining: 313 }]) {
      const { calls, fetchImpl } = provider(options);
      await expect(generateLiamGpuUpgradeTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow();
      expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    }
  });

  it("refuses a provider voice labelled Liam with another id, before the generation request", async () => {
    const { calls, fetchImpl } = provider({ voiceId: "not-liam" });
    await expect(generateLiamGpuUpgradeTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/does not match the reviewed SpecSmith Liam id/);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("makes no request at all without a key, or with a changed figure", async () => {
    const { calls, fetchImpl } = countingFetch();
    await expect(generateLiamGpuUpgradeTake({ env: {}, fetchImpl, outputDir: tempDir() })).rejects.toThrow(/No fixture voice is ever substituted/);
    const facts = gpuUpgradeFacts();
    await expect(generateLiamGpuUpgradeTake({ env: LIAM_ENV, fetchImpl, outputDir: tempDir(), facts: { ...facts, cpuHeavy: { ...facts.cpuHeavy, fpsA: 300 } } })).rejects.toThrow(/Refusing to generate/);
    expect(calls).toEqual([]);
  });

  it("keeps the shared cap at 360, unchanged", () => {
    expect(MAX_SAMPLE_CHARACTERS).toBe(360);
  });

  it("refuses George, a missing or another voice id before any request", async () => {
    const { liamTakeConfigFromEnv } = await import("../voiceSpendGuards.ts");
    expect(() => liamTakeConfigFromEnv({ ELEVENLABS_API_KEY: "k" })).toThrow(/voice-missing/);
    expect(() => liamTakeConfigFromEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: GEORGE_VOICE_ID })).toThrow(/voice-george/);
    expect(() => liamTakeConfigFromEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "someone-else" })).toThrow(/voice-not-liam/);
    expect(liamTakeConfigFromEnv({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: REVIEWED_LIAM_VOICE.voiceId })?.voiceId).toBe(REVIEWED_LIAM_VOICE.voiceId);
    expect(liamTakeConfigFromEnv({})).toBeUndefined();
  });
});

describe("line timings from the provider's timestamps", () => {
  it("gives each line its own span, in order", () => {
    const timings = lineTimingsFromAlignment(uniformAlignment());
    expect(timings.map((timing) => timing.id)).toEqual(["hook", "fps-aw", "fps-val", "percent", "explain", "ask"]);
    for (let i = 1; i < timings.length; i += 1) expect(timings[i].start).toBeGreaterThan(timings[i - 1].end);
    expect(timings[0].start).toBe(0);
  });

  it("refuses timestamps that do not spell the approved text", () => {
    expect(() => lineTimingsFromAlignment(uniformAlignment(GPU_TAKE_TEXT.replace("sixty-five", "sixty-six")))).toThrow(/do not spell the approved text/);
  });
});
