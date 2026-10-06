// Timing the GPU-upgrade Short to a saved take: only the approved take in
// pinned Liam with matching audio and timestamps is used; the cut follows the
// delivery on a 0.1 s grid without moving a word; the sound effects land on
// the events the pictures draw; and the saved bytes are checked on every use.

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GEORGE_VOICE_ID, REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { createSavedTakeNarrationAdapter } from "../savedTakeNarration.ts";
import { validateCues } from "../soundEffects.ts";
import { APPROVED_GPU_UPGRADE_LINES, GPU_TAKE_CONCEPT_FILE, GPU_TAKE_MANIFEST, GPU_TAKE_TEXT, type Alignment, type LineTiming } from "./liamTake.ts";
import { EDIT, loadGpuUpgradeTake, retimeBeats, retimeConcept, scriptTextSha256, soundCuesFor } from "./takeTiming.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** Line spans like Liam's FPS take: about 15 characters a second, 0.3 s between lines. TEST TIMINGS, not a take. */
function liamLikeTimings(charsPerSecond = 15, pause = 0.3): LineTiming[] {
  let t = 0.1;
  return APPROVED_GPU_UPGRADE_LINES.map((line) => {
    const start = t, end = t + line.spoken.length / charsPerSecond;
    t = end + pause;
    return { id: line.id, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
  });
}
function alignmentFor(timings: readonly LineTiming[]): Alignment {
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  APPROVED_GPU_UPGRADE_LINES.forEach((line, i) => {
    const { start, end } = timings[i];
    [...line.spoken].forEach((char, k) => {
      characters.push(char);
      starts.push(start + ((end - start) * k) / line.spoken.length);
      ends.push(start + ((end - start) * (k + 1)) / line.spoken.length);
    });
    if (i < timings.length - 1) { characters.push(" "); starts.push(end); ends.push(timings[i + 1].start); }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}
/** A take directory holding a TEST manifest and stand-in bytes, for the loader's refusals. Never a real take. */
function takeDir(overrides: Record<string, unknown> = {}, audio = Buffer.from("not really audio")) {
  const dir = mkdtempSync(join(tmpdir(), "gpu-saved-take-"));
  dirs.push(dir);
  writeFileSync(join(dir, "take.mp3"), audio);
  const manifest = {
    generatedBy: "elevenlabs-text-to-speech-with-timestamps", isFixture: false, voiceId: REVIEWED_LIAM_VOICE.voiceId, voiceUsed: "Liam", modelId: "m",
    text: GPU_TAKE_TEXT, lines: APPROVED_GPU_UPGRADE_LINES,
    audio: { file: "take.mp3", sha256: createHash("sha256").update(audio).digest("hex") },
    alignment: alignmentFor(liamLikeTimings()), ...overrides,
  };
  writeFileSync(join(dir, GPU_TAKE_MANIFEST), JSON.stringify(manifest));
  return dir;
}

describe("the saved take is used only if it is the approved take", () => {
  it("loads the approved text in pinned Liam with its audio and timestamps", async () => {
    const take = await loadGpuUpgradeTake(takeDir());
    expect(take.lineTimings.map((line) => line.id)).toEqual(["hook", "fps-aw", "fps-val", "percent", "explain", "ask"]);
    expect(take.take.scriptTextSha256).toBe(scriptTextSha256());
    expect(take.take.providerTextSha256).toBe(createHash("sha256").update(GPU_TAKE_TEXT).digest("hex"));
  });

  it("refuses another voice, a fixture, a changed script, changed audio, or no timestamps", async () => {
    await expect(loadGpuUpgradeTake(takeDir({ voiceId: GEORGE_VOICE_ID }))).rejects.toThrow(/not the pinned Liam voice/);
    await expect(loadGpuUpgradeTake(takeDir({ isFixture: true }))).rejects.toThrow(/fixture/);
    await expect(loadGpuUpgradeTake(takeDir({ text: GPU_TAKE_TEXT.replace("sixty-five", "sixty-six") }))).rejects.toThrow(/not the approved script/);
    await expect(loadGpuUpgradeTake(takeDir({ audio: { file: "take.mp3", sha256: "0".repeat(64) } }))).rejects.toThrow(/not the audio its manifest describes/);
    await expect(loadGpuUpgradeTake(takeDir({ alignment: null, alignmentError: "none" }))).rejects.toThrow(/no provider timestamps/);
  });

  it("the narration adapter re-hashes the saved bytes before every use", async () => {
    const dir = takeDir();
    const take = await loadGpuUpgradeTake(dir);
    writeFileSync(take.take.audioPath, "changed after loading");
    const adapter = createSavedTakeNarrationAdapter({ outputDir: join(dir, "out"), take: take.take });
    await expect(adapter.render({ task: { taskId: "voice" } } as never)).rejects.toThrow(/not the audio its manifest names/);
  });
});

describe("the edit follows the delivery", () => {
  it("cuts on a 0.1 s grid, before each line and after the previous one, and holds the close", () => {
    const timings = liamLikeTimings();
    const beats = retimeBeats(timings);
    expect(beats[0].startSecond).toBe(0);
    beats.forEach((beat, i) => {
      expect(Math.abs(beat.startSecond * 10 - Math.round(beat.startSecond * 10))).toBeLessThan(1e-9);
      expect(beat.startSecond).toBeLessThanOrEqual(timings[i].start);
      if (i > 0) expect(beat.startSecond).toBeGreaterThanOrEqual(timings[i - 1].end - EDIT.overlapTolerance);
      expect(beat.endSecond).toBeGreaterThanOrEqual(timings[i].end);
    });
    expect(beats.at(-1)!.endSecond).toBeGreaterThanOrEqual(timings.at(-1)!.end + EDIT.tail);
    expect(beats.at(-1)!.endSecond).toBeLessThan(timings.at(-1)!.end + EDIT.tail + 0.1 + 1e-9);
  });

  it("refuses a take too fast for a readable beat, rather than squeezing it", () => {
    expect(() => retimeBeats(liamLikeTimings(60))).toThrow(/under the 1.5 s minimum/);
  });

  it("retimes the concept's beats and changes nothing else", () => {
    const concept = JSON.parse(readFileSync(GPU_TAKE_CONCEPT_FILE, "utf8"));
    const beats = retimeBeats(liamLikeTimings());
    const retimed = retimeConcept(concept, beats);
    retimed.beats.forEach((beat: Record<string, unknown>, i: number) => {
      expect({ ...beat, startSecond: 0, endSecond: 0 }).toEqual({ ...concept.beats[i], startSecond: 0, endSecond: 0 });
      expect([beat.startSecond, beat.endSecond]).toEqual([beats[i].startSecond, beats[i].endSecond]);
    });
    expect({ ...retimed, beats: [] }).toEqual({ ...concept, beats: [] });
    concept.beats[1].narration = "Something Liam did not say.";
    expect(() => retimeConcept(concept, beats)).toThrow(/not the line Liam spoke/);
  });
});

describe("the sound effects", () => {
  it("land on the events the pictures draw, one at a time, inside the video", () => {
    const beats = retimeBeats(liamLikeTimings());
    const cues = soundCuesFor(beats);
    const percent = beats.find((beat) => beat.id === "percent")!;
    expect(cues.filter((cue) => cue.kind === "pop").map((cue) => cue.atSecond)).toEqual([percent.startSecond + 0.8, percent.startSecond + 1.05].map((t) => Math.round(t * 1000) / 1000));
    expect(cues.filter((cue) => cue.kind === "whoosh")).toHaveLength(beats.length);
    expect(cues.filter((cue) => cue.kind === "tick")).toHaveLength(2);
    expect(() => validateCues(cues, beats.at(-1)!.endSecond)).not.toThrow();
  });
});
