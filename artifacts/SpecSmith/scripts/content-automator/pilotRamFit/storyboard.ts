// The pilot Short: "Can I reuse my old DDR4?" One idea, shown with motion:
// the motherboard decides which RAM generation fits, because DDR4 and DDR5
// sticks are keyed differently.
//
// Wording rules, pinned by storyboard.test.ts:
// - no performance figure of any kind: this video makes compatibility claims
//   only, each traceable to the catalog or the Builder's checker (facts.ts);
// - nothing absolute the catalog cannot back: "the board decides" is about
//   the two boards shown and the Builder's rule, not every board ever made;
// - the RAM diagram is labelled a diagram while the notch is the subject.

import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";
import type { DeclaredVisual } from "../v2/creative/visualHonesty.ts";
import type { RamFitFacts } from "./facts.ts";

export type SceneId = "hook" | "why" | "twist" | "payoff" | "cta";

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

export function pilotScenes(facts: RamFitFacts): PilotScene[] {
  return [
    {
      id: "hook", purpose: "hook", startSecond: 0, endSecond: 2.5,
      narration: "Reusing your old D D R 4 RAM?",
      captions: ["Reusing your old DDR4 RAM?"],
      motion: "A DDR4 stick drops into a DDR5 slot and slams to a stop short of seating; the frame shakes, the misaligned notch flashes red, a WON'T GO IN stamp lands.",
      claimSources: ["oldRam.type", "ddr5Board.supported_ram", "mismatch (ram-type-mismatch, certain)"],
    },
    {
      id: "why", purpose: "evidence", startSecond: 2.5, endSecond: 7,
      narration: "On a D D R 5 board, it can't go in. The notch is in a different spot.",
      captions: ["On a DDR5 board,", "it can't go in.", "The notch is in", "a different spot."],
      motion: "The camera pushes in on the contacts: dashed guides drop from the DDR4 notch and the slot's DDR5 key, an arrow shows the gap, then a ghost DDR5 edge slides in and lines up. Labelled 'Diagram, not to scale'.",
      claimSources: ["mismatch.detail: keyed differently and are not interchangeable"],
    },
    {
      id: "twist", purpose: "reversal", startSecond: 7, endSecond: 10.7,
      narration: `This Intel chip works with both. The board decides which.`,
      captions: ["This Intel chip", "works with both.", "The board decides which."],
      motion: `A ${facts.cpu.name} chip clones itself into two ${facts.cpu.socket} boards that slide in from either side: a DDR4 board (${facts.ddr4Board.name}) and a DDR5 board (${facts.ddr5Board.name}). Both sockets light green; THE BOARD DECIDES lands above them.`,
      claimSources: ["cpu.supported_ram = DDR4, DDR5", "cpu.socket = ddr4Board.socket = ddr5Board.socket", "ddr4Board.supported_ram = DDR4", "ddr5Board.supported_ram = DDR5"],
    },
    {
      id: "payoff", purpose: "payoff", startSecond: 10.7, endSecond: 13.7,
      narration: "On a D D R 4 board, it clicks right in.",
      captions: ["On a DDR4 board,", "it clicks right in."],
      motion: "The old DDR4 stick flies into the DDR4 board's slot and seats; both latches snap shut and the slot glows green. The DDR5 board dims behind a red cross.",
      claimSources: ["matchPassed includes RAM type and CPU socket"],
    },
    {
      id: "cta", purpose: "cta", startSecond: 13.7, endSecond: 17.5,
      narration: "Spec Smith's Builder catches this before you buy.",
      captions: ["SpecSmith's Builder catches", "this before you buy."],
      onScreenExtras: ["specsmithpc.com/builder", "Free · no account needed"],
      motion: "The SpecSmith mark appears and the Builder's real warning card for this exact DDR4 + DDR5-board build slides up and pulses red; specsmithpc.com/builder settles beneath it.",
      claimSources: ["mismatch.title and detail, captured from the running Builder at the same parts", "About page: completely free with no account required"],
    },
  ];
}

/** The scenes in MASTER #1's storyboard shape, so its review can measure them. */
export function pilotStoryboard(facts: RamFitFacts): PlatformScriptStoryboard {
  const scenes = pilotScenes(facts);
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: scenes.at(-1)!.endSecond,
    title: "Can you reuse your old DDR4 RAM?",
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
  { kind: "derived-illustration", visualId: "one-cpu-two-boards", explains: "The same LGA1700 CPU supports DDR4 and DDR5; each of the two boards shown takes one.",
    subject: "other", explanatoryLabel: null, derivedFrom: "cpus.json i5-12400f; components.json b660mpro, b760mawifi", showsNumericValues: false },
  { kind: "decorative", visualId: "grid-background", description: "Drifting grid and glow behind every scene." },
];
