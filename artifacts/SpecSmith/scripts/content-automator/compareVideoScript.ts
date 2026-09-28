// The script of the proven Compare video: RTX 4080 Super vs RTX 4080, both
// builds on a Ryzen 9 9950X3D.
//
// ONE SOURCE FOR WHAT IS SAID, SHOWN AND CAPTURED. Each beat carries its
// spoken line, its caption, the Compare setting captured behind it, and every
// page figure the line or caption states. The storyboard reads its narration
// and captions from here, the plan reads its capture settings from here, and
// the Liam narration is these lines joined. So the voice, the captions and the
// pictures cannot describe different things.
//
// EVERY FIGURE IS THE PAGE'S. `figures` records what the Compare page renders
// at that beat's setting: its "Est. Avg FPS" for each build, its "Modelled
// Game Leads", and ties counted from its per-game table (the page counts a tie
// as a lead for Build A, so ties are stated separately). storyboardCompareClaims
// renders Compare at each beat's setting and fails if any stated figure is not
// what the page shows; elevenLabsVoiceSample recomputes them with the page's
// own functions before any paid request.
//
// EVERY FIGURE IS LABELLED A MODEL ESTIMATE. Captions say "EST." or
// "MODELLED", and the evidence beat says the page's own caveat aloud before
// any per-setting figure is spoken.
//
// FIGURES ARE WRITTEN AS THEY ARE SAID. The narration contains no digit: a
// voice left to read "164" says "one hundred and sixty-four", which is longer
// than the beat was sized for and not how the figure is said. Captions keep
// the digits; spokenWords.ts reads the spoken figures back for checking.

export const COMPARE_VIDEO_IDEA_ID = "compare-rtx4080s-rtx4080";

export const COMPARE_VIDEO_BUILDS = {
  a: { gpu: "rtx4080s", cpu: "r9-9950x3d", label: "RTX 4080 Super + Ryzen 9 9950X3D" },
  b: { gpu: "rtx4080", cpu: "r9-9950x3d", label: "RTX 4080 + Ryzen 9 9950X3D" },
} as const;

export type CompareResolution = "1080p" | "1440p" | "4k";
export type ComparePreset = "high" | "ultra";

export interface CompareSetting {
  resolution: CompareResolution;
  preset: ComparePreset;
}

/** Figures the Compare page renders at one setting, as a beat states them. */
export interface CompareBeatFigures extends CompareSetting {
  /** "Est. Avg FPS" for Build A and Build B. */
  avgA?: number;
  avgB?: number;
  /** "Modelled Game Leads" for Build A and Build B, and ties from the per-game table. */
  leadsA?: number;
  leadsB?: number;
  ties?: number;
  /** Games on the page's per-game table ("twenty of twenty"). */
  games?: number;
}

export interface CompareVideoBeat {
  purpose: "hook" | "commitment" | "evidence" | "reversal" | "payoff" | "cta";
  narration: string;
  onScreenText: string;
  /** The Compare state captured behind this beat. The hook is a card, not a capture. */
  capture: CompareSetting | null;
  /** Page figures this beat's narration or caption states. Absent when it states none. */
  figures?: CompareBeatFigures;
}

export const COMPARE_VIDEO_BEATS: readonly CompareVideoBeat[] = Object.freeze([
  {
    purpose: "hook",
    narration: "Forty-eighty Super, or plain forty-eighty?",
    onScreenText: "RTX 4080 SUPER OR RTX 4080?",
    capture: null,
  },
  {
    purpose: "commitment",
    narration: "Same CPU. Super build: twenty of twenty modelled leads.",
    onScreenText: "SUPER BUILD: 20 OF 20 MODELLED GAME LEADS",
    capture: { resolution: "1080p", preset: "high" },
    figures: { resolution: "1080p", preset: "high", leadsA: 20, leadsB: 0, ties: 0, games: 20 },
  },
  {
    purpose: "evidence",
    narration: "Model estimates, not measured benchmarks of these exact systems.",
    onScreenText: "MODELLED FPS, NOT MEASURED ON THESE EXACT SYSTEMS",
    capture: { resolution: "4k", preset: "high" },
  },
  {
    purpose: "reversal",
    narration: "The catch: one sixty-four to one sixty at fourteen-forty.",
    onScreenText: "1440p HIGH: EST. 164 vs 160",
    capture: { resolution: "1440p", preset: "high" },
    figures: { resolution: "1440p", preset: "high", avgA: 164, avgB: 160 },
  },
  {
    purpose: "payoff",
    narration: "Four-K Ultra: seventy-nine to seventy-seven.",
    onScreenText: "4K ULTRA: EST. 79 vs 77",
    capture: { resolution: "4k", preset: "ultra" },
    figures: { resolution: "4k", preset: "ultra", avgA: 79, avgB: 77 },
  },
  {
    purpose: "cta",
    narration: "A few frames apart. Try your games in SpecSmith Compare.",
    onScreenText: "TRY IT IN SPECSMITH COMPARE",
    capture: { resolution: "1080p", preset: "high" },
  },
] satisfies CompareVideoBeat[]);

/** The Liam narration: every beat's line, in order. */
export const COMPARE_VIDEO_NARRATION = COMPARE_VIDEO_BEATS.map((beat) => beat.narration).join(" ");

/** The capture setting behind each beat after the hook, in order. */
export function compareCaptureSettings(): CompareSetting[] {
  return COMPARE_VIDEO_BEATS.slice(1).map((beat) => {
    if (!beat.capture) throw new Error(`Compare beat "${beat.purpose}" has no capture setting.`);
    return beat.capture;
  });
}
