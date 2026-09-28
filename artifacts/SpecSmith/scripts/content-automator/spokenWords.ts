// How many words a line takes to SAY, not to write.
//
// Narration timing counted whitespace tokens, so "164 to 160 at 1440p" was
// five words. Spoken, it is "one sixty-four to one sixty at fourteen-forty p":
// ten. A script that states figures overran its beat windows while every
// check passed. Numerals, "4K"-style resolutions and short all-capital
// acronyms (CPU, FPS) are now counted as they are read aloud; every other
// token is one word, as before.

/** Words to say a whole number below 100: "twenty" is one, "seventy-nine" two. */
function underHundred(value: number): number {
  if (value === 0) return 0;
  if (value < 20 || value % 10 === 0) return 1;
  return 2;
}

/** Words to say a run of digits the way model numbers and figures are read. */
function digitsSpoken(digits: string): number {
  const value = Number(digits);
  if (digits.length <= 2) return Math.max(1, underHundred(value));
  if (digits.length === 3) return 1 + underHundred(value % 100); // "one sixty-four"
  if (digits.length === 4) {
    // Read in pairs: "forty eighty", "fourteen forty", "twenty seventy-seven".
    return Math.max(1, underHundred(Number(digits.slice(0, 2)))) + Math.max(1, underHundred(Number(digits.slice(2))));
  }
  return digits.length; // Long runs are read digit by digit.
}

/** Spoken words in one whitespace-free token. */
function tokenSpoken(token: string): number {
  const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!word) return 0;
  const numeric = /^(\d+)([a-z]*)$/i.exec(word);
  if (numeric) return digitsSpoken(numeric[1]) + (numeric[2] ? numeric[2].length : 0);
  // CPU, FPS, RTX: said letter by letter.
  if (/^[A-Z]{2,4}$/.test(word)) return word.length;
  return 1;
}

/** The number of words it takes to read `text` aloud. */
export function spokenWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).reduce((total, token) => total + tokenSpoken(token), 0);
}
