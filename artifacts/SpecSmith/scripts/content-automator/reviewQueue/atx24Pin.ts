// "New build won't turn on? Check the 24-pin cable." A 12.6 s Short as DATA.
//
//   PROBLEM    a finger presses the PC's button; nothing happens.
//   UNPLUG     the power cord leaves the power supply.
//   LOCATION   panel off; the camera closes on the 24-pin socket in an example
//              layout, labelled POSITION VARIES.
//   ACTION     side view: the 24-pin plug lowered, pressed home, its latch over the tab.
//   POWER BACK panel back on; the cord back in; the button pulses amber. No start is shown.
//
// Not claimed: where the socket is on any board, that this fixes a PC, or what
// happens afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { ASUS_NO_POWER, CHECKED, CORSAIR_CLICK_IN, CORSAIR_WONT_TURN_ON, CRUCIAL_UNPLUG } from "./sources.ts";

export const ATX_24PIN_CUT: CutSpec = {
  id: "atx-24pin",
  durationSeconds: 12.6,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.6, text: "New build won't turn on?" },
    { from: 1.6, to: 3.4, text: "Unplug it before opening the case." },
    { from: 3.4, to: 5.2, text: "Find the 24-pin power socket." },
    { from: 5.2, to: 7.1, text: "Push the 24-pin cable all the way in," },
    { from: 7.1, to: 9.0, text: "until its latch catches." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then try booting again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "A finger presses the stylized PC's power button and rests there; the monitor stays dark." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "The side panel slides off; the camera closes on a 24-pin socket at the board's edge in an example layout, outlined amber, marked POSITION VARIES." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Side view: the plug marked 24-PIN lowers onto the socket and thumbs press it home." },
    { storyBeat: "latch", purpose: "payoff", visualDirection: "The latch hooks over the socket's tab; the plug is outlined green." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "The camera pulls back from the filled socket; the panel slides back on; at the back, the cord goes back in." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { press: 0.3, holdUntil: 1.45 } },
    { scene: "psuRear", from: 1.6, to: 3.6, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.2, 2.55] } },
    { scene: "caseOpen", from: 3.4, to: 5.4, fadeIn: 0.2, fadeOut: 0.2, params: { panelOff: [3.55, 3.9], zoom: { from: [540, 700, 0.9], to: [834, 350, 2.2], during: [3.9, 4.5] }, show24: true, highlight: "atx24", highlightFrom: 4.4 } },
    { scene: "connectorInsert", from: 5.2, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { lower: [5.45, 5.95], thumbsIn: [6.0, 6.2], press: [6.2, 6.5], latch: [6.4, 6.55], thumbsOut: [7.3, 7.5], seatedFrom: 6.6, stamp: "24-PIN" } },
    { scene: "caseOpen", from: 9.0, to: 9.65, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [834, 350, 2.2], to: [540, 700, 0.9], during: [9.0, 9.25] }, panelOn: [9.2, 9.45], show24: true, atx24FilledFrom: 0, highlight: "atx24", highlightFrom: 99, seatedFrom: 9.0 } },
    { scene: "psuRear", from: 9.45, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.75, 10.1] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "NEW BUILD WON'T TURN ON?", from: 0, to: 1.6, colour: "red", at: "head", size: 60 },
    { text: "UNPLUG FIRST", from: 1.6, to: 3.4, colour: "amber", at: "head" },
    { text: "24-PIN POWER SOCKET", from: 4.2, to: 5.2, colour: "purple", at: "head" },
    { text: "POSITION VARIES", from: 4.35, to: 5.2, colour: "amber", at: "foot" },
    { text: "PUSH IT ALL THE WAY IN", from: 5.3, to: 7.1, colour: "cyan", at: "head" },
    { text: "FULLY IN", from: 7.1, to: 9.0, colour: "green", at: "head", size: 72 },
    { text: "POWER CORD BACK IN", from: 9.45, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "button", at: 0.3, seconds: 0.05, reason: "the power button is pressed (nothing happens on screen)" },
    { kind: "plug", at: 2.24, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 5.95, seconds: 0.04, reason: "the plug lands on the socket" },
    { kind: "snap", at: 6.53, seconds: 0.06, reason: "the plug's latch hooks over the socket's tab (stylized)" },
    { kind: "plug", at: 10.04, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "snap",
  sources: [
    CRUCIAL_UNPLUG,
    { ...ASUS_NO_POWER, quote: "Some motherboard may contain 8-pin EATX12V_1, 4-pin EATX12V_2 and 24-pin EATXPWR, we suggest to connect all three connectors to the power supply.", supports: "The 24-pin main power connector is part of the maker's own no-power checklist." },
    { ...CORSAIR_WONT_TURN_ON, quote: "Search-excerpt summary: start with the motherboard's 24-pin connector, making sure it is firmly seated and that its latch is fully engaged.", supports: "Push the 24-pin plug fully in until its latch catches." },
    CORSAIR_CLICK_IN,
  ],
  sourcesChecked: CHECKED,
};
