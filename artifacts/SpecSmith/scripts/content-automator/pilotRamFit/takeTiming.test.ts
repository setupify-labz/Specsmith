// Timing the locked cut to a Liam take: only the approved take in the pinned
// voice is accepted, the beats land on the words they belong to, captions
// follow the words, and the locked animation always gets the time it needs.
// The final render accepts nothing else: there is no fallback voice.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { ramFitFacts } from "./facts.ts";
import { APPROVED_RAM_FIT_LINES, lineTimingsFromAlignment, RAM_FIT_TAKE_AUDIO, RAM_FIT_TAKE_MANIFEST, RAM_FIT_TAKE_TEXT } from "./liamTake.ts";
import { renderModeFromArgs } from "./render.ts";
import { pilotScenes } from "./storyboard.ts";
import { LOCKED, loadRamFitTake, phraseTime, planFromTake } from "./takeTiming.ts";
import { fakeAlignment } from "./testTake.ts";

let work: string;
let mp3: Buffer;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "ram-fit-timing-"));
  const path = join(work, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-ar", "44100", "-ac", "1", "-b:a", "64k", path]);
  mp3 = await readFile(path);
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

async function writeTake(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, RAM_FIT_TAKE_AUDIO), mp3);
  const alignment = fakeAlignment();
  const manifest = {
    isFixture: false, voiceId: REVIEWED_LIAM_VOICE.voiceId, voiceUsed: "Liam", modelId: "eleven_multilingual_v2",
    text: RAM_FIT_TAKE_TEXT, lines: APPROVED_RAM_FIT_LINES,
    audio: { file: RAM_FIT_TAKE_AUDIO, bytes: mp3.byteLength, sha256: createHash("sha256").update(mp3).digest("hex") },
    lineTimings: lineTimingsFromAlignment(alignment), alignment, alignmentError: null, providerReportedCharacterCost: 167,
    ...over,
  };
  await writeFile(join(dir, RAM_FIT_TAKE_MANIFEST), JSON.stringify(manifest));
  return dir;
}

const scenes = () => pilotScenes(ramFitFacts());

describe("which takes the final render accepts", () => {
  it("accepts the approved Liam take whose audio matches its manifest", async () => {
    const take = await loadRamFitTake(await writeTake("good"));
    expect(take.voiceId).toBe(REVIEWED_LIAM_VOICE.voiceId);
    expect(take.lineTimings.map((timing) => timing.id)).toEqual(["fail", "notch", "choice", "payoff", "cta"]);
  });

  it("refuses another voice, edited audio, another script, a fixture, or a take without timestamps", async () => {
    await expect(loadRamFitTake(await writeTake("george", { voiceId: GEORGE_VOICE_ID }))).rejects.toThrow(/not the pinned Liam voice/);
    await expect(loadRamFitTake(await writeTake("sha", { audio: { file: RAM_FIT_TAKE_AUDIO, sha256: "0".repeat(64) } }))).rejects.toThrow(/not the audio its manifest describes/);
    await expect(loadRamFitTake(await writeTake("script", { text: RAM_FIT_TAKE_TEXT.replace("your CPU", "this CPU") }))).rejects.toThrow(/not the approved script/);
    await expect(loadRamFitTake(await writeTake("fixture", { isFixture: true }))).rejects.toThrow(/fixture/);
    await expect(loadRamFitTake(await writeTake("no-timestamps", { alignment: null, alignmentError: "unreadable" }))).rejects.toThrow(/no provider timestamps/);
    await expect(loadRamFitTake(join(work, "nothing-here"))).rejects.toThrow(/No readable take manifest/);
  });

  it("has no fallback voice: the final render needs a take, and a draft must be asked for by name", () => {
    expect(() => renderModeFromArgs([])).toThrow(/--liam-take/);
    expect(renderModeFromArgs(["--liam-take", "some/dir"])).toMatchObject({ mode: "final" });
    expect(() => renderModeFromArgs(["--liam-take"])).toThrow(/needs the take directory/);
    expect(renderModeFromArgs(["--temp-voice"])).toEqual({ mode: "draft" });
  });
});

describe("timing the locked cut to the take", () => {
  const alignment = fakeAlignment();
  const lineTimings = lineTimingsFromAlignment(alignment);

  it("lands the jam on \"won't\", inside the first second, and each fix as its words end", () => {
    const plan = planFromTake({ alignment, lineTimings }, scenes());
    const voice = (id: string) => plan.voice.find((line) => line.id === id)!;
    const lineStart = (id: string) => lineTimings.find((timing) => timing.id === id)!.start;
    // "won't" in the take, moved to where line 1 is placed.
    const wont = voice("fail").at + phraseTime(alignment, lineTimings, "fail", "won't", "start");
    expect(plan.events.jam).toBeCloseTo(wont, 3);
    expect(plan.events.jam).toBeGreaterThanOrEqual(LOCKED.jamEarliest);
    expect(plan.events.jam).toBeLessThanOrEqual(LOCKED.jamLatest);
    const choice = plan.scenes.find((scene) => scene.id === "choice")!;
    expect(plan.events.fix1).toBeCloseTo(voice("choice").at + phraseTime(alignment, lineTimings, "choice", "DDR5 RAM here", "end"), 3);
    expect(plan.events.fix1 - choice.startSecond).toBeGreaterThanOrEqual(LOCKED.fix1Earliest - 1e-9);
    expect(plan.events.fix2 - plan.events.fix1).toBeGreaterThanOrEqual(LOCKED.fixGap - 1e-9);
    expect(lineStart("choice")).toBeGreaterThan(0);
  });

  it("keeps the shots in their locked order, end to end, each long enough for its line and its animation", () => {
    const plan = planFromTake({ alignment, lineTimings }, scenes());
    expect(plan.scenes.map((scene) => scene.id)).toEqual(["fail", "notch", "choice", "payoff", "cta"]);
    expect(plan.scenes[0].startSecond).toBe(0);
    plan.scenes.slice(1).forEach((scene, index) => expect(scene.startSecond).toBe(plan.scenes[index].endSecond));
    for (const line of plan.voice) {
      const scene = plan.scenes.find((entry) => entry.id === line.id)!;
      expect(line.at).toBeGreaterThanOrEqual(scene.startSecond);
      expect(line.at + (line.takeEnd - line.takeStart)).toBeLessThanOrEqual(scene.endSecond);
    }
    const payoff = plan.scenes.find((scene) => scene.id === "payoff")!;
    expect(payoff.endSecond - payoff.startSecond).toBeGreaterThanOrEqual(LOCKED.proofAt + LOCKED.proofOnScreen - 1e-9);
  });

  /** Where the first word of each caption is heard in the video, from the take and the plan's voice placement. */
  function heardStarts(plan: ReturnType<typeof planFromTake>, align: typeof alignment): number[] {
    let offset = 0;
    return APPROVED_RAM_FIT_LINES.flatMap((line) => {
      const scene = plan.scenes.find((entry) => entry.id === line.id)!;
      let within = 0;
      const starts = scene.captions.map((chunk) => {
        const takeSeconds = align.character_start_times_seconds[offset + within];
        within += chunk.length + 1;
        const part = [...plan.voice].reverse().find((entry) => entry.id === line.id && takeSeconds >= entry.takeStart - 1e-9)!;
        return part.at + takeSeconds - part.takeStart;
      });
      offset += line.text.length + 1;
      return starts;
    });
  }

  it("starts each caption as its first word is heard; only the opening hook is on frame one", () => {
    for (const take of [alignment, fakeAlignment(RAM_FIT_TAKE_TEXT, 0.03, 0.2), fakeAlignment(RAM_FIT_TAKE_TEXT, 0.04, 0.3)]) {
      const plan = planFromTake({ alignment: take, lineTimings: lineTimingsFromAlignment(take) }, scenes());
      const heard = heardStarts(plan, take);
      expect(plan.captions[0]).toMatchObject({ text: "DDR4 RAM won't fit", start: 0 });
      expect(heard[0]).toBeLessThanOrEqual(LOCKED.jamEarliest + 1e-9);
      plan.captions.slice(1).forEach((cue, index) => {
        expect(cue.start).toBeCloseTo(heard[index + 1], 3);
        expect(cue.start).toBeGreaterThanOrEqual(plan.captions[index].end - 1e-9);
      });
      expect(plan.captions.map((cue) => cue.text).join(" ")).toBe(RAM_FIT_TAKE_TEXT);
    }
  });

  it("never shows a delayed line's caption before its first word", () => {
    const fast = fakeAlignment(RAM_FIT_TAKE_TEXT, 0.03, 0.2);
    const plan = planFromTake({ alignment: fast, lineTimings: lineTimingsFromAlignment(fast) }, scenes());
    const choice = plan.scenes.find((scene) => scene.id === "choice")!;
    const first = plan.captions.find((cue) => cue.text === "Use DDR5 RAM here,")!;
    const line = plan.voice.find((entry) => entry.id === "choice")!;
    expect(line.at - choice.startSecond).toBeGreaterThan(0.3);
    expect(first.start).toBeCloseTo(line.at, 3);
  });

  it("lengthens the pause at \"here,\" so the DDR4 stick still seats as \"DDR4 board\" ends", () => {
    const close = fakeAlignment(RAM_FIT_TAKE_TEXT, 0.04, 0.3);
    const timings = lineTimingsFromAlignment(close);
    const gap = phraseTime(close, timings, "choice", "DDR4 board", "end") - phraseTime(close, timings, "choice", "DDR5 RAM here", "end");
    expect(gap).toBeLessThan(LOCKED.fixGap);
    const plan = planFromTake({ alignment: close, lineTimings: timings }, scenes());
    expect(plan.commaPause).toBeCloseTo(LOCKED.fixGap - gap, 3);
    const parts = plan.voice.filter((entry) => entry.id === "choice");
    expect(parts).toHaveLength(2);
    // The cut falls in the silence after the comma, and nothing of the line is lost or repeated.
    const text = APPROVED_RAM_FIT_LINES.find((line) => line.id === "choice")!.text;
    const offset = APPROVED_RAM_FIT_LINES.slice(0, 2).reduce((sum, line) => sum + line.text.length + 1, 0);
    expect(parts[0].takeEnd).toBeCloseTo(close.character_end_times_seconds[offset + text.indexOf(",")], 6);
    expect(parts[1].takeStart).toBeCloseTo(close.character_start_times_seconds[offset + text.indexOf("or a")], 6);
    expect(parts[1].at - (parts[0].at + parts[0].takeEnd - parts[0].takeStart)).toBeCloseTo(parts[1].takeStart - parts[0].takeEnd + plan.commaPause, 3);
    // Both beats on their words, as heard.
    const boardEnd = close.character_end_times_seconds[offset + text.indexOf("DDR4 board") + "DDR4 board".length - 1];
    expect(plan.events.fix2).toBeCloseTo(parts[1].at + boardEnd - parts[1].takeStart, 3);
    const hereEnd = close.character_end_times_seconds[offset + text.indexOf("DDR5 RAM here") + "DDR5 RAM here".length - 1];
    expect(plan.events.fix1).toBeCloseTo(parts[0].at + hereEnd - parts[0].takeStart, 3);
    expect(plan.events.fix2 - plan.events.fix1).toBeCloseTo(LOCKED.fixGap, 3);
    expect(plan.adjustments.join(" ")).toMatch(/pause after "here," is/);
    const choice = plan.scenes.find((scene) => scene.id === "choice")!;
    expect(parts[1].at + parts[1].takeEnd - parts[1].takeStart).toBeLessThanOrEqual(choice.endSecond);
  });

  it("refuses a take whose fixes are too close to seat on their words, rather than moving a beat off its words", () => {
    const rushed = fakeAlignment(RAM_FIT_TAKE_TEXT, 0.015, 0.2);
    expect(() => planFromTake({ alignment: rushed, lineTimings: lineTimingsFromAlignment(rushed) }, scenes())).toThrow(/longer pause at "here,"/);
  });

  it("does not touch Liam's pause when his own read leaves the stick time to come back", () => {
    const plan = planFromTake({ alignment, lineTimings }, scenes());
    expect(plan.commaPause).toBe(0);
    expect(plan.voice).toHaveLength(5);
  });

  it("waits for the pull-back when the take says the fix early, and records that it did", () => {
    const fast = fakeAlignment(RAM_FIT_TAKE_TEXT, 0.03, 0.2);
    const plan = planFromTake({ alignment: fast, lineTimings: lineTimingsFromAlignment(fast) }, scenes());
    const choice = plan.scenes.find((scene) => scene.id === "choice")!;
    expect(plan.events.fix1 - choice.startSecond).toBeCloseTo(LOCKED.fix1Earliest, 3);
    expect(plan.adjustments.join(" ")).toMatch(/pull-back finishes first/);
  });

  it("refuses a take whose \"won't\" cannot land inside the first second", () => {
    const slow = fakeAlignment(RAM_FIT_TAKE_TEXT, 0.12, 0.3);
    expect(() => planFromTake({ alignment: slow, lineTimings: lineTimingsFromAlignment(slow) }, scenes())).toThrow(/inside the first second/);
  });
});
