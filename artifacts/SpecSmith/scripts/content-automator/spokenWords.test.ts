import { describe, expect, it } from "vitest";

import { spokenWordCount } from "./spokenWords.ts";

describe("words counted as they are said", () => {
  it.each([
    ["word", 1],
    ["20", 1],
    ["79", 2],
    ["160", 2],
    ["164", 3],
    ["4080", 2],
    ["1440p", 3],
    ["4K", 2],
    ["CPU", 3],
    ["FPS.", 3],
    ["SpecSmith", 1],
    ["A", 1],
  ])("%s is %i", (text, words) => {
    expect(spokenWordCount(text)).toBe(words);
  });

  it("counts a line of figures far longer than its written length", () => {
    expect("The catch: just 164 to 160 at 1440p High.".split(/\s+/)).toHaveLength(9);
    expect(spokenWordCount("The catch: just 164 to 160 at 1440p High.")).toBe(14);
  });

  it("counts nothing in blank text", () => {
    expect(spokenWordCount("   ")).toBe(0);
  });
});
