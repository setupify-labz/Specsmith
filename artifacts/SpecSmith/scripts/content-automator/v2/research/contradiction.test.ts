// Evidence that CONTRADICTS a proposition never authorizes that proposition,
// and never silently authorizes its negation either.
//
// Traced through every stage a claim passes on its way to a script:
//   assessConfidence -> buildResearchCreativeContract -> the creative brief's
//   approved claims -> the evidence gate on the script.
//
// Regression: before this fix, a claim whose only applicable evidence
// contradicted it was rated "strongly-supported" (meaning its negation), and
// the contract then listed the claim's own false proposition under safeClaims.
// The real case: "a GPU upgrade helps Valorant more at 4K because the CPU
// matters less there" — false of SpecSmith's model, whose per-game ratio does
// not change with resolution.

import { describe, expect, it } from "vitest";

import { leadsVsAverageFacts, type ComparePairing } from "../../leadsVsAverage/facts.ts";
import { buildCreativeBrief } from "../creative/fileWorkflow.ts";
import { runCreativeProposalPass } from "../creative/proposalPass.ts";
import { CREATIVE_DISCLOSURES, type CreativeConcept } from "../creative/concept.ts";
import { UNSAFE_FOR_CREATIVE, type AtomicClaim, type Observation, type ResearchProvenance, type ResearchQuestion, type SourceSnapshot } from "./model.ts";
import { runResearchPass } from "./researchPass.ts";

const NOW = new Date("2026-10-06T19:30:00.000Z");
const AT = NOW.toISOString();

function pass(input: {
  readonly synthetic: boolean;
  readonly observations: readonly Omit<Observation, "snapshotId" | "observedAt" | "provenance" | "form">[];
  readonly claims: readonly Omit<AtomicClaim, "questionId" | "provenance">[];
  readonly stances: readonly { claimId: string; observationId: string; stance: "supports" | "contradicts" }[];
}) {
  const provenance: ResearchProvenance = { synthetic: input.synthetic, producedBy: input.synthetic ? "test" : "specsmith-runtime", producedAt: AT };
  const snapshot: SourceSnapshot = {
    snapshotId: "specsmith-model-test",
    source: { sourceId: "specsmith-fps-model", sourceType: "first-party-specsmith", publisher: "SpecSmith", url: "https://specsmithpc.com/compare" },
    retrievedAt: AT, retrievalMethod: "specsmith-runtime", contentHash: "f".repeat(64), provenance,
  };
  const question: ResearchQuestion = {
    questionId: "q-contradiction", question: "What does the model estimate?", purpose: "test", informsDecision: "what may be said",
    claimKind: "performance-estimated", risk: "medium", acceptableUncertainty: "strongly-supported", subjectIds: ["valorant"],
  };
  return runResearchPass({
    researchId: "research-contradiction", question,
    claims: input.claims.map((claim) => ({ ...claim, questionId: question.questionId, provenance })),
    snapshots: [snapshot],
    observations: input.observations.map((entry) => ({ ...entry, snapshotId: snapshot.snapshotId, form: "structured-value", observedAt: AT, provenance })),
    stances: input.stances, startedAt: NOW, now: NOW,
  });
}

const valorant = { cpu: "Ryzen 5 7600", gameId: "valorant", resolution: "1440p", preset: "high" };

describe("a contradiction-only claim", () => {
  const result = pass({
    synthetic: true,
    observations: [
      { observationId: "obs-supports", content: "Valorant: 263 -> 305 estimated FPS", fields: { before: 263, after: 305 }, configuration: valorant },
      { observationId: "obs-against", content: "The after/before ratio is 1.16 at 1080p, 1440p and 4K", fields: { ratio1080p: 1.16 }, configuration: { cpu: "Ryzen 5 7600", gameId: "valorant" } },
    ],
    claims: [
      { claimId: "supported", proposition: "In SpecSmith's model estimates Valorant goes from 263 to 305 FPS at 1440p High.", kind: "performance-estimated", risk: "medium", configuration: valorant, subjectIds: ["valorant"] },
      { claimId: "contradicted", proposition: "In SpecSmith's model estimates the upgrade helps Valorant more at 4K than at 1080p.", kind: "performance-estimated", risk: "medium", configuration: { cpu: "Ryzen 5 7600", gameId: "valorant" }, subjectIds: ["valorant"] },
    ],
    stances: [
      { claimId: "supported", observationId: "obs-supports", stance: "supports" },
      { claimId: "contradicted", observationId: "obs-against", stance: "contradicts" },
    ],
  });

  it("is rated a state the creative contract refuses, with the contradiction as the reason", () => {
    const confidence = result.confidence.get("contradicted")!;
    expect(UNSAFE_FOR_CREATIVE).toContain(confidence.state);
    expect(confidence.state).not.toBe("strongly-supported");
    expect(confidence.detractors.join(" ")).toMatch(/contradict/);
    expect(confidence.wouldChangeIfs.join(" ")).toMatch(/negation .* its own claim/i);
  });

  it("stays out of safeClaims and grounded hook material, and no negation is authorized in its place", () => {
    const { contract } = result;
    expect(contract.safeClaims.map((claim) => claim.claimId)).toEqual(["supported"]);
    expect(contract.groundedHookMaterial.map((entry) => entry.claimId)).toEqual(["supported"]);
    expect(contract.unsafeClaims.map((claim) => claim.claimId)).toEqual(["contradicted"]);
    // Nothing safe was manufactured from the contradiction.
    expect(contract.safeClaims.every((claim) => claim.supportingSnapshotIds.length > 0)).toBe(true);
    expect(contract.openQuestions.join(" ")).toMatch(/Contradicted by applicable evidence/);
  });

  it("keeps the supported control safe", () => {
    expect(result.confidence.get("supported")!.state).toBe("strongly-supported");
  });
});

describe("disputed controls", () => {
  it("a numeric conflict between supporting sources stays disputed", () => {
    const result = pass({
      synthetic: true,
      observations: [
        { observationId: "obs-a", content: "305", fields: { after: 305 }, configuration: valorant },
        { observationId: "obs-b", content: "240", fields: { after: 240 }, configuration: valorant },
      ],
      claims: [{ claimId: "conflicted", proposition: "Valorant reaches 305 FPS.", kind: "performance-estimated", risk: "medium", configuration: valorant, subjectIds: ["valorant"] }],
      stances: [
        { claimId: "conflicted", observationId: "obs-a", stance: "supports" },
        { claimId: "conflicted", observationId: "obs-b", stance: "supports" },
      ],
    });
    expect(result.confidence.get("conflicted")!.state).toBe("disputed");
    expect(result.contract.disputedClaims.map((claim) => claim.claimId)).toEqual(["conflicted"]);
    expect(result.contract.safeClaims).toEqual([]);
  });

  it("applicable support and applicable contradiction together are disputed, not averaged into a safe claim", () => {
    const result = pass({
      synthetic: true,
      observations: [
        { observationId: "obs-for", content: "for", configuration: valorant },
        { observationId: "obs-against", content: "against", configuration: valorant },
      ],
      claims: [{ claimId: "mixed", proposition: "The model treats Valorant as GPU-bound.", kind: "specsmith-product", risk: "low", configuration: valorant, subjectIds: ["valorant"] }],
      stances: [
        { claimId: "mixed", observationId: "obs-for", stance: "supports" },
        { claimId: "mixed", observationId: "obs-against", stance: "contradicts" },
      ],
    });
    expect(result.confidence.get("mixed")!.state).toBe("disputed");
    expect(result.contract.disputedClaims.map((claim) => claim.claimId)).toEqual(["mixed"]);
    expect(result.contract.safeClaims).toEqual([]);
  });
});

describe("end to end: the 4K example, computed from the shipped model", () => {
  const pairing: ComparePairing = { gpuA: "rtx5070", cpuA: "r5-7600", gpuB: "rtx4060", cpuB: "r5-7600", resolution: "1440p", preset: "high" };
  const valorantAt = (resolution: ComparePairing["resolution"]) => leadsVsAverageFacts({ ...pairing, resolution }).games.find((game) => game.game === "Valorant")!;
  const at1440 = valorantAt("1440p");
  const ratios = (["1080p", "1440p", "4k"] as const).map((resolution) => { const row = valorantAt(resolution); return Math.round((row.fpsA / row.fpsB) * 100) / 100; });

  const result = pass({
    synthetic: false,
    observations: [
      { observationId: "obs-valorant-1440p", content: `Valorant ${at1440.fpsB} -> ${at1440.fpsA}`, fields: { before: at1440.fpsB, after: at1440.fpsA }, configuration: valorant },
      { observationId: "obs-resolution-invariance", content: `after/before ratio ${ratios.join(", ")} at 1080p, 1440p, 4K`,
        fields: { ratio1080p: ratios[0], ratio1440p: ratios[1], ratio4k: ratios[2] }, configuration: { cpu: "Ryzen 5 7600", gameId: "valorant" } },
    ],
    claims: [
      { claimId: "gpu-upgrade-cpu-heavy-game", proposition: `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, the same upgrade takes Valorant from ${at1440.fpsB} to ${at1440.fpsA} FPS.`,
        kind: "performance-estimated", risk: "medium", configuration: valorant, subjectIds: ["rtx5070", "rtx4060", "r5-7600", "valorant"] },
      { claimId: "cpu-matters-less-at-4k", // Worded around what is distinctive about it. The evidence gate blocks any
        // line repeating a refused claim's distinctive words, so a refused claim
        // phrased with the safe claim's subject ("SpecSmith's model estimates",
        // "Valorant") would also block every honest line about that subject.
        proposition: "A GPU upgrade gains more at 4K than at 1080p because the CPU matters less at higher resolution.",
        kind: "performance-estimated", risk: "medium", configuration: { cpu: "Ryzen 5 7600", gameId: "valorant" }, subjectIds: ["rtx5070", "rtx4060", "r5-7600", "valorant"] },
    ],
    stances: [
      { claimId: "gpu-upgrade-cpu-heavy-game", observationId: "obs-valorant-1440p", stance: "supports" },
      { claimId: "cpu-matters-less-at-4k", observationId: "obs-resolution-invariance", stance: "contradicts" },
    ],
  });

  const mission = {
    missionId: "contradiction-4k-regression",
    viewerQuestion: "Will a new GPU make every game faster by the same amount?",
    productDestination: "/compare",
    renderRequest: { captureType: "static", state: { surface: "compare", ...pairing } },
    research: result.contract,
    researchSynthetic: false,
    allowSynthetic: false,
    memory: [],
    retrieval: { kind: "explanatory-structure" as const, allowSynthetic: false },
    platform: "youtube-shorts" as const,
  };

  it("the model really is resolution-invariant, so the 4K claim is false of it", () => {
    expect([at1440.fpsB, at1440.fpsA]).toEqual([263, 305]);
    expect(new Set(ratios).size).toBe(1);
  });

  it("research refuses the 4K claim and keeps the supported Valorant claim", () => {
    expect(result.containsSyntheticEvidence).toBe(false);
    expect(result.contract.safeClaims.map((claim) => claim.claimId)).toEqual(["gpu-upgrade-cpu-heavy-game"]);
    expect(result.contract.unsafeClaims.map((claim) => claim.claimId)).toEqual(["cpu-matters-less-at-4k"]);
  });

  it("the creative brief does not offer it to an author", () => {
    const brief = buildCreativeBrief(mission, []);
    expect(brief.approvedClaims.map((claim) => claim.claimId)).toEqual(["gpu-upgrade-cpu-heavy-game"]);
    expect(brief.refusedClaims.map((claim) => claim.claimId)).toContain("cpu-matters-less-at-4k");
  });

  it("a script that states it is refused by the evidence gate; the same script without it is not", () => {
    const state = "compare_rtx5070_r5-7600_vs_rtx4060_r5-7600_1440p_high_static_540x960-2";
    const disclosure = CREATIVE_DISCLOSURES["disclosure.fps-estimate"];
    const concept = (conceptId: string, extra: string): CreativeConcept => ({
      conceptId,
      axes: { audienceExperience: "spectator", explanatoryStructure: "linear-demonstration", visualMechanism: "single-surface-hold" },
      viewerQuestion: mission.viewerQuestion, viewerTakeaway: "Gains differ by game.", productDestination: "/compare",
      visuals: [{ kind: "real-product-capture", visualId: "primary", surface: "compare", stateIdentifier: state }],
      requiredCapabilities: [{ capabilityId: "render.compare-surface-capture", description: "Static Compare capture." }],
      requiredDisclosures: ["disclosure.fps-estimate"],
      beats: [
        { purpose: "hook", startSecond: 0, endSecond: 3, narration: "Same CPU, new GPU.", onScreenText: "Same CPU. New GPU.", visualIds: ["primary"], factDependencies: [] },
        { purpose: "evidence", startSecond: 3, endSecond: 10, narration: `In SpecSmith's model estimates, Valorant goes from 263 to 305 estimated FPS.${extra}`,
          onScreenText: "Valorant: 263 → 305 Estimated FPS", visualIds: ["primary"], factDependencies: ["gpu-upgrade-cpu-heavy-game"] },
      ],
      disclosureTextByBeat: { 0: [disclosure], 1: [disclosure] },
    } as unknown as CreativeConcept);
    const { proposals } = runCreativeProposalPass({ ...mission, concepts: [
      concept("states-4k", " A GPU upgrade gains more at 4K, because the CPU matters less at higher resolution."),
      concept("control", ""),
    ] });
    const findings = (id: string) => proposals.find((proposal) => proposal.concept.conceptId === id)!.evidenceFindings.filter((finding) => finding.severity === "hard-fail");
    expect(findings("states-4k").map((finding) => finding.code)).toContain("unsupported-factual-claim");
    expect(findings("states-4k").some((finding) => finding.message.includes("gains more at 4K"))).toBe(true);
    expect(findings("control")).toEqual([]);
  });
});
