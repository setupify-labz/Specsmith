// MASTER #6 — Creative memory and retrieval tests.

import { describe, expect, it } from "vitest";

import { EVIDENCE_STRENGTHS, strengthPermitsReuse } from "../experiment/model.ts";
import {
  briefLinesFromMemory,
  CreativeMemoryError,
  recordCreativeDecision,
  retrieveCreativeMemory,
  type CreativeMemoryEntry,
} from "./memory.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function entry(overrides: Partial<Parameters<typeof recordCreativeDecision>[0]> = {}): CreativeMemoryEntry {
  return recordCreativeDecision({
    entryId: "e1",
    conceptId: "m6-crossover-that-isnt",
    decision: { kind: "explanatory-structure", value: "elimination-then-substitution" },
    outcome: { state: "process", observation: "Its payoff beat was hedged by the evidence gate." },
    evidenceStrength: "anecdotal",
    synthetic: false,
    note: "",
    now: NOW,
    ...overrides,
  });
}

describe("what memory refuses to record", () => {
  it("refuses any evidence at all behind an unknown outcome", () => {
    for (const strength of EVIDENCE_STRENGTHS.filter((value) => value !== "insufficient")) {
      expect(() =>
        entry({ outcome: { state: "unknown", reason: "never published" }, evidenceStrength: strength }),
      ).toThrow(CreativeMemoryError);
    }
  });

  it("allows an unknown outcome to be recorded as insufficient", () => {
    const recorded = entry({
      outcome: { state: "unknown", reason: "never published, so nothing was observed" },
      evidenceStrength: "insufficient",
    });
    expect(recorded.outcome.state).toBe("unknown");
    expect(recorded.evidenceStrength).toBe("insufficient");
  });

  it("refuses to let watching our own pipeline become a reusable result", () => {
    for (const strength of EVIDENCE_STRENGTHS.filter(strengthPermitsReuse)) {
      expect(() => entry({ evidenceStrength: strength })).toThrow(/not a replicated result about audiences/);
    }
  });

  it("refuses a measured outcome that cannot name its experiment", () => {
    expect(() =>
      entry({ outcome: { state: "measured", observation: "x", experimentId: "  " }, evidenceStrength: "directional" }),
    ).toThrow(/must name the experiment/);
  });

  it("takes its clock as an argument", () => {
    expect(entry().recordedAt).toBe(NOW.toISOString());
  });
});

describe("retrieval never hands back a rule it does not have", () => {
  const entries = [
    entry({
      entryId: "e-unknown",
      outcome: { state: "unknown", reason: "the video was never published" },
      evidenceStrength: "insufficient",
    }),
    entry({ entryId: "e-process" }),
  ];

  it("marks an unknown outcome as carrying no weight, and says so out loud", () => {
    const result = retrieveCreativeMemory(entries, { kind: "explanatory-structure", allowSynthetic: false });
    const unknown = result.observations.find((observation) => observation.entry.entryId === "e-unknown");
    expect(unknown?.usage).toBe("nothing");
    expect(unknown?.phrasing).toMatch(/not a reason to repeat or avoid it/);
  });

  it("reports that no guidance is available rather than promoting the strongest thing it has", () => {
    const result = retrieveCreativeMemory(entries, { kind: "explanatory-structure", allowSynthetic: false });
    expect(result.noGuidanceAvailable).toBe(true);
    expect(result.observations.every((observation) => observation.usage !== "guidance")).toBe(true);
  });

  it("phrases a single observation as context, never as a rule", () => {
    const result = retrieveCreativeMemory(entries, { kind: "explanatory-structure", allowSynthetic: false });
    const process = result.observations.find((observation) => observation.entry.entryId === "e-process");
    expect(process?.usage).toBe("context");
    expect(process?.phrasing).toMatch(/context for a decision, not a rule/);
  });

  it("only calls something guidance when MASTER #5's own reuse gate allows it", () => {
    const replicated = entry({
      entryId: "e-measured",
      outcome: { state: "measured", observation: "It held in an independent experiment.", experimentId: "exp-7" },
      evidenceStrength: "replicated",
    });
    const result = retrieveCreativeMemory([replicated], { kind: "explanatory-structure", allowSynthetic: false });
    expect(result.observations[0].usage).toBe("guidance");
    expect(result.observations[0].phrasing).toMatch(/within that scope only/);
    expect(result.noGuidanceAvailable).toBe(false);
  });

  it("keeps synthetic entries out of production retrieval and says how many it withheld", () => {
    const synthetic = entry({ entryId: "e-synth", synthetic: true });
    const production = retrieveCreativeMemory([synthetic], { kind: "explanatory-structure", allowSynthetic: false });
    expect(production.observations).toEqual([]);
    expect(production.excludedSyntheticCount).toBe(1);

    const engineering = retrieveCreativeMemory([synthetic], { kind: "explanatory-structure", allowSynthetic: true });
    expect(engineering.observations).toHaveLength(1);
  });

  it("filters by decision value without inventing a relevance score", () => {
    const other = entry({ entryId: "e-other", decision: { kind: "visual-mechanism", value: "split-screen-fork" } });
    const result = retrieveCreativeMemory([...entries, other], {
      kind: "visual-mechanism",
      value: "split-screen-fork",
      allowSynthetic: false,
    });
    expect(result.observations.map((observation) => observation.entry.entryId)).toEqual(["e-other"]);
  });

  it("preserves record order rather than ranking", () => {
    const result = retrieveCreativeMemory(entries, { kind: "explanatory-structure", allowSynthetic: false });
    expect(result.observations.map((observation) => observation.entry.entryId)).toEqual(["e-unknown", "e-process"]);
  });

  it("is deterministic", () => {
    const query = { kind: "explanatory-structure", allowSynthetic: false } as const;
    expect(retrieveCreativeMemory(entries, query)).toEqual(retrieveCreativeMemory(entries, query));
  });
});

describe("brief lines", () => {
  it("returns nothing at all when memory has nothing to say", () => {
    const empty = retrieveCreativeMemory([], { kind: "visual-mechanism", allowSynthetic: false });
    expect(briefLinesFromMemory(empty)).toEqual([]);
  });

  it("omits weightless entries rather than padding the brief with them", () => {
    const unknownOnly = retrieveCreativeMemory(
      [entry({ outcome: { state: "unknown", reason: "never published" }, evidenceStrength: "insufficient" })],
      { kind: "explanatory-structure", allowSynthetic: false },
    );
    expect(briefLinesFromMemory(unknownOnly)).toEqual([]);
  });
});
