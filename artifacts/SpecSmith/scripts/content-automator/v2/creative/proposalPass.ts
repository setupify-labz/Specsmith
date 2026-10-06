/** Mission-driven, deterministic concept planning. This is an editorial scaffold,
 * not an LLM, a proven originality judge or a rendered-video generator. */
import type { PlatformScriptStoryboard } from "../../types.ts";
import { contractDeclaresSynthetic, type ResearchCreativeContract } from "../research/creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "../research/strictEvidenceGate.ts";
import { UNSAFE_FOR_CREATIVE } from "../research/model.ts";
import { parseUiRenderRequest, stateIdentifier } from "../../uiRender/uiRenderState.ts";
import { buildProductionPlanPackage } from "../../productionPlan.ts";
import type { ProductionTask, ScriptStoryboardPackage } from "../../types.ts";
import { DISCLOSURE_BANDED_LAYOUT, storyViewport } from "../../bandedLayout.ts";
import type { SoundCue } from "../../soundEffects.ts";
import { CREATIVE_DISCLOSURES, persistentDisclosuresOf, toStoryboardBeats, type CreativeConcept, type ConceptBeatPlan } from "./concept.ts";
import { missionCaptureViews, type CompareViewSetting } from "./captureViews.ts";
import { DATA_MOTION_GRAPHIC_CAPABILITY, describeShown, resolveDataMotionGraphic, stageNoteText, unsupportedGraphicValues, verticalOverflow, withConsistentColours, type ResolvedDataMotionGraphic } from "./dataMotionGraphic.ts";
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
  /**
   * Further settings of the same Compare pair a concept may show, beyond the
   * primary `renderRequest`. Each is a real, validated application state. The
   * research's claims hold only for the primary view (see captureViews.ts).
   */
  readonly additionalViews?: readonly CompareViewSetting[];
  /** Generator-supplied candidates; omission explicitly chooses the old scaffold. */
  readonly concepts?: readonly CreativeConcept[];
}

export function runCreativeProposalPass(input: CreativeMissionInput) {
  if (!input.missionId.trim() || !input.viewerQuestion.trim() || input.productDestination.split("?")[0] !== "/compare") throw new Error("A concrete mission and compare destination/state are required.");
  if (input.researchSynthetic && !input.allowSynthetic) throw new Error("Synthetic research is permitted only in the engineering proposal path.");
  // The mission's label is a claim about the research, not a fact about it. A
  // contract that declares synthetic evidence cannot be presented as production.
  if (!input.researchSynthetic && contractDeclaresSynthetic(input.research)) {
    throw new Error("The research contract declares synthetic evidence, but the mission declares production research. Label the mission synthetic or supply production research.");
  }
  if (input.retrieval.allowSynthetic && !input.allowSynthetic) throw new Error("Production proposals cannot retrieve synthetic creative memory.");
  const renderRequest = parseUiRenderRequest(input.renderRequest);
  if (renderRequest.state.surface !== "compare") throw new Error("This editorial planner supports Compare missions only.");
  const captureStateIdentifier = stateIdentifier(renderRequest);
  const views = missionCaptureViews(input.renderRequest, input.additionalViews ?? []);
  const viewIds = new Set(views.map((view) => view.stateIdentifier));
  const retrieved = retrieveCreativeMemory(input.memory, input.retrieval);
  const approved = input.research.safeClaims.filter((claim) => !UNSAFE_FOR_CREATIVE.includes(claim.state) && claim.supportingSnapshotIds.length > 0);
  if (!approved.length) return { proposals: [], selected: null, retrieved, reason: "No evidence-grounded answer available; research is required.", limitations: ["No provider or rendered-video generation is implemented."] };
  const fact = approved[0];
  const answer = [fact.proposition, ...fact.requiredWording, fact.attribution ?? ""].filter(Boolean).join(" ");
  // Compare shows single estimates, not a range, so only the estimate disclosure applies.
  const ids = ["disclosure.fps-estimate"];
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
  const set = critiqueConceptSet({ concepts: plans, availableCapabilityIds: ["render.compare-surface-capture", DATA_MOTION_GRAPHIC_CAPABILITY], guaranteedDisclosureIds: ["disclosure.fps-estimate", "disclosure.model-range"] });
  const proposals = plans.map((concept) => {
    const storyboard: PlatformScriptStoryboard = { platform: input.platform,
      title: input.viewerQuestion, targetDurationSeconds: concept.beats.at(-1)!.endSecond,
      narrationStyle: "Clear, deliberate explanation; no sensationalism.",
      beats: toStoryboardBeats(concept), finalCta: concept.beats.at(-1)!.narration,
      factualGuardrails: [...input.research.limitations, ...fact.requiredWording],
      ...(persistentDisclosuresOf(concept).length > 0 ? { persistentDisclosures: persistentDisclosuresOf(concept) } : {}) };
    const evidenceFindings = checkScriptAgainstResearchStrict(storyboard, input.research);
    const critique = set.concepts.find((entry) => entry.conceptId === concept.conceptId)!;
    const allowedClaims = new Set(approved.map((claim) => claim.claimId));
    const grounded = concept.beats.some((beat) => beat.factDependencies.length > 0) &&
      concept.beats.every((beat) => beat.factDependencies.every((id) => allowedClaims.has(id)));
    // Data motion graphics: every value computed from the primary view, and
    // every figure shown covered by an approved claim bound on that beat.
    let motionGraphics: ResolvedDataMotionGraphic[] = [];
    const motionGraphicProblems: string[] = [];
    for (const visual of concept.visuals) {
      if (visual.kind !== "data-motion-graphic") continue;
      try { motionGraphics.push(resolveDataMotionGraphic(visual, views, { viewerQuestion: input.viewerQuestion, productDestination: concept.productDestination })); }
      catch (error) { motionGraphicProblems.push((error as Error).message); }
    }
    // Games in order of first appearance on screen, beat by beat.
    const appearance = concept.beats.flatMap((beat) => beat.visualIds)
      .flatMap((id) => motionGraphics.find((graphic) => graphic.visualId === id)?.games.map((game) => game.gameId) ?? []);
    motionGraphics = withConsistentColours(motionGraphics, appearance);
    // Each graphic must fit the band it will be rendered into, at readable sizes.
    const storyHeight = persistentDisclosuresOf(concept).length > 0 ? DISCLOSURE_BANDED_LAYOUT.story.height : DISCLOSURE_BANDED_LAYOUT.height;
    for (const graphic of motionGraphics) {
      const overflow = verticalOverflow(graphic, storyHeight);
      if (overflow) motionGraphicProblems.push(overflow);
    }
    try {
      for (const entry of unsupportedGraphicValues({ beats: concept.beats, graphics: motionGraphics, approvedClaims: approved })) {
        motionGraphicProblems.push(`Beat ${entry.beat}: motion graphic "${entry.visualId}" shows ${describeShown(entry.shown)}, and no approved claim bound on that beat covers that game, setting, pairing, direction and those values together. Bind the claim whose evidence states exactly this, or show a template without values.`);
      }
    } catch (error) { motionGraphicProblems.push((error as Error).message); }
    // This production adapter renders the exact Compare capture and data
    // motion graphics computed from it. Declared illustrations must stay
    // blocked, not be silently replaced with screenshots.
    const exactCapture = concept.visuals.length > 0 && concept.visuals.every((visual) =>
      (visual.kind === "real-product-capture" && visual.surface === "compare" && viewIds.has(visual.stateIdentifier)) ||
      (visual.kind === "data-motion-graphic" && motionGraphics.some((graphic) => graphic.visualId === visual.visualId)));
    // A claim was established for the primary view only. A beat that states
    // one while showing another setting would pair it with numbers it was
    // never checked against.
    const claimsOnPrimaryView = claimBeatsOffPrimaryView(concept, captureStateIdentifier).length === 0;
    return { concept, storyboard, critique, evidenceFindings, reviewRequired: true, synthetic: input.researchSynthetic, renderRequest, views,
      motionGraphics, motionGraphicProblems,
      contractEligible: grounded && exactCapture && claimsOnPrimaryView && motionGraphicProblems.length === 0 && concept.productDestination === input.productDestination &&
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

/** Beats (1-based) that state a claim while showing a view other than the primary one. */
export function claimBeatsOffPrimaryView(concept: CreativeConcept, primaryStateIdentifier: string): number[] {
  const stateOf = new Map(concept.visuals.map((visual) =>
    [visual.visualId, visual.kind === "real-product-capture" ? visual.stateIdentifier
      : visual.kind === "data-motion-graphic" ? visual.sourceStateIdentifier : null] as const));
  return concept.beats.flatMap((beat, index) =>
    beat.factDependencies.length > 0 && beat.visualIds.some((id) => {
      const state = stateOf.get(id);
      return state !== null && state !== undefined && state !== primaryStateIdentifier;
    }) ? [index + 1] : []);
}

/**
 * Use the existing planner, then bind it to what this proposal can honestly show.
 *
 * - Each beat's visual task renders that beat's own validated view, never the
 *   planner's default reference state and never one state for every beat.
 * - With required disclosures, the frame is banded (bandedLayout.ts): captures
 *   render at the story band's size, a disclosure-overlay task renders the
 *   disclosures verbatim for the whole video, and captions sit in their own band.
 * - No music. The music-sfx task is dropped unless `soundEffects` are given: a
 *   silent placeholder would pass for a sound design decision that was never
 *   made. Given cues, it renders those synthesized effects (soundEffects.ts),
 *   and still no music.
 */
export function buildCreativeProposalProductionPlan(
  base: Omit<ScriptStoryboardPackage, "scripts">,
  proposal: NonNullable<ReturnType<typeof runCreativeProposalPass>["selected"]>,
  options: { readonly soundEffects?: readonly SoundCue[] } = {},
) {
  if (!proposal.contractEligible) throw new Error("A blocked proposal cannot enter the production contract.");
  const viewById = new Map(proposal.views.map((view) => [view.stateIdentifier, view] as const));
  const disclosures = proposal.storyboard.persistentDisclosures ?? [];
  const banded = disclosures.length > 0;
  const plan = buildProductionPlanPackage({ ...base, scripts: [proposal.storyboard] });
  for (const platform of plan.platforms) {
    for (const task of platform.tasks) {
      if (task.sourceBeat !== null && (task.capability === "video-generation" || task.capability === "deterministic-ui-render")) {
        const beat = proposal.concept.beats[task.sourceBeat];
        const graphics = proposal.motionGraphics.filter((graphic) => beat.visualIds.includes(graphic.visualId));
        if (graphics.length > 0) {
          if (graphics.length !== 1 || beat.visualIds.length !== 1) {
            throw new Error(`Beat ${task.sourceBeat + 1} mixes a motion graphic with other visuals; a visual task renders exactly one.`);
          }
          // Rendered from the resolved values, sized to the band it fills.
          task.capability = "data-motion-graphic";
          (task as ProductionTask & { dataMotionGraphicState?: unknown }).dataMotionGraphicState = {
            graphic: graphics[0],
            durationSeconds: beat.endSecond - beat.startSecond,
            width: DISCLOSURE_BANDED_LAYOUT.width,
            height: banded ? DISCLOSURE_BANDED_LAYOUT.story.height : DISCLOSURE_BANDED_LAYOUT.height,
          };
          delete task.uiRenderState;
          delete task.videoGenerationState;
          delete task.fallbackCapability;
          continue;
        }
        const captures = beat.visualIds
          .map((id) => proposal.concept.visuals.find((visual) => visual.visualId === id))
          .filter((visual) => visual?.kind === "real-product-capture") as { stateIdentifier: string }[];
        if (captures.length !== 1) {
          throw new Error(`Beat ${task.sourceBeat + 1} shows ${captures.length} product captures; a visual task renders exactly one.`);
        }
        const view = viewById.get(captures[0].stateIdentifier);
        if (!view) throw new Error(`Beat ${task.sourceBeat + 1} names ${captures[0].stateIdentifier}, which is not a validated view of this mission.`);
        task.capability = "deterministic-ui-render";
        // Framed on the active settings: a cut between views then visibly shows
        // the setting change, not just a few numbers moving in a list.
        task.uiRenderState = banded ? { ...view.request, viewport: storyViewport(), framing: "settings" } : view.request;
        delete task.videoGenerationState;
        delete task.fallbackCapability;
      }
    }

    const music = platform.tasks.find((task) => task.capability === "music-sfx");
    const compose = platform.tasks.find((task) => task.capability === "motion-compositor") as ProductionTask & { compositorState?: Record<string, unknown> };
    const captions = platform.tasks.find((task) => task.capability === "caption-render") as ProductionTask & { captionRenderState?: Record<string, unknown> };
    if (music && options.soundEffects && options.soundEffects.length > 0) {
      (music as ProductionTask & { soundEffectsState?: unknown }).soundEffectsState = { cues: [...options.soundEffects] };
      music.purpose = "Restrained synthesized sound effects under the narration: cuts and figure reveals only. No music.";
      platform.qualityChecks.push(`Sound effects: ${options.soundEffects.length} synthesized cues (no music, no samples), mixed under the narration at the compositor's music gain.`);
    } else if (music) {
      platform.tasks = platform.tasks.filter((task) => task !== music);
      platform.renderOrder = platform.renderOrder.filter((id) => id !== music.taskId);
      compose.inputRequirements = compose.inputRequirements.filter((id) => id !== music.taskId);
      delete compose.compositorState!.musicTaskId;
      platform.qualityChecks.push("No music track: this path has no licensed or offline music capability. Narration only; sound design remains a human decision.");
    }

    // A beat whose caption is exactly the line its graphic draws is captioned
    // by the graphic: burning the same words into the caption band as well
    // would show them twice. Only an exact match is dropped, so a caption can
    // never vanish because a graphic says something similar.
    if (captions?.captionRenderState) {
      const carried = new Set(proposal.concept.beats.flatMap((beat, index) => {
        const graphic = proposal.motionGraphics.find((entry) => beat.visualIds.includes(entry.visualId));
        const note = graphic ? stageNoteText(graphic) : null;
        return note !== null && note === beat.onScreenText ? [index] : [];
      }));
      if (carried.size > 0) {
        const cues = (captions.captionRenderState.cues as { startSecond: number }[]).filter((cue) =>
          !proposal.concept.beats.some((beat, index) => carried.has(index) && beat.startSecond === cue.startSecond));
        captions.captionRenderState = { ...captions.captionRenderState, cues };
        platform.qualityChecks.push(`Beat ${[...carried].map((index) => index + 1).join(", ")}: the caption is the line the motion graphic draws, so it is shown once, in the graphic.`);
      }
    }

    if (banded) {
      const layout = DISCLOSURE_BANDED_LAYOUT;
      const overlay: ProductionTask & { disclosureOverlayState: unknown } = {
        taskId: `${platform.platform}-disclosure-overlay`,
        capability: "disclosure-overlay",
        sourceBeat: null,
        purpose: "Render the required estimate disclosures, verbatim, as one persistent readable panel.",
        inputRequirements: [...disclosures],
        outputRequirements: ["Every disclosure verbatim; no overflow or clipping; minimum type size and contrast verified before use."],
        disclosureOverlayState: { lines: [...disclosures], width: layout.width, height: layout.disclosure.height },
      };
      platform.tasks.splice(platform.tasks.indexOf(compose), 0, overlay);
      platform.renderOrder.splice(platform.renderOrder.indexOf(compose.taskId), 0, overlay.taskId);
      compose.inputRequirements = [...compose.inputRequirements, overlay.taskId];
      compose.compositorState = { ...compose.compositorState, layout, disclosureTaskId: overlay.taskId };
      captions.captionRenderState = { ...captions.captionRenderState, placement: "caption-band" };
      platform.qualityChecks.push(
        "Disclosures stay on screen verbatim for the whole video in their own band; the rendered frames are checked against the verified panel and the story band against each beat's capture.",
      );
    }
  }
  return plan;
}
