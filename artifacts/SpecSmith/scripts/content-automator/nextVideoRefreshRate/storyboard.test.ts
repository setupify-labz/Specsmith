// The refresh-rate Short's guards: only rates the owner's screenshot lists,
// nothing implying the recorded PC was found at 60 Hz, a labelled and undone
// demo, an edit that opens on the real setting and ends on it kept, crops
// that keep the surrounding UI, and no FPS-boost, fix-everything,
// every-monitor, SpecSmith-detects or smoothness claims.

import { describe, expect, it } from "vitest";

import {
  copyProblems, demoLabel, editProblems, evidenceProblems, FORBIDDEN_CLAIMS, PAYOFF_NOTE, SCREENSHOT, SITE_LINE, WORKING_NARRATION,
  type RecordingEdit, type Segment,
} from "./storyboard.ts";

const ui = { crop: { x: 700, y: 200, w: 692, h: 1000 }, context: [{ x: 750, y: 300, w: 600, h: 80, label: "Choose a refresh rate" }] };
const shot = (shot: Segment["shot"], start: number, end: number, hz: number, caption: string, extra: Partial<Segment> = {}): Segment =>
  ({ shot, sourceStart: start, sourceEnd: end, ...ui, value: { x: 900, y: 700, w: 300, h: 60, label: `${hz} Hz`, hz }, caption, ...extra });
const goodEdit = (path = "recording.mp4", sha256 = "0".repeat(64)): RecordingEdit => ({
  recording: { path, sha256, width: 2560, height: 1440, recordedOn: "2026-10-09", windowsVersion: "Windows 11", monitorModel: "Example 240 Hz" },
  segments: [
    shot("open-current", 0, 2.5, 240, "Check your monitor's refresh rate"),
    shot("list-open", 2.5, 5, 240, "The list shows what your setup supports"),
    shot("demo-low", 5, 7, 60, "Changing it: a demo"),
    shot("choose-current", 7, 10, 240, "Pick the rate, then Keep changes"),
    shot("kept", 10, 13, 240, "", { highlightFrom: 0.5 }),
  ],
  closingCaption: "What's yours set to?",
});
const withSegments = (edit: RecordingEdit, segments: Segment[]): RecordingEdit => ({ ...edit, segments });

describe("the evidence", () => {
  it("is the owner's described screenshot: 240 Hz selected, 60–240 Hz listed, image not yet received", () => {
    expect(evidenceProblems()).toEqual([]);
    expect(SCREENSHOT).toMatchObject({ selectedHz: 240, listedHz: [60, 75, 100, 120, 144, 165, 200, 240], path: null, sha256: null });
  });

  it("refuses a selected rate the list does not show, and a path without its hash", () => {
    expect(evidenceProblems({ ...SCREENSHOT, selectedHz: 360 })).toHaveLength(1);
    expect(evidenceProblems({ ...SCREENSHOT, path: "shot.png" })).toHaveLength(1);
  });
});

describe("copy", () => {
  it("allows the note, site line, demo label and working narration", () => {
    expect(copyProblems([PAYOFF_NOTE, SITE_LINE, demoLabel(60), WORKING_NARRATION.text])).toEqual([]);
    expect(WORKING_NARRATION.final).toBe(false);
  });

  it("allows any listed rate, written or spoken, and refuses unlisted ones", () => {
    expect(copyProblems(["240 Hz", "144 Hz", "sixty", "two forty", "seventy-five hertz"])).toEqual([]);
    expect(copyProblems(["Set it to 360 Hz"])).toHaveLength(1);
    expect(copyProblems(["Try 170 Hz"])).toHaveLength(1);
  });

  const bad = [
    "This boosts your FPS", "More FPS in every game", "Your FPS will jump", "This fixes every display problem",
    "Every monitor supports 240 Hz", "All gaming monitors can do this", "SpecSmith detects your refresh rate", "Feel the difference instantly",
    "Your monitor might still be set to 60 Hz", "Mine was stuck at sixty", "My PC was set to 60 Hz", "Windows left it on 60",
  ];
  for (const sentence of bad) {
    it(`refuses "${sentence}"`, () => expect(copyProblems([sentence]).length).toBeGreaterThan(0));
  }

  it("has no pattern that matches the note", () => {
    for (const { pattern } of FORBIDDEN_CLAIMS) expect(PAYOFF_NOTE).not.toMatch(pattern);
  });
});

describe("the edit", () => {
  it("accepts the recommended shot plan", () => expect(editProblems(goodEdit())).toEqual([]));

  it("must open on the real setting, readable", () => {
    const edit = goodEdit();
    expect(editProblems(withSegments(edit, [shot("demo-low", 0, 2.5, 60, "x"), ...edit.segments.slice(1)])).join()).toMatch(/first shot must be the real Advanced display setting at 240 Hz/);
  });

  it("refuses 60 Hz outside a demo shot, and a demo never undone", () => {
    const edit = goodEdit();
    const unlabelled = edit.segments.map((s) => s.shot === "demo-low" ? { ...s, shot: "list-open" as const } : s);
    expect(editProblems(withSegments(edit, unlabelled)).join()).toMatch(/only a "demo-low" shot may show/);
    const neverUndone = edit.segments.filter((s) => s.shot !== "choose-current").map((s) => s.shot === "kept" ? { ...s, sourceEnd: s.sourceEnd + 3 } : s);
    expect(editProblems(withSegments(edit, neverUndone)).join()).toMatch(/demo must be followed by choosing 240 Hz again/);
  });

  it("must end on 240 Hz kept, with exactly one highlight there", () => {
    const edit = goodEdit();
    expect(editProblems(withSegments(edit, edit.segments.slice(0, -1).map((s, i, all) => i === all.length - 1 ? { ...s, sourceEnd: 13 } : s))).join()).toMatch(/must end on 240 Hz kept/);
    expect(editProblems(withSegments(edit, edit.segments.map((s) => ({ ...s, highlightFrom: undefined })))).join()).toMatch(/Exactly one highlight/);
  });

  it("refuses a crop that cuts off the surrounding UI or the value", () => {
    const edit = goodEdit();
    const tight = edit.segments.map((s, i) => i === 1 ? { ...s, crop: { x: 880, y: 650, w: 346, h: 500 } } : s);
    expect(editProblems(withSegments(edit, tight)).join()).toMatch(/"Choose a refresh rate" is cut off/);
    const bare = edit.segments.map((s, i) => i === 1 ? { ...s, context: [] } : s);
    expect(editProblems(withSegments(edit, bare)).join()).toMatch(/declares no surrounding UI/);
  });

  it("refuses a rate the screenshot does not list, a forbidden caption, and a length outside 12–15 s", () => {
    const edit = goodEdit();
    expect(editProblems(withSegments(edit, edit.segments.map((s) => s.shot === "demo-low" ? { ...s, value: { ...s.value, hz: 30 } } : s))).join()).toMatch(/30 Hz, which the screenshot does not list/);
    expect(editProblems({ ...edit, closingCaption: "Yours was probably stuck at 60 Hz" }).join()).toMatch(/stuck at 60/);
    expect(editProblems(withSegments(edit, edit.segments.map((s) => s.shot === "kept" ? { ...s, sourceEnd: 20 } : s))).join()).toMatch(/outside 12–15 s/);
  });
});
