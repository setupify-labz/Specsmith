// The one Liam take of the RAM-fit pilot: every guard runs before the paid
// request, exactly one request is made with exactly the approved text, nothing
// paid is lost to a parse error, and no other voice is ever tried. All against
// a fake provider: no network, no spend.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_SAMPLE_CHARACTERS } from "../elevenLabsVoiceSample.ts";
import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { ramFitFacts } from "./facts.ts";
import {
  APPROVED_RAM_FIT_LINES,
  assertApprovedRamFitScript,
  generateLiamRamFitTake,
  lineTimingsFromAlignment,
  RAM_FIT_TAKE_AUDIO,
  RAM_FIT_TAKE_MANIFEST,
  RAM_FIT_TAKE_RAW,
  RAM_FIT_TAKE_TEXT,
} from "./liamTake.ts";
import { pilotScenes } from "./storyboard.ts";
import { fakeAlignment } from "./testTake.ts";

const LIAM = REVIEWED_LIAM_VOICE.voiceId;
const env = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: LIAM } as NodeJS.ProcessEnv;

let mp3: Buffer;
let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "ram-fit-take-test-"));
  const path = join(work, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-ar", "44100", "-ac", "1", "-b:a", "64k", path]);
  mp3 = await readFile(path);
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

interface Calls { urls: string[]; bodies: string[] }
function fakeProvider(over: { subscription?: Record<string, unknown>; voices?: unknown; take?: unknown; status?: number } = {}) {
  const calls: Calls = { urls: [], bodies: [] };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.urls.push(url);
    if (init?.body) calls.bodies.push(String(init.body));
    if (url.endsWith("/v1/user/subscription")) {
      return new Response(JSON.stringify(over.subscription ?? { tier: "starter", character_count: 100, character_limit: 67000, can_extend_character_limit: false }));
    }
    if (url.endsWith("/v1/voices")) {
      return new Response(JSON.stringify(over.voices ?? { voices: [{ voice_id: LIAM, name: "Liam - Energetic, Social Media Creator" }] }));
    }
    return new Response(JSON.stringify(over.take ?? { audio_base64: mp3.toString("base64"), alignment: fakeAlignment() }), {
      status: over.status ?? 200, headers: { "content-type": "application/json", "character-cost": "167" },
    });
  };
  return { calls, fetchImpl };
}
const generations = (calls: Calls) => calls.urls.filter((url) => url.includes("/v1/text-to-speech/")).length;

describe("the approved script", () => {
  it("is exactly the five final lines, in order, and the video speaks exactly these", () => {
    expect(APPROVED_RAM_FIT_LINES.map((line) => line.text)).toEqual([
      "DDR4 RAM won't fit a DDR5 slot.",
      "The notch doesn't line up.",
      "Use DDR5 RAM here, or a DDR4 board compatible with your CPU.",
      "SpecSmith catches it.",
      "Check yours at SpecSmith.",
    ]);
    expect(pilotScenes(ramFitFacts()).map((scene) => ({ id: scene.id, text: scene.narration }))).toEqual(APPROVED_RAM_FIT_LINES);
    expect(() => assertApprovedRamFitScript()).not.toThrow();
  });

  it("is 167 characters, inside the shared cap", () => {
    expect(RAM_FIT_TAKE_TEXT.length).toBe(167);
    expect(RAM_FIT_TAKE_TEXT.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARACTERS);
  });
});

describe("before any spend", () => {
  it("refuses George, a missing id, or a provider 'Liam' that is not the pinned id, with no generation request", async () => {
    await expect(generateLiamRamFitTake({ env: { ...env, ELEVENLABS_VOICE_ID: GEORGE_VOICE_ID }, outputDir: join(work, "a") })).rejects.toThrow();
    await expect(generateLiamRamFitTake({ env: { ELEVENLABS_API_KEY: "test-key-not-real" } as NodeJS.ProcessEnv, outputDir: join(work, "a2") })).rejects.toThrow();
    const { calls, fetchImpl } = fakeProvider({ voices: { voices: [{ voice_id: "someone-else", name: "Liam" }] } });
    await expect(generateLiamRamFitTake({ env, fetchImpl, outputDir: join(work, "b") })).rejects.toThrow(/does not match/);
    expect(generations(calls)).toBe(0);
  });

  it("refuses when Liam is absent from the account, without trying another voice", async () => {
    const { calls, fetchImpl } = fakeProvider({ voices: { voices: [{ voice_id: GEORGE_VOICE_ID, name: "George" }] } });
    await expect(generateLiamRamFitTake({ env, fetchImpl, outputDir: join(work, "absent") })).rejects.toThrow(/not on this ElevenLabs account/);
    expect(generations(calls)).toBe(0);
  });

  it("refuses an account that can top up, lacks the characters, or hides its billing, with no generation request", async () => {
    for (const subscription of [
      { tier: "starter", character_count: 0, character_limit: 67000, can_extend_character_limit: true },
      { tier: "starter", character_count: 66900, character_limit: 67000, can_extend_character_limit: false },
      { tier: "starter", character_count: 0, character_limit: 67000 },
    ]) {
      const { calls, fetchImpl } = fakeProvider({ subscription });
      await expect(generateLiamRamFitTake({ env, fetchImpl, outputDir: join(work, "c") })).rejects.toThrow();
      expect(generations(calls)).toBe(0);
    }
  });

  it("refuses without an API key rather than substituting any voice", async () => {
    await expect(generateLiamRamFitTake({ env: {} as NodeJS.ProcessEnv, outputDir: join(work, "nokey") })).rejects.toThrow(/No fixture voice/);
  });
});

describe("the one request", () => {
  it("sends exactly the approved text once, to Liam's timestamped endpoint, and keeps the take", async () => {
    const { calls, fetchImpl } = fakeProvider();
    const dir = join(work, "take");
    const result = await generateLiamRamFitTake({ env, fetchImpl, outputDir: dir });
    expect(generations(calls)).toBe(1);
    expect(calls.urls.find((url) => url.includes("/v1/text-to-speech/"))).toContain(`/v1/text-to-speech/${LIAM}/with-timestamps`);
    expect(JSON.parse(calls.bodies[0]).text).toBe(RAM_FIT_TAKE_TEXT);
    expect(result.providerReportedCharacterCost).toBe(167);
    expect(await readFile(join(dir, RAM_FIT_TAKE_AUDIO))).toEqual(mp3);
    const manifest = JSON.parse(await readFile(join(dir, RAM_FIT_TAKE_MANIFEST), "utf8"));
    expect(manifest).toMatchObject({ voiceId: LIAM, text: RAM_FIT_TAKE_TEXT, isFixture: false, alignmentError: null, toppedUp: false });
    expect(manifest.lineTimings.map((timing: { id: string }) => timing.id)).toEqual(["fail", "notch", "choice", "payoff", "cta"]);
    expect(manifest.alignment.characters.join("")).toBe(RAM_FIT_TAKE_TEXT);
  });

  it("keeps the raw response and the audio even when the timestamps cannot be read", async () => {
    const { fetchImpl } = fakeProvider({ take: { audio_base64: mp3.toString("base64"), alignment: { characters: ["x"] } } });
    const dir = join(work, "no-alignment");
    const result = await generateLiamRamFitTake({ env, fetchImpl, outputDir: dir });
    expect(result.lineTimings).toBeNull();
    expect(result.alignmentError).toBeTruthy();
    expect((await readFile(join(dir, RAM_FIT_TAKE_RAW))).length).toBeGreaterThan(0);
    expect(await readFile(join(dir, RAM_FIT_TAKE_AUDIO))).toEqual(mp3);
    expect(JSON.parse(await readFile(join(dir, RAM_FIT_TAKE_MANIFEST), "utf8")).alignment).toBeNull();
  });

  it("stops on a provider failure without trying another voice", async () => {
    const { calls, fetchImpl } = fakeProvider({ status: 401, take: { detail: "payment_required" } });
    await expect(generateLiamRamFitTake({ env, fetchImpl, outputDir: join(work, "fail") })).rejects.toThrow(/HTTP 401/);
    expect(generations(calls)).toBe(1);
  });
});

describe("cutting the take into lines", () => {
  it("reads each line's span from the provider's timestamps, and refuses timestamps for other text", () => {
    const timings = lineTimingsFromAlignment(fakeAlignment());
    expect(timings.map((timing) => timing.id)).toEqual(["fail", "notch", "choice", "payoff", "cta"]);
    expect(timings[1].start).toBeGreaterThan(timings[0].end);
    expect(() => lineTimingsFromAlignment(fakeAlignment(RAM_FIT_TAKE_TEXT.replace("your CPU", "this CPU")))).toThrow(/do not spell/);
  });
});
