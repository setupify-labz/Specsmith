// The voiced two-checks cut is timed to the take's words: the flip on the "I",
// the cable seated on "into its ports", the opening kept, the close brief, and
// the captions are the spoken lines. Stand-in timestamps at Liam's measured
// paces are TEST FIXTURES, never a take.

import { describe, expect, it } from "vitest";

import { TIMING } from "./comboDraft.ts";
import { join } from "node:path";

import { cutFromTake, FLIP_HALF_THROW_SECONDS, phraseTimes, soundCuesFor, V2_PROFILE, VOICED_OPENING } from "./finalCut.ts";
import { APPROVED_TWO_CHECKS_V2_LINES, TWO_CHECKS_V2_TAKE_TEXT } from "./scriptV2.ts";
import { FPS } from "./comboDraft.ts";
import { loadTwoChecksTake, type Alignment } from "./liamTake.ts";
import { loadTwoChecksV2Take } from "./liamTakeV2.ts";
import { APPROVED_TWO_CHECKS_LINES, TWO_CHECKS_TAKE_TEXT } from "./script.ts";

/** A stand-in take: each line at `cps` characters a second, `gap` seconds between lines. FIXTURE. */
function fixtureAlignment(cps: number, gap: number, lead = 0.05, lines: readonly { readonly spoken: string }[] = APPROVED_TWO_CHECKS_LINES): Alignment {
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  let t = lead;
  lines.forEach((line, index) => {
    if (index > 0) { characters.push(" "); starts.push(t); ends.push(t + gap); t += gap; }
    const per = line.spoken.length < 12 ? 0.8 / line.spoken.length : 1 / cps;
    for (const char of line.spoken) { characters.push(char); starts.push(t); ends.push(t + per); t += per; }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

/** The renderer's rocker state at a rendered frame: I once its 0.1 s throw is halfway (comboDraft.ts rocker). */
const rockerShowsIAt = (flip: number, frame: number) => Math.max(0, Math.min(1, (Number((frame / FPS).toFixed(4)) - flip) / 0.1)) >= 0.5;

const paces = { fast: fixtureAlignment(21, 0.4), typical: fixtureAlignment(18.5, 0.5), slow: fixtureAlignment(16.5, 0.6) };

describe("the voiced cut follows Liam's words", () => {
  for (const [name, alignment] of Object.entries(paces)) {
    it(`(${name} fixture) lands the flip on "I" and the seat on "into its ports", keeping the opening`, () => {
      const { timing, voice } = cutFromTake(alignment);
      const at = (phrase: string) => { const p = phraseTimes(alignment, phrase); const seg = voice.find((v) => p.start >= v.from && p.start < v.to)!; return { start: p.start + seg.offset, end: p.end + seg.offset }; };
      // Three stretches, split in the silences after "No power?" and before "PC on…"; later stretches never move earlier.
      expect(voice).toHaveLength(3);
      expect(voice[0].to).toBeGreaterThan(phraseTimes(alignment, "No power?").end);
      expect(voice[0].to).toBeLessThan(phraseTimes(alignment, "Check the power supply switch.").start);
      expect(voice[1].to).toBeGreaterThan(phraseTimes(alignment, "I is on.").end);
      expect(voice[1].to).toBeLessThan(phraseTimes(alignment, "PC on, but no picture?").start);
      expect(voice[1].offset).toBeGreaterThanOrEqual(voice[0].offset);
      expect(voice[2].offset).toBeGreaterThanOrEqual(voice[1].offset);
      expect(TWO_CHECKS_TAKE_TEXT[TWO_CHECKS_TAKE_TEXT.indexOf("I is on.")]).toBe("I");
      expect(rockerShowsIAt(timing.flip, Math.floor(at("I is on.").start * FPS + 1e-6))).toBe(true);
      expect(rockerShowsIAt(timing.flip, Math.floor(at("I is on.").start * FPS + 1e-6) - 1)).toBe(false);
      // The unplug starts on "that your monitor" itself (never moved earlier to make room for the carry) and is out before the phrase ends.
      expect(timing.pull).toBeCloseTo(at("that your monitor").start, 3);
      expect(timing.travel).toBeLessThanOrEqual(at("that your monitor").end);
      expect(timing.seated).toBeGreaterThanOrEqual(at("into its ports.").start);
      expect(timing.seated).toBeLessThanOrEqual(at("into its ports.").end);
      expect(timing.zoomIn[1]).toBeLessThanOrEqual(at("O is off.").start);
      expect(timing.light).toBeLessThan(at("PC on, but no picture?").start);
      // The slower opening: the dead press with "NO POWER?" for over a second, then 0.8-0.9 s on the glimpse.
      expect([timing.press1, timing.glimpse]).toEqual([VOICED_OPENING.press1, [...VOICED_OPENING.glimpse]]);
      expect(timing.glimpse[0]).toBeGreaterThanOrEqual(1.0);
      expect(timing.glimpse[1] - timing.glimpse[0]).toBeGreaterThanOrEqual(0.8);
      expect(timing.glimpse[1] - timing.glimpse[0]).toBeLessThanOrEqual(0.9);
      expect(at("No power?").start).toBeGreaterThan(timing.press1);
      expect(at("No power?").end).toBeLessThanOrEqual(timing.glimpse[0]);
      expect(at("Check the power supply switch.").start).toBeGreaterThanOrEqual(timing.glimpse[1] - 0.001);
      const order = [timing.press1, timing.glimpse[1], timing.turn1[0], timing.zoomIn[0], timing.finger, timing.flip, timing.zoomOut[0], timing.turn2[0], timing.press2, timing.light, timing.turn3[0], timing.zoomPorts[0], timing.pull, timing.travel, timing.push, timing.seated, timing.zoomOut2[0], timing.final, timing.durationSeconds];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // The close backs out on the last word and holds briefly: no long empty ending.
      const breath = timing.durationSeconds - at("into its ports.").end;
      expect(breath).toBeGreaterThan(0.5);
      expect(breath).toBeLessThan(1.2);
      expect(timing.durationSeconds - timing.final).toBeGreaterThanOrEqual(0.5);
    });
  }

  it("(the saved Liam take) starts the unplug on \"that your monitor\" and seats the plug in \"into its ports.\"", async () => {
    const take = await loadTwoChecksTake(join(import.meta.dirname, "take"));
    const alignment = take.manifest.alignment as Alignment;
    const { timing, voice } = cutFromTake(alignment);
    const offset = voice[2].offset;
    const that = phraseTimes(alignment, "that your monitor"), into = phraseTimes(alignment, "into its ports.");
    expect(timing.pull).toBeCloseTo(that.start + offset, 3);
    expect(timing.pull).toBeGreaterThan(phraseTimes(alignment, "check").start + offset);
    expect(timing.travel).toBeLessThanOrEqual(that.end + offset);
    expect(timing.seated).toBeGreaterThanOrEqual(into.start + offset);
    expect(timing.seated).toBeLessThanOrEqual(into.end + offset);
    // The flip on the "I".
    // On the rendered frame showing when "I" begins, the rocker already shows I; on the frame before, still O.
    const iFrame = Math.floor((phraseTimes(alignment, "I is on.").start + voice[1].offset) * FPS + 1e-6);
    expect(rockerShowsIAt(timing.flip, iFrame)).toBe(true);
    expect(rockerShowsIAt(timing.flip, iFrame - 1)).toBe(false);
  });

  it("never overlaps the take's stretches, even with a longer pause after \"No power?\"", () => {
    const alignment = fixtureAlignment(18.5, 0.5);
    const at = TWO_CHECKS_TAKE_TEXT.indexOf("Check the power supply switch.");
    const shifted: Alignment = {
      characters: alignment.characters,
      character_start_times_seconds: alignment.character_start_times_seconds.map((s, i) => i >= at ? s + 1 : s),
      character_end_times_seconds: alignment.character_end_times_seconds.map((e, i) => i >= at ? e + 1 : e),
    };
    const { voice } = cutFromTake(shifted);
    for (let i = 1; i < voice.length; i += 1) expect(voice[i].from + voice[i].offset).toBeGreaterThanOrEqual(voice[i - 1].to + voice[i - 1].offset);
  });

  it("refuses to split the take where the silence is too short for the fades", () => {
    const alignment = fixtureAlignment(18.5, 0.01);
    expect(() => cutFromTake(alignment)).toThrow(/cannot be split there without touching a word/);
  });

  it("captions the spoken lines, continuously, with no caption over the glimpse", () => {
    const { captions, timing } = cutFromTake(paces.typical);
    expect(captions[0]).toMatchObject({ from: 0, text: "No power?" });
    for (let i = 1; i < captions.length; i += 1) expect(captions[i].from).toBe(captions[i - 1].to);
    expect(captions.at(-1)!.to).toBe(timing.durationSeconds);
    expect(captions.find((c) => c.from <= timing.glimpse[0] + 0.1 && c.to > timing.glimpse[0] + 0.1)!.text).toBe("");
    expect(captions.map((c) => c.text).filter(Boolean).join(" ")).toBe(TWO_CHECKS_TAKE_TEXT);
  });

  it("puts the sounds on the presses, the switch and the light-up only", () => {
    const { timing } = cutFromTake(paces.typical);
    expect(soundCuesFor(timing).map((cue) => [cue.kind, cue.atSecond])).toEqual([["click", timing.press1], ["click", timing.flip], ["click", timing.press2], ["startup", timing.light]]);
  });

  it("refuses timestamps that do not spell the approved text", () => {
    const wrong = fixtureAlignment(18.5, 0.5);
    wrong.characters[0] = "N" === wrong.characters[0] ? "M" : "N";
    expect(() => cutFromTake(wrong)).toThrow(/do not spell the approved text/);
  });
});

describe("the second narration's voiced cut follows its words", () => {
  it("(the saved v2 take) lands every beat on its word and runs 13-15 s", async () => {
    const take = await loadTwoChecksV2Take(join(import.meta.dirname, "takeV2"));
    const alignment = take.manifest.alignment as Alignment;
    const { timing, voice } = cutFromTake(alignment, V2_PROFILE);
    const place = (t0: number) => t0 + voice.find((v) => t0 >= v.from && t0 < v.to)!.offset;
    const I = place(alignment.character_start_times_seconds[TWO_CHECKS_V2_TAKE_TEXT.indexOf("to I.") + 3]);
    expect(rockerShowsIAt(timing.flip, Math.floor(I * FPS + 1e-6))).toBe(true);
    expect(rockerShowsIAt(timing.flip, Math.floor(I * FPS + 1e-6) - 1)).toBe(false);
    expect(timing.pull).toBeCloseTo(place(phraseTimes(alignment, "your monitor", TWO_CHECKS_V2_TAKE_TEXT).start), 3);
    const into = phraseTimes(alignment, "into it.", TWO_CHECKS_V2_TAKE_TEXT);
    expect(timing.seated).toBeGreaterThanOrEqual(place(into.start));
    expect(timing.seated).toBeLessThanOrEqual(place(into.start) + (into.end - into.start));
    expect(timing.durationSeconds).toBeGreaterThanOrEqual(13);
    expect(timing.durationSeconds).toBeLessThanOrEqual(15);
    for (let c = 0; c < alignment.characters.length; c += 1) {
      if (alignment.characters[c] === " ") continue;
      expect(voice.some((v) => alignment.character_start_times_seconds[c] >= v.from && alignment.character_end_times_seconds[c] <= v.to)).toBe(true);
    }
  });

  for (const [name, cps, gap] of [["fast", 21, 0.4], ["typical", 18.5, 0.5], ["slow", 16.5, 0.6]] as const) {
    it(`(${name} fixture) shows I on the "I" of "flip it to I.", unplugs on "your monitor" and seats on "into it."`, () => {
      const alignment = fixtureAlignment(cps, gap, 0.05, APPROVED_TWO_CHECKS_V2_LINES);
      const { timing, voice, captions } = cutFromTake(alignment, V2_PROFILE);
      const at = (phrase: string) => { const p = phraseTimes(alignment, phrase, TWO_CHECKS_V2_TAKE_TEXT); const seg = voice.find((v) => p.start >= v.from && p.start < v.to)!; return { start: p.start + seg.offset, end: p.end + seg.offset }; };
      const iTime = at("to I.").start + (alignment.character_start_times_seconds[TWO_CHECKS_V2_TAKE_TEXT.indexOf("to I.") + 3] - alignment.character_start_times_seconds[TWO_CHECKS_V2_TAKE_TEXT.indexOf("to I.")]);
      expect(TWO_CHECKS_V2_TAKE_TEXT[TWO_CHECKS_V2_TAKE_TEXT.indexOf("to I.") + 3]).toBe("I");
      expect(rockerShowsIAt(timing.flip, Math.floor(iTime * FPS + 1e-6))).toBe(true);
      expect(rockerShowsIAt(timing.flip, Math.floor(iTime * FPS + 1e-6) - 1)).toBe(false);
      expect(timing.zoomIn[1]).toBeLessThanOrEqual(at("If it's on O,").start);
      expect(timing.pull).toBeCloseTo(at("your monitor").start, 3);
      expect(timing.seated).toBeGreaterThanOrEqual(at("into it.").start);
      expect(timing.seated).toBeLessThanOrEqual(at("into it.").end);
      // The longer hook fits the dead press beat, before the glimpse; "Check…" starts as the picture returns.
      expect(at("PC won't turn on?").start).toBeGreaterThan(timing.press1);
      expect(at("PC won't turn on?").end).toBeLessThanOrEqual(timing.glimpse[0]);
      expect(timing.glimpse[1] - timing.glimpse[0]).toBeCloseTo(0.85, 3);
      expect(at("Check the power supply switch.").start).toBeGreaterThanOrEqual(timing.glimpse[1] - 0.001);
      expect(timing.light).toBeLessThan(at("PC on, but no picture?").start);
      for (let i = 1; i < voice.length; i += 1) expect(voice[i].from + voice[i].offset).toBeGreaterThanOrEqual(voice[i - 1].to + voice[i - 1].offset - 1e-9);
      // Every character of the take is inside a placed stretch: only silence is ever dropped.
      for (let c = 0; c < alignment.characters.length; c += 1) {
        if (alignment.characters[c] === " ") continue;
        const [s0, e0] = [alignment.character_start_times_seconds[c], alignment.character_end_times_seconds[c]];
        expect(voice.some((v) => s0 >= v.from && e0 <= v.to)).toBe(true);
      }
      for (let i = 1; i < captions.length; i += 1) expect(captions[i].from).toBe(captions[i - 1].to);
      expect(captions.map((c) => c.text).filter(Boolean).join(" ")).toBe(TWO_CHECKS_V2_TAKE_TEXT);
    });
  }
});
