/** Generator-driven proposal/revision orchestration. No implicit provider, key,
 * network request, spending or approval. A caller must supply the generator. */
import { createHash } from "node:crypto";
import { CREATIVE_DISCLOSURES, type CreativeConcept } from "./concept.ts";
import { UNSAFE_FOR_CREATIVE } from "../research/model.ts";
import { runCreativeProposalPass, type CreativeMissionInput } from "./proposalPass.ts";
import { CREATIVE_GENERATOR_INSTRUCTIONS } from "./instructions.ts";
import { buildCreativeBrief, buildRevisionFeedback, feedbackExpectationsFor, outstandingFindings } from "./fileWorkflow.ts";

export { CREATIVE_GENERATOR_INSTRUCTIONS };

export interface CreativeGeneratorRequest {
  readonly instructions: string;
  readonly brief: string;
  readonly attempt: number;
  readonly previous: readonly CreativeConcept[];
  readonly feedback: readonly string[];
  readonly signal: AbortSignal;
}
export interface CreativeGenerator {
  readonly name: string;
  /** Untrusted output; it must pass the same evidence and production checks. */
  generate(request: CreativeGeneratorRequest): Promise<readonly CreativeConcept[]>;
}


export async function runCreativeGenerationPass(
  input: Omit<CreativeMissionInput, "concepts">,
  generator?: CreativeGenerator,
  options: { readonly maxAttempts?: number; readonly timeoutMs?: number } = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid bounded creative generation budget.");
  const baseline = runCreativeProposalPass({ ...input, concepts: [] }); // validates mission/provenance without using templates
  const history: { attempt: number; generator: string; inputHash: string; outputHash?: string; feedback: string[] }[] = [];
  // The same rule the proposal pass applies: a claim is usable only if it has
  // evidence AND reached a state that may be said. Snapshot ids on an unsafe
  // claim are not a grounded answer.
  if (!input.research.safeClaims.some((claim) => !UNSAFE_FOR_CREATIVE.includes(claim.state) && claim.supportingSnapshotIds.length > 0)) {
    return { status: "blocked-evidence" as const, result: baseline, history, reason: "Research has not approved a grounded answer; no generator called." };
  }
  if (!generator) return { status: "blocked-generator" as const, result: baseline, history, reason: "No text generator configured. Templates are not substituted." };
  const brief = JSON.stringify({ missionId: input.missionId, viewerQuestion: input.viewerQuestion,
    platform: input.platform, destination: input.productDestination, renderRequest: input.renderRequest,
    additionalViews: input.additionalViews ?? [],
    research: input.research, memory: baseline.retrieved.observations, disclosures: CREATIVE_DISCLOSURES,
    availableCapabilities: ["render.compare-surface-capture"],
    constraints: ["Human review required; integrity checks do not prove semantic originality or factual completeness."] });
  // The same brief and checks the file workflow applies. The proposal pass's
  // own eligibility is not the whole verdict: the workflow's checks and
  // MASTER #1's storyboard review decide whether anything is ready for review.
  const workflowBrief = buildCreativeBrief(input, []);
  let previous: readonly CreativeConcept[] = [];
  let feedback: string[] = [];
  let result = baseline;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inputHash = createHash("sha256").update(JSON.stringify({ brief, previous, feedback })).digest("hex");
    const record: (typeof history)[number] = { attempt, generator: generator.name, inputHash, feedback: [] };
    history.push(record);
    try {
      const raw = await Promise.race([
        generator.generate({ instructions: CREATIVE_GENERATOR_INSTRUCTIONS, brief, attempt,
          previous: structuredClone(previous), feedback: [...feedback], signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Generator timed out.")); }, timeoutMs); }),
      ]);
      if (!Array.isArray(raw) || raw.length !== 3 || new Set(raw.map((concept) => concept?.conceptId)).size !== 3) {
        throw new Error("Generator must return exactly three uniquely identified concepts.");
      }
      previous = structuredClone(raw);
      record.outputHash = createHash("sha256").update(JSON.stringify(previous)).digest("hex");
      result = runCreativeProposalPass({ ...input, concepts: previous });
      feedback = result.proposals.flatMap((proposal) => [
        ...proposal.critique.findings.map((finding) => `${proposal.concept.conceptId}: ${finding.code}: ${finding.detail}`),
        ...proposal.evidenceFindings.filter((finding) => finding.severity === "hard-fail").map((finding) => `${proposal.concept.conceptId}: ${finding.message}`),
        ...(!proposal.contractEligible ? [`${proposal.concept.conceptId}: not contract eligible; check factual claim bindings, exact capture state, destination and set divergence.`] : []),
      ]);
      const workflow = buildRevisionFeedback(attempt, workflowBrief.briefHash, "checking", "", result, feedbackExpectationsFor(workflowBrief));
      feedback = [...feedback, ...workflow.setFindings,
        ...workflow.concepts.flatMap((concept) => [...concept.required, ...concept.missionBlockers, ...concept.blockedOutsideAuthor]
          .map((item) => `${concept.conceptId}: ${item}`))];
      // `every` is true of an empty list: review-ready needs three checked proposals.
      if (result.proposals.length === 3 && result.proposals.every((proposal) => proposal.contractEligible) && outstandingFindings(workflow) === 0) {
        return { status: "awaiting-human-review" as const, result, history, reason: "Three generator-authored treatments passed the #6 workflow checks and MASTER #1's storyboard review; no creative score, rendered-media approval or publishing permission is inferred." };
      }
    } catch (error) {
      feedback = [error instanceof Error ? error.message : "Generator returned invalid output."];
      result = baseline; // never retain an earlier passing selection after an invalid revision
    } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
    record.feedback = [...feedback];
  }
  return { status: "blocked-revision" as const, result: { ...result, selected: null }, history,
    reason: "Bounded revision budget exhausted; unresolved concepts preserved for review, not approved." };
}
