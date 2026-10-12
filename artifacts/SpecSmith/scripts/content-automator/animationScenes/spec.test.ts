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
    expect(broken((s) => { s.shots[1].to = 2.0; s.shots[2].from = 3.5; })).toContainEqual(expect.stringContaining("no scene drawn at"));
  });
  it("refuse a frame whose only scene is at zero opacity (first frame of a fade-in; Codex P2)", () => {
    expect(broken((s) => { s.shots[0].fadeIn = 0.2; })).toContainEqual("no scene drawn at 0.000 s");
    // The next shot starts exactly where the previous ends, fading in: its first frame is blank.
    expect(broken((s) => { s.shots[0].to = 1.6; s.shots[0].fadeOut = 0; })).toContainEqual(expect.stringContaining("no scene drawn at 1.6"));
  });
  it("refuse negative fade durations (Codex P2)", () => {
    expect(broken((s) => { s.shots[1].fadeIn = -0.2; s.shots[1].fadeOut = -0.2; })).toContainEqual(expect.stringContaining("negative or invalid fadeIn"));
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
  it("refuse a reversed or empty label window and a zero-length cue (Codex P2)", () => {
    expect(broken((s) => { s.labels[0].to = s.labels[0].from; })).toContainEqual(expect.stringContaining("has no positive span"));
    expect(broken((s) => { s.labels[3].from = 5.2; s.labels[3].to = 4.4; })).toContainEqual(expect.stringContaining("has no positive span"));
    expect(broken((s) => { s.cues[1].seconds = 0; })).toContainEqual(expect.stringContaining("has no length"));
  });
  it("refuse a band that is not the standard disclosure, or that makes a forbidden claim (Codex P1)", () => {
    const problems = broken((s) => { s.line = "Guaranteed to fix it"; });
    expect(problems).toContainEqual(expect.stringContaining("the band on every frame must read"));
    expect(problems.some((p) => p.startsWith('"Guaranteed to fix it"'))).toBe(true);
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

describe("a failed render leaves no temporary frames behind (Codex P2)", () => {
  it("removes the frames folder when the spec is refused mid-render", async () => {
    const { mkdtempSync, readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { renderCut } = await import("./renderCut.ts");
    const dir = mkdtempSync(join(tmpdir(), "cut-fail-"));
    // A missing Chromium path makes the render fail after the frames folder has been created.
    const previous = process.env.SPECSMITH_RENDER_CHROMIUM;
    process.env.SPECSMITH_RENDER_CHROMIUM = "/nonexistent/chromium";
    try {
      await expect(renderCut(CPU_POWER_CUT, dir)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.SPECSMITH_RENDER_CHROMIUM; else process.env.SPECSMITH_RENDER_CHROMIUM = previous;
    }
    expect(readdirSync(dir)).toEqual([]);
  }, 60_000);
});

describe("a label pill wider than the frame is refused, not clipped", () => {
  const chromium = process.env.SPECSMITH_RENDER_CHROMIUM;
  it.skipIf(!chromium)("refuses the CPU hook at 72 px (it overflowed a phone frame) and leaves no frames behind", async () => {
    const { mkdtempSync, readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { renderCut } = await import("./renderCut.ts");
    const dir = mkdtempSync(join(tmpdir(), "cut-pill-"));
    const spec = { ...CPU_POWER_CUT, labels: CPU_POWER_CUT.labels.map((l, i) => (i === 0 ? { ...l, size: 72 } : l)) };
    await expect(renderCut(spec, dir)).rejects.toThrow("NEW BUILD WON'T TURN ON?");
    expect(readdirSync(dir)).toEqual([]);
  }, 120_000);
});
