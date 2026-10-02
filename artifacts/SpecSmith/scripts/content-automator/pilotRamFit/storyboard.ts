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

export type SceneId = "fail" | "notch" | "choice" | "payoff" | "cta";

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
      id: "fail", purpose: "hook", startSecond: 0, endSecond: 2.35,
      narration: "DDR4 won't fit DDR5.",
      captions: ["DDR4 won't fit DDR5."],
      motion: "From the first frame a DDR4 stick is pushing into a DDR5 slot; at 0.5 s it slams to a stop on the key, the frame jolts, and the contacts left outside the slot turn red.",
      claimSources: ["mismatch (ram-type-mismatch, error, certain)", "oldRam.type = DDR4", "ddr5Board.supported_ram = DDR5"],
    },
    {
      id: "notch", purpose: "evidence", startSecond: 2.35, endSecond: 3.9,
      narration: "The notch doesn't line up.",
      captions: ["The notch doesn't line up."],
      motion: "A quick push-in on the contacts: DDR4 notch (amber) and DDR5 key (cyan) labelled. 'Diagram, not to scale'.",
      claimSources: ["mismatch.detail: keyed differently and are not interchangeable"],
    },
    {
      id: "choice", purpose: "payoff", startSecond: 3.9, endSecond: 6.95,
      narration: "Use DDR5 RAM, or a DDR4 board.",
      captions: ["Use DDR5 RAM,", "or a DDR4 board."],
      motion: "Pull back to two boards. The DDR4 stick lifts out; a DDR5 stick slides in and seats in this DDR5 board (check). Then the DDR4 stick rises into the DDR4 board above (check).",
      claimSources: ["mismatch.fix: Choose DDR5 memory, or a motherboard that supports DDR4", "newRamPassed includes RAM type", "matchPassed includes RAM type"],
    },
    {
      id: "payoff", purpose: "reversal", startSecond: 6.95, endSecond: 9.45,
      narration: "SpecSmith flags it, with both fixes.",
      captions: ["SpecSmith flags it,", "with both fixes."],
      onScreenExtras: ["Won't fit", "DDR4 RAM · DDR5 board", "Use DDR5 RAM", "Or a DDR4 board", "Real SpecSmith Builder warning"],
      motion: "A large message: WON'T FIT, DDR4 RAM · DDR5 board, and the two fixes as big rows. Then the real Builder warning card slides up beneath it for about a second, labelled as the real warning.",
      claimSources: ["mismatch.title and fix, captured from the running Builder at the same parts"],
    },
    {
      id: "cta", purpose: "cta", startSecond: 9.45, endSecond: 11.2,
      narration: "Check yours at SpecSmith.",
      captions: ["Check yours at SpecSmith."],
      onScreenExtras: ["specsmithpc.com/builder"],
      motion: "SpecSmith logo lockup and the URL pill.",
      claimSources: ["route /builder reproduces the warning"],
    },
  ];
}

/** The scenes in MASTER #1's storyboard shape, so its review can measure them. */
export function pilotStoryboard(facts: RamFitFacts): PlatformScriptStoryboard {
  const scenes = pilotScenes(facts);
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: scenes.at(-1)!.endSecond,
    title: "DDR4 won't fit DDR5",
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
  { kind: "derived-illustration", visualId: "two-fixes", explains: "The Builder's two fixes: DDR5 memory on the DDR5 board, or a DDR4 board for the DDR4 memory.",
    subject: "other", explanatoryLabel: null, derivedFrom: "components.json b660mpro (DDR4), b760mawifi (DDR5), kf16ddr5; checkCompatibility verdicts and fix text", showsNumericValues: false },
  { kind: "derived-illustration", visualId: "fit-message", explains: "The Builder's verdict and fix, set large: won't fit, DDR5 RAM or a DDR4 board.",
    subject: "other", explanatoryLabel: null, derivedFrom: "compatibility.ts ram-type-mismatch title and fix", showsNumericValues: false },
  { kind: "decorative", visualId: "background", description: "Dark background with a soft glow behind every scene." },
];
