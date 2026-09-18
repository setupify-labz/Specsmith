// MASTER #4 — Audience boundary tests.
//
// The property under test throughout: the system cannot describe a person it
// has not observed. Every assertion that something is `unknown` is an assertion
// that no persona was invented to fill the gap.

import { describe, expect, it } from "vitest";

import {
  AudienceStateError,
  buildHeld,
  stateIsReliable,
  unknownDemographics,
  unknownHeld,
} from "./model.ts";
import {
  AudienceIngestionError,
  parseAudienceSignalBundle,
  signalsForDimension,
  unavailableAudienceSignals,
} from "./signals.ts";
import {
  asObserved,
  detectAmbiguity,
  expertiseFromPhrasing,
  generateParaphrases,
  LanguageProvenanceError,
  normalizeIntent,
  observedPhrases,
  terminologyRequiringExplanation,
} from "./language.ts";
import {
  AudienceHypothesisRegistry,
  HypothesisIntegrityError,
  hypothesisKnowledgeState,
  proposeAudienceHypothesis,
  updateAudienceHypothesis,
} from "./hypotheses.ts";
import {
  fixtureDemographicClaim,
  fixtureNoAudienceSignals,
  fixtureObservedAudience,
  fixtureZeroSampleSize,
} from "../delivery/engineeringFixture.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;
const PRODUCTION = { allowSynthetic: false } as const;

describe("a value cannot be stated without saying how it is known", () => {
  it("refuses a value in a state that carries none", () => {
    expect(() => buildHeld({ value: "beginner", state: "unknown", basis: "I reckon so" }))
      .toThrow(/carries no value/);
  });

  it("refuses an unknown that secretly holds a value", () => {
    expect(() => buildHeld({ value: "beginner", state: "unknown", basis: "a sufficiently long basis" }))
      .toThrow(AudienceStateError);
  });

  it("refuses an observation that cites no signal", () => {
    expect(() => buildHeld({ value: "beginner", state: "observed", basis: "everyone knows this" }))
      .toThrow(/observation with no signal is an invention/);
  });

  it("refuses a conflict backed by a single signal", () => {
    expect(() => buildHeld({ value: "mixed", state: "conflicting", signalIds: ["s1"], basis: "these disagree somehow" }))
      .toThrow(/one signal cannot conflict with itself/);
  });

  it("refuses a value with no auditable basis", () => {
    expect(() => buildHeld({ value: "beginner", state: "known", basis: "yes" })).toThrow(/basis an auditor can check/);
  });

  it("accepts an observation that cites its signal", () => {
    const held = buildHeld({ value: "beginner", state: "observed", signalIds: ["sig-1"], basis: "Observed in tool usage data." });
    expect(held.value).toBe("beginner");
    expect(held.signalIds).toEqual(["sig-1"]);
  });

  it("treats only known, observed and supported-inference as reliable", () => {
    expect(stateIsReliable("known")).toBe(true);
    expect(stateIsReliable("observed")).toBe(true);
    expect(stateIsReliable("supported-inference")).toBe(true);
    expect(stateIsReliable("hypothesis")).toBe(false);
    expect(stateIsReliable("unknown")).toBe(false);
  });
});

describe("demographics stay unknown", () => {
  it("reports every demographic dimension as unknown with a reason", () => {
    const demographics = unknownDemographics();
    for (const [name, held] of Object.entries(demographics)) {
      expect(held.state, name).toBe("unknown");
      expect(held.value, name).toBeNull();
      expect(held.basis).toMatch(/persona, not an audience/);
    }
  });

  it("refuses a signal that claims to establish an age from behaviour", () => {
    expect(() => parseAudienceSignalBundle(fixtureDemographicClaim(NOW), ENGINEERING))
      .toThrow(/cannot establish a demographic fact/);
  });
});

describe("nothing connected means unknown, never a default", () => {
  const empty = unavailableAudienceSignals(NOW.toISOString());

  it("reports an unobserved dimension as unknown and explains why", () => {
    const lookup = signalsForDimension(empty, "expertise", NOW);
    expect(lookup.state).toBe("unknown");
    expect(lookup.signals).toEqual([]);
    expect(lookup.explanation).toMatch(/unobserved, not absent/);
  });

  it("lists every source family as unavailable so the absence is on the record", () => {
    expect(empty.unavailableFamilies.length).toBeGreaterThan(10);
    expect(empty.provenance.synthetic).toBe(false);
  });
});

describe("impossible audience signals are refused, not repaired", () => {
  it("refuses a sample size of zero, because zero is a measurement", () => {
    expect(() => parseAudienceSignalBundle(fixtureZeroSampleSize(NOW), ENGINEERING))
      .toThrow(/unknown is not zero/);
  });

  it("keeps an unreported sample size as null rather than zero", () => {
    const raw = fixtureNoAudienceSignals(NOW) as Record<string, unknown>;
    const withSignal = {
      ...raw,
      signals: [{
        signalId: "s1", sourceFamily: "community-discussion", sourceReference: "https://example.invalid/x",
        capturedAt: NOW.toISOString(), observedAt: null, scope: "fictional", sampleSize: null,
        limitations: [], evidenceState: "observed", dimensions: ["objection"], observation: "an objection",
      }],
    };
    const bundle = parseAudienceSignalBundle(withSignal, ENGINEERING);
    expect(bundle.signals[0].sampleSize).toBeNull();
  });

  it("refuses an observation made after it was captured", () => {
    const raw = fixtureNoAudienceSignals(NOW) as Record<string, unknown>;
    const impossible = {
      ...raw,
      signals: [{
        signalId: "s1", sourceFamily: "community-discussion", sourceReference: "https://example.invalid/x",
        capturedAt: NOW.toISOString(), observedAt: "2027-01-01T00:00:00.000Z", scope: "fictional", sampleSize: 5,
        limitations: [], evidenceState: "observed", dimensions: ["objection"], observation: "an objection",
      }],
    };
    expect(() => parseAudienceSignalBundle(impossible, ENGINEERING)).toThrow(/observed after it was captured/);
  });

  it("refuses a duplicate signal id rather than deduplicating by guess", () => {
    const raw = fixtureNoAudienceSignals(NOW) as Record<string, unknown>;
    const signal = {
      signalId: "same", sourceFamily: "community-discussion", sourceReference: "https://example.invalid/x",
      capturedAt: NOW.toISOString(), observedAt: null, scope: "fictional", sampleSize: 5,
      limitations: [], evidenceState: "observed", dimensions: ["objection"], observation: "an objection",
    };
    expect(() => parseAudienceSignalBundle({ ...raw, signals: [signal, { ...signal, observation: "different" }] }, ENGINEERING))
      .toThrow(/appears twice/);
  });

  it("refuses an unrecognised evidence state rather than defaulting it", () => {
    const raw = fixtureNoAudienceSignals(NOW) as Record<string, unknown>;
    expect(() => parseAudienceSignalBundle({
      ...raw,
      signals: [{
        signalId: "s1", sourceFamily: "community-discussion", sourceReference: "https://example.invalid/x",
        capturedAt: NOW.toISOString(), observedAt: null, scope: "fictional", sampleSize: 5,
        limitations: [], evidenceState: "pretty-sure", dimensions: ["objection"], observation: "an objection",
      }],
    }, ENGINEERING)).toThrow(AudienceIngestionError);
  });
});

describe("the synthetic audience boundary", () => {
  it("accepts a fixture bundle in the engineering environment", () => {
    expect(parseAudienceSignalBundle(fixtureNoAudienceSignals(NOW), ENGINEERING).provenance.synthetic).toBe(true);
  });

  it("refuses the same bundle in production, by name", () => {
    expect(() => parseAudienceSignalBundle(fixtureNoAudienceSignals(NOW), PRODUCTION))
      .toThrow(/may never become observed audience evidence in production/);
  });

  it("refuses a bundle that does not say whether it is synthetic", () => {
    const raw = { ...(fixtureNoAudienceSignals(NOW) as Record<string, unknown>), provenance: { producedBy: "x", producedAt: NOW.toISOString() } };
    expect(() => parseAudienceSignalBundle(raw, ENGINEERING)).toThrow(/must be an explicit boolean/);
  });
});

describe("observed language and generated paraphrase never mix", () => {
  const bundle = parseAudienceSignalBundle(fixtureObservedAudience(NOW), ENGINEERING);

  it("reads observed phrases with their originating signal", () => {
    const phrases = observedPhrases(bundle);
    expect(phrases.length).toBe(2);
    expect(phrases.every((phrase) => phrase.origin === "observed")).toBe(true);
    expect(phrases.every((phrase) => phrase.signalId !== "")).toBe(true);
  });

  it("refuses to treat a generated paraphrase as user language", () => {
    const [paraphrase] = generateParaphrases("is example gpu-a enough", "vary the hook", ["will this card hold up"]);
    expect(() => asObserved(paraphrase)).toThrow(LanguageProvenanceError);
    expect(() => asObserved(paraphrase)).toThrow(/never be represented as the language an audience actually used/);
  });

  it("gives a generated paraphrase no frequency, because nobody said it", () => {
    const [paraphrase] = generateParaphrases("base", "reason", ["variant"]);
    expect(paraphrase.frequency).toBeNull();
    expect(paraphrase.origin).toBe("generated");
  });

  it("passes an observed phrase through asObserved unchanged", () => {
    const phrase = observedPhrases(bundle)[0];
    expect(asObserved(phrase)).toBe(phrase);
  });

  it("classifies intent deterministically from real phrasing", () => {
    expect(normalizeIntent("example gpu-a vs example gpu-b")).toBe("comparison");
    expect(normalizeIntent("why is my fps low")).toBe("troubleshooting");
    expect(normalizeIntent("is example gpu-a worth upgrading to")).toBe("purchasing-research");
    expect(normalizeIntent("what is vram")).toBe("informational");
  });

  it("infers expertise only from phrasing that actually implies it", () => {
    expect(expertiseFromPhrasing("what is vram")).toBe("beginner");
    expect(expertiseFromPhrasing("curve optimizer negative offset")).toBe("advanced");
    expect(expertiseFromPhrasing("example gpu-a benchmark")).toBe("unknown");
  });

  it("flags genuinely ambiguous wording instead of answering the wrong question", () => {
    expect(detectAmbiguity("will this bottleneck")).toMatch(/two need different answers/);
    expect(detectAmbiguity("is example gpu-a enough")).toMatch(/undefined without a resolution/);
    expect(detectAmbiguity("what is vram")).toBeNull();
  });

  it("marks terminology from non-expert phrasing as needing explanation", () => {
    const terms = terminologyRequiringExplanation(observedPhrases(bundle));
    expect(terms).toContain("vram");
    expect(terms).toContain("1440p");
  });
});

describe("audience hypotheses stay hypotheses", () => {
  const valid = {
    hypothesisId: "hyp-1",
    proposition: "Beginners grasp the comparison faster when the result comes first.",
    whyBelieved: "A decision-maker needs the outcome before the mechanism.",
    uncertainty: "Untested; the opposite is equally arguable.",
    audienceScope: "Beginners on short-form vertical video.",
    creativeImplication: "Put the result before the explanation.",
    falsificationCondition: "Result-first cuts retain no better than mechanism-first cuts.",
    measurementRequirement: "Matched creative pairs with retention curves for both.",
    now: NOW,
    synthetic: true,
    producedBy: "test",
  };

  it("is born untested", () => {
    expect(proposeAudienceHypothesis(valid).status).toBe("untested");
    expect(proposeAudienceHypothesis(valid).measurementRef).toBeNull();
  });

  it("refuses a hypothesis that cannot be proven wrong", () => {
    expect(() => proposeAudienceHypothesis({ ...valid, falsificationCondition: "nope" }))
      .toThrow(/cannot be proven wrong is not a hypothesis/);
  });

  it("refuses a hypothesis with no measurement requirement", () => {
    expect(() => proposeAudienceHypothesis({ ...valid, measurementRequirement: "somehow" }))
      .toThrow(HypothesisIntegrityError);
  });

  it("refuses a hypothesis that says nothing about creative", () => {
    expect(() => proposeAudienceHypothesis({ ...valid, creativeImplication: "n/a" }))
      .toThrow(/cannot justify any adaptation/);
  });

  it("refuses a measured status without a measurement reference", () => {
    const hypothesis = proposeAudienceHypothesis(valid);
    expect(() => updateAudienceHypothesis(hypothesis, { status: "supported-by-measurement", now: NOW }))
      .toThrow(/does not become a finding because it was used a few times/);
  });

  it("accepts a measured status when a measurement is cited", () => {
    const hypothesis = proposeAudienceHypothesis(valid);
    const updated = updateAudienceHypothesis(hypothesis, {
      status: "supported-by-measurement",
      measurementRef: "experiment-42",
      now: NOW,
    });
    expect(updated.status).toBe("supported-by-measurement");
    expect(updated.version).toBe(2);
    // Still only a supported inference: the measurement tested the effect, not
    // the mechanism the hypothesis claimed for it.
    expect(hypothesisKnowledgeState(updated)).toBe("supported-inference");
  });

  it("never lets a hypothesis reach the observed state", () => {
    const hypothesis = proposeAudienceHypothesis(valid);
    const statuses = ["untested", "under-measurement", "supported-by-measurement", "contradicted-by-measurement", "inconclusive", "abandoned"] as const;
    for (const status of statuses) {
      const candidate = { ...hypothesis, status, measurementRef: "m-1" };
      expect(hypothesisKnowledgeState(candidate)).not.toBe("observed");
    }
  });

  it("does not let repeated use promote a hypothesis to fact", () => {
    const registry = new AudienceHypothesisRegistry();
    const hypothesis = proposeAudienceHypothesis(valid);
    registry.add(hypothesis);
    // Ten more versions, all still untested. Repetition changes nothing.
    let current = hypothesis;
    for (let index = 0; index < 10; index += 1) {
      current = updateAudienceHypothesis(current, { status: "untested", now: NOW });
      registry.add(current);
    }
    expect(registry.current("hyp-1")?.status).toBe("untested");
    expect(hypothesisKnowledgeState(registry.current("hyp-1")!)).toBe("hypothesis");
    expect(registry.testable()).toHaveLength(1);
  });

  it("refuses to rewrite history", () => {
    const registry = new AudienceHypothesisRegistry();
    const hypothesis = proposeAudienceHypothesis(valid);
    registry.add(hypothesis);
    expect(() => registry.add(hypothesis)).toThrow(/History is not rewritten/);
    expect(registry.history("hyp-1")).toHaveLength(1);
  });
});

describe("unknownHeld", () => {
  it("produces a null value with a recorded reason", () => {
    const held = unknownHeld<string>("Nobody looked, and nothing here may pretend otherwise.");
    expect(held.value).toBeNull();
    expect(held.state).toBe("unknown");
    expect(held.signalIds).toEqual([]);
  });
});
