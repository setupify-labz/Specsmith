// The second approved narration of the "New PC not working?" two-checks Short.
//
// Approved by the owner on 2026-10-10 for ONE Liam take, word for word (the
// version that keeps "If you have a graphics card"; straight ASCII apostrophes):
//   "PC won't turn on? Check the power supply switch. If it's on O, flip it to I.
//    PC on, but no picture? If you have a graphics card, make sure your monitor
//    is plugged into it."
// The first narration (script.ts) and its take stay as they are.

export const APPROVED_TWO_CHECKS_V2_TEXT = "PC won't turn on? Check the power supply switch. If it's on O, flip it to I. PC on, but no picture? If you have a graphics card, make sure your monitor is plugged into it.";

export const APPROVED_TWO_CHECKS_V2_LINES = Object.freeze([
  { id: "hook", spoken: "PC won't turn on?" },
  { id: "where", spoken: "Check the power supply switch." },
  { id: "flip", spoken: "If it's on O, flip it to I." },
  { id: "symptom", spoken: "PC on, but no picture?" },
  { id: "cable", spoken: "If you have a graphics card, make sure your monitor is plugged into it." },
] as const);
export type TwoChecksV2LineId = (typeof APPROVED_TWO_CHECKS_V2_LINES)[number]["id"];

/** The one string sent: the lines joined by single spaces. */
export const TWO_CHECKS_V2_TAKE_TEXT = APPROVED_TWO_CHECKS_V2_LINES.map((line) => line.spoken).join(" ");
