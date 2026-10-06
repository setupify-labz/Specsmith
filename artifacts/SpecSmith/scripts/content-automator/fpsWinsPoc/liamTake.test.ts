// The one Liam take of the FPS Short: the story is recomputed from the Compare
// model before any spend, every voice guard runs before the paid request,
// exactly one request carries exactly the approved text, and no other voice is
// tried. All against a fake provider: no network, no spend.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_SAMPLE_CHARACTERS } from "../elevenLabsVoiceSample.ts";
import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { APPROVED_FPS_TEXT, assertFpsStory, FPS_TAKE_MANIFEST, FPS_TAKE_RAW, fpsFigures, generateLiamFpsTake, type FpsFigures } from "./liamTake.ts";

const LIAM = REVIEWED_LIAM_VOICE.voiceId;
const env = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: LIAM } as NodeJS.ProcessEnv;
const alignmentFor = (text: string) => {
  const characters = [...text];
  return { characters, character_start_times_seconds: characters.map((_, i) => i * 0.05), character_end_times_seconds: characters.map((_, i) => i * 0.05 + 0.04) };
};

let mp3: Buffer;
let work: string;
let figures: FpsFigures;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "fps-take-test-"));
  const path = join(work, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-ar", "44100", "-ac", "1", "-b:a", "64k", path]);
  mp3 = await readFile(path);
  figures = await fpsFigures();
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

interface Calls { urls: string[]; bodies: string[] }
function fakeProvider(over: { subscription?: Record<string, unknown>; voices?: unknown; status?: number } = {}) {
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
    return new Response(JSON.stringify({ audio_base64: mp3.toString("base64"), alignment: alignmentFor(APPROVED_FPS_TEXT) }), {
      status: over.status ?? 200, headers: { "content-type": "application/json", "character-cost": "348" },
    });
  };
  return { calls, fetchImpl };
}
const generations = (calls: Calls) => calls.urls.filter((url) => url.includes("/v1/text-to-speech/")).length;

describe("the approved script", () => {
  it("keeps every approved claim, in order, inside the shared cap", () => {
    const order = ["twenty games", "fourteen-forty-p High", "Cyberpunk", "Counter-Strike 2", "Call of Duty: Warzone", "Baldur's Gate 3", "blowout",
      "one-sixty-four versus one-sixty FPS", "only four FPS apart", "Model estimates, not measured benchmarks", "Would you have guessed four?"];
    const positions = order.map((phrase) => APPROVED_FPS_TEXT.indexOf(phrase));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(APPROVED_FPS_TEXT.length).toBe(348);
    expect(APPROVED_FPS_TEXT.length).toBeLessThanOrEqual(MAX_SAMPLE_CHARACTERS);
  });
});

describe("the story, recomputed from the Compare model before any spend", () => {
  it("holds today: same CPU, 20/20 leads, 0 ties, 164 vs 160, four verified spotlights", () => {
    expect(figures).toMatchObject({ sameCpu: true, games: 20, leadsA: 20, leadsB: 0, ties: 0, avgA: 164, avgB: 160 });
    expect(() => assertFpsStory(figures)).not.toThrow();
  });

  it("negative controls: a wrong average, a tie, a lost lead, a changed CPU or a renamed game are each refused", () => {
    const broken: [string, FpsFigures, RegExp][] = [
      ["average 165", { ...figures, avgA: 165 }, /averages are 165 vs 160/],
      ["average 161", { ...figures, avgB: 161 }, /averages are 164 vs 161/],
      ["a tie", { ...figures, leadsA: 19, ties: 1 }, /leads are 19\/0 with 1 ties/],
      ["different CPUs", { ...figures, sameCpu: false }, /no longer share one CPU/],
      ["renamed spotlight", { ...figures, perGame: figures.perGame.map((row) => (row.id === "cs2" ? { ...row, name: "CS2" } : row)) }, /"Counter-Strike 2" is not the catalogue's cs2/],
      ["spotlight not a lead", { ...figures, perGame: figures.perGame.map((row) => (row.id === "bg3" ? { ...row, b: row.a } : row)) }, /"Baldur's Gate 3" is not a Super lead/],
    ];
    for (const [, bad, reason] of broken) expect(() => assertFpsStory(bad), String(reason)).toThrow(reason);
  });

  it("refuses to spend when the story fails: no provider call at all", async () => {
    const { calls, fetchImpl } = fakeProvider();
    await expect(generateLiamFpsTake({ fetchImpl, env, outputDir: join(work, "stale"), figures: { ...figures, avgA: 165 } })).rejects.toThrow(/no longer matches/);
    expect(calls.urls).toEqual([]);
  });
});

describe("the one paid request", () => {
  it("makes exactly one generation with exactly the approved text, in Liam, and keeps the raw response", async () => {
    const { calls, fetchImpl } = fakeProvider();
    const dir = join(work, "ok");
    const result = await generateLiamFpsTake({ fetchImpl, env, outputDir: dir, figures });
    expect(generations(calls)).toBe(1);
    expect(calls.urls.find((url) => url.includes("/v1/text-to-speech/"))).toContain(`/v1/text-to-speech/${LIAM}/with-timestamps`);
    expect(JSON.parse(calls.bodies.at(-1)!).text).toBe(APPROVED_FPS_TEXT);
    expect(result.alignmentError).toBeNull();
    const manifest = JSON.parse(await readFile(join(dir, FPS_TAKE_MANIFEST), "utf8"));
    expect(manifest).toMatchObject({ isFixture: false, voiceId: LIAM, text: APPROVED_FPS_TEXT, providerReportedCharacterCost: 348 });
    await expect(readFile(join(dir, FPS_TAKE_RAW))).resolves.toBeTruthy();
  });

  it("never tries another voice: George, a wrong id, a missing key, Liam absent, a top-up account or a provider error all stop it", async () => {
    const cases: [string, Parameters<typeof generateLiamFpsTake>[0], RegExp][] = [
      ["George", { env: { ...env, ELEVENLABS_VOICE_ID: GEORGE_VOICE_ID } }, /pinned Liam id|Liam/],
      ["no key", { env: { ELEVENLABS_VOICE_ID: LIAM } as NodeJS.ProcessEnv }, /ELEVENLABS_API_KEY is not set/],
      ["Liam absent", { ...fakeProvider({ voices: { voices: [{ voice_id: GEORGE_VOICE_ID, name: "George" }] } }) }, /Liam/],
      ["top-up", { ...fakeProvider({ subscription: { tier: "creator", character_count: 0, character_limit: 100000, can_extend_character_limit: true } }) }, /extend|top/i],
      ["too few characters", { ...fakeProvider({ subscription: { tier: "starter", character_count: 66900, character_limit: 67000, can_extend_character_limit: false } }) }, /character|allowance/i],
    ];
    for (const [, opts, reason] of cases) {
      const provider = fakeProvider();
      const fetchImpl = (opts as { fetchImpl?: unknown }).fetchImpl ?? provider.fetchImpl;
      await expect(generateLiamFpsTake({ env, figures, outputDir: join(work, "refused"), ...opts, fetchImpl: fetchImpl as never })).rejects.toThrow(reason);
    }
    const failing = fakeProvider({ status: 401 });
    await expect(generateLiamFpsTake({ fetchImpl: failing.fetchImpl, env, figures, outputDir: join(work, "401") })).rejects.toThrow(/HTTP 401/);
    expect(generations(failing.calls)).toBe(1);
  });
});
