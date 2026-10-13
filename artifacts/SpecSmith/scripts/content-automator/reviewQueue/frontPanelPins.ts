// "Power button does nothing? Check the front-panel pins." A 12.6 s Short as DATA,
// rendered by animationScenes/renderCut.ts from the shared scene library.
//
//   PROBLEM    a finger presses the PC's button; nothing lights.
//   UNPLUG     the power cord leaves the power supply.
//   LOCATION   a front-panel header from above, an EXAMPLE layout (labelled so):
//              the button's two-pin plug sits on the RESET SW pair; PWR SW glows.
//   ACTION     a cross on the wrong pair; the plug moves to PWR SW and is pressed fully on.
//   POWER BACK the cord goes back in; the unlit PC's button pulses amber. No start is shown.
//
// Not claimed: where PWR SW is on any board (layouts differ; the manual decides),
// that this fixes a PC, or what happens when the button is pressed afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { CHECKED, CORSAIR_WONT_TURN_ON, CRUCIAL_UNPLUG } from "./sources.ts";

export const FRONT_PANEL_PINS_CUT: CutSpec = {
  id: "front-panel-pins",
  durationSeconds: 12.6,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.6, text: "Power button does nothing?" },
    { from: 1.6, to: 3.4, text: "Unplug it before opening the case." },
    { from: 3.4, to: 5.4, text: "Find the front-panel pins in your manual." },
    { from: 5.4, to: 7.2, text: "If the button's plug is on the wrong pins," },
    { from: 7.2, to: 9.0, text: "move it to PWR SW and push it fully on." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then try the button again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "A finger presses the stylized PC's power button and rests there; nothing lights and the monitor stays dark." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "A front-panel header from above, labelled EXAMPLE LAYOUT: PWR LED, PWR SW, HDD LED, RESET SW pairs; the POWER SW plug sits on RESET SW; the PWR SW pair glows amber." },
    { storyBeat: "wrong-pins", purpose: "reversal", visualDirection: "The camera closes in; a red cross beside the plug on RESET SW; the plug lifts and moves to the PWR SW pair." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "The plug is pressed fully onto the PWR SW pins; outlined green." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "At the back, the power cord goes back into the power supply." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its button pulsing amber. No one presses it; no start is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { press: 0.3, holdUntil: 1.45 } },
    { scene: "psuRear", from: 1.6, to: 3.6, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.2, 2.55] } },
    { scene: "frontPanelHeader", from: 3.4, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { startOn: "reset", highlightFrom: 4.3, wrongAt: 5.5, move: [6.2, 6.9], press: [7.3, 7.6], seatedFrom: 7.6, zoom: { from: [600, 925, 1.3], to: [640, 925, 1.6], during: [5.4, 5.9] } } },
    { scene: "psuRear", from: 9.0, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.3, 9.65] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "BUTTON DOES NOTHING?", from: 0, to: 1.6, colour: "red", at: "head", size: 60 },
    { text: "UNPLUG FIRST", from: 1.6, to: 3.4, colour: "amber", at: "head" },
    { text: "CHECK YOUR MANUAL", from: 3.5, to: 5.4, colour: "purple", at: "head" },
    { text: "EXAMPLE LAYOUT", from: 3.5, to: 9.0, colour: "amber", at: "foot" },
    { text: "WRONG PINS", from: 5.5, to: 7.2, colour: "red", at: "head" },
    { text: "FULLY ON PWR SW", from: 7.3, to: 9.0, colour: "green", at: "head" },
    { text: "POWER CORD BACK IN", from: 9.1, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "button", at: 0.3, seconds: 0.05, reason: "the power button is pressed (nothing happens on screen)" },
    { kind: "plug", at: 2.24, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 7.45, seconds: 0.04, peakDbfs: -12, reason: "the plug lands fully on the PWR SW pins (stylized)" },
    { kind: "plug", at: 9.59, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "tap",
  sources: [
    CRUCIAL_UNPLUG,
    { ...CORSAIR_WONT_TURN_ON, quote: "In some cases, the Power Switch is plugged into the wrong front I/O terminal on the motherboard, preventing the PC from powering on.", supports: "A case power-switch plug on the wrong front-panel pins can stop the PC powering on." },
    { ...CORSAIR_WONT_TURN_ON, quote: "Search-excerpt summary: check the motherboard manual for the front I/O connectors; the power switch terminals are often labeled \"PWR SW\" or \"PWR\"; on pins such as \"RESET SW\" or \"PWR LED\" the PC will not power on.", supports: "The manual shows the layout; the button's plug belongs on the PWR SW pins, not RESET SW or an LED pair." },
  ],
  sourcesChecked: CHECKED,
};
