// The approved narration of the "New PC not working?" two-checks Short, one
// line per beat.
//
// Approved by the owner on 2026-10-09 for ONE Liam take, word for word:
//   "No power? Check the power supply switch. O is off. I is on. PC on, but no
//    picture? If you have a graphics card, check that your monitor is plugged
//    into its ports."
// Changing a word is a reviewed change to this file and to the pinned hash.

export const APPROVED_TWO_CHECKS_TEXT = "No power? Check the power supply switch. O is off. I is on. PC on, but no picture? If you have a graphics card, check that your monitor is plugged into its ports.";

export const APPROVED_TWO_CHECKS_LINES = Object.freeze([
  { id: "hook", spoken: "No power?" },
  { id: "where", spoken: "Check the power supply switch." },
  { id: "off", spoken: "O is off." },
  { id: "on", spoken: "I is on." },
  { id: "symptom", spoken: "PC on, but no picture?" },
  { id: "cable", spoken: "If you have a graphics card, check that your monitor is plugged into its ports." },
] as const);
export type TwoChecksLineId = (typeof APPROVED_TWO_CHECKS_LINES)[number]["id"];

/** The one string sent: the lines joined by single spaces. */
export const TWO_CHECKS_TAKE_TEXT = APPROVED_TWO_CHECKS_LINES.map((line) => line.spoken).join(" ");
