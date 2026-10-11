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
// Only a topic with an `animation` (a template registered in animations.ts) is
// ever proposed; the rest wait here until someone builds their animation.
//
// `editorialPrior` is an editorial judgement of how often beginners hit the
// symptom. It is NOT data, and the proposal record says so wherever it is used.

import { CPU_POWER_CUT } from "../nextVideoCpuPower/cut.ts";
import { TEMPLATES } from "./animations.ts";

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
  /** The registered animation template that renders this Short (animations.ts). Without one, the topic is never proposed. */
  readonly animation?: string;
}

const CRUCIAL = "Crucial, How to Install Memory in Your Desktop (crucial.com/support/install-memory-desktop), checked 2026-10-11; the factual-takeaway gate re-checks it.";
const RAM_CUT = TEMPLATES["ram-seat"];
const CPU_CUT = TEMPLATES["cpu-power"];
const sourceOf = (url: string) => { const src = CPU_POWER_CUT.sources.find((s) => s.url === url)!; return `${src.publisher}, "${src.title}" (${src.url}): "${src.quote}" Checked ${CPU_POWER_CUT.sourcesChecked.on} via search excerpts; the factual-takeaway gate re-reads it.`; };

const MANUAL = "Editorial knowledge of standard desktop assembly; to be checked against a motherboard or case manual (fact-check gate).";

export const TOPICS: readonly Topic[] = [
  {
    // Rendered by the ram-seat template: beats, captions and labels are the cut's own.
    id: "ram-not-seated",
    family: "on-no-picture",
    title: "Added RAM, Now It Won't Boot? Check It's Fully Seated",
    symptom: "After adding or moving memory, the PC powers on but does not boot to a picture.",
    hook: RAM_CUT.beats[0].onScreenText,
    beats: RAM_CUT.beats.map((b) => ({ seconds: Math.round((b.to - b.from) * 100) / 100, onScreenText: b.onScreenText, narration: b.caption, visualDirection: b.visualDirection })),
    finalCta: "Then try booting again.",
    coveredBy: [/\bram\b.*\b(seat|clip|click|slot)/i, /\b(seat|reseat)\w*\b.*\bram\b/i, /\b(added|new)\b.*\bram\b.*\bboot/i],
    claims: [
      { id: "ram-power-off", proposition: "shut the system down and unplug the power cable before installing memory", basis: CRUCIAL },
      { id: "ram-notch", proposition: "line up the notch on the module with the ridge in the slot", basis: CRUCIAL },
      { id: "ram-clips", proposition: "press with firm, even pressure until the clips on the side of the slot snap into place", basis: CRUCIAL },
      { id: "ram-reseat", proposition: "if the system beeps or shows errors after installing memory, remove and reinstall the modules", basis: CRUCIAL },
    ],
    riskyClaims: [
      { id: "ram-always-cause", proposition: "always the sole culprit behind boot failures", why: "A PC can fail to boot for many reasons; seating is one check." },
      { id: "ram-fixes-all", proposition: "guaranteed cure for boot failures", why: "It may not work; the Short offers a check, never a guaranteed fix." },
      { id: "ram-boot-shown", proposition: "successfully boots straight into Windows afterwards", why: "The cut ends before anyone presses the button; no boot is shown or promised." },
    ],
    editorialPrior: 0.9,
    animation: "ram-seat",
  },
  {
    // Rendered from nextVideoCpuPower/cut.ts by the shared scene library: beats, captions and labels are the cut's own.
    id: "cpu-power-cable",
    family: "on-no-picture",
    title: "New Build Won't Boot? Check the CPU Power Cable",
    symptom: "A newly built PC does not boot.",
    hook: CPU_CUT.beats[0].onScreenText,
    beats: CPU_CUT.beats.map((b) => ({ seconds: Math.round((b.to - b.from) * 100) / 100, onScreenText: b.onScreenText, narration: b.caption, visualDirection: b.visualDirection })),
    finalCta: "Then try booting again.",
    coveredBy: [/\bcpu power\b/i, /\b(eps|eps12v|8-pin|4\+4)\b/i],
    claims: [
      { id: "cpu-unplug", proposition: "unplug the power cable before working inside the PC", basis: sourceOf("https://www.crucial.com/support/install-memory-desktop") },
      { id: "cpu-cable-needed", proposition: "a missing CPU power cable can stop a PC from booting", basis: `${sourceOf("https://www.asus.com/us/support/faq/1042632/")} Also: ${sourceOf("https://www.hometheaterforum.com/community/threads/mobo-wont-power-8-pin-cpu-atx-12v.253413/")}` },
      { id: "cpu-socket-near", proposition: "the CPU power socket on the motherboard is next to the CPU", basis: sourceOf("https://www.corsair.com/us/en/explorer/diy-builder/power-supply-units/do-i-need-to-plug-in-both-cpu-power-cables/") },
      { id: "cpu-not-pcie", proposition: "a PCIe cable is not the CPU power cable and does not belong in that socket", basis: sourceOf("https://www.corsair.com/ca/en/explorer/diy-builder/power-supply-units/can-i-use-a-pci-e-cable-in-the-8-pin-motherboard-plug/") },
    ],
    riskyClaims: [
      { id: "cpu-fixes-all", proposition: "guaranteed cure for boot failures", why: "It may not work; one check, never a guaranteed fix." },
      { id: "cpu-sole-cause", proposition: "always the sole culprit behind boot failures", why: "A PC can fail to boot for many reasons; this is one check." },
      { id: "cpu-header-universal", proposition: "identical header placement on all motherboards", why: "Positions vary; the layout is labelled as an example and the manual decides." },
      { id: "cpu-boot-shown", proposition: "successfully boots straight into Windows afterwards", why: "The cut ends before anyone presses the button; no boot is shown or promised." },
    ],
    editorialPrior: 0.8,
    animation: "cpu-power",
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
