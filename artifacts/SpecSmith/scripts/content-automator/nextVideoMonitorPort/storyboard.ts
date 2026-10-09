// "Where to plug in your gaming monitor": a 13-second SpecSmith Short.
//
// This file is the single source for what the Short may show and say, and the
// guards that keep it honest:
//
//   - The general fact it rests on is sourced (SOURCES): a motherboard's video
//     ports are driven by the CPU's integrated graphics, which can be absent or
//     disabled when a graphics card is installed.
//   - What happens on THIS PC with each connection is not known until the PC
//     is checked (PC_RECORD). Until then no outcome is shown or said, and the
//     visual draft is an illustrative diagram, labelled as such on every frame.
//   - A motherboard connection can show a picture, so "NO SIGNAL" is never
//     presented as the universal result. Windows can also render a game on the
//     graphics card while a motherboard port drives the display, so no FPS
//     gain, bottleneck or performance loss is claimed unless measured here,
//     same game and settings, both ways.

export const DURATION_SECONDS = 13;
export const FPS = 30;

export const SOURCES = Object.freeze([
  {
    publisher: "Intel Support",
    title: "Blank Screen When Using Intel® HD Graphics 620",
    url: "https://www.intel.com/content/www/us/en/support/articles/000087454/graphics.html",
    supports: "The motherboard's video port works through the integrated graphics, which may be disabled when discrete graphics are used; Intel advises connecting to the discrete card's port.",
  },
  {
    publisher: "Intel Support",
    title: "How To Set the Default GPU for Applications and Games",
    url: "https://www.intel.com/content/www/us/en/support/articles/000090168/graphics.html",
    supports: "Windows can assign each application to a specific GPU, so the GPU rendering a game is not simply the one the monitor is plugged into.",
  },
]);
export const SOURCES_CHECKED = Object.freeze({
  on: "2026-10-09",
  method: "Web-search excerpts of the Intel pages; this environment cannot open them directly. A person should read both once before the final edit.",
});

/** What one connection actually did on the verified PC. */
export interface ObservedConnection {
  /** What the monitor showed, in plain words, e.g. "Windows desktop at 1920×1080, 60 Hz" or "NO SIGNAL message". */
  readonly monitorShowed: string;
  /** Which adapter Windows listed for that display (Settings › System › Display › Advanced display, "Display information"). */
  readonly displayAdapter: string | null;
  /** The footage file and its SHA-256 that shows it. */
  readonly footage: { readonly path: string; readonly sha256: string } | null;
}

/** The PC the Short is filmed on. Every field comes from the PC itself, not from a spec sheet guess. */
export interface PcRecord {
  readonly cpu: string;
  readonly motherboard: string;
  readonly gpu: string;
  /** Whether this CPU has integrated graphics (from the CPU maker's spec page for this exact model). */
  readonly cpuHasIntegratedGraphics: boolean;
  /** The firmware's integrated-graphics setting as found, if checked. */
  readonly firmwareIntegratedGraphics: string | null;
  readonly motherboardPort: ObservedConnection;
  readonly graphicsCardPort: ObservedConnection;
  /** Same game, same settings, both connections, if anyone measured it. No performance line without it. */
  readonly measuredPerformance: null | { readonly game: string; readonly settings: string; readonly motherboardPortFps: number; readonly graphicsCardPortFps: number; readonly method: string };
}
export const PC_RECORD: PcRecord | null = null;

export class MonitorPortStoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonitorPortStoryError";
  }
}

export const HOOK = "You bought a graphics card. Is your monitor plugged into it?";
export const LABELS = Object.freeze({ motherboard: "MOTHERBOARD", graphicsCard: "GRAPHICS CARD" });
export const INSTRUCTION = "If you have a dedicated GPU, check its display ports.";
export const SITE_LINE = "specsmithpc.com";
export const ILLUSTRATIVE_LABEL = Object.freeze({ badge: "ILLUSTRATIVE DIAGRAM", line: "Not real hardware · real footage replaces it" });

export interface Caption { readonly startSecond: number; readonly endSecond: number; readonly text: string }

/**
 * The beats. The result beat says only what PC_RECORD observed; without a
 * record it is a labelled placeholder, never a guessed outcome.
 */
export function beats(record: PcRecord | null = PC_RECORD) {
  return [
    { id: "hook", startSecond: 0, endSecond: 2.6, caption: HOOK },
    { id: "motherboard", startSecond: 2.6, endSecond: 4.6, caption: "Motherboard ports use the CPU's graphics" },
    { id: "graphics-card", startSecond: 4.6, endSecond: 6.6, caption: "Graphics card ports use the card you bought" },
    { id: "move", startSecond: 6.6, endSecond: 8.6, caption: "Move the cable to the graphics card" },
    { id: "result", startSecond: 8.6, endSecond: 10.4, caption: resultCaption(record) },
    { id: "instruction", startSecond: 10.4, endSecond: DURATION_SECONDS, caption: INSTRUCTION },
  ] as const;
}

/** What the result beat may say. */
export function resultCaption(record: PcRecord | null): string {
  if (!record) return "Result on screen: filmed on the real PC";
  return `On this PC: ${record.graphicsCardPort.monitorShowed}`;
}

/** Claims this Short must never make, in any copy. */
export const FORBIDDEN_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string; readonly unlessObserved?: true }[] = [
  { pattern: /\bno signal\b/i, why: "A motherboard port can show a picture; NO SIGNAL is only said when this PC showed it, and never as universal.", unlessObserved: true },
  { pattern: /\b\d+\s*(%|percent|fps|frames)\b/i, why: "No FPS or percentage figure without a same-game, same-settings measurement on this PC." },
  { pattern: /\b(more|extra|higher|boost\w*|gain\w*|double\w*|lose|losing|lost)\b[^.?!]*\b(fps|frames|performance)\b/i, why: "No performance gain or loss is claimed without measurement." },
  { pattern: /\b(fps|performance)\b[^.?!]*\b(boost\w*|gain\w*|jump\w*|drop\w*|tank\w*|loss)\b/i, why: "No performance gain or loss is claimed without measurement." },
  { pattern: /\bbottleneck\w*\b/i, why: "No bottleneck claim." },
  { pattern: /\b(gpu|graphics card|card)\b[^.?!]*\b(wasted|unused|idle|sitting there|doing nothing)\b/i, why: "Windows can render on the graphics card while a motherboard port drives the display." },
  { pattern: /\b(wasting|wasted|not using|isn't using|doesn't use|won't use|unused)\b[^.?!]*\b(gpu|graphics card|card)\b/i, why: "Windows can render on the graphics card while a motherboard port drives the display." },
  { pattern: /\b(always|never|every|guarantee\w*)\b/i, why: "Outcomes vary by CPU, motherboard, firmware and Windows settings." },
  { pattern: /\bspecsmith\b[^.?!]*\b(detect|detects|scan|scans|checks?|reads?)\b/i, why: "SpecSmith does not inspect a PC's connections." },
];

/** Problems with any copy, given what was observed on the PC. */
export function copyProblems(texts: readonly string[], record: PcRecord | null = PC_RECORD): string[] {
  const observed = [record?.motherboardPort.monitorShowed, record?.graphicsCardPort.monitorShowed].filter(Boolean).join(" ");
  const problems: string[] = [];
  for (const text of texts) {
    for (const { pattern, why, unlessObserved } of FORBIDDEN_CLAIMS) {
      if (!pattern.test(text)) continue;
      if (unlessObserved && pattern.test(observed) && /\bon this pc\b/i.test(text)) continue;
      problems.push(`"${text}": ${why}`);
    }
  }
  return problems;
}

/**
 * The narration proposed for review. Not voiced. The result line is added
 * only once PC_RECORD says what the screen showed. At the saved GPU take's
 * pace (about 13.5 characters a second) the four lines run about 12.6 s; a
 * result line would need the edit to grow toward 15 s.
 */
export function proposedNarration(record: PcRecord | null = PC_RECORD): string {
  const lines = [
    "You bought a graphics card. Is your monitor plugged into it?",
    "These are motherboard ports. Move it to the graphics card.",
    ...(record ? [`On this PC, that gives ${record.graphicsCardPort.monitorShowed}.`] : []),
    "If you have a dedicated GPU, check its display ports.",
  ];
  return lines.join(" ");
}

/** Every string this Short shows or says. */
export function allCopy(record: PcRecord | null = PC_RECORD): string[] {
  return [...beats(record).map((beat) => beat.caption), LABELS.motherboard, LABELS.graphicsCard, SITE_LINE, proposedNarration(record)];
}

/** What stands between the illustrative draft and a real cut. */
export function finalCutProblems(record: PcRecord | null = PC_RECORD): string[] {
  if (!record) return ["No PC record: CPU, motherboard, GPU, integrated graphics and both observed connections are unverified."];
  const problems: string[] = [];
  for (const [name, value] of Object.entries({ cpu: record.cpu, motherboard: record.motherboard, gpu: record.gpu })) if (!value.trim()) problems.push(`${name} is blank.`);
  for (const [name, connection] of [["motherboard port", record.motherboardPort], ["graphics card port", record.graphicsCardPort]] as const) {
    if (!connection.monitorShowed.trim()) problems.push(`What the monitor showed on the ${name} is not recorded.`);
    if (!connection.footage) problems.push(`No footage of the ${name} result.`);
  }
  if (!record.cpuHasIntegratedGraphics && !/no signal|nothing|black|blank/i.test(record.motherboardPort.monitorShowed)) {
    problems.push("The CPU has no integrated graphics, yet the motherboard port is recorded as showing a picture; recheck before filming.");
  }
  return problems;
}

/** Problems with the story as configured; empty when the draft may be rendered. */
export function storyProblems(record: PcRecord | null = PC_RECORD): string[] {
  const problems = copyProblems(allCopy(record), record);
  const list = beats(record);
  if (list[0].startSecond !== 0 || list[0].caption !== HOOK) problems.push("The hook must be on screen from frame 0.");
  for (let index = 1; index < list.length; index += 1) if (list[index].startSecond !== list[index - 1].endSecond) problems.push(`Gap before "${list[index].id}".`);
  if (list.at(-1)!.caption !== INSTRUCTION || list.at(-1)!.endSecond !== DURATION_SECONDS) problems.push("The Short must end on the instruction.");
  if (DURATION_SECONDS < 12 || DURATION_SECONDS > 15) problems.push(`Duration ${DURATION_SECONDS}s is outside 12–15 s.`);
  return problems;
}
