// "PC on, monitor blank? Check the monitor's input setting." A 10 s Short as DATA.
//
//   PROBLEM    the PC is lit; the monitor stays dark.
//   PORT       the back of the PC: the cable sits in the graphics card's ports
//              (an example: DisplayPort).
//   MENU       the monitor's input menu opens: HDMI 1 is selected.
//   ACTION     the selection moves to DisplayPort and is confirmed (a tick).
//   TRY AGAIN  the PC and the still-dark monitor. No picture is shown.
//
// Not claimed: how any one monitor's menu works (MENUS VARY BY MONITOR), that this
// fixes a blank screen, or what the screen shows afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { ASUS_NO_POWER, CHECKED } from "./sources.ts";

export const MONITOR_INPUT_SOURCE_CUT: CutSpec = {
  id: "monitor-input-source",
  durationSeconds: 10.0,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.6, text: "PC on, monitor blank?" },
    { from: 1.6, to: 3.6, text: "Check which port your cable is in." },
    { from: 3.6, to: 5.6, text: "Open the monitor's input menu." },
    { from: 5.6, to: 8.0, text: "Pick the input that matches your cable." },
    { from: 8.0, to: 10.0, text: "Then check the screen again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "The stylized PC lit, its fans turning; the monitor beside it stays dark." },
    { storyBeat: "port", purpose: "evidence", visualDirection: "The back of the PC: the display cable sits in the graphics card's ports, outlined amber; EXAMPLE: DISPLAYPORT." },
    { storyBeat: "menu", purpose: "evidence", visualDirection: "A large monitor, screen dark; a bezel button is pressed and an INPUT SOURCE menu opens with HDMI 1 selected." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Two presses move the selection to DisplayPort; a third confirms it with a green tick." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The camera closes on the monitor beside the lit PC; the screen is still dark. No picture is shown or promised." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { lit: true } },
    { scene: "rearIo", from: 1.6, to: 3.8, fadeIn: 0.2, fadeOut: 0.2, params: { startIn: "gpu", gpuHighlightFrom: 2.0 } },
    { scene: "monitorMenu", from: 3.6, to: 8.2, fadeIn: 0.2, fadeOut: 0.2, params: { presses: [3.85, 5.9, 6.4, 7.0], menuFrom: 4.0, items: ["HDMI 1", "HDMI 2", "DisplayPort"], select: [[0, 0], [5.9, 1], [6.4, 2]], confirmAt: 7.0 } },
    { scene: "powerButton", from: 8.0, to: 10.0, fadeIn: 0.2, params: { lit: true, zoom: { from: [540, 900, 1.0], to: [760, 990, 1.7], during: [8.0, 8.8] } } },
  ],
  labels: [
    { text: "PC ON, MONITOR BLANK?", from: 0, to: 1.6, colour: "red", at: "head", size: 60 },
    { text: "WHICH PORT?", from: 1.7, to: 3.6, colour: "purple", at: "head" },
    { text: "EXAMPLE: DISPLAYPORT", from: 1.7, to: 3.6, colour: "amber", at: "foot" },
    { text: "INPUT MENU", from: 3.7, to: 5.6, colour: "cyan", at: "head" },
    { text: "MENUS VARY BY MONITOR", from: 3.7, to: 8.0, colour: "amber", at: "foot" },
    { text: "MATCH YOUR CABLE", from: 5.7, to: 8.0, colour: "green", at: "head" },
  ],
  cues: [
    { kind: "tick", at: 3.85, seconds: 0.03, reason: "a bezel button opens the menu" },
    { kind: "tick", at: 5.9, seconds: 0.03, reason: "the selection moves down" },
    { kind: "tick", at: 6.4, seconds: 0.03, reason: "the selection moves down again" },
    { kind: "button", at: 7.0, seconds: 0.05, peakDbfs: -12, reason: "the matching input is confirmed (stylized)" },
  ],
  clearestCue: "button",
  sources: [
    { ...ASUS_NO_POWER, quote: "Search-excerpt summary: confirm the monitor's input source matches the port in use (for example, select DP when the PC is connected by DisplayPort).", supports: "The monitor's input setting has to match the port the cable is in." },
    {
      publisher: "NZXT",
      title: "PC Powers On But No Display: How to Fix It",
      url: "https://nzxt.com/blogs/news/pc-powers-on-but-no-display",
      quote: "Search-excerpt summary: set the monitor's on-screen menu to auto-detect or to the input that matches your cable; monitors with several inputs of one type label them HDMI-1, HDMI-2.",
      supports: "Pick the input that matches the cable in the monitor's own menu.",
    },
  ],
  sourcesChecked: CHECKED,
};
