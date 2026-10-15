// "Using two RAM sticks? Check which slots." A 13 s Short as DATA.
//
//   PROBLEM    close on the memory slots: two sticks side by side (example slots A1, A2).
//   UNPLUG     the power cord leaves the power supply.
//   LOCATION   the slots labelled A1 A2 B1 B2 (an EXAMPLE naming); the manual's pair glows.
//   ACTION     a cross on side by side; both sticks move to A2 and B2 (a tick);
//              A2 + B2 ON MANY BOARDS, and the board's manual decides.
//   POWER BACK the cord back in; the button pulses amber. No start is shown.
//
// Not claimed: any speed or performance figure, that A2 + B2 is right for every
// board (some use other pairs: the manual's "recommended memory configuration"
// decides), that this fixes anything, or what happens afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { CHECKED, CRUCIAL_UNPLUG } from "./sources.ts";

export const RAM_SLOTS_CUT: CutSpec = {
  id: "ram-slots",
  durationSeconds: 13.0,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.8, text: "Using two RAM sticks?" },
    { from: 1.8, to: 3.6, text: "Unplug it before opening the case." },
    { from: 3.6, to: 5.6, text: "Your manual lists which slots to use for two." },
    { from: 5.6, to: 7.6, text: "On many boards, it's A2 and B2, not side by side." },
    { from: 7.6, to: 9.4, text: "Your board's manual decides, not this example." },
    { from: 9.4, to: 11.2, text: "Plug it back in." },
    { from: 11.2, to: 13.0, text: "Then try booting again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "Close on the board's four memory slots: two sticks in the first two, side by side." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "Closer: the slots labelled A1 A2 B1 B2 (EXAMPLE LAYOUT); A2 and B2 glow amber." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "A red cross beside the side-by-side pair; both sticks lift and move to A2 and B2; a green tick." },
    { storyBeat: "manual", purpose: "evidence", visualDirection: "The sticks in A2 and B2; YOUR MANUAL DECIDES; EXAMPLE LAYOUT stays on screen." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "At the back, the power cord goes back into the power supply." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown." },
  ],
  shots: [
    { scene: "caseOpen", from: 0, to: 2.0, fadeOut: 0.2, params: { zoom: { from: [640, 420, 1.4], to: [660, 400, 1.5], during: [0, 2.0] }, ram: { start: [0, 1] } } },
    { scene: "psuRear", from: 1.8, to: 3.8, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.4, 2.75] } },
    { scene: "caseOpen", from: 3.6, to: 9.6, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [728, 380, 2.0], to: [728, 380, 2.0], during: [3.6, 3.7] }, ram: { start: [0, 1], end: [1, 3], move: [6.0, 6.8], wrongAt: 5.7, rightAt: 6.9 }, slotLabels: true, highlightSlots: [1, 3], highlightFrom: 4.4 } },
    { scene: "psuRear", from: 9.4, to: 11.35, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.7, 10.05] } },
    { scene: "powerButton", from: 11.2, to: 13.0, fadeIn: 0.2, params: { pulseFrom: 11.4 } },
  ],
  labels: [
    { text: "TWO RAM STICKS?", from: 0, to: 1.8, colour: "red", at: "head", size: 60 },
    { text: "UNPLUG FIRST", from: 1.8, to: 3.6, colour: "amber", at: "head" },
    { text: "CHECK YOUR MANUAL", from: 3.7, to: 5.6, colour: "purple", at: "head" },
    { text: "EXAMPLE LAYOUT", from: 3.7, to: 9.4, colour: "amber", at: "foot" },
    { text: "SIDE BY SIDE?", from: 5.7, to: 6.8, colour: "red", at: "head" },
    { text: "A2 + B2", from: 6.8, to: 7.6, colour: "green", at: "head" },
    { text: "YOUR MANUAL DECIDES", from: 7.6, to: 9.4, colour: "purple", at: "head" },
    { text: "POWER CORD BACK IN", from: 9.5, to: 11.2, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "plug", at: 2.44, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "snap", at: 6.85, seconds: 0.06, reason: "the sticks' clips close in A2 and B2 (stylized)" },
    { kind: "plug", at: 9.99, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "snap",
  sources: [
    CRUCIAL_UNPLUG,
    {
      publisher: "ASUS",
      title: "[Motherboard] How to install DRAM (Memory) on Motherboard? (FAQ 1047257)",
      url: "https://www.asus.com/support/faq/1047257/",
      quote: "Search-excerpt wording: If two DRAMs, please install to DIMM_A2 and DIMM_B2 slots; the manual's \"Recommended memory configuration\" section lists the slots for one, two or four modules.",
      supports: "The manual lists which slots to use for two modules; on these ASUS boards, A2 and B2.",
    },
    {
      publisher: "ASUS",
      title: "M5A97 R2.0 user manual",
      url: "https://dlcdnet.asus.com/pub/ASUS/mb/SocketAM3+/M5A97_R2.0/E7438_M5A97_R20_Manual_web_hi-res.pdf",
      quote: "Installing the modules into slots A2 and B2 is suggested for better compatibility.",
      supports: "A2 and B2 for two modules on another ASUS board.",
    },
    {
      publisher: "ASUS",
      title: "ROG RAMPAGE VI EXTREME OMEGA DRAM QVL (8 DIMM slots)",
      url: "https://dlcdnets.asus.com/pub/ASUS/mb/LGA2066/ROG_RAMPAGE_VI_EXTREME_OMEGA/ROG_RAMPAGE_VI_EXTREME_OMEGA_DRAM_QVL_V4.0.pdf",
      quote: "Search-excerpt summary: this board uses different slots for two modules (B1 and D1).",
      supports: "Not every board uses A2 + B2: the cut says ON MANY BOARDS and sends viewers to their own manual.",
    },
  ],
  sourcesChecked: CHECKED,
};
