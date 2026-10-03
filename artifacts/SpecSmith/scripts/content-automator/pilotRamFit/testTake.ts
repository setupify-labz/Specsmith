// TEST ONLY: a stand-in for the provider's character timestamps, so the take
// script and the timing plan can be exercised without a provider call. Never
// imported by the renderer or the take script.

import { RAM_FIT_TAKE_TEXT, type Alignment } from "./liamTake.ts";

/** Timestamps for `text`: `perChar` seconds a character, `gap` seconds between sentences. */
export function fakeAlignment(text = RAM_FIT_TAKE_TEXT, perChar = 0.055, gap = 0.3): Alignment {
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0.08;
  characters.forEach((char, index) => {
    if (char === " " && /[.!?]$/.test(text.slice(0, index))) t += gap;
    starts.push(t); ends.push(t + perChar * 0.9); t += perChar;
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}
