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
// ever proposed; the rest wait here until someone builds their animation. A topic
// marked `automatic: false` is proposed only on an operator's --topic choice: the
// automatic review queue holds only data-only specs on the shared scene library.
//
// `editorialPrior` is an editorial judgement of how often beginners hit the
// symptom. It is NOT data, and the proposal record says so wherever it is used.

import type { CutSpec } from "../animationScenes/spec.ts";
import { CPU_POWER_CUT } from "../nextVideoCpuPower/cut.ts";
import { ATX_24PIN_CUT } from "../reviewQueue/atx24Pin.ts";
import { CPU_FAN_HEADER_CUT } from "../reviewQueue/cpuFanHeader.ts";
import { FRONT_PANEL_PINS_CUT } from "../reviewQueue/frontPanelPins.ts";
import { GPU_POWER_CABLE_CUT } from "../reviewQueue/gpuPowerCable.ts";
import { MONITOR_INPUT_SOURCE_CUT } from "../reviewQueue/monitorInputSource.ts";
import { RAM_SLOTS_CUT } from "../reviewQueue/ramSlots.ts";
import { TEMPLATES } from "./animations.ts";

export type Family = "wont-turn-on" | "on-no-picture" | "compatibility" | "boot-message" | "setup";

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
  /** false: never chosen automatically (an operator's --topic only). Default: in the automatic queue. */
  readonly automatic?: false;
}

const CRUCIAL = "Crucial, How to Install Memory in Your Desktop (crucial.com/support/install-memory-desktop), checked 2026-10-11; the factual-takeaway gate re-checks it.";
const RAM_CUT = TEMPLATES["ram-seat"];
const CPU_CUT = TEMPLATES["cpu-power"];
const sourceOf = (url: string) => { const src = CPU_POWER_CUT.sources.find((s) => s.url === url)!; return `${src.publisher}, "${src.title}" (${src.url}): "${src.quote}" Checked ${CPU_POWER_CUT.sourcesChecked.on} via search excerpts; the factual-takeaway gate re-reads it.`; };

/** A claim's basis: the spec's own source, quoted as the search excerpt gave it. */
const basis = (spec: CutSpec, url: string, index = 0) => {
  const src = spec.sources.filter((s) => s.url === url)[index];
  if (!src) throw new Error(`${spec.id} has no source ${url}`);
  return `${src.publisher}, "${src.title}" (${src.url}): "${src.quote}" Checked ${spec.sourcesChecked.on} via search excerpts; the factual-takeaway gate re-reads it.`;
};
/** A spec-driven topic's hook and beats are the cut's own (frame one, captions, labels at their exact timing). */
const fromCut = (spec: CutSpec) => {
  const t = TEMPLATES[spec.id];
  return { hook: t.beats[0].onScreenText, beats: t.beats.map((b) => ({ seconds: Math.round((b.to - b.from) * 100) / 100, onScreenText: b.onScreenText, narration: b.caption, visualDirection: b.visualDirection })), animation: spec.id };
};
const UNPLUG = (spec: CutSpec) => ({ id: `${spec.id}-unplug`, proposition: "unplug the power cable before working inside the PC", basis: basis(spec, "https://www.crucial.com/support/install-memory-desktop") });
const NO_BOOT_SHOWN = (id: string) => ({ id: `${id}-boot-shown`, proposition: "successfully boots straight into Windows afterwards", why: "The cut ends before anyone presses the button; no boot is shown or promised." });
const NOT_GUARANTEED = (id: string) => ({ id: `${id}-fixes-all`, proposition: "guaranteed cure for boot failures", why: "It may not work; one check, never a guaranteed fix." });

export const TOPICS: readonly Topic[] = [
  {
    // Rendered by the ram-seat template: beats, captions and labels are the cut's own. A hand-built cut from
    // before the scene library: proposed only on an operator's --topic choice, not by the automatic queue.
    id: "ram-not-seated",
    automatic: false,
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
    // Filed as "won't turn on" (owner's decision, 2026-10-12): the cut opens on a dead button.
    family: "wont-turn-on",
    title: "New Build Won't Turn On? Check the CPU Power Cable",
    symptom: "Pressing the power button on a newly built PC does nothing.",
    hook: CPU_CUT.beats[0].onScreenText,
    beats: CPU_CUT.beats.map((b) => ({ seconds: Math.round((b.to - b.from) * 100) / 100, onScreenText: b.onScreenText, narration: b.caption, visualDirection: b.visualDirection })),
    finalCta: "Then try booting again.",
    // "8-pin" alone also names GPU/PCIe connectors, so it counts only beside "CPU"; EPS is CPU-specific.
    coveredBy: [/\bcpu power\b/i, /\beps(12v)?\b/i, /\bcpu\b.*\b(8-pin|4\+4)/i, /\b(8-pin|4\+4).*\bcpu\b/i],
    claims: [
      { id: "cpu-unplug", proposition: "unplug the power cable before working inside the PC", basis: sourceOf("https://www.crucial.com/support/install-memory-desktop") },
      { id: "cpu-cable-needed", proposition: "a missing CPU power cable can leave a new PC with no power or no boot", basis: `${sourceOf("https://www.asus.com/us/support/faq/1042632/")} Also: ${sourceOf("https://www.hometheaterforum.com/community/threads/mobo-wont-power-8-pin-cpu-atx-12v.253413/")}` },
      { id: "cpu-manual-location", proposition: "the motherboard manual shows the CPU power connector", basis: `${sourceOf("https://www.hometheaterforum.com/community/threads/mobo-wont-power-8-pin-cpu-atx-12v.253413/")} (the manual documents the EATX12V plug; positions vary by board, so the cut sends viewers to their own manual)` },
      { id: "cpu-not-pcie", proposition: "the cable marked CPU goes to the motherboard's CPU power connector, not a PCIe cable, and the wrong cable can damage components", basis: sourceOf("https://www.corsair.com/us/en/explorer/diy-builder/power-supply-units/can-i-use-a-pci-e-cable-in-the-8-pin-motherboard-plug/") },
      { id: "cpu-own-psu-cable", proposition: "use the CPU cable supplied with that power supply, since modular cables can differ between models", basis: sourceOf("https://knowledge.seasonic.com/article/68-cable-compatibility") },
      { id: "cpu-fully-in", proposition: "push the connector until it is fully in place", basis: sourceOf("https://help.corsair.com/hc/en-us/articles/10700487373197-PSU-How-to-Avoid-Current-Overload-Connector-Issues") },
    ],
    riskyClaims: [
      { id: "cpu-fixes-all", proposition: "guaranteed cure for boot failures", why: "It may not work; one check, never a guaranteed fix." },
      { id: "cpu-sole-cause", proposition: "always the sole culprit behind boot failures", why: "A PC can fail to boot for many reasons; this is one check." },
      { id: "cpu-header-universal", proposition: "identical header placement on all motherboards", why: "Positions vary; the layout is labelled POSITION VARIES and the manual decides." },
      { id: "cpu-cable-swap", proposition: "any modular lead swaps freely between different PSU brands", why: "Modular cables can differ between brands, series and models; use the power supply's own cable." },
      { id: "cpu-boot-shown", proposition: "successfully boots straight into Windows afterwards", why: "The cut ends before anyone presses the button; no boot is shown or promised." },
    ],
    editorialPrior: 0.8,
    animation: "cpu-power",
  },
  {
    id: "front-panel-power-pins",
    family: "wont-turn-on",
    title: "Power Button Does Nothing? Check the Front-Panel Pins",
    symptom: "Pressing the case power button does nothing at all.",
    ...fromCut(FRONT_PANEL_PINS_CUT),
    finalCta: "Then try the button again.",
    coveredBy: [/\bfront[- ]panel\b/i, /\bpwr[ _]?sw\b/i, /\bpower switch (pins|header)\b/i],
    claims: [
      UNPLUG(FRONT_PANEL_PINS_CUT),
      { id: "fp-wrong-pins", proposition: "a case power-switch plug on the wrong front-panel pins can stop the PC powering on", basis: basis(FRONT_PANEL_PINS_CUT, FRONT_PANEL_PINS_CUT.sources[1].url, 0) },
      { id: "fp-pwr-sw", proposition: "the motherboard manual shows the front-panel layout, and the button's plug belongs on the PWR SW pins", basis: basis(FRONT_PANEL_PINS_CUT, FRONT_PANEL_PINS_CUT.sources[1].url, 1) },
    ],
    riskyClaims: [
      NOT_GUARANTEED("fp"),
      { id: "fp-same-layout", proposition: "identical pin order across all motherboards", why: "Layouts differ; the cut labels its header EXAMPLE LAYOUT and sends viewers to their manual." },
      NO_BOOT_SHOWN("fp"),
    ],
    editorialPrior: 0.7,
  },
  {
    id: "atx-24pin-cable",
    family: "wont-turn-on",
    title: "New Build Won't Turn On? Check the 24-Pin Cable",
    symptom: "Pressing the power button on a newly built PC does nothing.",
    ...fromCut(ATX_24PIN_CUT),
    finalCta: "Then try booting again.",
    coveredBy: [/\b24[- ]?pin\b/i, /\bmain power (cable|connector)\b/i, /\beatxpwr\b/i],
    claims: [
      UNPLUG(ATX_24PIN_CUT),
      { id: "atx-needed", proposition: "the 24-pin main power connector is on the motherboard maker's no-power checklist", basis: basis(ATX_24PIN_CUT, ATX_24PIN_CUT.sources[1].url) },
      { id: "atx-latch", proposition: "push the 24-pin plug fully in until its latch catches", basis: `${basis(ATX_24PIN_CUT, ATX_24PIN_CUT.sources[2].url)} Also: ${basis(ATX_24PIN_CUT, ATX_24PIN_CUT.sources[3].url)}` },
    ],
    riskyClaims: [
      NOT_GUARANTEED("atx"),
      { id: "atx-header-universal", proposition: "identical socket placement on all motherboards", why: "Positions vary; the layout is labelled POSITION VARIES." },
      NO_BOOT_SHOWN("atx"),
    ],
    editorialPrior: 0.65,
  },
  {
    id: "gpu-power-cable",
    family: "on-no-picture",
    title: "PC On, But No Picture? Check the Graphics Card's Power Cable",
    symptom: "The PC turns on (fans spin) but the monitor shows nothing.",
    ...fromCut(GPU_POWER_CABLE_CUT),
    finalCta: "Then try booting again.",
    coveredBy: [/\b(gpu|graphics card)\b.*\bpower (cable|connector|socket)/i, /\bpcie power\b/i],
    claims: [
      UNPLUG(GPU_POWER_CABLE_CUT),
      { id: "gpu-own-cables", proposition: "a graphics card's power comes from its own cables from the power supply", basis: basis(GPU_POWER_CABLE_CUT, GPU_POWER_CABLE_CUT.sources[1].url) },
      { id: "gpu-connectors", proposition: "check the card's power connectors are properly connected, all of them where a card has several", basis: `${basis(GPU_POWER_CABLE_CUT, GPU_POWER_CABLE_CUT.sources[2].url)} Also: ${basis(GPU_POWER_CABLE_CUT, GPU_POWER_CABLE_CUT.sources[3].url)}` },
      { id: "gpu-no-picture", proposition: "a PC that is on with no picture can come down to the graphics card's power cables", basis: basis(GPU_POWER_CABLE_CUT, GPU_POWER_CABLE_CUT.sources[4].url) },
      { id: "gpu-psu-own", proposition: "use the power supply's own cable", basis: basis(GPU_POWER_CABLE_CUT, "https://knowledge.seasonic.com/article/68-cable-compatibility") },
    ],
    riskyClaims: [
      NOT_GUARANTEED("gpu"),
      { id: "gpu-connector-type", proposition: "one universal connector type fits all graphics cards", why: "Cards use different connectors (6+2-pin, 12V-2x6 and others); the cut says CHECK YOUR CARD'S MANUAL." },
      { id: "gpu-cable-swap", proposition: "any modular lead swaps freely between different PSU brands", why: "Modular cables can differ between brands, series and models." },
      NO_BOOT_SHOWN("gpu"),
    ],
    editorialPrior: 0.75,
  },
  {
    id: "monitor-input-source",
    family: "on-no-picture",
    title: "PC On, Monitor Blank? Check the Input Setting",
    symptom: "The PC is on and the monitor is on, but the monitor shows nothing from the PC.",
    ...fromCut(MONITOR_INPUT_SOURCE_CUT),
    finalCta: "Then check the screen again.",
    coveredBy: [/\binput (source|setting|menu)\b/i],
    claims: [
      { id: "input-match", proposition: "the monitor's input setting has to match the port the cable is in", basis: basis(MONITOR_INPUT_SOURCE_CUT, MONITOR_INPUT_SOURCE_CUT.sources[0].url) },
      { id: "input-menu", proposition: "pick the matching input (or auto-detect) in the monitor's own menu", basis: basis(MONITOR_INPUT_SOURCE_CUT, MONITOR_INPUT_SOURCE_CUT.sources[1].url) },
    ],
    riskyClaims: [
      { id: "input-fixes-all", proposition: "guaranteed cure for blank screens", why: "It may not work; one check, never a guaranteed fix." },
      { id: "input-picture-shown", proposition: "picture instantly appears afterwards", why: "The cut ends on a dark screen; no picture is shown or promised." },
    ],
    editorialPrior: 0.6,
  },
  {
    id: "cpu-fan-header",
    family: "boot-message",
    title: "\"CPU Fan Error\" at Startup? Check the CPU_FAN Header",
    symptom: "The PC shows a CPU fan error message when it starts.",
    ...fromCut(CPU_FAN_HEADER_CUT),
    finalCta: "Then start the PC and check again.",
    coveredBy: [/\bcpu[ _]fan\b/i, /\bfan error\b/i],
    claims: [
      UNPLUG(CPU_FAN_HEADER_CUT),
      { id: "fan-header", proposition: "the cooler's fan belongs on the CPU_FAN header, not CHA_FAN; the message means the fan is not detected", basis: basis(CPU_FAN_HEADER_CUT, CPU_FAN_HEADER_CUT.sources[1].url) },
      { id: "fan-detect", proposition: "check the CPU_FAN connection when the fan is not detected", basis: basis(CPU_FAN_HEADER_CUT, CPU_FAN_HEADER_CUT.sources[2].url) },
      { id: "fan-aio", proposition: "liquid coolers can be wired to other headers; their manual decides", basis: basis(CPU_FAN_HEADER_CUT, CPU_FAN_HEADER_CUT.sources[3].url) },
    ],
    riskyClaims: [
      NOT_GUARANTEED("fan"),
      { id: "fan-ignore-setting", proposition: "disable the warning in BIOS settings instead", why: "The cut does not advise switching the warning off." },
      { id: "fan-message-gone", proposition: "message disappears on the next start", why: "The cut ends before anyone starts the PC; no result is shown." },
    ],
    editorialPrior: 0.55,
  },
  {
    id: "ram-two-stick-slots",
    family: "setup",
    title: "Using Two RAM Sticks? Check Which Slots",
    symptom: "Two memory modules are installed side by side instead of in the slots the manual recommends.",
    ...fromCut(RAM_SLOTS_CUT),
    finalCta: "Then try booting again.",
    coveredBy: [/\b(a2|b2)\b.*\b(a2|b2)\b/i, /\bdual[- ]channel\b/i, /\bwhich (ram|memory) slots?\b/i],
    claims: [
      UNPLUG(RAM_SLOTS_CUT),
      { id: "slots-manual", proposition: "the manual lists which slots to use for two modules; on many ASUS boards, A2 and B2", basis: `${basis(RAM_SLOTS_CUT, RAM_SLOTS_CUT.sources[1].url)} Also: ${basis(RAM_SLOTS_CUT, RAM_SLOTS_CUT.sources[2].url)}` },
      { id: "slots-vary", proposition: "not every board uses A2 and B2; the board's own manual decides", basis: basis(RAM_SLOTS_CUT, RAM_SLOTS_CUT.sources[3].url) },
    ],
    riskyClaims: [
      { id: "slots-speed", proposition: "doubles memory speed and frame rates", why: "No speed or performance claim is made or measured." },
      { id: "slots-universal", proposition: "identical slot pairs on all motherboards", why: "Slot pairs vary by board; the cut says ON MANY BOARDS and labels its layout EXAMPLE." },
      NO_BOOT_SHOWN("slots"),
    ],
    editorialPrior: 0.5,
  },
];
