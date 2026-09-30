import { describe, expect, it } from "vitest";

import { spokenFigure, spokenFigures, spokenWordCount } from "./spokenWords.ts";

describe("words counted as they are said", () => {
  it.each([
    ["word", 1],
    ["20", 1],
    ["79", 2],
    ["160", 3],
    ["164", 4],
    ["one sixty-four", 3],
    ["forty-eighty", 2],
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
    expect(spokenWordCount("The catch: just 164 to 160 at 1440p High.")).toBe(16);
  });

  it("reads spoken figures back, skipping part and setting names", () => {
    expect(spokenFigures("The catch: one sixty-four to one sixty at fourteen-forty.")).toEqual([164, 160]);
    expect(spokenFigures("Forty-eighty Super, or plain forty-eighty?")).toEqual([]);
    expect(spokenFigures("Four-K Ultra: seventy-nine to seventy-seven.")).toEqual([79, 77]);
    expect(spokenFigures("twenty of twenty")).toEqual([20, 20]);
    for (const value of [7, 20, 64, 79, 160, 164, 190]) expect(spokenFigures(spokenFigure(value))).toEqual([value]);
  });

  it("refuses a figure it could not read back", () => {
    expect(() => spokenFigure(205)).toThrow(/No reviewed spoken form/);
  });

  it("counts nothing in blank text", () => {
    expect(spokenWordCount("   ")).toBe(0);
  });
});
