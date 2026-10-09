// The approved narration of the "PC won't turn on?" Short, one line per beat.
//
// Approved by the owner on 2026-10-09 for ONE Liam take, word for word:
//   "PC won't turn on? Check the switch on the back. O is off. I is on."
// Each line is also its beat's caption, so what is said and what is shown
// cannot drift apart. Changing a word is a reviewed change to this file.

export const APPROVED_POWER_SWITCH_TEXT = "PC won't turn on? Check the switch on the back. O is off. I is on.";

export const APPROVED_POWER_SWITCH_LINES = Object.freeze([
  { id: "hook", spoken: "PC won't turn on?" },
  { id: "where", spoken: "Check the switch on the back." },
  { id: "off", spoken: "O is off." },
  { id: "on", spoken: "I is on." },
] as const);
export type PowerSwitchLineId = (typeof APPROVED_POWER_SWITCH_LINES)[number]["id"];

/** The one string sent: the lines joined by single spaces. */
export const POWER_SWITCH_TAKE_TEXT = APPROVED_POWER_SWITCH_LINES.map((line) => line.spoken).join(" ");
