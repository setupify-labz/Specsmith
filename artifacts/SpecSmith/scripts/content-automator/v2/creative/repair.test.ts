import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordCreativeDecision, retrieveCreativeMemory, type CreativeEvidenceSource } from "./memory.ts";
import { CreativeMemoryStore } from "./memoryStore.ts";
import { runCreativeProposalPass, buildCreativeProposalProductionPlan } from "./proposalPass.ts";
import { assessConcept, CREATIVE_DISCLOSURES, toStoryboardBeats } from "./concept.ts";
import { PACKAGE_CROSSOVER, AVAILABLE_CAPABILITIES } from "./sectionOnePackages.ts";
import { runExperimentPass } from "../experiment/experimentPass.ts";
import { registerExperiment } from "../experiment/registry.ts";
import { AssignmentLedger } from "../experiment/assignment.ts";
import { buildObservation } from "../experiment/observation.ts";
import { fixtureCleanExperiment, fixtureControlAnalytics, fixtureVariantAnalytics, fixtureCleanShippedFacts,
  fixtureLineage, fixtureGuardrailsPassing, FIXTURE_IDS, FIXTURE_SHAS, FIXTURE_PUBLISHED_AT } from "../experiment/engineeringFixture.ts";
import { surveySeparability } from "./separability.ts";
import { assessDivergence } from "./divergence.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";

const NOW = new Date("2026-09-15T12:00:00Z");
function source(): CreativeEvidenceSource {
  const definition = fixtureCleanExperiment(NOW);
  const registered = registerExperiment({ ...definition, variants: definition.variants.map((variant) => variant.isControl ? variant : {
    ...variant, differences: [{ ...variant.differences[0], dimension: "before-after-structure", control: "prediction-then-reveal", variant: "question-evidence-boundary" }],
  }) }, NOW);
  const shippedFacts = new Map([...fixtureCleanShippedFacts()].map(([id, facts]) => [id, { ...facts,
    dimensionValues: { "before-after-structure": id === FIXTURE_IDS.controlVariantId ? "prediction-then-reveal" : "question-evidence-boundary" },
  }]));
  const ledger = new AssignmentLedger();
  for (const [variantId, creativeId, lineageId, postId, sha] of [
    [FIXTURE_IDS.controlVariantId, FIXTURE_IDS.controlCreativeId, FIXTURE_IDS.controlLineageId, FIXTURE_IDS.controlPostId, FIXTURE_SHAS.control],
    [FIXTURE_IDS.variantId, FIXTURE_IDS.variantCreativeId, FIXTURE_IDS.variantLineageId, FIXTURE_IDS.variantPostId, FIXTURE_SHAS.variant],
  ]) ledger.bind({ experimentId: FIXTURE_IDS.experimentId, experimentRevision: 1, variantId, creativeId, creativeLineageId: lineageId,
    platform: "youtube-shorts", packageId: FIXTURE_IDS.packageId, approvedMediaSha256: sha, providerPostId: postId,
    publishedAt: FIXTURE_PUBLISHED_AT, now: new Date("2026-08-31T12:00:00Z") });
  const observations = [fixtureControlAnalytics(), fixtureVariantAnalytics()].map((analytics) => buildObservation({
    analytics, assignment: ledger.forCreative(analytics.creativeId)!, expectedWindow: "24h", synthetic: true,
    environment: { allowSynthetic: true }, now: NOW, producedBy: "SYNTHETIC_ENGINEERING_FIXTURE" }));
  const result = runExperimentPass({ experiment: registered.experiment, preregistration: registered.preregistration,
    assignments: ledger.all(), observations, lineage: fixtureLineage(), shippedFacts,
    guardrailResults: fixtureGuardrailsPassing(), replications: [{ originalExperimentId: FIXTURE_IDS.experimentId,
      replicationExperimentId: "SYNTHETIC_ENGINEERING_FIXTURE-independent", kind: "exact", agrees: true,
      extendsScope: false, explanation: "Engineering fixture only" }], conflictingExperimentIds: [], supportingExperimentIds: [],
    daysRunning: 2, unresolvedHypotheses: 1, synthetic: true, now: NOW, producedBy: "SYNTHETIC_ENGINEERING_FIXTURE" });
  return { experiment: registered.experiment, result };
}
function record(evidenceSource = source()) {
  return recordCreativeDecision({ entryId: "SYNTHETIC_ENGINEERING_FIXTURE-memory", conceptId: "fixture-concept",
    decision: { kind: "explanatory-structure", value: "question-evidence-boundary" },
    outcome: { state: "measured", experimentId: evidenceSource.experiment.experimentId, observation: "Caller text must not be trusted" },
    evidenceStrength: evidenceSource.result.interpretation!.evidence.strength, synthetic: true, allowSynthetic: true,
    evidenceSource, note: "Fixture only", now: NOW });
}
const research: ResearchCreativeContract = { version: "research-creative-contract-v1", questionId: "fixture-question", generatedAt: NOW.toISOString(),
  safeClaims: [{ claimId: "fixture-known-rule", proposition: "These FPS values are model estimates, not measurements.", state: "known",
    requiredWording: ["model estimates"], supportingSnapshotIds: ["SYNTHETIC_ENGINEERING_FIXTURE-snapshot"] }],
  unsafeClaims: [], disputedClaims: [], groundedHookMaterial: [], openQuestions: [], limitations: ["Synthetic test contract"], overallState: "known" };
function mission(memory = [] as ReturnType<typeof record>[], evidenceSource = source()) {
  return { missionId: "fixture-new-mission", viewerQuestion: "What do the numbers on this comparison actually establish?",
    productDestination: "/compare", renderRequest: { captureType: "static", state: { surface: "compare", gpuA: "rtx5060ti", cpuA: "i3-13100f", gpuB: "rtx4060ti", cpuB: "r5-9600x", resolution: "1440p", preset: "high" } },
    research, researchSynthetic: true, allowSynthetic: true, memory, retrieval: { kind: "explanatory-structure" as const, allowSynthetic: true,
      scope: evidenceSource.experiment.scope, evidenceSources: new Map([[evidenceSource.experiment.experimentId, evidenceSource]]) },
    platform: "youtube-shorts" as const };
}

describe("MASTER #6 independent repair", () => {
  it("cannot attach measured evidence to an untested decision or endorse a losing variant", () => {
    const evidenceSource = source();
    expect(() => recordCreativeDecision({ entryId: "mismatch", conceptId: "fixture", decision: { kind: "visual-mechanism", value: "invented" },
      outcome: { state: "measured", experimentId: evidenceSource.experiment.experimentId, observation: "x" },
      evidenceStrength: evidenceSource.result.interpretation!.evidence.strength, synthetic: true, allowSynthetic: true, evidenceSource, note: "", now: NOW })).toThrow(/does not test/);
    const losing = { ...evidenceSource, result: { ...evidenceSource.result, interpretation: { ...evidenceSource.result.interpretation!,
      primaryComparison: { ...evidenceSource.result.interpretation!.primaryComparison, outcome: "control-higher" as const } } } };
    expect(retrieveCreativeMemory([record(losing)], mission([], losing).retrieval).noGuidanceAvailable).toBe(true);
  });
  it("rejects strength plus arbitrary experiment ID without resolved evidence", () => {
    expect(() => recordCreativeDecision({ entryId: "bad", conceptId: "bad", decision: { kind: "visual-mechanism", value: "anything" },
      outcome: { state: "measured", experimentId: "made-up", observation: "Always use this" }, evidenceStrength: "replicated",
      synthetic: false, note: "", now: NOW })).toThrow(/Missing or invalidated/);
  });
  it("production rejects synthetic source even with a false caller flag", () => {
    const evidenceSource = source();
    expect(() => recordCreativeDecision({ entryId: "bad", conceptId: "bad", decision: { kind: "visual-mechanism", value: "x" },
      outcome: { state: "measured", experimentId: evidenceSource.experiment.experimentId, observation: "x" }, evidenceStrength: "replicated",
      synthetic: false, note: "", now: NOW, evidenceSource })).toThrow(/Synthetic experiment/);
  });
  it("only resolved, exact-scope evidence guides; duplicate results count once", () => {
    const evidenceSource = source(); const entry = record(evidenceSource); const input = mission([entry, { ...entry, entryId: "replay" }], evidenceSource);
    const result = retrieveCreativeMemory(input.memory, input.retrieval);
    expect(result.observations).toHaveLength(1); expect(result.observations[0].usage).toBe("guidance");
    expect(result.observations[0].phrasing).not.toContain("Caller text");
  });
  it.each(["platform", "topicFamily", "audienceProfileId", "objective", "missionFamily"] as const)("rejects %s scope expansion", (field) => {
    const evidenceSource = source(); const input = mission([record(evidenceSource)], evidenceSource);
    const query = { ...input.retrieval, scope: { ...input.retrieval.scope, [field]: "different" } } as typeof input.retrieval;
    expect(retrieveCreativeMemory(input.memory, query).observations).toEqual([]);
  });
  it("withdrawn, missing, changed and tampered evidence cannot guide", () => {
    const evidenceSource = source(); const entry = record(evidenceSource); const input = mission([entry], evidenceSource);
    for (const altered of [{ ...evidenceSource, invalidated: true }, { ...evidenceSource, result: { ...evidenceSource.result, resultHash: "superseded" } }]) {
      expect(retrieveCreativeMemory([entry], { ...input.retrieval, evidenceSources: new Map([[evidenceSource.experiment.experimentId, altered]]) }).noGuidanceAvailable).toBe(true);
    }
    expect(retrieveCreativeMemory([entry], { kind: "explanatory-structure", allowSynthetic: true }).noGuidanceAvailable).toBe(true);
    expect(retrieveCreativeMemory([{ ...entry, outcome: { state: "measured", experimentId: evidenceSource.experiment.experimentId, observation: "Always do this" } }], input.retrieval).noGuidanceAvailable).toBe(true);
  });
  it("tampered process records cannot become guidance on reload", () => {
    const entry = recordCreativeDecision({ entryId: "process", conceptId: "process", decision: { kind: "visual-mechanism", value: "x" },
      outcome: { state: "process", observation: "One internal observation" }, evidenceStrength: "anecdotal", synthetic: false, note: "", now: NOW });
    const forged = { ...entry, evidenceStrength: "replicated" as const, memoryAction: "store-as-replicated" };
    expect(retrieveCreativeMemory([forged], { kind: "visual-mechanism", allowSynthetic: false }).noGuidanceAvailable).toBe(true);
  });
  it("wrong disclosure and trailing-only disclosure cannot clear the estimate gate", () => {
    const input = { concept: PACKAGE_CROSSOVER, availableCapabilityIds: AVAILABLE_CAPABILITIES,
      guaranteedDisclosureIds: ["disclosure.editorial-price"] };
    expect(assessConcept(input).producible).toBe(false);
    expect(assessConcept({ ...input, guaranteedDisclosureIds: Object.keys(CREATIVE_DISCLOSURES),
      concept: { ...PACKAGE_CROSSOVER, disclosureTextByBeat: { 5: Object.values(CREATIVE_DISCLOSURES) } } }).producible).toBe(false);
    expect(toStoryboardBeats(PACKAGE_CROSSOVER)[0].onScreenText).toContain(CREATIVE_DISCLOSURES["disclosure.fps-estimate"]);
  });
  it("empty-memory new missions generate structurally different, evidence-gated storyboards", () => {
    const result = runCreativeProposalPass(mission());
    expect(result.proposals).toHaveLength(3); expect(assessDivergence(result.proposals.map((entry) => entry.concept)).divergent).toBe(true);
    expect(result.selected).not.toBeNull(); expect(result.selected!.reviewRequired).toBe(true);
    const changed = runCreativeProposalPass({ ...mission(), missionId: "other", viewerQuestion: "What is uncertain in my comparison?" });
    expect(changed.proposals[0].storyboard.beats[0].narration).not.toBe(result.proposals[0].storyboard.beats[0].narration);
  });
  it("changing axis labels cannot pass an identical script as a fresh treatment", () => {
    const relabeled = { ...PACKAGE_CROSSOVER, conceptId: "relabeled", viewerTakeaway: "Something else",
      axes: { audienceExperience: "investigator" as const, explanatoryStructure: "question-evidence-boundary" as const, visualMechanism: "single-surface-hold" as const } };
    const report = assessDivergence([PACKAGE_CROSSOVER, relabeled]);
    expect(report.divergent).toBe(false);
    expect(report.findings.some((finding) => finding.code === "duplicate-treatment")).toBe(true);
  });
  it("verified memory changes selection, but absent evidence and unsafe claims cannot pass", () => {
    const evidenceSource = source();
    const empty = runCreativeProposalPass(mission([], evidenceSource));
    const informed = runCreativeProposalPass(mission([record(evidenceSource)], evidenceSource));
    expect(empty.selected!.concept.conceptId).not.toBe(informed.selected!.concept.conceptId);
    expect(informed.selected!.concept.axes.explanatoryStructure).toBe("question-evidence-boundary");
    expect(runCreativeProposalPass({ ...mission(), research: { ...research, safeClaims: [] } }).selected).toBeNull();
    const blocked = runCreativeProposalPass({ ...mission(), research: { ...research,
      unsafeClaims: [{ claimId: "bad", proposition: research.safeClaims[0].proposition, state: "unknown", reason: "withdrawn", wouldBecomeSafeIf: [] }] } });
    expect(blocked.selected).toBeNull();
  });
  it("selected package reaches the existing production contract without claiming a render", () => {
    const result = runCreativeProposalPass(mission());
    const plan = buildCreativeProposalProductionPlan({ packageId: "fixture-package", ideaId: "fixture-idea", campaignId: "fixture-campaign",
      feature: "compare", route: "/compare", subjectIds: [] }, result.selected!);
    expect(plan).toBeDefined();
    const visuals = plan.platforms[0].tasks.filter((task) => task.capability === "deterministic-ui-render");
    expect(visuals).toHaveLength(result.selected!.storyboard.beats.length);
    expect(visuals.every((task) => JSON.stringify(task.uiRenderState).includes("i3-13100f"))).toBe(true);
    expect(plan.platforms[0].tasks.some((task) => task.capability === "video-generation")).toBe(false);
  });
  it("rejects synthetic research in production and invalid catalog render states", () => {
    expect(() => runCreativeProposalPass({ ...mission(), allowSynthetic: false })).toThrow(/Synthetic research/);
    expect(() => runCreativeProposalPass({ ...mission(), renderRequest: { state: { surface: "compare", gpuA: "invented-gpu" } } })).toThrow();
  });
  it("immutable store rejects conflicting replay, separates engineering and survives reload", () => {
    const root = mkdtempSync(join(tmpdir(), "specsmith-memory-repair-"));
    try {
      const store = new CreativeMemoryStore(root, true); const evidenceSource = source(); const existing = record(evidenceSource);
      const input = { entryId: existing.entryId, conceptId: existing.conceptId, decision: existing.decision, outcome: existing.outcome,
        evidenceStrength: existing.evidenceStrength, synthetic: true, evidenceSource, note: existing.note, now: NOW };
      store.append(input); store.append(input);
      expect(() => store.append({ ...input, note: "changed" })).toThrow(/Conflicting memory replay/);
      expect(new CreativeMemoryStore(root).load()).toEqual([]);
      const reloaded = new CreativeMemoryStore(root, true).load();
      expect(retrieveCreativeMemory(reloaded, mission([], evidenceSource).retrieval).noGuidanceAvailable).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("unknown ranges cannot support an all-games inseparability conclusion", () => {
    expect(surveySeparability([{ context: "unknown", a: { estimated: NaN, min: 0, max: 1 }, b: { estimated: 1, min: 0, max: 2 } }]).noPointSeparates).toBe(false);
  });
});
