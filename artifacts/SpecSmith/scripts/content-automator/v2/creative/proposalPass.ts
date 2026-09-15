/** Mission-driven, deterministic concept planning. This is an editorial scaffold,
 * not an LLM, a proven originality judge or a rendered-video generator. */
import type { PlatformScriptStoryboard } from "../../types.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "../research/strictEvidenceGate.ts";
import { UNSAFE_FOR_CREATIVE } from "../research/model.ts";
import { parseUiRenderRequest, stateIdentifier } from "../../uiRender/uiRenderState.ts";
import { buildProductionPlanPackage } from "../../productionPlan.ts";
import type { ScriptStoryboardPackage } from "../../types.ts";
import { CREATIVE_DISCLOSURES, toStoryboardBeats, type CreativeConcept, type ConceptBeatPlan } from "./concept.ts";
import { critiqueConceptSet } from "./conceptCritique.ts";
import { retrieveCreativeMemory, type CreativeMemoryEntry, type RetrievalQuery } from "./memory.ts";

export interface CreativeMissionInput {
  readonly missionId: string;
  readonly viewerQuestion: string;
  readonly productDestination: string;
  readonly renderRequest: unknown;
  /** Already produced by MASTER #2, not an ad-hoc fact list. */
  readonly research: ResearchCreativeContract;
  readonly researchSynthetic: boolean;
  readonly allowSynthetic: boolean;
  readonly memory: readonly CreativeMemoryEntry[];
  readonly retrieval: RetrievalQuery;
  readonly platform: PlatformScriptStoryboard["platform"];
  /** Generator-supplied candidates; omission explicitly chooses the old scaffold. */
  readonly concepts?: readonly CreativeConcept[];
}

export function runCreativeProposalPass(input: CreativeMissionInput) {
  if (!input.missionId.trim() || !input.viewerQuestion.trim() || input.productDestination.split("?")[0] !== "/compare") throw new Error("A concrete mission and compare destination/state are required.");
  if (input.researchSynthetic && !input.allowSynthetic) throw new Error("Synthetic research is permitted only in the engineering proposal path.");
  if (input.retrieval.allowSynthetic && !input.allowSynthetic) throw new Error("Production proposals cannot retrieve synthetic creative memory.");
  const renderRequest = parseUiRenderRequest(input.renderRequest);
  if (renderRequest.state.surface !== "compare") throw new Error("This editorial planner supports Compare missions only.");
  const captureStateIdentifier = stateIdentifier(renderRequest);
  const retrieved = retrieveCreativeMemory(input.memory, input.retrieval);
  const approved = input.research.safeClaims.filter((claim) => !UNSAFE_FOR_CREATIVE.includes(claim.state) && claim.supportingSnapshotIds.length > 0);
  if (!approved.length) return { proposals: [], selected: null, retrieved, reason: "No evidence-grounded answer available; research is required.", limitations: ["No provider or rendered-video generation is implemented."] };
  const fact = approved[0];
  const answer = [fact.proposition, ...fact.requiredWording, fact.attribution ?? ""].filter(Boolean).join(" ");
  const ids = ["disclosure.fps-estimate", "disclosure.model-range"];
  const visualId = `${input.missionId}-compare`;
  const beat = (purpose: ConceptBeatPlan["purpose"], narration: string, text: string, start: number, end: number, factual = false): ConceptBeatPlan => ({
    purpose, narration, onScreenText: text, startSecond: start, endSecond: end,
    visualIds: [visualId], factDependencies: factual ? [fact.claimId] : [],
  });
  // Each mechanism changes the sequence and viewer task, not just the headline.
  const plans: readonly CreativeConcept[] = input.concepts ?? [
    {
      conceptId: `${input.missionId}-predict-reveal`, axes: { audienceExperience: "participant", explanatoryStructure: "prediction-then-reveal", visualMechanism: "single-surface-hold" },
      viewerQuestion: input.viewerQuestion, viewerTakeaway: `Check a prediction against the evidence: ${answer}`,
      beats: [beat("hook", input.viewerQuestion, "Make a prediction before reading the answer", 0, 5),
        beat("commitment", "Pick an answer, then inspect the evidence on the comparison page.", "Predict → inspect", 5, 9),
        beat("evidence", answer, answer, 9, 24, true),
        beat("payoff", "Was your prediction supported? Keep the estimate label and its limitations in view.", "Evidence, not a guessing contest", 24, 31),
        beat("cta", "Inspect the comparison for your own question.", "Open Compare", 31, 35)],
    },
    {
      conceptId: `${input.missionId}-answer-first`, axes: { audienceExperience: "spectator", explanatoryStructure: "linear-demonstration", visualMechanism: "single-surface-hold" },
      viewerQuestion: input.viewerQuestion, viewerTakeaway: `Explain the answer and its boundary: ${answer}`,
      beats: [beat("hook", answer, answer, 0, 12, true),
        beat("evidence", "Inspect the labeled evidence on the page before interpreting it.", "Inspect the evidence", 12, 19),
        beat("reversal", "A model output is not a measurement of these systems. Check what the evidence does not establish.", "What remains unknown?", 19, 27),
        beat("cta", "Use the comparison as a starting point, not a complete purchase recommendation.", "Open Compare", 27, 33)],
    },
    {
      conceptId: `${input.missionId}-investigation`, axes: { audienceExperience: "investigator", explanatoryStructure: "question-evidence-boundary", visualMechanism: "single-surface-hold" },
      viewerQuestion: input.viewerQuestion, viewerTakeaway: `Use a repeatable question-evidence-limit checklist: ${answer}`,
      beats: [beat("hook", input.viewerQuestion, "Question → evidence → limit", 0, 5),
        beat("commitment", "First identify what would answer your question, rather than looking for the largest number.", "What evidence would answer this?", 5, 12),
        beat("evidence", answer, answer, 12, 27, true),
        beat("payoff", "Now identify the missing information before deciding what to do.", "What would change your decision?", 27, 33),
        beat("cta", "Apply that checklist to the comparison you care about.", "Open Compare", 33, 37)],
    },
  ].map((partial) => ({ ...partial, productDestination: input.productDestination,
    visuals: [{ kind: "real-product-capture", visualId, surface: "compare", stateIdentifier: captureStateIdentifier }],
    requiredCapabilities: [{ capabilityId: "render.compare-surface-capture", description: "Existing Compare UI capture." }],
    requiredDisclosures: ids,
    disclosureTextByBeat: Object.fromEntries(partial.beats.map((_, index) => [index, ids.map((id) => CREATIVE_DISCLOSURES[id])])),
  } as CreativeConcept));
  const set = critiqueConceptSet({ concepts: plans, availableCapabilityIds: ["render.compare-surface-capture"], guaranteedDisclosureIds: ids });
  const proposals = plans.map((concept) => {
    const storyboard: PlatformScriptStoryboard = { platform: input.platform,
      title: input.viewerQuestion, targetDurationSeconds: concept.beats.at(-1)!.endSecond,
      narrationStyle: "Clear, deliberate explanation; no sensationalism.",
      beats: toStoryboardBeats(concept), finalCta: concept.beats.at(-1)!.narration,
      factualGuardrails: [...input.research.limitations, ...fact.requiredWording] };
    const evidenceFindings = checkScriptAgainstResearchStrict(storyboard, input.research);
    const critique = set.concepts.find((entry) => entry.conceptId === concept.conceptId)!;
    const allowedClaims = new Set(approved.map((claim) => claim.claimId));
    const grounded = concept.beats.some((beat) => beat.factDependencies.length > 0) &&
      concept.beats.every((beat) => beat.factDependencies.every((id) => allowedClaims.has(id)));
    // This production adapter renders only the exact Compare capture. Declared
    // illustrations must stay blocked, not be silently replaced with screenshots.
    const exactCapture = concept.visuals.length > 0 && concept.visuals.every((visual) => visual.kind === "real-product-capture" &&
      visual.surface === "compare" && visual.stateIdentifier === captureStateIdentifier);
    return { concept, storyboard, critique, evidenceFindings, reviewRequired: true, synthetic: input.researchSynthetic, renderRequest,
      contractEligible: grounded && exactCapture && concept.productDestination === input.productDestination &&
        set.divergent && critique.ready && !evidenceFindings.some((finding) => finding.severity === "hard-fail") };
  });
  // Only verified, directly applicable guidance affects the choice. Context never
  // becomes a performance recommendation; absent evidence the editorial default is explicit.
  const guidance = retrieved.observations.filter((observation) => observation.usage === "guidance");
  const selected = proposals.find((proposal) => proposal.contractEligible && guidance.some((observation) =>
    observation.entry.decision.value === proposal.concept.axes.explanatoryStructure)) ?? proposals.find((proposal) => proposal.contractEligible) ?? null;
  return { proposals, selected, retrieved,
    reason: guidance.length ? "Verified in-scope memory considered; no integrity check bypassed." : "Untested editorial scaffold; no performance guidance available.",
    limitations: ["Deterministic editorial planning, not autonomous original script generation.", "Human creative review, readability, renderer execution and media/audio review remain required."] };
}

/** Use the existing planner, binding its visual tasks to the exact validated UI
 * state rather than silently substituting the planner's default reference CPU. */
export function buildCreativeProposalProductionPlan(
  base: Omit<ScriptStoryboardPackage, "scripts">,
  proposal: NonNullable<ReturnType<typeof runCreativeProposalPass>["selected"]>,
) {
  if (!proposal.contractEligible) throw new Error("A blocked proposal cannot enter the production contract.");
  const request = parseUiRenderRequest(proposal.renderRequest);
  const plan = buildProductionPlanPackage({ ...base, scripts: [proposal.storyboard] });
  for (const platform of plan.platforms) {
    for (const task of platform.tasks) {
      if (task.sourceBeat !== null && (task.capability === "video-generation" || task.capability === "deterministic-ui-render")) {
        task.capability = "deterministic-ui-render";
        task.uiRenderState = request;
        delete task.videoGenerationState;
        delete task.fallbackCapability;
      }
    }
  }
  return plan;
}
