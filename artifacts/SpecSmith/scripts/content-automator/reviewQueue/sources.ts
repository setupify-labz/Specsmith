// Sources shared by the review-queue cuts. Every quote below was read from a
// web-search excerpt on 2026-10-12: this environment's network policy does not
// resolve asus.com, corsair.com, nzxt.com or seasonic.com, so no page was opened
// directly. A quote that the excerpt gave as the page's own words is kept as a
// quote; anything the excerpt only paraphrased is marked "Search-excerpt summary".
// A person must read each page once before a cut goes further (factual-takeaway gate).

import type { SpecSource } from "../animationScenes/spec.ts";

export const CHECKED = {
  on: "2026-10-12",
  method: "Web-search excerpts only; asus.com, corsair.com, nzxt.com and seasonic.com do not resolve from this environment, so no page was opened directly. Quotes the excerpt gave verbatim are quoted; paraphrases are marked \"Search-excerpt summary\". A person must read each page once before this Short goes further (factual-takeaway gate).",
} as const;

export const CRUCIAL_UNPLUG: SpecSource = {
  publisher: "Crucial",
  title: "How to Install Memory in Your Desktop",
  url: "https://www.crucial.com/support/install-memory-desktop",
  quote: "Shut down your system. Once your system has been powered off, unplug the power cable.",
  supports: "Unplug before working inside the PC.",
};

export const CORSAIR_WONT_TURN_ON = {
  publisher: "Corsair",
  title: "PC Won't Turn On: What You Need to Try",
  url: "https://www.corsair.com/us/en/explorer/diy-builder/blogs/pc-wont-turn-on-what-you-need-to-try/",
} as const;

export const ASUS_NO_POWER = {
  publisher: "ASUS",
  title: "[Motherboard] Troubleshooting - No Power/No Boot/No Display (FAQ 1042632)",
  url: "https://www.asus.com/us/support/faq/1042632/",
} as const;

export const CORSAIR_CLICK_IN: SpecSource = {
  publisher: "Corsair",
  title: "PSU: How to Avoid Current Overload/Connector Issues",
  url: "https://help.corsair.com/hc/en-us/articles/10700487373197-PSU-How-to-Avoid-Current-Overload-Connector-Issues",
  quote: "Make sure connectors click fully into place.",
  supports: "Push the connector all the way in (the latch catching is the visible and audible sign).",
};

export const SEASONIC_OWN_CABLES: SpecSource = {
  publisher: "Seasonic",
  title: "Which cables are compatible with my Power Supply? (Knowledge Base 68)",
  url: "https://knowledge.seasonic.com/article/68-cable-compatibility",
  quote: "Cables are often not compatible between brands, and even within a brand, modular cables may differ between series and models. Seasonic recommends using the DC cables supplied with the power supply.",
  supports: "Use the power supply's own cable; do not mix modular cables between models without confirmed compatibility.",
};
