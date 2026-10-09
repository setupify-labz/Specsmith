// "Your gaming monitor might still be set to 60 Hz": a 14-second troubleshooting
// Short. This file is the single source for what the draft may show and say,
// and the guards that keep it honest:
//
//   - The Windows path comes from Microsoft's support article, with how it was
//     checked recorded beside it (MICROSOFT_SOURCE).
//   - No real recording exists yet (FOOTAGE is null), so every frame is an
//     ILLUSTRATIVE recreation and says so, and nothing names a specific higher
//     refresh rate: the higher option is a labelled placeholder until a real
//     display's options are recorded. "144 Hz monitor" is used only when the
//     recorded display offers exactly 144 Hz.
//   - The copy never claims more rendered FPS, a fix for every display issue,
//     that every monitor supports 144 Hz, or that SpecSmith reads Windows
//     settings; and it never stages a smoothness comparison.

export const DURATION_SECONDS = 14;
export const FPS = 30;

/** How the Windows steps were checked. Read the limits before relying on it. */
export const MICROSOFT_SOURCE = Object.freeze({
  title: "Change the refresh rate on your monitor in Windows",
  publisher: "Microsoft Support",
  urls: [
    "https://support.microsoft.com/en-us/windows/change-the-refresh-rate-on-your-monitor-in-windows-c8ea729e-0678-015c-c415-f806f04aae5a",
    "https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows",
  ],
  checkedOn: "2026-10-09",
  method:
    "Web-search excerpts of the Microsoft page. A direct read was refused by this environment's network policy " +
    "(support.microsoft.com: egress blocked), so the page itself has not been read here. A person should open it " +
    "once and confirm the path before the final edit.",
  /** The path as the excerpts give it, in order. */
  path: ["Start", "Settings", "System", "Display", "Advanced display"],
  steps: [
    "Select Start > Settings > System > Display > Advanced display.",
    "If you have more than one display, choose the one you want to change first.",
    "Next to Choose a refresh rate, select the rate you want.",
  ],
  /** Sentences the search excerpts attribute to the Microsoft page. */
  excerpts: [
    "The refresh rates that appear depend on your display and what it supports.",
    "The refresh rate dropdown list shows an asterisk next to refresh rates that don't support your current resolution. " +
      "Selecting one of these rates will cause your display resolution to change in order to achieve the selected refresh rate.",
  ],
  /** Shown in the draft but NOT confirmed from Microsoft's text; the real recording settles them. */
  unconfirmed: [
    "The exact label of the display selector on the Advanced display page.",
    "The confirmation prompt's wording and buttons, and how long Windows waits before reverting (third-party guides say 15 seconds).",
    "Whether Windows 10 builds before 20H2 show this page (third-party guides send them to Display adapter properties > Monitor instead).",
  ],
});

/**
 * The real recording, once someone supplies one. Until then the draft is
 * illustrative. `offeredHz` is what that display's own refresh-rate list
 * showed in the recording, never a spec-sheet number.
 */
export interface Footage {
  readonly path: string;
  readonly sha256: string;
  readonly recordedOn: string;
  readonly windowsVersion: string;
  readonly monitorModel: string;
  readonly offeredHz: readonly number[];
}
export const FOOTAGE: Footage | null = null;

export class RefreshRateStoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshRateStoryError";
  }
}

/** The higher rate the payoff may name: only one the recorded display actually offered. */
export function higherRateLabel(footage: Footage | null): string {
  if (!footage) return "Higher rate";
  const higher = footage.offeredHz.filter((hz) => hz > 60);
  if (!footage.offeredHz.includes(60) || higher.length === 0) {
    throw new RefreshRateStoryError("The recording must show both 60 Hz and a higher rate in the display's own list.");
  }
  return `${Math.max(...higher)} Hz`;
}

/** The frame-one caption. "144 Hz monitor" only when the recorded display offers exactly that. */
export function hookCaption(footage: Footage | null): string {
  if (footage && footage.offeredHz.includes(60) && Math.max(...footage.offeredHz) === 144) return "144 Hz monitor. Still set to 60?";
  return "High-refresh monitor. Still set to 60 Hz?";
}

/** Every frame of an illustrative draft carries this, verbatim, in its own band. */
export const ILLUSTRATIVE_LABEL = Object.freeze({
  badge: "ILLUSTRATIVE UI DRAFT",
  line: "Recreated settings · not a screen recording",
});

export interface Caption { readonly startSecond: number; readonly endSecond: number; readonly text: string; readonly hook?: true }

export function captions(footage: Footage | null): Caption[] {
  return [
    { startSecond: 0, endSecond: 2, text: hookCaption(footage), hook: true },
    { startSecond: 2, endSecond: 4.6, text: "Open Settings › System › Display" },
    { startSecond: 4.6, endSecond: 6, text: "Then Advanced display" },
    { startSecond: 6, endSecond: 7.3, text: "Select your monitor first" },
    { startSecond: 7.3, endSecond: 9.1, text: "Choose a refresh rate" },
    { startSecond: 9.1, endSecond: 11, text: "Keep the change" },
    { startSecond: 11, endSecond: DURATION_SECONDS, text: "What was yours set to?" },
  ];
}

/** Shown in the story band through the payoff and the close. */
export const PAYOFF_NOTE = "Refresh rate isn't game FPS";
export const SITE_LINE = "specsmithpc.com";

/**
 * The narration proposed for approval. Not voiced: no take exists and none was
 * requested. Start times are ESTIMATES from the saved GPU-upgrade take's pace
 * (314 characters in 23.25 s, about 13.5 characters a second): this line set
 * would run about 12.5 s. As with that Short, the edit is retimed to the
 * approved take's actual delivery, not to these numbers.
 */
export const PROPOSED_NARRATION = Object.freeze([
  { line: "Your high-refresh monitor might still be set to sixty hertz.", plannedStartSecond: 0.2 },
  { line: "Open Advanced display, select your monitor, then choose the higher rate it supports.", plannedStartSecond: 4.6 },
  { line: "What was yours set to?", plannedStartSecond: 11.2 },
]);
export const PROPOSED_NARRATION_TEXT = PROPOSED_NARRATION.map((entry) => entry.line).join(" ");

/** Claims this Short must never make, in any copy: captions, notes, narration. */
export const FORBIDDEN_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\b(more|higher|boost\w*|increase\w*|raise\w*|double\w*)\b[^.?!]*\bfps\b/i, why: "Refresh rate does not raise rendered FPS." },
  { pattern: /\bfps\b[^.?!]*\b(boost\w*|increase\w*|gain\w*|jump\w*)\b/i, why: "Refresh rate does not raise rendered FPS." },
  { pattern: /\b(fix|fixes|solve|solves)\b[^.?!]*\b(every|all|any)\b/i, why: "It does not fix every display issue." },
  { pattern: /\b(every|all|any)\s+(gaming\s+)?monitors?\b/i, why: "Not every monitor supports a higher rate." },
  { pattern: /\bspecsmith\b[^.?!]*\b(detect|detects|scan|scans|check|checks|reads?)\b/i, why: "SpecSmith does not read Windows display settings." },
  { pattern: /\b(smoother|silky|buttery|feel the difference|see the difference)\b/i, why: "The exported video cannot show a smoothness difference; no comparison is staged." },
];

/** Every string this Short shows or says. */
export function allCopy(footage: Footage | null): string[] {
  return [...captions(footage).map((entry) => entry.text), PAYOFF_NOTE, SITE_LINE, higherRateLabel(footage), PROPOSED_NARRATION_TEXT];
}

/** Problems with any copy: forbidden claims, and rates no recording has shown. */
export function copyProblems(texts: readonly string[], footage: Footage | null): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) problems.push(`"${text}": ${why}`);
    const shown = new Set([60, ...(footage?.offeredHz ?? [])]);
    const rates = [...text.matchAll(/(\d{2,3})\s*(hz|hertz)/gi)].map((match) => Number(match[1])).filter((hz) => !shown.has(hz));
    if (rates.length) problems.push(`"${text}" names ${rates.join(", ")} Hz, which no recorded display has shown.`);
  }
  return problems;
}

/** Problems with the story as configured; empty when it may be rendered. */
export function storyProblems(footage: Footage | null = FOOTAGE): string[] {
  const problems = copyProblems(allCopy(footage), footage);
  const list = captions(footage);
  if (list[0].startSecond !== 0 || !list[0].hook) problems.push("The hook caption must be on screen from frame 0.");
  for (let index = 1; index < list.length; index += 1) {
    if (list[index].startSecond !== list[index - 1].endSecond) problems.push(`Caption gap or overlap before "${list[index].text}".`);
  }
  if (list.at(-1)!.endSecond !== DURATION_SECONDS) problems.push("The last caption must hold to the end.");
  if (DURATION_SECONDS < 12 || DURATION_SECONDS > 15) problems.push(`Duration ${DURATION_SECONDS}s is outside 12–15 s.`);
  return problems;
}
