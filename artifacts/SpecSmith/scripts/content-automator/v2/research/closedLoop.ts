// The closed loop: question -> evidence -> claims -> contract -> gate.
import { atomizeClaim } from "./claims.ts";
import { buildFixtureClaims, buildFixtureIngestionDocument, fixtureStances } from "./engineeringFixture.ts";
import { ingestResearchEvidence } from "./ingestion.ts";
import { runResearchPass, type ResearchResult } from "./researchPass.ts";
import type { EvidenceFinding } from "./creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "./strictEvidenceGate.ts";
import type { AtomicClaim, ResearchQuestion } from "./model.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

export interface ClosedLoopResult {
  readonly result: ResearchResult;
  readonly claims: readonly AtomicClaim[];
  readonly findings: readonly EvidenceFinding[];
  readonly worked: { readonly source: string; readonly observation: string; readonly claim: string; readonly verdict: string };
}

export function runResearchClosedLoop(input: { readonly storyboard: PlatformScriptStoryboard; readonly now: Date }): ClosedLoopResult {
  const { now, storyboard } = input;
  const questionId = "q-gpu-a-upgrade";
  const question: ResearchQuestion = {
    questionId,
    question: "Is Example GPU-A a meaningfully better buy than GPU-B at 1440p?",
    purpose: "Decide whether a comparison hook can be stated as fact or must be softened.",
    informsDecision: "hook-family-selection",
    claimKind: "comparison",
    risk: "high",
    acceptableUncertainty: "likely",
    subjectIds: ["example-gpu-a", "example-gpu-b"],
    configuration: { gpu: "Example GPU-A", formFactor: "desktop", gameId: "example-game", resolution: "1440p" },
  };
  const document = buildFixtureIngestionDocument({ now });
  const ingested = ingestResearchEvidence(document, { allowSynthetic: true });
  const fixture = buildFixtureClaims(questionId, now);
  const claims = atomizeClaim({ questionId, statement: fixture.compoundStatement, defaultKind: "comparison", subjectIds: fixture.subjectIds, configuration: fixture.configuration, provenance: fixture.provenance, idPrefix: "claim" });
  const find = (kind: AtomicClaim["kind"]) => claims.find((claim) => claim.kind === kind)?.claimId ?? claims[0].claimId;
  const stances = fixtureStances({ vram: find("specification"), comparison: find("comparison"), price: find("current-price") });
  const result = runResearchPass({ researchId: "research-fixture-1", question, claims, snapshots: ingested.snapshots, observations: ingested.observations, stances, startedAt: now, now, duplicatesSkipped: ingested.duplicatesSkipped });
  const findings = checkScriptAgainstResearchStrict(storyboard, result.contract);
  const comparisonClaim = claims.find((claim) => claim.kind === "comparison");
  const comparisonVerdict = comparisonClaim ? result.confidence.get(comparisonClaim.claimId) : undefined;
  return { result, claims, findings, worked: {
    source: "snap-review-laptop — Example Review Lab, an independent benchmark, read directly (a genuinely strong source).",
    observation: 'obs-laptop-bench — "Example GPU-A Laptop GPU averaged 71 fps" at 1440p/high on game version 1.4.',
    claim: comparisonClaim?.proposition ?? "(no comparison claim)",
    verdict: comparisonVerdict ? `${comparisonVerdict.state} — ${comparisonVerdict.detractors.join(" ")}` : "(not assessed)",
  } };
}

export function formatEvidenceFindings(findings: readonly EvidenceFinding[]): string {
  if (findings.length === 0) return "  no evidence contradictions found in the generated copy";
  return findings.map((finding) => `  ${finding.severity} ${finding.code} @ ${finding.location}: ${finding.message}`).join("\n");
}
