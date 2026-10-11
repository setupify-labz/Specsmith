// "New build won't boot? Check the CPU power cable." A 12.6 s Short, as DATA:
// a timeline of the reusable scenes in animationScenes/library.ts, rendered by
// animationScenes/renderCut.ts. There is no drawing code here.
//
//   PROBLEM     a finger presses the PC's button; the monitor stays dark. No
//               other symptom is shown (it varies: some boards show no lights).
//   UNPLUG      at the back, the power cord comes out of the power supply.
//   LOCATION    panel off; the camera closes on an empty 8-pin socket next to
//               the CPU cooler, labelled EXAMPLE LAYOUT (positions vary).
//   ACTION      two cable ends: the one marked CPU is right, the one marked
//               PCIe is wrong; then the CPU plug pressed fully into the socket,
//               its latch hooking over the tab.
//   POWER BACK  panel back on with the cable in; the cord back in.
//   TRY AGAIN   the unlit PC, its button pulsing amber. No boot is shown.
//
// THE CLAIMS rest on SOURCES below. Not claimed: where the socket is on any
// particular board (the manual decides; the layout is labelled as an example),
// whether a second 4-pin socket is needed (it depends on the board), that this
// fixes a PC, or what the monitor shows afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";

export const CPU_POWER_CUT: CutSpec = {
  id: "cpu-power",
  durationSeconds: 12.6,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.6, text: "New build won't boot?" },
    { from: 1.6, to: 3.4, text: "Unplug it before opening the case." },
    { from: 3.4, to: 5.2, text: "Find the CPU power socket by the CPU." },
    { from: 5.2, to: 7.1, text: "Use the CPU cable, not a PCIe one." },
    { from: 7.1, to: 9.0, text: "Push it all the way in." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then try booting again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "A finger presses the stylized PC's power button; the monitor beside it stays dark. No other symptom is shown." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "The glass side panel slides off; the camera closes on an empty 8-pin socket next to the CPU cooler, outlined amber, the cooler tagged CPU; marked EXAMPLE LAYOUT." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Two cable ends face-on: the 4+4-pin end marked CPU gets a green tick; the 6+2-pin end marked PCIe gets a red cross." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Side view: the CPU plug lowers onto the socket, thumbs press it home, its latch hooks over the socket's tab; outlined green." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "The camera pulls back from the filled socket; the panel slides back on; at the back, the cord goes back in." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { press: 0.3 } },
    { scene: "psuRear", from: 1.6, to: 3.6, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.2, 2.55] } },
    { scene: "caseOpen", from: 3.4, to: 5.4, fadeIn: 0.2, fadeOut: 0.2, params: { panelOff: [3.55, 3.9], zoom: { from: [540, 700, 0.9], to: [430, 300, 2.2], during: [3.9, 4.5] }, highlight: "cpuSocket", highlightFrom: 4.4, tagCpuFrom: 4.4 } },
    { scene: "connectorCompare", from: 5.2, to: 7.3, fadeIn: 0.2, fadeOut: 0.2, params: { from: 5.25, left: "cpu", leftOk: true, right: "pcie", rightOk: false, verdictLeft: 5.95, verdictRight: 6.25 } },
    { scene: "connectorInsert", from: 7.1, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { lower: [7.3, 7.8], thumbsIn: [7.85, 8.05], press: [8.05, 8.35], latch: [8.25, 8.4], thumbsOut: [8.75, 8.95], seatedFrom: 8.45, stamp: "CPU" } },
    { scene: "caseOpen", from: 9.0, to: 9.85, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [430, 300, 2.2], to: [540, 700, 0.9], during: [9.05, 9.45] }, panelOn: [9.45, 9.75], highlight: "cpuSocket", highlightFrom: 99, seatedFrom: 9.0, socketFilledFrom: 0 } },
    { scene: "psuRear", from: 9.65, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.95, 10.3] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "NEW BUILD WON'T BOOT?", from: 0, to: 1.6, colour: "red", at: "head", size: 72 },
    { text: "UNPLUG FIRST", from: 1.6, to: 3.4, colour: "amber", at: "head" },
    { text: "CPU POWER SOCKET", from: 4.35, to: 5.2, colour: "purple", at: "head" },
    { text: "EXAMPLE LAYOUT", from: 4.35, to: 5.2, colour: "amber", at: "foot" },
    { text: "USE THE CPU CABLE", from: 5.3, to: 7.1, colour: "cyan", at: "head" },
    { text: "NOT THE PCIe ONE", from: 6.25, to: 7.1, colour: "red", at: "foot" },
    { text: "PUSH IT ALL THE WAY IN", from: 7.2, to: 8.45, colour: "cyan", at: "head" },
    { text: "FULLY IN", from: 8.45, to: 9.65, colour: "green", at: "head", size: 72 },
    { text: "POWER CORD BACK IN", from: 9.65, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "button", at: 0.3, seconds: 0.05, reason: "the power button is pressed (nothing happens on screen)" },
    { kind: "plug", at: 2.24, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 7.8, seconds: 0.04, reason: "the plug lands on the socket" },
    { kind: "snap", at: 8.38, seconds: 0.06, reason: "the plug's latch hooks over the socket's tab (stylized)" },
    { kind: "plug", at: 10.24, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "snap",
  sources: [
    {
      publisher: "Crucial",
      title: "How to Install Memory in Your Desktop",
      url: "https://www.crucial.com/support/install-memory-desktop",
      quote: "Shut down your system. Once your system has been powered off, unplug the power cable.",
      supports: "Unplug before working inside the PC.",
    },
    {
      publisher: "ASUS",
      title: "[Motherboard] Troubleshooting - No Power/No Boot/No Display (FAQ 1042632)",
      url: "https://www.asus.com/us/support/faq/1042632/",
      quote: "Some motherboard may contain 8-pin EATX12V_1, 4-pin EATX12V_2 and 24-pin EATXPWR, we suggest to connect all three connectors to the power supply.",
      supports: "The CPU power connection is a step in the maker's own no-power / no-boot / no-display checklist.",
    },
    {
      publisher: "ASUS (H87M-PRO user manual, p. 1-24, as quoted on a forum)",
      title: "H87M-PRO user manual",
      url: "https://www.hometheaterforum.com/community/threads/mobo-wont-power-8-pin-cpu-atx-12v.253413/",
      quote: "Do not forget to connect the 4-pin/8-pin EATX 12V power plug. Otherwise, the system will not boot.",
      supports: "A missing CPU power cable can stop a PC from booting (second-hand quote of the manual; hedged as \"can\").",
    },
    {
      publisher: "Corsair",
      title: "Do I Need to Plug in Both CPU Power Cables?",
      url: "https://www.corsair.com/us/en/explorer/diy-builder/power-supply-units/do-i-need-to-plug-in-both-cpu-power-cables/",
      quote: "Just make sure the connector closest to the CPU socket is populated and you will be totally fine.",
      supports: "The CPU power socket is next to the CPU socket; one cable in the nearest socket suffices on most builds.",
    },
    {
      publisher: "Corsair",
      title: "Can I use a PCI-e cable in the 8-pin motherboard plug?",
      url: "https://www.corsair.com/ca/en/explorer/diy-builder/power-supply-units/can-i-use-a-pci-e-cable-in-the-8-pin-motherboard-plug/",
      quote: "The connector is physically different, but also because the cables are wired differently and might damage your components.",
      supports: "Use the CPU (EPS12V) cable in the CPU socket, not a PCIe cable.",
    },
  ],
  sourcesChecked: {
    on: "2026-10-11",
    method: "Web-search excerpts of the pages; this environment's network policy blocks asus.com and corsair.com, so none was opened directly. The H87M-PRO manual line is a forum's quotation. A person must read each page once before this Short goes further (factual-takeaway gate).",
  },
};
