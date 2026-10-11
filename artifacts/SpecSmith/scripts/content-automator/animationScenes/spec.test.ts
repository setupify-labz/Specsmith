// The spec checks refuse a Short before anything renders: a caption gap, a
// frame with no scene, an unreadable or overlapping label, a cue outside the
// cut, a missing clearest cue, an unknown scene, a forbidden claim.

import { describe, expect, it } from "vitest";

import { CPU_POWER_CUT } from "../nextVideoCpuPower/cut.ts";
import { specProblems, type CutSpec } from "./spec.ts";

const broken = (change: (s: any) => void): string[] => { const s = structuredClone(CPU_POWER_CUT) as any; change(s); return specProblems(s as CutSpec); };

describe("spec checks", () => {
  it("accept the CPU power cut", () => expect(specProblems(CPU_POWER_CUT)).toEqual([]));
  it("refuse a caption gap and a frame with no scene", () => {
    expect(broken((s) => { s.captions[2].from = 3.5; })).toContainEqual(expect.stringContaining("caption 3 does not start"));
    expect(broken((s) => { s.shots[1].to = 2.0; s.shots[2].from = 3.5; })).toContainEqual(expect.stringContaining("no scene at"));
  });
  it("refuse a label shown too briefly to read, and two labels in one place", () => {
    expect(broken((s) => { s.labels[2].from = 5.0; })).toContainEqual(expect.stringContaining("characters a second"));
    expect(broken((s) => { s.labels[1].from = 1.0; })).toContainEqual(expect.stringContaining("overlap at the head"));
  });
  it("refuse an unknown scene, a cue outside the cut, and a missing clearest cue", () => {
    expect(broken((s) => { s.shots[0].scene = "explosion"; })).toContainEqual('unknown scene "explosion"');
    expect(broken((s) => { s.cues[0].at = 12.59; })).toContainEqual(expect.stringContaining("outside the cut"));
    expect(broken((s) => { s.cues = s.cues.filter((c: any) => c.kind !== "snap"); })).toContainEqual(expect.stringContaining("never sounds"));
  });
  it("refuse a forbidden claim in a caption or label", () => {
    expect(broken((s) => { s.captions[6].text = "Guaranteed to fix it."; }).some((p) => p.startsWith('"Guaranteed to fix it."'))).toBe(true);
  });
  it("keep the illustration band and sources on the spec", () => {
    expect([CPU_POWER_CUT.badge, CPU_POWER_CUT.line]).toEqual(["ILLUSTRATION", "Stylized example · not a fix for every PC"]);
    expect(CPU_POWER_CUT.sources.map((s) => s.publisher)).toEqual(expect.arrayContaining(["ASUS", "Corsair", "Crucial"]));
    expect(CPU_POWER_CUT.sourcesChecked.method).toContain("A person must read each page");
  });
});
