// Data motion graphics: values computed from the primary Compare state, every
// figure bound to an approved claim, disclosed, and counted as its own picture.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gpuUpgradeMission, WORKFLOW_DIRECTORY } from "../../nextVideoGpuUpgrade/workflowCli.ts";
import { assessConcept, type CreativeConcept } from "./concept.ts";
import { missionCaptureViews, pictureIdentity } from "./captureViews.ts";
import {
  dataMotionGraphicDefects,
  figuresShown,
  percentChange,
  resolveDataMotionGraphic,
  unboundGraphicFigures,
  type DataMotionGraphic,
} from "./dataMotionGraphic.ts";
import { buildCreativeProposalProductionPlan, runCreativeProposalPass } from "./proposalPass.ts";
import { reviewVisualHonesty } from "./visualHonesty.ts";

const P = "compare_rtx5070_r5-7600_vs_rtx4060_r5-7600_1440p_high_static_540x960-2";
const graphic = (overrides: Partial<DataMotionGraphic> = {}): DataMotionGraphic => ({
  kind: "data-motion-graphic", visualId: "g", template: "percent-change", sourceStateIdentifier: P, games: ["alanwake2", "valorant"], baseline: "B", ...overrides,
});
const { mission } = gpuUpgradeMission();
const views = missionCaptureViews(mission.renderRequest);
const batch = (): CreativeConcept[] => {
  const dir = join(WORKFLOW_DIRECTORY, "batches", readdirSync(join(WORKFLOW_DIRECTORY, "batches")).sort().at(-1)!);
  return readdirSync(dir).sort().map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as CreativeConcept);
};
const pass = (concepts: CreativeConcept[]) => runCreativeProposalPass({ ...mission, concepts });
const recommended = () => batch()[0];

describe("resolving a graphic from the primary Compare state", () => {
  it("computes figures with the functions Compare uses, and percentages from the displayed estimates", () => {
    const resolved = resolveDataMotionGraphic(graphic(), views);
    expect(resolved.setting).toBe("1440p High");
    expect(resolved.beforeBuild).toBe("RTX 4060 + Ryzen 5 7600");
    expect(resolved.games).toEqual([
      { gameId: "alanwake2", name: "Alan Wake 2", before: 43, after: 65, percent: 51, formula: "(65 − 43) ÷ 43" },
      { gameId: "valorant", name: "Valorant", before: 263, after: 305, percent: 16, formula: "(305 − 263) ÷ 263" },
    ]);
    expect(figuresShown(resolved)).toEqual(["43", "65", "51%", "263", "305", "16%"]);
    expect(figuresShown(resolveDataMotionGraphic(graphic({ template: "game-labels" }), views))).toEqual([]);
    expect(percentChange(43, 65)).toBe(51);
    expect(() => percentChange(0, 10)).toThrow();
  });

  it("refuses a graphic sourced from another setting, and malformed graphics", () => {
    const withOther = missionCaptureViews(mission.renderRequest, [{ resolution: "4k", preset: "high" }]);
    const other = withOther.find((view) => !view.primary)!.stateIdentifier;
    expect(() => resolveDataMotionGraphic(graphic({ sourceStateIdentifier: other }), withOther)).toThrow(/primary view/);
    expect(() => resolveDataMotionGraphic(graphic({ sourceStateIdentifier: "elsewhere" }), views)).toThrow(/not a view/);
    expect(dataMotionGraphicDefects(graphic({ games: ["not-a-game"] }))).toEqual([expect.stringMatching(/Unknown game id/)]);
    expect(dataMotionGraphicDefects(graphic({ games: [] }))).not.toEqual([]);
    expect(dataMotionGraphicDefects(graphic({ template: "pie" as never }))).not.toEqual([]);
    expect(reviewVisualHonesty([graphic({ games: ["alanwake2", "alanwake2"] })]).acceptable).toBe(false);
  });

  it("finds a figure no bound claim states", () => {
    const resolved = resolveDataMotionGraphic(graphic(), views);
    const propositions = Object.fromEntries(mission.research.safeClaims.map((claim) => [claim.claimId, claim.proposition]));
    const unbound = unboundGraphicFigures({ beats: [{ visualIds: ["g"], factDependencies: ["gpu-upgrade-percent-gpu-heavy-game"] }], graphics: [resolved], approvedPropositions: propositions });
    expect(unbound.map((entry) => entry.figure)).toEqual(["263", "305", "16%"]);
  });

  it("is one picture per template and game set, whatever its id", () => {
    expect(pictureIdentity(graphic({ visualId: "a" }))).toBe(pictureIdentity(graphic({ visualId: "b" })));
    expect(pictureIdentity(graphic())).not.toBe(pictureIdentity(graphic({ template: "fps-change" })));
    expect(pictureIdentity(graphic())).not.toBe(pictureIdentity(graphic({ games: ["valorant", "alanwake2"] })));
  });
});

describe("the workflow's guards on graphics", () => {
  it("the authored batch passes at 1440p High only", () => {
    const { proposals } = pass(batch());
    expect(proposals.map((proposal) => proposal.contractEligible)).toEqual([true, true, true]);
    expect(proposals.every((proposal) => proposal.views.length === 1 && proposal.motionGraphicProblems.length === 0)).toBe(true);
  });

  it("refuses a beat whose graphic shows a figure its claims do not state", () => {
    const concepts = batch();
    const a = concepts[0];
    const index = a.beats.findIndex((beat) => beat.visualIds.includes("pct-aw-val"));
    concepts[0] = { ...a, beats: a.beats.map((beat, i) => i === index ? { ...beat, factDependencies: ["gpu-upgrade-percent-gpu-heavy-game"] } : beat) };
    const proposal = pass(concepts).proposals[0];
    expect(proposal.contractEligible).toBe(false);
    expect(proposal.motionGraphicProblems.join(" ")).toMatch(/shows 263, which no approved claim bound on that beat states/);
  });

  it("refuses a graphic computed at another setting", () => {
    const other = missionCaptureViews(mission.renderRequest, [{ resolution: "4k", preset: "high" }]).find((view) => !view.primary)!.stateIdentifier;
    const concepts = batch();
    concepts[0] = { ...concepts[0], visuals: concepts[0].visuals.map((visual) => visual.kind === "data-motion-graphic" ? { ...visual, sourceStateIdentifier: other } : visual) };
    const { proposals } = runCreativeProposalPass({ ...mission, additionalViews: [{ resolution: "4k", preset: "high" }], concepts });
    expect(proposals[0].contractEligible).toBe(false);
    expect(proposals[0].motionGraphicProblems.join(" ")).toMatch(/primary view/);
  });

  it("requires the estimate disclosure on every beat that shows a graphic", () => {
    const a = recommended();
    const index = a.beats.findIndex((beat) => beat.visualIds.includes("fps-aw"));
    const undisclosed = { ...a, disclosureTextByBeat: { ...a.disclosureTextByBeat, [index]: [] } } as CreativeConcept;
    const assessment = assessConcept({ concept: undisclosed, availableCapabilityIds: ["render.compare-surface-capture", "render.data-motion-graphic"], guaranteedDisclosureIds: ["disclosure.fps-estimate"] });
    expect(assessment.defects.map((defect) => defect.code)).toContain("undisclosed-estimate");
  });

  it("a concept without the capability declared available is blocked", () => {
    const assessment = assessConcept({ concept: recommended(), availableCapabilityIds: ["render.compare-surface-capture"], guaranteedDisclosureIds: ["disclosure.fps-estimate"] });
    expect(assessment.defects.map((defect) => defect.code)).toContain("missing-capability");
  });

  it("puts each graphic beat into the production plan as a motion-graphic task carrying its computed values", () => {
    const proposal = pass(batch()).proposals[0];
    const plan = buildCreativeProposalProductionPlan({ packageId: "p", ideaId: "i", campaignId: "c", feature: "compare", subjectIds: [] } as never, proposal as never);
    const tasks = plan.platforms[0].tasks.filter((task) => task.capability === "data-motion-graphic") as unknown as { sourceBeat: number; dataMotionGraphicState: { graphic: { template: string; games: { name: string; before: number; after: number; percent: number }[] }; height: number } }[];
    expect(tasks.map((task) => task.sourceBeat)).toEqual(proposal.concept.beats.flatMap((beat, i) => beat.visualIds[0].startsWith("compare") ? [] : [i]));
    const pct = tasks.find((task) => task.dataMotionGraphicState.graphic.template === "percent-change")!;
    expect(pct.dataMotionGraphicState.graphic.games.map((game) => [game.name, game.before, game.after, game.percent])).toEqual([["Alan Wake 2", 43, 65, 51], ["Valorant", 263, 305, 16]]);
    expect(pct.dataMotionGraphicState.height).toBe(1300);
  });
});
