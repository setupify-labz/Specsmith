// "PC on, but no picture? Check the graphics card's power cable." A 12.6 s Short as DATA.
//
//   PROBLEM    the PC is lit (fans spinning); the monitor stays dark.
//   UNPLUG     the power cord leaves the power supply.
//   LOCATION   panel off; the camera closes on a power socket on the graphics card's
//              top edge, an example position, labelled POSITION VARIES.
//   ACTION     side view: the PSU's power plug pressed into the card's socket, latch over the tab.
//   MORE       "connect them all" if the card has more than one; CHECK YOUR CARD'S MANUAL.
//   POWER BACK panel back on; cord back in; the button pulses amber. No boot is shown.
//
// Not claimed: which connector type a card uses (6+2-pin, 12V-2x6 and others
// exist: the card's manual decides), that every card needs one, that this fixes
// a PC, or what the monitor shows afterwards.

import type { CutSpec } from "../animationScenes/spec.ts";
import { ASUS_NO_POWER, CHECKED, CRUCIAL_UNPLUG, SEASONIC_OWN_CABLES } from "./sources.ts";

export const GPU_POWER_CABLE_CUT: CutSpec = {
  id: "gpu-power-cable",
  durationSeconds: 12.6,
  fps: 30,
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.6, text: "PC on, but no picture?" },
    { from: 1.6, to: 3.4, text: "Shut down and unplug it first." },
    { from: 3.4, to: 5.2, text: "Find the power socket on the graphics card." },
    { from: 5.2, to: 7.1, text: "Plug in its power cable from your PSU." },
    { from: 7.1, to: 9.0, text: "If it has more than one, connect them all." },
    { from: 9.0, to: 10.8, text: "Plug it back in." },
    { from: 10.8, to: 12.6, text: "Then try booting again." },
  ],
  beats: [
    { storyBeat: "problem", purpose: "hook", visualDirection: "The stylized PC lit, its fans turning; the camera pushes in on the monitor beside it, which stays dark." },
    { storyBeat: "unplug", purpose: "commitment", visualDirection: "At the back of the power supply, the power cord comes out of the inlet." },
    { storyBeat: "location", purpose: "evidence", visualDirection: "The side panel slides off; the camera closes on an empty power socket on the graphics card's top edge in an example position, outlined amber, marked POSITION VARIES." },
    { storyBeat: "action", purpose: "payoff", visualDirection: "Side view: the plug marked GPU lowers onto the socket, thumbs press it home, its latch hooks over the tab." },
    { storyBeat: "more-than-one", purpose: "payoff", visualDirection: "The plug outlined green; CHECK YOUR CARD'S MANUAL below." },
    { storyBeat: "power-back", purpose: "cta", visualDirection: "The camera pulls back from the filled socket; the panel slides back on; at the back, the cord goes back in." },
    { storyBeat: "try-again", purpose: "cta", visualDirection: "The unlit PC beside the dark monitor, its power button pulsing amber. No one presses it; no boot is shown." },
  ],
  shots: [
    { scene: "powerButton", from: 0, to: 1.8, fadeOut: 0.2, params: { lit: true, zoom: { from: [540, 900, 1.0], to: [700, 960, 1.35], during: [0, 1.8] } } },
    { scene: "psuRear", from: 1.6, to: 3.6, fadeIn: 0.2, fadeOut: 0.2, params: { unplug: [2.2, 2.55] } },
    { scene: "caseOpen", from: 3.4, to: 5.4, fadeIn: 0.2, fadeOut: 0.2, params: { panelOff: [3.55, 3.9], zoom: { from: [540, 700, 0.9], to: [750, 640, 2.2], during: [3.9, 4.5] }, showGpuPower: true, highlight: "gpuPower", highlightFrom: 4.4 } },
    { scene: "connectorInsert", from: 5.2, to: 9.2, fadeIn: 0.2, fadeOut: 0.2, params: { lower: [5.45, 5.95], thumbsIn: [6.0, 6.2], press: [6.2, 6.5], latch: [6.4, 6.55], thumbsOut: [7.3, 7.5], seatedFrom: 6.6, stamp: "GPU" } },
    { scene: "caseOpen", from: 9.0, to: 9.65, fadeIn: 0.2, fadeOut: 0.2, params: { zoom: { from: [750, 640, 2.2], to: [540, 700, 0.9], during: [9.0, 9.25] }, panelOn: [9.2, 9.45], showGpuPower: true, gpuPowerFilledFrom: 0, highlight: "gpuPower", highlightFrom: 99, seatedFrom: 9.0 } },
    { scene: "psuRear", from: 9.45, to: 10.95, fadeIn: 0.2, fadeOut: 0.2, params: { startPlugged: false, plugIn: [9.75, 10.1] } },
    { scene: "powerButton", from: 10.8, to: 12.6, fadeIn: 0.2, params: { pulseFrom: 11.0 } },
  ],
  labels: [
    { text: "PC ON, NO PICTURE?", from: 0, to: 1.6, colour: "red", at: "head", size: 60 },
    { text: "UNPLUG FIRST", from: 1.6, to: 3.4, colour: "amber", at: "head" },
    { text: "GPU POWER SOCKET", from: 4.3, to: 5.2, colour: "purple", at: "head" },
    { text: "POSITION VARIES", from: 4.35, to: 5.2, colour: "amber", at: "foot" },
    { text: "YOUR PSU'S OWN CABLE", from: 5.3, to: 7.1, colour: "cyan", at: "head" },
    { text: "FULLY IN", from: 7.1, to: 9.0, colour: "green", at: "head", size: 72 },
    { text: "CHECK YOUR CARD'S MANUAL", from: 7.2, to: 9.0, colour: "amber", at: "foot" },
    { text: "POWER CORD BACK IN", from: 9.45, to: 10.8, colour: "cyan", at: "head" },
  ],
  cues: [
    { kind: "plug", at: 2.24, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tap", at: 5.95, seconds: 0.04, reason: "the plug lands on the card's socket" },
    { kind: "snap", at: 6.53, seconds: 0.06, reason: "the plug's latch hooks over the socket's tab (stylized)" },
    { kind: "plug", at: 10.04, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ],
  clearestCue: "snap",
  sources: [
    CRUCIAL_UNPLUG,
    {
      publisher: "Corsair",
      title: "Can I use a PCI-e cable in the 8-pin motherboard plug?",
      url: "https://www.corsair.com/us/en/explorer/diy-builder/power-supply-units/can-i-use-a-pci-e-cable-in-the-8-pin-motherboard-plug/",
      quote: "The connectors are either labelled as PCIe or CPU. The PCIe cables go to your graphics card, and the cable marked CPU will mount in your motherboards 8-pin header.",
      supports: "A graphics card's power comes from its own cables from the power supply.",
    },
    {
      publisher: "Intel",
      title: "Intel Arc A750 not working (Intel Community support thread)",
      url: "https://community.intel.com/t5/Intel-ARC-Graphics/Intel-Arc-A750-Not-Working/m-p/1484315",
      quote: "Search-excerpt summary: Intel's support reply says to ensure the power connectors are properly connected to the power supply and the graphics card.",
      supports: "Check the card's power connectors at the card (and the power supply); plural where a card has several.",
    },
    { ...ASUS_NO_POWER, quote: "Search-excerpt summary: for a discrete graphics card with a power connector, make sure the connector is firmly seated; reseat the card and the display cable.", supports: "The card's power connector is on the maker's own no-display checklist." },
    {
      publisher: "NZXT",
      title: "PC Powers On But No Display: How to Fix It",
      url: "https://nzxt.com/blogs/news/pc-powers-on-but-no-display",
      quote: "Search-excerpt summary: if the screen stays black, reseat the graphics card and its PCIe power cables at both the card and the PSU.",
      supports: "A PC that is on with no picture can come down to the graphics card's power cables.",
    },
    SEASONIC_OWN_CABLES,
  ],
  sourcesChecked: CHECKED,
};
