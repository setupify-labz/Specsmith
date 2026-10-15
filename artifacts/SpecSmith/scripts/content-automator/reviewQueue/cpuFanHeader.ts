// "'CPU Fan Error' at startup? Check the CPU_FAN header." A 12.6 s Short as DATA.
//
//   PROBLEM    the PC is lit; the monitor shows a stylized "CPU Fan Error!" message.
//   UNPLUG     the power cord leaves the power supply.
//   LOCATION   panel off; the camera shows the CPU_FAN and CHA_FAN headers in an
//              EXAMPLE layout; CPU_FAN glows.
//   ACTION     the cooler's fan plug sits on CHA_FAN (a cross); it moves to CPU_FAN.
//              AIO? CHECK ITS MANUAL: liquid coolers can use other headers.
//   POWER BACK the cord back in; the button pulses amber. No start is shown.
//
// Not claimed: where the headers are on any board, how a liquid cooler must be
// wired (its manual decides), that this clears the message, or what the screen
// shows afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { CHECKED, CRUCIAL_UNPLUG } from "./sources.ts";

export const CPU_FAN_HEADER_CUT: CutSpec = {
  id: "cpu-fan-header",
  durationSeconds: 12.6,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.8, text: "\"CPU Fan Error\" at startup?" },
    { from: 1.8, to: 3.6, text: "Shut down and unplug it first." },
    { from: 3.6, to: 5.6, text: "Find the CPU_FAN header in your manual." },
    { from: 5.6, to: 7.4, text: "If the cooler's fan is on CHA_FAN," },
    { from: 7.4, to: 9.0, text: "move it to CPU_FAN." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then start the PC and check again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "The stylized PC lit; the monitor shows a stylized message, CPU Fan Error!" },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "The side panel slides off; the camera closes on the CPU_FAN header near the top of the board, in an example layout, glowing amber; EXAMPLE LAYOUT." },
    { storyBeat: "wrong-header", purpose: "reversal", visualDirection: "The camera moves down to CHA_FAN: the cooler's fan plug sits there, a red cross beside it; AIO? CHECK ITS MANUAL." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "The camera follows the plug from CHA_FAN up to CPU_FAN, where it lands, outlined green." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "At the back, the power cord goes back into the power supply." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its button pulsing amber. No start or message is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 2.0, fadeOut: 0.2, params: { lit: true, screenText: "CPU Fan Error!", screenTextFrom: 0 } },
    { scene: "psuRear", from: 1.8, to: 3.8, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.4, 2.75] } },
    { scene: "caseOpen", from: 3.6, to: 5.8, fadeIn: 0.2, fadeOut: 0.2, params: { panelOff: [3.75, 4.1], zoom: { from: [540, 700, 0.9], to: [500, 270, 1.6], during: [4.1, 4.6] }, fanPlug: { start: "cha" }, highlight: "cpuFan", highlightFrom: 4.5 } },
    { scene: "caseOpen", from: 5.6, to: 7.6, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [500, 270, 1.6], to: [330, 960, 2.0], during: [5.6, 6.0] }, fanPlug: { start: "cha", wrongAt: 6.0 }, highlight: "cpuFan", highlightFrom: 0 } },
    { scene: "caseOpen", from: 7.4, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [330, 960, 2.0], to: [555, 170, 2.0], during: [7.4, 8.3] }, fanPlug: { start: "cha", move: [7.5, 8.3] }, highlight: "cpuFan", highlightFrom: 0, seatedFrom: 8.4 } },
    { scene: "psuRear", from: 9.0, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.3, 9.65] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "CPU FAN ERROR?", from: 0, to: 1.8, colour: "red", at: "head", size: 60 },
    { text: "UNPLUG FIRST", from: 1.8, to: 3.6, colour: "amber", at: "head" },
    { text: "CPU_FAN HEADER", from: 4.5, to: 5.6, colour: "purple", at: "head" },
    { text: "EXAMPLE LAYOUT", from: 4.5, to: 5.6, colour: "amber", at: "foot" },
    { text: "WRONG HEADER", from: 5.7, to: 7.4, colour: "red", at: "head" },
    { text: "AIO? CHECK ITS MANUAL", from: 5.7, to: 7.4, colour: "amber", at: "foot" },
    { text: "ON CPU_FAN", from: 7.4, to: 9.0, colour: "green", at: "head" },
    { text: "POWER CORD BACK IN", from: 9.1, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "plug", at: 2.44, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 8.28, seconds: 0.04, peakDbfs: -12, reason: "the fan plug lands on CPU_FAN (stylized)" },
    { kind: "plug", at: 9.59, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "tap",
  sources: [
    CRUCIAL_UNPLUG,
    {
      publisher: "ASUS",
      title: "[Motherboard] Why I see the error message CPU FAN Error in POST? (FAQ 1006064)",
      url: "https://www.asus.com/support/faq/1006064/",
      quote: "Search-excerpt wording: \"CPU FAN Error\" in POST means the system doesn't detect the FAN; make sure the CPU FAN cable is securely installed to the CPU_FAN connector instead of the CHA_FAN.",
      supports: "The cooler's fan belongs on the CPU_FAN header, not CHA_FAN; the message means the fan is not detected.",
    },
    {
      publisher: "ASUS",
      title: "[Motherboard] Troubleshooting - An error \"CPU Over Temperature Error\" occurs after bootup (FAQ 1043819)",
      url: "https://www.asus.com/us/support/faq/1043819/",
      quote: "Search-excerpt summary: if the cooler fan is not running or cannot be detected (speed N/A), confirm it is properly connected to the CPU_FAN header on the motherboard.",
      supports: "Check the CPU_FAN connection when the fan is not detected.",
    },
    {
      publisher: "ASUS ROG forum",
      title: "Asus Strix Z790-H Gaming WiFi: CPU FAN ERROR when AIO pump… (forum thread 937761)",
      url: "https://rog-forum.asus.com/t5/intel-700-600-series/asus-strix-z790-h-gaming-wifi-cpu-fan-error-when-aio-pump/td-p/937761",
      quote: "Search-excerpt summary: for AIO liquid coolers, replies suggest the pump on AIO_PUMP and fans on CPU_FAN, and to follow the cooler's own manual.",
      supports: "Liquid coolers can be wired differently; the cut says AIO? CHECK ITS MANUAL and makes no claim about them.",
    },
  ],
  sourcesChecked: CHECKED,
};
