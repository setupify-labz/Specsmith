// The pilot Short: "Will my old DDR4 fit?" One idea, told as one continuous
// story: a DDR4 stick needs a board with DDR4 slots, because DDR4 and DDR5
// sticks are keyed differently. Approach, stop, notch close-up, the two board
// choices, the Builder's warning, the route; each shot follows from the last.
//
// Wording rules, pinned by storyboard.test.ts:
// - no performance figure of any kind: this video makes compatibility claims
//   only, each traceable to the catalog or the Builder's checker (facts.ts);
// - "needs a board with DDR4 slots" is a necessary condition, never stated as
//   enough on its own;
// - the RAM diagram is labelled a diagram while the notch is the subject.

import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";
import type { DeclaredVisual } from "../v2/creative/visualHonesty.ts";
import type { RamFitFacts } from "./facts.ts";

export type SceneId = "approach" | "stop" | "notch" | "boards" | "catch" | "cta";

export interface PilotScene {
  readonly id: SceneId;
  readonly purpose: StoryboardBeat["purpose"];
  readonly startSecond: number;
  readonly endSecond: number;
  /** The temporary (and proposed final) voiceover line. */
  readonly narration: string;
  /** Burned-in captions, shown one chunk at a time in step with the voice. */
  readonly captions: readonly string[];
  /** What moves, for the review and for a person reading the plan. */
  readonly motion: string;
  /** Other words on screen that are not captions (the URL on the end card). */
  readonly onScreenExtras?: readonly string[];
  /** Which facts.ts fields this scene's claims rest on. */
  readonly claimSources: readonly string[];
}

export function pilotScenes(_facts: RamFitFacts): PilotScene[] {
  return [
    {
      id: "approach", purpose: "hook", startSecond: 0, endSecond: 2.3,
      narration: "Reusing old D D R 4 RAM?",
      captions: ["Reusing old DDR4 RAM?"],
      motion: "From the first frame a DDR4 stick is lowering into a DDR5 slot, close up.",
      claimSources: ["oldRam.type = DDR4", "ddr5Board.supported_ram = DDR5"],
    },
    {
      id: "stop", purpose: "commitment", startSecond: 2.3, endSecond: 4.7,
      narration: "It won't fit a D D R 5 slot.",
      captions: ["It won't fit a DDR5 slot."],
      motion: "The stick hits the slot and stops short, contacts still showing; a small jolt; the notch and the slot key glow red.",
      claimSources: ["mismatch (ram-type-mismatch, error, certain)"],
    },
    {
      id: "notch", purpose: "evidence", startSecond: 4.7, endSecond: 8.5,
      narration: "The notch is in a different place, so it can't line up.",
      captions: ["The notch is in", "a different place,", "so it can't line up."],
      motion: "A slow push-in on the contacts: an amber marker on the DDR4 notch, a cyan marker on the DDR5 key, an arrow between them. Labelled 'Diagram, not to scale'.",
      claimSources: ["mismatch.detail: keyed differently and are not interchangeable"],
    },
    {
      id: "boards", purpose: "payoff", startSecond: 8.5, endSecond: 12.5,
      narration: "Your D D R 4 needs a board with D D R 4 slots.",
      captions: ["Your DDR4 needs a board", "with DDR4 slots."],
      motion: "The camera pulls back: the DDR5 slot belongs to a DDR5 board, with a DDR4 board beside it. The stick lifts out, moves across and clicks into the DDR4 board; a green check; the DDR5 board dims.",
      claimSources: ["ddr4Board.supported_ram = DDR4", "matchPassed includes RAM type"],
    },
    {
      id: "catch", purpose: "reversal", startSecond: 12.5, endSecond: 16.1,
      narration: "Pick the wrong board, and Spec Smith flags it.",
      captions: ["Pick the wrong board,", "and SpecSmith flags it."],
      motion: "The boards fade; the SpecSmith Builder's real warning card for DDR4 on this DDR5 board settles in the middle of the frame.",
      claimSources: ["mismatch.title, detail and fix, captured from the running Builder at the same parts"],
    },
    {
      id: "cta", purpose: "cta", startSecond: 16.1, endSecond: 18.6,
      narration: "Check yours at Spec Smith.",
      captions: ["Check yours at SpecSmith."],
      onScreenExtras: ["specsmithpc.com/builder"],
      motion: "The card holds; the URL pill rises in beneath it and stays to the end.",
      claimSources: ["route /builder reproduces the card"],
    },
  ];
}

/** The scenes in MASTER #1's storyboard shape, so its review can measure them. */
export function pilotStoryboard(facts: RamFitFacts): PlatformScriptStoryboard {
  const scenes = pilotScenes(facts);
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: scenes.at(-1)!.endSecond,
    title: "Will your old DDR4 RAM fit?",
    narrationStyle: "Friendly, quick, like a friend who has built a few PCs. No hype.",
    beats: scenes.map((scene) => ({
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      purpose: scene.purpose,
      narration: scene.narration,
      visualDirection: `[animated:${scene.id}] ${scene.motion}`,
      onScreenText: [...scene.captions, ...(scene.onScreenExtras ?? [])].join(" "),
      factDependencies: [],
    })),
    finalCta: scenes.at(-1)!.narration,
    factualGuardrails: [
      "Compatibility claims only: catalog specifications and the Builder's own verdict. No performance figures.",
      "The RAM keying drawing is a diagram, labelled as one while it is on screen.",
    ],
  };
}

/** Caption chunks spread across a voice clip in proportion to their length. */
export function captionTimings(scene: PilotScene, voiceStart: number, voiceSeconds: number): { text: string; start: number; end: number }[] {
  const total = scene.captions.reduce((sum, text) => sum + text.length, 0);
  let cursor = voiceStart;
  return scene.captions.map((text, index) => {
    const start = index === 0 ? scene.startSecond : cursor;
    cursor += voiceSeconds * (text.length / total);
    const end = index === scene.captions.length - 1 ? scene.endSecond : cursor;
    return { text, start, end };
  });
}

/** The visuals the video shows, declared for MASTER #1's visual-honesty review. */
export const DECLARED_VISUALS: DeclaredVisual[] = [
  { kind: "derived-illustration", visualId: "ram-keying-diagram", explains: "DDR4 and DDR5 sticks are keyed differently, so a DDR4 stick cannot seat in a DDR5 slot.",
    subject: "other", explanatoryLabel: "Diagram, not to scale", derivedFrom: "compatibility.ts ram-type-mismatch (certain): keyed differently and are not interchangeable", showsNumericValues: false },
  { kind: "derived-illustration", visualId: "two-board-choices", explains: "A DDR4 stick seats in a board with DDR4 slots and not in one with DDR5 slots.",
    subject: "other", explanatoryLabel: null, derivedFrom: "components.json b660mpro (DDR4), b760mawifi (DDR5); checkCompatibility verdicts", showsNumericValues: false },
  { kind: "decorative", visualId: "background", description: "Dark background with a soft glow behind every scene." },
];
