// Anti-slop scanner tests.
//
// The scanner's job is to block copy SpecSmith has not earned the right to say.
// The tests that matter most are the ones asserting it does NOT fire: a scanner
// that flags honest hardware comparison prose gets disabled within a week, and
// then it protects nothing.

import { describe, expect, it } from "vitest";

import { scanForSlop, type SlopScanInput } from "./antiSlop.ts";

function input(overrides: Partial<SlopScanInput> = {}): SlopScanInput {
  return {
    title: "RTX 4080 Super vs RTX 4080: which one to buy",
    beats: [
      { onScreenText: "Two cards, names hidden", narration: "Two GPUs, same build around them." },
      { onScreenText: "REAL SPECS", narration: "SpecSmith holds the CPU and resolution constant." },
      { onScreenText: "OPEN COMPARE", narration: "Open /compare and change the cards yourself." },
    ],
    finalCta: "Open SpecSmith Compare.",
    ...overrides,
  };
}

describe("scanForSlop", () => {
  it("passes honest comparison copy with no findings", () => {
    const report = scanForSlop(input());
    expect(report.findings).toEqual([]);
    expect(report.passable).toBe(true);
  });

  it("hard-fails manufactured urgency, because hardware advice is not time-limited", () => {
    const report = scanForSlop(input({ finalCta: "Open Compare before it's too late!" }));
    const finding = report.findings.find((entry) => entry.code === "fake-urgency");
    expect(finding?.severity).toBe("hard-fail");
    expect(finding?.location).toBe("cta");
    expect(finding?.evidence.toLowerCase()).toBe("before it's too late");
    expect(report.passable).toBe(false);
  });

  it("hard-fails a claim that SpecSmith performed a measurement it never performed", () => {
    const beats = input().beats.map((beat, index) =>
      index === 1 ? { ...beat, narration: "We benchmarked both cards at 1440p." } : beat,
    );
    const report = scanForSlop(input({ beats }));
    const finding = report.findings.find((entry) => entry.code === "unsupported-claim-verb");
    expect(finding?.severity).toBe("hard-fail");
    expect(finding?.location).toBe("beat-2.narration");
    expect(report.passable).toBe(false);
  });

  it("hard-fails an unsupported superlative", () => {
    const report = scanForSlop(input({ title: "The best GPU you can buy" }));
    expect(report.hardFailures.map((entry) => entry.code)).toContain("unsupported-superlative");
  });

  it("warns, without blocking, on repeated on-screen text across beats", () => {
    const beats = input().beats.map((beat) => ({ ...beat, onScreenText: "REAL SPECS" }));
    const report = scanForSlop(input({ beats }));
    const repeats = report.findings.filter((entry) => entry.code === "repeated-caption");
    expect(repeats).toHaveLength(2);
    expect(repeats[0].location).toBe("beat-2.onScreenText");
    expect(repeats.every((entry) => entry.severity === "warning")).toBe(true);
    expect(report.passable).toBe(true);
  });

  it("hard-fails a hook promising a reveal the video never delivers", () => {
    const beats = [
      { onScreenText: "The secret nobody mentions", narration: "There is something about these cards." },
      { onScreenText: "REAL SPECS", narration: "SpecSmith holds the build constant." },
    ];
    const report = scanForSlop(input({ beats }));
    const finding = report.findings.find((entry) => entry.code === "clickbait-unsupported");
    expect(finding?.severity).toBe("hard-fail");
    expect(finding?.location).toBe("beat-1");
  });

  it("does not flag a hook whose promised reveal the body actually delivers", () => {
    const beats = [
      { onScreenText: "The secret spec", narration: "One number decides this." },
      { onScreenText: "MEMORY BANDWIDTH", narration: "The secret is memory bandwidth, and SpecSmith shows it." },
    ];
    const report = scanForSlop(input({ beats }));
    expect(report.findings.some((entry) => entry.code === "clickbait-unsupported")).toBe(false);
  });

  it("separates narration from on-screen text in the reported location", () => {
    const beats = [
      { onScreenText: "HURRY", narration: "Two GPUs, same build." },
      ...input().beats.slice(1),
    ];
    const report = scanForSlop(input({ beats }));
    expect(report.findings.map((entry) => entry.location)).toContain("beat-1.onScreenText");
    expect(report.findings.map((entry) => entry.location)).not.toContain("beat-1.narration");
  });
});
