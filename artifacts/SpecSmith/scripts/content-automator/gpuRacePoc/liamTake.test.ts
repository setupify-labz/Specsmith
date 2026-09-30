// The one Liam take: every guard runs before the paid request, exactly one
// request is made, nothing paid is lost to a parse error, and the take is cut
// into lines that retime the draft. All against a fake provider: no network.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SAMPLE_RATE } from "./audio.ts";
import {
  APPROVED_RACE_LINES,
  assertApprovedRaceScript,
  generateLiamRaceTake,
  LIAM_TAKE_AUDIO,
  LIAM_TAKE_MANIFEST,
  LIAM_TAKE_RAW,
  LIAM_TAKE_TEXT,
  lineTimingsFromAlignment,
  type Alignment,
} from "./liamTake.ts";
import { raceData } from "./raceData.ts";
import { loadLiamTake, segmentByPauses } from "./takeVoice.ts";
import { buildRaceTimeline, narrationLines, type LineId } from "./timeline.ts";
import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";

const LIAM = REVIEWED_LIAM_VOICE.voiceId;
const env = { ELEVENLABS_API_KEY: "test-key-not-real", ELEVENLABS_VOICE_ID: LIAM } as NodeJS.ProcessEnv;

/** A short silent MP3, standing in for the provider's audio. */
let mp3: Buffer;
let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "liam-take-test-"));
  const path = join(work, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=16", "-ar", "44100", "-ac", "1", "-b:a", "64k", path]);
  mp3 = await readFile(path);
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

/** Alignment for the take text: 50 ms a character, each line starting 3.2 s after the last. */
function alignment(text = LIAM_TAKE_TEXT): Alignment {
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  let line = 0;
  let within = 0;
  characters.forEach((char, index) => {
    if (char === " " && text.slice(0, index).endsWith(".")) { line += 1; within = -1; }
    const t = line * 3.2 + within * 0.05;
    starts.push(t); ends.push(t + 0.045); within += 1;
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

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
    return new Response(JSON.stringify(over.take ?? { audio_base64: mp3.toString("base64"), alignment: alignment() }), {
      status: over.status ?? 200, headers: { "content-type": "application/json", "character-cost": "190" },
    });
  };
  return { calls, fetchImpl };
}
const generations = (calls: Calls) => calls.urls.filter((url) => url.includes("/v1/text-to-speech/")).length;

describe("before any spend", () => {
  it("confirms the approved script against Compare's figures", async () => {
    await expect(assertApprovedRaceScript()).resolves.toBeUndefined();
    const { figures } = await raceData();
    expect(narrationLines(figures)).toEqual(APPROVED_RACE_LINES);
    expect(LIAM_TAKE_TEXT).toBe(
      "Forty-eighty Super versus forty-eighty. Game after game, the Super takes the lead. Twenty of twenty modelled leads. " +
      "Yet on average, one sixty-four to one sixty. Just four FPS apart.");
  });

  it("refuses a voice other than pinned Liam, with no generation request", async () => {
    await expect(generateLiamRaceTake({ env: { ...env, ELEVENLABS_VOICE_ID: "JBFqnCBsd6RMkjVDRZzb" }, outputDir: join(work, "a") }))
      .rejects.toThrow();
    const { calls, fetchImpl } = fakeProvider({ voices: { voices: [{ voice_id: "someone-else", name: "Liam" }] } });
    await expect(generateLiamRaceTake({ env, fetchImpl, outputDir: join(work, "b") })).rejects.toThrow(/does not match/);
    expect(generations(calls)).toBe(0);
  });

  it("refuses an account that can top up, or lacks the included characters, with no generation request", async () => {
    for (const subscription of [
      { tier: "starter", character_count: 0, character_limit: 67000, can_extend_character_limit: true },
      { tier: "starter", character_count: 66950, character_limit: 67000, can_extend_character_limit: false },
      { tier: "starter", character_count: 0, character_limit: 67000 },
    ]) {
      const { calls, fetchImpl } = fakeProvider({ subscription });
      await expect(generateLiamRaceTake({ env, fetchImpl, outputDir: join(work, "c") })).rejects.toThrow();
      expect(generations(calls)).toBe(0);
    }
  });
});

describe("the one request", () => {
  it("sends exactly the approved text once, to Liam's timestamped endpoint, and keeps the take", async () => {
    const { calls, fetchImpl } = fakeProvider();
    const dir = join(work, "take");
    const result = await generateLiamRaceTake({ env, fetchImpl, outputDir: dir });
    expect(generations(calls)).toBe(1);
    expect(calls.urls.find((url) => url.includes("/v1/text-to-speech/"))).toContain(`/v1/text-to-speech/${LIAM}/with-timestamps`);
    expect(JSON.parse(calls.bodies[0]).text).toBe(LIAM_TAKE_TEXT);
    expect(result.providerReportedCharacterCost).toBe(190);
    expect(await readFile(join(dir, LIAM_TAKE_AUDIO))).toEqual(mp3);
    const manifest = JSON.parse(await readFile(join(dir, LIAM_TAKE_MANIFEST), "utf8"));
    expect(manifest).toMatchObject({ voiceId: LIAM, text: LIAM_TAKE_TEXT, isFixture: false, alignmentError: null, toppedUp: false });
    expect(manifest.lineTimings.map((timing: { id: LineId }) => timing.id)).toEqual(APPROVED_RACE_LINES.map((line) => line.id));
  });

  it("keeps the raw response and the audio even when the timestamps cannot be read", async () => {
    const { fetchImpl } = fakeProvider({ take: { audio_base64: mp3.toString("base64"), alignment: { characters: ["x"] } } });
    const dir = join(work, "no-alignment");
    const result = await generateLiamRaceTake({ env, fetchImpl, outputDir: dir });
    expect(result.lineTimings).toBeNull();
    expect(result.alignmentError).toBeTruthy();
    expect((await readFile(join(dir, LIAM_TAKE_RAW))).length).toBeGreaterThan(0);
    expect(await readFile(join(dir, LIAM_TAKE_AUDIO))).toEqual(mp3);
  });

  it("stops on a provider failure without trying another voice", async () => {
    const { calls, fetchImpl } = fakeProvider({ status: 401, take: { detail: "payment_required" } });
    await expect(generateLiamRaceTake({ env, fetchImpl, outputDir: join(work, "fail") })).rejects.toThrow(/HTTP 401/);
    expect(generations(calls)).toBe(1);
  });
});

describe("cutting the take into lines", () => {
  it("reads each line's span from the provider's timestamps, and refuses timestamps for other text", () => {
    const timings = lineTimingsFromAlignment(alignment(), APPROVED_RACE_LINES);
    expect(timings.map((timing) => timing.id)).toEqual(["matchup", "flips", "leads", "average", "gap"]);
    expect(timings[1].start).toBeCloseTo(3.2, 5);
    expect(() => lineTimingsFromAlignment(alignment(LIAM_TAKE_TEXT.replace("four", "five")), APPROVED_RACE_LINES)).toThrow(/do not spell/);
  });

  it("finds line breaks from pauses only when they stand clearly apart from pauses inside lines", () => {
    const tone = (seconds: number) => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => 0.3 * Math.sin(i / 8));
    const gap = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE));
    const join2 = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
    const clean = join2(tone(1), gap(0.5), tone(1), gap(0.15), tone(0.5), gap(0.5), tone(1), gap(0.5), tone(1), gap(0.5), tone(1));
    expect(segmentByPauses(clean, 5)).toHaveLength(5);
    const ambiguous = join2(tone(1), gap(0.5), tone(1), gap(0.45), tone(0.5), gap(0.5), tone(1), gap(0.5), tone(1), gap(0.5), tone(1));
    expect(() => segmentByPauses(ambiguous, 5)).toThrow(/without guessing/);
  });

  it("loads only the approved Liam take with the audio its manifest names, and retimes the draft from it", async () => {
    const dir = join(work, "take");
    const take = await loadLiamTake(dir);
    expect([...take.lines.keys()]).toEqual(["matchup", "flips", "leads", "average", "gap"]);
    const { figures, rows, names } = await raceData();
    const seconds = Object.fromEntries([...take.lines].map(([id, clip]) => [id, clip.length / SAMPLE_RATE])) as Record<LineId, number>;
    expect(() => buildRaceTimeline(figures, rows, names, seconds)).not.toThrow();

    const manifest = JSON.parse(await readFile(join(dir, LIAM_TAKE_MANIFEST), "utf8"));
    await writeFile(join(dir, LIAM_TAKE_MANIFEST), JSON.stringify({ ...manifest, audio: { ...manifest.audio, sha256: "0".repeat(64) } }));
    await expect(loadLiamTake(dir)).rejects.toThrow(/not the audio its manifest describes/);
    await writeFile(join(dir, LIAM_TAKE_MANIFEST), JSON.stringify({ ...manifest, voiceId: "JBFqnCBsd6RMkjVDRZzb" }));
    await expect(loadLiamTake(dir)).rejects.toThrow(/not the pinned Liam voice/);
    await writeFile(join(dir, LIAM_TAKE_MANIFEST), JSON.stringify({ ...manifest, text: `${LIAM_TAKE_TEXT} Extra.` }));
    await expect(loadLiamTake(dir)).rejects.toThrow(/not the approved script/);
  });
});
