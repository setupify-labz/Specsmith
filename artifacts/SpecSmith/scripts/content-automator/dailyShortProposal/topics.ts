// The beginner PC troubleshooting checks the daily job can propose.
//
// Each topic is ONE check for ONE symptom, written to be accurate without
// promising a fix: its claims are hedged ("can"), its risky claims are listed
// so the strict research gate blocks them (phrased in words only the risky
// claim would use: the gate matches on any two distinctive words, so a risky
// claim that reused the topic's own nouns would block innocent lines), and every factual claim is marked
// as editorial knowledge that a person must check against a manual before the
// Short goes further (the fact-check human gate never closes on its own).
//
// `editorialPrior` is an editorial judgement of how often beginners hit the
// symptom. It is NOT data, and the proposal record says so wherever it is used.

export type Family = "wont-turn-on" | "on-no-picture" | "compatibility";

export interface TopicBeat {
  readonly seconds: number;
  readonly onScreenText: string;
  readonly narration: string;
  readonly visualDirection: string;
}

export interface Topic {
  readonly id: string;
  readonly family: Family;
  readonly title: string;
  readonly symptom: string;
  /** Frame one: what is on screen before anyone has heard a word. */
  readonly hook: string;
  readonly beats: readonly TopicBeat[];
  readonly finalCta: string;
  /** Words that mean an existing video already covers this check. */
  readonly coveredBy: readonly RegExp[];
  readonly claims: readonly { readonly id: string; readonly proposition: string; readonly basis: string }[];
  /** Claims this Short must never make (blocked by the strict research gate). */
  readonly riskyClaims: readonly { readonly id: string; readonly proposition: string; readonly why: string }[];
  readonly editorialPrior: number;
}

const MANUAL = "Editorial knowledge of standard desktop assembly; to be checked against a motherboard or case manual (fact-check gate).";

export const TOPICS: readonly Topic[] = [
  {
    id: "ram-not-seated",
    family: "on-no-picture",
    title: "Fans Spin, No Display? Check Your RAM First",
    symptom: "The PC powers on and the fans spin, but the monitor shows nothing.",
    hook: "FANS SPIN, NO DISPLAY?",
    beats: [
      { seconds: 2.0, onScreenText: "FANS SPIN, NO DISPLAY?", narration: "Fans spin, but no display?", visualDirection: "The stylized PC from the two-checks Short, fans lit, beside a dark monitor. Large label on frame one." },
      { seconds: 3.0, onScreenText: "CHECK THE RAM", narration: "Check your RAM.", visualDirection: "Side panel off; the camera closes on the memory slots. One stick sits slightly raised, its clip open." },
      { seconds: 4.0, onScreenText: "PRESS UNTIL BOTH CLIPS CLOSE", narration: "Press each stick straight down until the clips snap shut.", visualDirection: "Thumbs press the raised stick down; both clips close; a soft click; amber outline on the clips." },
      { seconds: 4.0, onScreenText: "WHICH SLOTS? CHECK THE MANUAL", narration: "Your motherboard manual shows which slots to use first.", visualDirection: "A manual page icon beside the slots; two slots highlighted and labelled 'example only: check your board'." },
    ],
    finalCta: "Save this for your next build.",
    coveredBy: [/\bram\b.*\b(seat|clip|click|slot)/i, /\b(seat|reseat)\w*\b.*\bram\b/i],
    claims: [
      { id: "ram-seating", proposition: "a RAM stick that is not fully seated can stop the PC from showing a picture", basis: MANUAL },
      { id: "ram-clips", proposition: "the slot clips close when the stick is fully inserted", basis: MANUAL },
      { id: "ram-slots", proposition: "the motherboard manual shows which slots to use first", basis: MANUAL },
    ],
    riskyClaims: [
      { id: "ram-always-cause", proposition: "always the sole culprit behind blank screens", why: "No display has many causes; RAM is one check." },
      { id: "ram-fixes-all", proposition: "guaranteed cure for blank screens", why: "It may not work; the Short offers a check, never a guaranteed fix." },
      { id: "ram-slot-universal", proposition: "identical slot order across all boards", why: "Slot order varies by board; the manual decides." },
    ],
    editorialPrior: 0.9,
  },
  {
    id: "cpu-power-cable",
    family: "on-no-picture",
    title: "Fans Spin, No Display? Check the CPU Power Cable",
    symptom: "The PC powers on, but there is no picture and it never reaches the BIOS.",
    hook: "FANS ON, NOTHING ON SCREEN?",
    beats: [
      { seconds: 2.0, onScreenText: "FANS ON, NOTHING ON SCREEN?", narration: "Fans on, but nothing on screen?", visualDirection: "The stylized PC, fans lit, beside a dark monitor." },
      { seconds: 3.5, onScreenText: "CHECK THE CPU POWER CABLE", narration: "Check the CPU power cable.", visualDirection: "Side panel off; close on the top-left corner of the motherboard; an empty 8-pin socket glows amber." },
      { seconds: 4.0, onScreenText: "TOP CORNER, 4+4 OR 8-PIN", narration: "It's a separate plug near the top of the board.", visualDirection: "The 4+4-pin cable from the power supply clicks into the socket." },
      { seconds: 3.5, onScreenText: "YOUR MANUAL SHOWS WHERE", narration: "Your motherboard manual shows exactly where.", visualDirection: "A manual page icon beside the socket, 'example only: check your board'." },
    ],
    finalCta: "Save this for your next build.",
    coveredBy: [/\bcpu power\b/i, /\b(eps|8-pin|4\+4)\b/i],
    claims: [
      { id: "cpu-cable-needed", proposition: "most desktop motherboards need a separate CPU power cable", basis: MANUAL },
      { id: "cpu-cable-place", proposition: "the CPU power socket is usually near the top of the board", basis: MANUAL },
    ],
    riskyClaims: [
      { id: "cpu-fixes-all", proposition: "guaranteed cure for blank screens", why: "It may not work; one check, never a guaranteed fix." },
    ],
    editorialPrior: 0.8,
  },
  {
    id: "monitor-input-source",
    family: "on-no-picture",
    title: "PC On, Monitor Blank? Check the Input Setting",
    symptom: "The PC is on and the monitor is on, but the monitor shows nothing from the PC.",
    hook: "MONITOR ON, BUT BLANK?",
    beats: [
      { seconds: 2.0, onScreenText: "MONITOR ON, BUT BLANK?", narration: "Monitor on, but blank?", visualDirection: "Lit PC beside a monitor with a dark screen." },
      { seconds: 3.5, onScreenText: "CHECK THE INPUT SETTING", narration: "Check the monitor's input setting.", visualDirection: "Close on the monitor's buttons; a stylized menu opens: HDMI 1, HDMI 2, DisplayPort." },
      { seconds: 4.0, onScreenText: "MATCH THE PORT YOU USED", narration: "It has to match the port your cable is in.", visualDirection: "The highlight moves to DisplayPort, matching the cable shown at the back." },
      { seconds: 3.0, onScreenText: "ONE CHECK, THEN THE NEXT", narration: "If that's set, check the cable next.", visualDirection: "The two spots from the two-checks Short, small, as 'next'." },
    ],
    finalCta: "Save this for your next build.",
    coveredBy: [/\binput (source|setting)\b/i],
    claims: [
      { id: "input-setting", proposition: "monitors have an input setting that must match the port in use", basis: MANUAL },
    ],
    riskyClaims: [
      { id: "input-fixes-all", proposition: "guaranteed cure for blank screens", why: "It may not work; one check, never a guaranteed fix." },
    ],
    editorialPrior: 0.8,
  },
  {
    id: "front-panel-power-pins",
    family: "wont-turn-on",
    title: "Power Button Does Nothing? Check the Front-Panel Pins",
    symptom: "Pressing the case power button does nothing at all.",
    hook: "BUTTON DOES NOTHING?",
    beats: [
      { seconds: 2.0, onScreenText: "BUTTON DOES NOTHING?", narration: "Power button does nothing?", visualDirection: "A finger presses the stylized PC's button; nothing lights." },
      { seconds: 3.5, onScreenText: "CHECK THE FRONT-PANEL PINS", narration: "Check the front-panel pins.", visualDirection: "Close on the bottom-right of the motherboard: a small header with two pins glowing amber." },
      { seconds: 4.0, onScreenText: "POWER SW: TWO PINS", narration: "The button's two-pin plug goes on the power switch pins.", visualDirection: "The 'POWER SW' plug slides onto the two pins." },
      { seconds: 3.5, onScreenText: "YOUR MANUAL HAS THE MAP", narration: "Your motherboard manual shows the layout.", visualDirection: "A manual page icon with a pin diagram, 'example only: check your board'." },
    ],
    finalCta: "Save this for your next build.",
    coveredBy: [/\bfront[- ]panel\b/i, /\bpower sw\b/i],
    claims: [
      { id: "fp-two-pins", proposition: "the case power button connects to two pins on the motherboard's front-panel header", basis: MANUAL },
    ],
    riskyClaims: [
      { id: "fp-fixes-all", proposition: "guaranteed cure for dead power buttons", why: "It may not work; one check, never a guaranteed fix." },
    ],
    editorialPrior: 0.7,
  },
];
