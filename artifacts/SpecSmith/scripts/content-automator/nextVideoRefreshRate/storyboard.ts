// "Check your monitor's refresh rate": a 12–15 s Windows tutorial Short.
//
// This file is the single source for what the Short may show and say, and the
// guards that keep it honest:
//
//   - The Windows path comes from Microsoft's support article, with how it was
//     checked recorded beside it (MICROSOFT_SOURCE).
//   - The owner's screenshot is the evidence of the available settings
//     (SCREENSHOT): 240 Hz selected, with 60–200 Hz also listed. No other rate
//     may be named. The owner's PC was never accidentally at 60 Hz, so nothing
//     may imply it was.
//   - A setting change is presented only from the owner's screen recording
//     (recordingEdit.ts); nothing is recreated. If the recording dips to 60 Hz
//     to demonstrate the change, every shot showing it is labelled DEMO and
//     the edit ends on 240 Hz kept.
//   - The copy never claims more rendered FPS, a fix for every display issue,
//     that every monitor offers these rates, or that SpecSmith reads Windows
//     settings, and it never stages a smoothness comparison.

export const MIN_SECONDS = 12;
export const MAX_SECONDS = 15;
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
  path: ["Start", "Settings", "System", "Display", "Advanced display"],
  steps: [
    "Select Start > Settings > System > Display > Advanced display.",
    "If you have more than one display, choose the one you want to change first.",
    "Next to Choose a refresh rate, select the rate you want.",
  ],
  excerpts: [
    "The refresh rates that appear depend on your display and what it supports.",
    "The refresh rate dropdown list shows an asterisk next to refresh rates that don't support your current resolution. " +
      "Selecting one of these rates will cause your display resolution to change in order to achieve the selected refresh rate.",
  ],
  /** Not confirmed from Microsoft's text; the recording shows what this PC actually displays. */
  unconfirmed: [
    "The exact label of the display selector on the Advanced display page.",
    "The confirmation prompt's wording and buttons, and how long Windows waits before reverting (third-party guides say 15 seconds).",
  ],
});

/**
 * The owner's screenshot of the Choose a refresh rate list: the evidence of
 * which rates this setup offers. The values are as the owner described them
 * on 2026-10-09; the image itself has not reached this session yet, so
 * `sha256` is null until it is added and checked against this description.
 */
export interface ScreenshotEvidence {
  readonly description: string;
  readonly describedOn: string;
  readonly path: string | null;
  readonly sha256: string | null;
  readonly selectedHz: number;
  readonly listedHz: readonly number[];
}
export const SCREENSHOT: ScreenshotEvidence = Object.freeze({
  description: "Owner's Windows screenshot of the Choose a refresh rate dropdown.",
  describedOn: "2026-10-09",
  path: null,
  sha256: null,
  selectedHz: 240,
  listedHz: Object.freeze([60, 75, 100, 120, 144, 165, 200, 240]),
});

export class RefreshRateStoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshRateStoryError";
  }
}

/** The evidence must be self-consistent: the selected rate is one the list shows. */
export function evidenceProblems(evidence: ScreenshotEvidence = SCREENSHOT): string[] {
  const problems: string[] = [];
  if (!evidence.listedHz.includes(evidence.selectedHz)) problems.push(`${evidence.selectedHz} Hz is selected but not in the list.`);
  if (new Set(evidence.listedHz).size !== evidence.listedHz.length) problems.push("The list repeats a rate.");
  if ((evidence.path === null) !== (evidence.sha256 === null)) problems.push("A screenshot path needs its SHA-256, and a SHA-256 its path.");
  return problems;
}

/** Shown during the payoff and the close. Accurate as worded: refresh rate is how often the display redraws, not frames the game renders. */
export const PAYOFF_NOTE = "Refresh rate isn't game FPS";
export const SITE_LINE = "specsmithpc.com";
/** Every shot that shows a rate other than the real current one carries this, verbatim. */
export const demoLabel = (hz: number) => `DEMO · set to ${hz} Hz for this video`;

/** Claims this Short must never make, in any copy: captions, notes, labels, narration. */
export const FORBIDDEN_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\b(more|higher|boost\w*|increase\w*|raise\w*|double\w*)\b[^.?!]*\bfps\b/i, why: "Refresh rate does not raise rendered FPS." },
  { pattern: /\bfps\b[^.?!]*\b(boost\w*|increase\w*|gain\w*|jump\w*)\b/i, why: "Refresh rate does not raise rendered FPS." },
  { pattern: /\b(fix|fixes|solve|solves)\b[^.?!]*\b(every|all|any)\b/i, why: "It does not fix every display issue." },
  { pattern: /\b(every|all|any)\s+(gaming\s+)?monitors?\b/i, why: "Not every monitor offers these rates." },
  { pattern: /\bspecsmith\b[^.?!]*\b(detect|detects|scan|scans|check|checks|reads?)\b/i, why: "SpecSmith does not read Windows display settings." },
  { pattern: /\b(smoother|silky|buttery|feel the difference|see the difference)\b/i, why: "The exported video cannot show a smoothness difference; no comparison is staged." },
  // The owner's PC was at 240 Hz. Nothing may suggest it, or the viewer's, was found stuck low.
  { pattern: /\b(still|stuck|left|accidentally|wrongly)\b[^.?!]*\b(at|on|to)\s+(60|sixty)\b/i, why: "Implies a monitor was found stuck at 60 Hz; the recorded PC was not." },
  { pattern: /\b(was|were)\s+(set\s+)?(at|to)\s+(60|sixty)\b/i, why: "Implies the recorded PC was at 60 Hz before the demo; it was at 240 Hz." },
];

const RATE = /(\d{2,3})\s*(?:hz|hertz)\b|\b(sixty|seventy[- ]five|one hundred(?: and)? twenty|one[- ]forty[- ]four|one[- ]sixty[- ]five|two hundred|two[- ]forty)\b/gi;
const WORD_RATES: Record<string, number> = {
  sixty: 60, "seventy five": 75, "one hundred twenty": 120, "one hundred and twenty": 120, "one forty four": 144,
  "one sixty five": 165, "two hundred": 200, "two forty": 240,
};

/** Problems with any copy: forbidden claims, and rates the screenshot does not list. */
export function copyProblems(texts: readonly string[], evidence: ScreenshotEvidence = SCREENSHOT): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) problems.push(`"${text}": ${why}`);
    for (const match of text.matchAll(RATE)) {
      const hz = match[1] ? Number(match[1]) : WORD_RATES[match[2].toLowerCase().replace(/-/g, " ")] ?? Number.NaN;
      if (!evidence.listedHz.includes(hz)) problems.push(`"${text}" names ${match[0]}, which the screenshot does not list.`);
    }
  }
  return problems;
}

// ---- The edit, as shots of the owner's recording. ----

export type ShotId = "open-current" | "display-select" | "list-open" | "demo-low" | "choose-current" | "kept";

/** One cut from the recording. Source pixels and source seconds. */
export interface Segment {
  readonly shot: ShotId;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /** The close-up, in source pixels; scaled to fill the story band. */
  readonly crop: Rect;
  /** UI that must stay in frame so viewers know what they are seeing (page title, the setting's label…). */
  readonly context: readonly LabelledRect[];
  /** The setting's value as it appears in this cut; its height decides readability. */
  readonly value: LabelledRect & { readonly hz: number };
  readonly caption: string;
  /** The one highlight, drawn around `value` from this many seconds into the segment. */
  readonly highlightFrom?: number;
}
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface LabelledRect extends Rect { readonly label: string }

/** The edit decision list, written after watching the recording. */
export interface RecordingEdit {
  readonly recording: { readonly path: string; readonly sha256: string; readonly width: number; readonly height: number; readonly recordedOn: string; readonly windowsVersion: string; readonly monitorModel: string };
  readonly segments: readonly Segment[];
  readonly closingCaption: string;
}

/** Problems with an edit before anything is rendered; empty when it may be cut. */
export function editProblems(edit: RecordingEdit, evidence: ScreenshotEvidence = SCREENSHOT): string[] {
  const problems = [...evidenceProblems(evidence)];
  const { segments } = edit;
  if (segments.length === 0) return [...problems, "The edit has no shots."];
  const duration = segments.reduce((sum, segment) => sum + (segment.sourceEnd - segment.sourceStart), 0);
  if (duration < MIN_SECONDS || duration > MAX_SECONDS) problems.push(`The edit runs ${duration.toFixed(2)} s, outside ${MIN_SECONDS}–${MAX_SECONDS} s.`);
  if (segments[0].shot !== "open-current" || segments[0].value.hz !== evidence.selectedHz) {
    problems.push(`The first shot must be the real Advanced display setting at ${evidence.selectedHz} Hz.`);
  }
  let demoSeen = false;
  for (const [index, segment] of segments.entries()) {
    const where = `Shot ${index + 1} (${segment.shot})`;
    if (!(segment.sourceEnd > segment.sourceStart)) problems.push(`${where} has no duration.`);
    if (!evidence.listedHz.includes(segment.value.hz)) problems.push(`${where} shows ${segment.value.hz} Hz, which the screenshot does not list.`);
    const isDemo = segment.value.hz !== evidence.selectedHz;
    if (isDemo !== (segment.shot === "demo-low")) problems.push(`${where}: only a "demo-low" shot may show a rate other than ${evidence.selectedHz} Hz, and it must.`);
    if (isDemo) demoSeen = true;
    for (const rect of [...segment.context, segment.value]) {
      if (!contains(segment.crop, rect)) problems.push(`${where}: "${rect.label}" is cut off by the crop; keep the surrounding UI in view.`);
    }
    if (segment.context.length === 0) problems.push(`${where} declares no surrounding UI; a bare close-up does not say what it is.`);
    if (segment.highlightFrom !== undefined && segment.shot !== "kept") problems.push(`${where}: the one highlight belongs on the kept result.`);
  }
  const last = segments.at(-1)!;
  if (last.shot !== "kept" || last.value.hz !== evidence.selectedHz) problems.push(`The edit must end on ${evidence.selectedHz} Hz kept.`);
  if (demoSeen && !segments.some((segment, index) => segment.shot === "choose-current" && segments.slice(0, index).some((before) => before.shot === "demo-low"))) {
    problems.push(`A demo must be followed by choosing ${evidence.selectedHz} Hz again.`);
  }
  if (segments.filter((segment) => segment.highlightFrom !== undefined).length !== 1) problems.push("Exactly one highlight, on the kept result.");
  problems.push(...copyProblems([...segments.map((segment) => segment.caption), edit.closingCaption, PAYOFF_NOTE, SITE_LINE,
    ...segments.filter((segment) => segment.shot === "demo-low").map((segment) => demoLabel(segment.value.hz))], evidence));
  return problems;
}

export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * The narration, written only after watching the recording, to match what it
 * proves. Until then this is a working draft for the recommended shot plan
 * (with the 60 Hz demonstration) and is NOT the approval script.
 */
export const WORKING_NARRATION = Object.freeze({
  final: false,
  text: "Check your monitor's refresh rate. In Advanced display, pick the right display and open the list. For this demo we dropped to sixty. Choose the rate you want, then keep changes. What's yours set to?",
});
