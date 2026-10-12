// "New build won't boot? Check the CPU power cable." A 12.6 s Short, as DATA:
// a timeline of the reusable scenes in animationScenes/library.ts, rendered by
// animationScenes/renderCut.ts. There is no drawing code here.
//
//   PROBLEM     a finger presses the PC's button; the monitor stays dark. No
//               other symptom is shown (it varies: some boards show no lights).
//   UNPLUG      at the back, the power cord comes out of the power supply.
//   LOCATION    panel off; the camera closes on an empty 8-pin socket in an
//               example layout, labelled POSITION VARIES: the caption sends the
//               viewer to their manual. No positioning rule is stated.
//   ACTION      two cable ends: the CPU cable from the PC's own power supply is
//               right, a PCIe cable is wrong; then the CPU plug pressed fully
//               into the socket, its latch hooking over the tab.
//   POWER BACK  panel back on with the cable in; the cord back in.
//   TRY AGAIN   the unlit PC, its button pulsing amber. No boot is shown.
//
// THE CLAIMS rest on SOURCES below. Not claimed: where the socket is on any
// board (Corsair's "connector closest to the CPU" advice is about a board with
// two CPU power sockets and one cable, so it is not used as a positioning
// rule); whether a second 4-pin socket is needed (it depends on the board);
// that any CPU cable fits any power supply (modular cables can differ between
// models, so the cut says to use the power supply's own cable); that this fixes
// a PC; or what the monitor shows afterwards.

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
    { from: 3.4, to: 5.2, text: "Check your manual for the CPU power socket." },
    { from: 5.2, to: 7.1, text: "Use your PSU's own CPU cable, not PCIe." },
    { from: 7.1, to: 9.0, text: "Push it all the way in." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then try booting again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "A finger presses the stylized PC's power button and rests there; the monitor beside it stays dark. No other symptom is shown." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "The glass side panel slides off; the camera closes on an empty 8-pin socket in an example layout, outlined amber, marked POSITION VARIES." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Two cable ends face-on: the 4+4-pin end marked CPU, from the PC's own power supply, gets a green tick; the 6+2-pin end marked PCIe gets a red cross." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Side view: the CPU plug lowers onto the socket, thumbs press it home, its latch hooks over the socket's tab; outlined green." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "The camera pulls back from the filled socket; the panel slides back on; at the back, the cord goes back in." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { press: 0.3, holdUntil: 1.45 } },
    { scene: "psuRear", from: 1.6, to: 3.6, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.2, 2.55] } },
    { scene: "caseOpen", from: 3.4, to: 5.4, fadeIn: 0.2, fadeOut: 0.2, params: { panelOff: [3.55, 3.9], zoom: { from: [540, 700, 0.9], to: [430, 300, 2.2], during: [3.9, 4.5] }, highlight: "cpuSocket", highlightFrom: 4.4 } },
    { scene: "connectorCompare", from: 5.2, to: 7.3, fadeIn: 0.2, fadeOut: 0.2, params: { from: 5.25, left: "cpu", leftOk: true, right: "pcie", rightOk: false, verdictLeft: 5.95, verdictRight: 6.25 } },
    { scene: "connectorInsert", from: 7.1, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { lower: [7.3, 7.8], thumbsIn: [7.85, 8.05], press: [8.05, 8.35], latch: [8.25, 8.4], thumbsOut: [8.75, 8.95], seatedFrom: 8.45, stamp: "CPU" } },
    { scene: "caseOpen", from: 9.0, to: 9.65, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [430, 300, 2.2], to: [540, 700, 0.9], during: [9.0, 9.25] }, panelOn: [9.2, 9.45], highlight: "cpuSocket", highlightFrom: 99, seatedFrom: 9.0, socketFilledFrom: 0 } },
    { scene: "psuRear", from: 9.45, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.75, 10.1] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "NEW BUILD WON'T BOOT?", from: 0, to: 1.6, colour: "red", at: "head", size: 72 },
    { text: "UNPLUG FIRST", from: 1.6, to: 3.4, colour: "amber", at: "head" },
    { text: "CPU POWER SOCKET", from: 4.35, to: 5.2, colour: "purple", at: "head" },
    { text: "POSITION VARIES", from: 4.35, to: 5.2, colour: "amber", at: "foot" },
    { text: "CPU CABLE FROM YOUR PSU", from: 5.3, to: 7.1, colour: "cyan", at: "head" },
    { text: "NOT A PCIe CABLE", from: 6.25, to: 7.1, colour: "red", at: "foot" },
    { text: "PUSH IT ALL THE WAY IN", from: 7.2, to: 8.45, colour: "cyan", at: "head" },
    { text: "FULLY IN", from: 8.45, to: 9.45, colour: "green", at: "head", size: 72 },
    { text: "POWER CORD BACK IN", from: 9.45, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "button", at: 0.3, seconds: 0.05, reason: "the power button is pressed (nothing happens on screen)" },
    { kind: "plug", at: 2.24, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 7.8, seconds: 0.04, reason: "the plug lands on the socket" },
    { kind: "snap", at: 8.38, seconds: 0.06, reason: "the plug's latch hooks over the socket's tab (stylized)" },
    { kind: "plug", at: 10.04, seconds: 0.2, reason: "the cord goes back into the power supply" },
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
      title: "Can I use a PCI-e cable in the 8-pin motherboard plug?",
      url: "https://www.corsair.com/us/en/explorer/diy-builder/power-supply-units/can-i-use-a-pci-e-cable-in-the-8-pin-motherboard-plug/",
      quote: "The connectors are either labelled as PCIe or CPU. The PCIe cables go to your graphics card, and the cable marked CPU will mount in your motherboards 8-pin header. … The connector is physically different, but also because the cables are wired differently and might damage your components.",
      supports: "CPU (EPS12V) and PCIe cables are different; the end marked CPU goes to the motherboard's CPU power header; the wrong cable can damage components.",
    },
    {
      publisher: "Seasonic",
      title: "Which cables are compatible with my Power Supply? (Knowledge Base 68)",
      url: "https://knowledge.seasonic.com/article/68-cable-compatibility",
      quote: "Cables are often not compatible between brands, and even within a brand, modular cables may differ between series and models. Seasonic recommends using the DC cables supplied with the power supply.",
      supports: "Use the CPU cable that came with that power supply; do not mix modular cables between models without confirmed compatibility.",
    },
    {
      publisher: "Corsair",
      title: "PSU: How to Avoid Current Overload/Connector Issues",
      url: "https://help.corsair.com/hc/en-us/articles/10700487373197-PSU-How-to-Avoid-Current-Overload-Connector-Issues",
      quote: "Make sure connectors click fully into place.",
      supports: "Push the connector all the way in (the latch catching is the visible and audible sign).",
    },
  ],
  sourcesChecked: {
    on: "2026-10-11",
    method: "Web-search excerpts of the pages; this environment's network policy blocks asus.com, corsair.com and seasonic.com, so none was opened directly. Corrected 2026-10-12 after the owner's review: the cable instruction names the power supply's own CPU/EPS cable, and Corsair's \"closest to the CPU\" advice (two sockets, one cable) is no longer used as a positioning rule. The H87M-PRO manual line is a forum's quotation. A person must read each page once before this Short goes further (factual-takeaway gate).",
  },
};
