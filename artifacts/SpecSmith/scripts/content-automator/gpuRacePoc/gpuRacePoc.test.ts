// The GPU race proof of concept may only animate what Compare's figures say,
// and keeps its model-estimate label in every frame.

import { describe, expect, it } from "vitest";

import { synthesizeCues, SAMPLE_RATE } from "./audio.ts";
import { KEY_FRAME_SECONDS, raceInputs } from "./render.ts";
import { MODEL_ESTIMATE_LABEL, sceneHtml } from "./scene.ts";
import { buildRaceTimeline, DURATION_SECONDS, FPS, initialsFor, TRACK_LENGTH } from "./timeline.ts";

const { timeline, text } = await raceInputs();

describe("the race is drawn from the figures", () => {
  it("races the verified 1440p High figures", () => {
    expect(timeline.figures).toMatchObject({ resolution: "1440p", preset: "high", avgA: 164, avgB: 160, leadsA: 20, leadsB: 0, ties: 0, games: 20 });
    expect(text).toMatchObject({ leadsValue: "20/20", gapValue: "4 FPS", avgA: "164", avgB: "160", setting: "1440p High · 20 games" });
  });

  it("holds the distances in the ratio of the average FPS in every frame", () => {
    expect(timeline.frames).toHaveLength(FPS * DURATION_SECONDS);
    for (const frame of timeline.frames) {
      if (frame.yA > 0) expect(frame.yB / frame.yA).toBeCloseTo(160 / 164, 10);
    }
    expect(timeline.frames.at(-1)!.yA).toBeCloseTo(TRACK_LENGTH, 6);
  });

  it("flips one tile per game, to the game's leader, as that leader passes it, before the pull-back", () => {
    expect(timeline.tiles).toHaveLength(20);
    expect(timeline.tiles.every((tile) => tile.leader === "a")).toBe(true);
    for (const tile of timeline.tiles) {
      const before = timeline.frames.filter((frame) => frame.t < tile.flipAt).at(-1)!;
      expect(before.yA).toBeLessThan(tile.y);
      expect(tile.flipAt).toBeLessThan(4.95);
    }
    expect(timeline.frames.at(-1)!.flip.every((value) => value === 1)).toBe(true);
  });

  it("flips a game the other build leads to that build, and shows a tie as a tie", () => {
    const rows = [
      { id: "x", name: "Game X", fpsA: 100, fpsB: 110 },
      { id: "y", name: "Game Y", fpsA: 90, fpsB: 90 },
    ];
    const other = buildRaceTimeline({ ...timeline.figures, games: 2, leadsA: 1, leadsB: 1, ties: 1 }, rows, timeline.names);
    expect(other.tiles.map((tile) => tile.leader)).toEqual(["b", "tie"]);
  });

  it("refuses to race a build that does not lead on average in lane A", () => {
    expect(() => buildRaceTimeline({ ...timeline.figures, avgA: 160, avgB: 164 }, [], timeline.names)).toThrow(/must lead/);
  });

  it("puts one tick on each flip, and the pull-back and reveal cues on their moments", () => {
    const flips = timeline.cues.filter((cue) => cue.kind === "flip").map((cue) => cue.at);
    expect(flips).toEqual(timeline.tiles.map((tile) => tile.flipAt));
    const pullStart = timeline.frames.find((frame) => frame.pullback > 0)!.t;
    expect(timeline.cues.find((cue) => cue.kind === "whoosh")!.at).toBeLessThanOrEqual(pullStart);
    const revealStart = timeline.frames.find((frame) => frame.reveal > 0)!.t;
    expect(revealStart - timeline.cues.find((cue) => cue.kind === "reveal")!.at).toBeLessThan(1 / FPS + 1e-9);
  });

  it("makes the same sound every time, and places each tick where its cue says", () => {
    const first = synthesizeCues(timeline.cues);
    expect(first).toEqual(synthesizeCues(timeline.cues));
    const energy = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * SAMPLE_RATE) + 1; i < Math.round(to * SAMPLE_RATE); i += 1) sum += (first[i] - first[i - 1]) ** 2;
      return sum;
    };
    for (const flip of timeline.tiles.map((tile) => tile.flipAt)) {
      expect(energy(flip, flip + 0.02)).toBeGreaterThan(5 * energy(flip - 0.05, flip - 0.03));
    }
  });

  it("abbreviates game names to tile initials", () => {
    expect(initialsFor("Red Dead Redemption 2")).toBe("RDR");
    expect(initialsFor("CS2 (Counter-Strike 2)")).toBe("CS2");
    expect(initialsFor("Fortnite")).toBe("FOR");
  });
});

describe("the scene keeps the label and draws no captured or external media", () => {
  const html = sceneHtml(timeline, text);

  it("draws the model-estimate label in screen space on every frame, after the camera", () => {
    expect(text.label).toBe(MODEL_ESTIMATE_LABEL);
    const draw = html.slice(html.indexOf("window.__draw = "));
    expect(draw.indexOf("withCamera(")).toBeLessThan(draw.indexOf("drawOverlay(f)"));
    const overlay = html.slice(html.indexOf("function drawOverlay"), html.indexOf("window.__draw = "));
    // The label is the overlay's last, unconditional drawing, never inside a camera or an if.
    const labelAt = overlay.lastIndexOf("T.label");
    expect(labelAt).toBeGreaterThan(overlay.lastIndexOf("if (f."));
  });

  it("has no image, page capture, timer or randomness", () => {
    expect(html).not.toMatch(/<img|<iframe|<video|url\(|https?:|drawImage|setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now/);
  });

  it("samples key frames across all five beats", () => {
    expect([...KEY_FRAME_SECONDS]).toEqual([0.4, 1.8, 3.4, 5.0, 5.7, 7.6]);
  });
});
