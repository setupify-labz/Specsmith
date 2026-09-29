// The GPU race draft may only animate and say what Compare's figures say, is
// cut to its narration, and keeps its model-estimate label in every frame.

import { describe, expect, it } from "vitest";

import { spokenFigures } from "../spokenWords.ts";
import { mixDraft, SAMPLE_RATE, synthesizeCues } from "./audio.ts";
import { keyFrameTimes, raceData, sceneText } from "./render.ts";
import { CAPTION_BAND, MODEL_ESTIMATE_LABEL, sceneHtml } from "./scene.ts";
import {
  buildRaceTimeline,
  captionTexts,
  FPS,
  MAX_CAPTION_CHARACTERS,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  narrationLines,
  RaceTimelineError,
  SPOTLIGHT_GAME_IDS,
  TILE_SIZE,
  TRACK_LENGTH,
  type LineId,
} from "./timeline.ts";

/** Line lengths the offline placeholder voice measured on this machine; the render measures its own. */
const PLACEHOLDER_SECONDS: Record<LineId, number> = { matchup: 2.13, flips: 2.59, leads: 1.9, average: 3.05, gap: 1.59 };

const { figures, rows, names } = await raceData();
const timeline = buildRaceTimeline(figures, rows, names, PLACEHOLDER_SECONDS);
const line = (id: LineId) => timeline.lines.find((entry) => entry.id === id)!;
const firstFrame = (predicate: (frame: (typeof timeline.frames)[number]) => boolean) => timeline.frames.find(predicate)!.t;

describe("the draft says and shows only the figures", () => {
  it("races the verified 1440p High figures", () => {
    expect(figures).toMatchObject({ resolution: "1440p", preset: "high", avgA: 164, avgB: 160, leadsA: 20, leadsB: 0, ties: 0, games: 20 });
    expect(sceneText(timeline)).toMatchObject({ countTotal: "/20", gapValue: "4 FPS", avgA: "164", avgB: "160", label: MODEL_ESTIMATE_LABEL });
  });

  it("speaks every figure as the figures give it, and no other", () => {
    const said = Object.fromEntries(narrationLines(figures).map((entry) => [entry.id, spokenFigures(entry.text)]));
    expect(said).toEqual({ matchup: [], flips: [], leads: [20, 20], average: [164, 160], gap: [4] });
    for (const entry of narrationLines(figures)) expect(entry.text).not.toMatch(/\d/);
  });

  it("holds the distances in the ratio of the average FPS in every frame, slow motion included", () => {
    for (const frame of timeline.frames) {
      if (frame.yA > 0) expect(frame.yB / frame.yA).toBeCloseTo(160 / 164, 10);
    }
    expect(timeline.frames.some((frame) => frame.spotlight && frame.speed < 0.3)).toBe(true);
    expect(timeline.frames.at(-1)!.yA).toBeCloseTo(TRACK_LENGTH, 3);
  });

  it("flips all twenty tiles as their leader passes, and never lets two touch", () => {
    expect(timeline.tiles).toHaveLength(20);
    for (const tile of timeline.tiles) {
      const at = timeline.frames.find((frame) => frame.t >= tile.flipAt)!;
      expect(Math.abs(at.yA - tile.y)).toBeLessThan(40);
    }
    const ys = timeline.tiles.map((tile) => tile.y);
    ys.slice(1).forEach((y, index) => expect(y - ys[index]).toBeGreaterThan(TILE_SIZE));
  });

  it("counts flipped leads only, rising one at a time to 20/20", () => {
    let previous = 0;
    for (const frame of timeline.frames) {
      expect(frame.count - previous).toBeGreaterThanOrEqual(0);
      expect(frame.count - previous).toBeLessThanOrEqual(1);
      expect(frame.count).toBe(timeline.tiles.filter((tile, index) => tile.leader === "a" && frame.flip[index] >= 0.5).length);
      previous = frame.count;
    }
    expect(previous).toBe(20);
  });

  it("pauses on exactly three named games, each one a modelled Super lead", () => {
    const lit = new Set(timeline.frames.filter((frame) => frame.spotlight).map((frame) => timeline.tiles[frame.spotlight!.tile].id));
    expect([...lit]).toEqual([...SPOTLIGHT_GAME_IDS]);
    for (const id of SPOTLIGHT_GAME_IDS) {
      const row = rows.find((entry) => entry.id === id)!;
      expect(row.fpsA).toBeGreaterThan(row.fpsB);
      const held = timeline.frames.filter((frame) => frame.spotlight && timeline.tiles[frame.spotlight.tile].id === id);
      expect(held.length / FPS).toBeGreaterThanOrEqual(0.85);
    }
  });
});

describe("the cut follows the voice", () => {
  it("runs 12-15 seconds", () => {
    expect(timeline.durationSeconds).toBeGreaterThanOrEqual(MIN_DURATION_SECONDS);
    expect(timeline.durationSeconds).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
    expect(timeline.frames).toHaveLength(Math.round(timeline.durationSeconds * FPS));
  });

  it("is moving from the start: the first flip counts inside the first second", () => {
    expect(firstFrame((frame) => frame.speed > 0)).toBeLessThan(0.2);
    expect(firstFrame((frame) => frame.count >= 1)).toBeLessThan(1);
  });

  it("lands each beat on its line", () => {
    const complete = firstFrame((frame) => frame.count === 20);
    // "Twenty of twenty modelled leads" starts as the counter reaches 20, never before.
    expect(line("leads").start).toBeGreaterThanOrEqual(complete - 1 / FPS);
    expect(line("leads").start - complete).toBeLessThan(0.15);
    // The flips keep coming while "game after game" is said; the pull-back comes as the leads line finishes.
    expect(complete).toBeGreaterThan(line("flips").start + line("flips").seconds);
    expect(firstFrame((frame) => frame.pullback > 0)).toBeGreaterThanOrEqual(line("leads").start + line("leads").seconds - 0.3 - 1 / FPS);
    // The averages appear while "one sixty-four to one sixty" is said; the verdict with "just four FPS apart".
    const averages = firstFrame((frame) => frame.reveal > 0);
    expect(averages).toBeGreaterThan(line("average").start);
    expect(averages).toBeLessThan(line("average").start + line("average").seconds);
    expect(Math.abs(firstFrame((frame) => frame.verdict > 0) - line("gap").start)).toBeLessThan(1 / FPS + 1e-9);
    // Lines never overlap, and the verdict holds after its line ends.
    timeline.lines.slice(1).forEach((entry, index) =>
      expect(entry.start).toBeGreaterThan(timeline.lines[index].start + timeline.lines[index].seconds));
    expect(timeline.durationSeconds - (line("gap").start + line("gap").seconds)).toBeGreaterThanOrEqual(0.9);
  });

  it("re-times from a different voice, and refuses one that will not fit", () => {
    const slower = buildRaceTimeline(figures, rows, names, { ...PLACEHOLDER_SECONDS, average: 3.2 });
    expect(slower.durationSeconds).toBeGreaterThan(timeline.durationSeconds);
    expect(() => buildRaceTimeline(figures, rows, names, { ...PLACEHOLDER_SECONDS, gap: 3.5 })).toThrow(/must run 12-15s/);
    expect(() => buildRaceTimeline(figures, rows, names, { ...PLACEHOLDER_SECONDS, flips: 4.5 })).toThrow(/must run 12-15s/);
  });

  it("refuses a story the figures do not support", () => {
    expect(() => buildRaceTimeline({ ...figures, avgA: 160, avgB: 164 }, rows, names, PLACEHOLDER_SECONDS)).toThrow(/must lead/);
    const flipped = rows.map((row) => (row.id === "warzone" ? { ...row, fpsA: row.fpsB - 1 } : row));
    expect(() => buildRaceTimeline(figures, flipped, names, PLACEHOLDER_SECONDS)).toThrow(RaceTimelineError);
  });
});

describe("captions", () => {
  it("caption every line, in short chunks, inside its line's time", () => {
    expect(new Set(timeline.captions.map((caption) => caption.line))).toEqual(new Set(timeline.lines.map((entry) => entry.id)));
    for (const caption of timeline.captions) {
      const spoken = line(caption.line);
      expect(caption.text.length).toBeLessThanOrEqual(MAX_CAPTION_CHARACTERS);
      expect(caption.start).toBeGreaterThanOrEqual(spoken.start - 1e-9);
      expect(caption.end).toBeLessThanOrEqual(spoken.start + spoken.seconds + 0.35 + 1e-9);
      expect(caption.end).toBeGreaterThan(caption.start + 0.8);
    }
    timeline.captions.slice(1).forEach((caption, index) => expect(caption.start).toBeGreaterThanOrEqual(timeline.captions[index].end));
  });

  it("show the figures the voice says, as digits", () => {
    const texts = captionTexts(figures, names);
    for (const entry of narrationLines(figures)) {
      const digits = (texts[entry.id].replace(names.a, "").replace(names.b, "").match(/\d+/g) ?? []).map(Number);
      expect(digits, entry.id).toEqual(spokenFigures(entry.text));
    }
  });

  it("never claim more leads than the counter shows", () => {
    for (const caption of timeline.captions.filter((entry) => entry.line === "leads")) {
      for (const frame of timeline.frames.filter((entry) => entry.t >= caption.start && entry.t < caption.end)) {
        expect(frame.count).toBe(20);
      }
    }
  });

  it("sit in their own band, under the label and above everything else", () => {
    const html = sceneHtml(timeline, sceneText(timeline));
    // The label pill ends at y=222 and the counter's digits start below y=380.
    expect(CAPTION_BAND.top).toBeGreaterThanOrEqual(222);
    expect(CAPTION_BAND.bottom).toBeLessThanOrEqual(360);
    // Nothing else is drawn at the band's old occupant: the setting now sits under the counter.
    expect(html).not.toContain("pill(T.setting");
  });
});

describe("sound", () => {
  it("puts one tick on each flip and a swell on each spotlight", () => {
    expect(timeline.cues.filter((cue) => cue.kind === "flip").map((cue) => cue.at)).toEqual(timeline.tiles.map((tile) => tile.flipAt));
    expect(timeline.cues.filter((cue) => cue.kind === "spotlight")).toHaveLength(3);
  });

  it("is deterministic, with each tick where its cue says", () => {
    const effects = synthesizeCues(timeline.cues, timeline.durationSeconds);
    expect(effects).toEqual(synthesizeCues(timeline.cues, timeline.durationSeconds));
    const energy = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * SAMPLE_RATE) + 1; i < Math.round(to * SAMPLE_RATE); i += 1) sum += (effects[i] - effects[i - 1]) ** 2;
      return sum;
    };
    for (const tile of timeline.tiles) expect(energy(tile.flipAt, tile.flipAt + 0.02)).toBeGreaterThan(3 * energy(tile.flipAt - 0.05, tile.flipAt - 0.03));
  });

  it("ducks the effects by 10 dB under narration", () => {
    const effects = new Float32Array(3 * SAMPLE_RATE).fill(0.1);
    const mixed = mixDraft(effects, [{ start: 1, samples: new Float32Array(SAMPLE_RATE) }]);
    expect(mixed[Math.round(1.5 * SAMPLE_RATE)] / mixed[Math.round(0.5 * SAMPLE_RATE)]).toBeCloseTo(10 ** (-10 / 20), 3);
  });
});

describe("the picture", () => {
  const html = sceneHtml(timeline, sceneText(timeline));

  it("draws the label last, in screen space, on every frame", () => {
    const draw = html.slice(html.indexOf("window.__draw = "));
    expect(draw.indexOf("withCamera(")).toBeLessThan(draw.indexOf("drawOverlay(f)"));
    const overlay = html.slice(html.indexOf("function drawOverlay"), html.indexOf("window.__draw = "));
    expect(overlay.lastIndexOf("T.label")).toBeGreaterThan(overlay.lastIndexOf("if (f."));
  });

  it("has no image, page capture, timer or randomness, and no unreadable tile labels", () => {
    expect(html).not.toMatch(/<img|<iframe|<video|url\(|https?:|drawImage|setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now/);
    expect(html).not.toContain("initials");
  });

  it("pulls key frames at each beat, inside the cut", () => {
    const times = keyFrameTimes(timeline);
    expect(times.map((time) => time.label)).toEqual([
      "opening", "first-flip", "spotlight-1", "spotlight-2", "counter-climbing", "spotlight-3", "count-complete", "pull-back", "averages", "verdict",
    ]);
    for (const time of times) expect(time.second).toBeLessThan(timeline.durationSeconds);
  });
});
