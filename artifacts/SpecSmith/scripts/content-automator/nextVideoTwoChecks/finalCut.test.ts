// The voiced two-checks cut is timed to the take's words: the flip on the "I",
// the cable seated on "into its ports", the opening kept, the close brief, and
// the captions are the spoken lines. Stand-in timestamps at Liam's measured
// paces are TEST FIXTURES, never a take.

import { describe, expect, it } from "vitest";

import { TIMING } from "./comboDraft.ts";
import { cutFromTake, phraseTimes, soundCuesFor } from "./finalCut.ts";
import type { Alignment } from "./liamTake.ts";
import { APPROVED_TWO_CHECKS_LINES, TWO_CHECKS_TAKE_TEXT } from "./script.ts";

/** A stand-in take: each line at `cps` characters a second, `gap` seconds between lines. FIXTURE. */
function fixtureAlignment(cps: number, gap: number, lead = 0.05): Alignment {
  const characters: string[] = [], starts: number[] = [], ends: number[] = [];
  let t = lead;
  APPROVED_TWO_CHECKS_LINES.forEach((line, index) => {
    if (index > 0) { characters.push(" "); starts.push(t); ends.push(t + gap); t += gap; }
    const per = line.spoken.length < 12 ? 0.8 / line.spoken.length : 1 / cps;
    for (const char of line.spoken) { characters.push(char); starts.push(t); ends.push(t + per); t += per; }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

const paces = { fast: fixtureAlignment(21, 0.4), typical: fixtureAlignment(18.5, 0.5), slow: fixtureAlignment(16.5, 0.6) };

describe("the voiced cut follows Liam's words", () => {
  for (const [name, alignment] of Object.entries(paces)) {
    it(`(${name} fixture) lands the flip on "I" and the seat on "into its ports", keeping the opening`, () => {
      const { timing, voice } = cutFromTake(alignment);
      const at = (phrase: string) => { const p = phraseTimes(alignment, phrase); const seg = voice.find((v) => p.start >= v.from && p.start < v.to)!; return { start: p.start + seg.offset, end: p.end + seg.offset }; };
      // Two stretches, split in the silence between "I is on." and "PC on…"; the second never moves earlier.
      expect(voice).toHaveLength(2);
      expect(voice[0].to).toBeGreaterThan(phraseTimes(alignment, "I is on.").end);
      expect(voice[0].to).toBeLessThan(phraseTimes(alignment, "PC on, but no picture?").start);
      expect(voice[1].offset).toBeGreaterThanOrEqual(voice[0].offset);
      expect(TWO_CHECKS_TAKE_TEXT[TWO_CHECKS_TAKE_TEXT.indexOf("I is on.")]).toBe("I");
      expect(timing.flip).toBeCloseTo(at("I is on.").start, 2);
      expect(timing.seated).toBeGreaterThanOrEqual(at("into its ports.").start);
      expect(timing.seated).toBeLessThanOrEqual(at("into its ports.").end);
      expect(timing.zoomIn[1]).toBeLessThanOrEqual(at("O is off.").start);
      expect(timing.light).toBeLessThan(at("PC on, but no picture?").start);
      expect([timing.press1, timing.glimpse]).toEqual([TIMING.press1, TIMING.glimpse]);
      expect(at("No power?").start).toBeLessThan(TIMING.glimpse[0]);
      expect(at("Check the power supply switch.").start).toBeGreaterThanOrEqual(TIMING.glimpse[1] - 0.001);
      const order = [timing.press1, timing.glimpse[1], timing.turn1[0], timing.zoomIn[0], timing.finger, timing.flip, timing.zoomOut[0], timing.turn2[0], timing.press2, timing.light, timing.turn3[0], timing.zoomPorts[0], timing.pull, timing.travel, timing.push, timing.seated, timing.zoomOut2[0], timing.final, timing.durationSeconds];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // The close breathes about a second after the last word, no more.
      const breath = timing.durationSeconds - at("into its ports.").end;
      expect(breath).toBeGreaterThan(0.8);
      expect(breath).toBeLessThan(1.4);
    });
  }

  it("captions the spoken lines, continuously, with no caption over the glimpse", () => {
    const { captions, timing } = cutFromTake(paces.typical);
    expect(captions[0]).toMatchObject({ from: 0, text: "No power?" });
    for (let i = 1; i < captions.length; i += 1) expect(captions[i].from).toBe(captions[i - 1].to);
    expect(captions.at(-1)!.to).toBe(timing.durationSeconds);
    expect(captions.find((c) => c.from <= TIMING.glimpse[0] + 0.1 && c.to > TIMING.glimpse[0] + 0.1)!.text).toBe("");
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
