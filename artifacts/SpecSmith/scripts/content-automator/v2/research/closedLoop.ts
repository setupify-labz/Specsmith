// The closed loop: question -> evidence -> claims -> contract -> gate.
//
// This is the real caller that makes every research module load-bearing rather
// than a set of interfaces nothing invokes. It walks the whole canonical chain
// on the engineering fixture and hands back both the RESEARCH_RESULT and the
// findings the Creative Director gate produces against a real storyboard.
//
// WHY IT RUNS ON FIXTURE EVIDENCE AND SAYS SO LOUDLY
// ---------------------------------------------------
// The evidence is synthetic (see engineeringFixture.ts) because this branch has
// no autonomous web access and fabricating plausible research would be worse
// than having none. `containsSyntheticEvidence` travels on the result, the
// report prints it, and production ingestion would refuse this input outright.
// What is being verified here is the MACHINERY — that a laptop benchmark cannot
// support a desktop claim, that three retellings are one source, that a
// four-day-old price is not current — not any fact about any product.

import { atomizeClaim } from "./claims.ts";
import { buildFixtureClaims, buildFixtureIngestionDocument, fixtureStances } from "./engineeringFixture.ts";
import { ingestResearchEvidence } from "./ingestion.ts";
import { runResearchPass, type ResearchResult } from "./researchPass.ts";
import { checkScriptAgainstResearch, type EvidenceFinding } from "./creativeContract.ts";
import type { AtomicClaim, ResearchQuestion } from "./model.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

export interface ClosedLoopResult {
  readonly result: ResearchResult;
  readonly claims: readonly AtomicClaim[];
  /** Findings against the storyboard the pipeline actually generated. */
  readonly findings: readonly EvidenceFinding[];
  /** A worked example of the chain, for the report. */
  readonly worked: {
    readonly source: string;
    readonly observation: string;
    readonly claim: string;
    readonly verdict: string;
  };
}

/**
 * Runs the whole chain.
 *
 * `allowSynthetic` is true here and ONLY here: this is the engineering path.
 * Every production caller passes false, and a synthetic record then refuses to
 * load rather than being quietly filtered out.
 */
export function runResearchClosedLoop(input: {
  readonly storyboard: PlatformScriptStoryboard;
  readonly now: Date;
}): ClosedLoopResult {
  const { now, storyboard } = input;
  const questionId = "q-gpu-a-upgrade";

  // 1. The question. Explicit, with the decision it informs and the uncertainty
  //    that would be acceptable — research with no decision attached is a hobby.
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

  // 2. Evidence, through the REAL strict parser. A fixture that bypassed the
  //    parser would not demonstrate that the parser works.
  const document = buildFixtureIngestionDocument({ now });
  const ingested = ingestResearchEvidence(document, { allowSynthetic: true });

  // 3. Atomization. The compound statement becomes independent claims, each
  //    free to reach a different verdict on its own evidence.
  const fixture = buildFixtureClaims(questionId, now);
  const claims = atomizeClaim({
    questionId,
    statement: fixture.compoundStatement,
    defaultKind: "comparison",
    subjectIds: fixture.subjectIds,
    configuration: fixture.configuration,
    provenance: fixture.provenance,
    idPrefix: "claim",
  });

  const find = (kind: AtomicClaim["kind"]) => claims.find((claim) => claim.kind === kind)?.claimId ?? claims[0].claimId;
  const stances = fixtureStances({
    vram: find("specification"),
    comparison: find("comparison"),
    price: find("current-price"),
  });

  // 4. The pass: assessment, applicability, freshness, corroboration, conflict,
  //    confidence, stopping decision, and the creative contract.
  const result = runResearchPass({
    researchId: "research-fixture-1",
    question,
    claims,
    snapshots: ingested.snapshots,
    observations: ingested.observations,
    stances,
    startedAt: now,
    now,
    duplicatesSkipped: ingested.duplicatesSkipped,
  });

  // 5. The gate. This is the consumer: the contract is checked against the real
  //    storyboard the pipeline generated, not against a sample.
  const findings = checkScriptAgainstResearch(storyboard, result.contract);

  const comparisonClaim = claims.find((claim) => claim.kind === "comparison");
  const comparisonVerdict = comparisonClaim
    ? result.confidence.get(comparisonClaim.claimId)
    : undefined;

  return {
    result,
    claims,
    findings,
    worked: {
      source: "snap-review-laptop — Example Review Lab, an independent benchmark, read directly (a genuinely strong source).",
      observation: 'obs-laptop-bench — "Example GPU-A Laptop GPU averaged 71 fps" at 1440p/high on game version 1.4.',
      claim: comparisonClaim?.proposition ?? "(no comparison claim)",
      verdict: comparisonVerdict
        ? `${comparisonVerdict.state} — ${comparisonVerdict.detractors.join(" ")}`
        : "(not assessed)",
    },
  };
}

/** Renders the gate findings for a terminal. */
export function formatEvidenceFindings(findings: readonly EvidenceFinding[]): string {
  if (findings.length === 0) return "  no evidence contradictions found in the generated copy";
  return findings
    .map((finding) => `  ${finding.severity} ${finding.code} @ ${finding.location}: ${finding.message}`)
    .join("\n");
}
