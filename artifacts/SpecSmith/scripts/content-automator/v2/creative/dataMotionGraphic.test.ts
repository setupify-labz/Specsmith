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
  graphicLabels,
  percentChange,
  stageNote,
  stageNoteText,
  resolveDataMotionGraphic,
  unsupportedGraphicValues,
  valuesShown,
  type DataMotionGraphic,
} from "./dataMotionGraphic.ts";
import { buildCreativeProposalProductionPlan, runCreativeProposalPass } from "./proposalPass.ts";
import { reviewVisualHonesty } from "./visualHonesty.ts";
import { checkScriptAgainstResearch } from "../research/creativeContract.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

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
    expect(valuesShown(resolved).map((entry) => [entry.gameId, entry.before, entry.after, entry.percent, entry.resolution, entry.preset, entry.cpu, entry.beforeGpu, entry.afterGpu])).toEqual([
      ["alanwake2", 43, 65, 51, "1440p", "high", "r5-7600", "rtx4060", "rtx5070"],
      ["valorant", 263, 305, 16, "1440p", "high", "r5-7600", "rtx4060", "rtx5070"],
    ]);
    expect(valuesShown(resolveDataMotionGraphic(graphic({ template: "game-labels" }), views))).toEqual([]);
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

  it("binds values to approved evidence as one tuple: game, setting, pairing, direction and values together", () => {
    const approved = mission.research.safeClaims;
    const check = (visual: DataMotionGraphic, claimIds: string[], claims = approved) => unsupportedGraphicValues({
      beats: [{ visualIds: [visual.visualId], factDependencies: claimIds }], graphics: [resolveDataMotionGraphic(visual, views)], approvedClaims: claims,
    }).map((entry) => entry.shown.gameId);
    const fps = graphic({ template: "fps-change", games: ["alanwake2"] });
    // The right claim covers it.
    expect(check(fps, ["gpu-upgrade-gpu-heavy-game"])).toEqual([]);
    // Another game's claim does not, though it is about the same upgrade.
    expect(check(fps, ["gpu-upgrade-cpu-heavy-game"])).toEqual(["alanwake2"]);
    // Flipped baseline: the graphic would show 65 → 43. Both digits are in the
    // claim's sentence, so a digit match would pass it; the tuple does not.
    const flipped = graphic({ template: "fps-change", games: ["alanwake2"], baseline: "A" });
    expect(approved.find((claim) => claim.claimId === "gpu-upgrade-gpu-heavy-game")!.proposition).toMatch(/43.*65/);
    expect(check(flipped, ["gpu-upgrade-gpu-heavy-game"])).toEqual(["alanwake2"]);
    // The right digits with evidence for another setting, or no structured evidence at all: refused.
    const reworded = approved.map((claim) => claim.claimId !== "gpu-upgrade-gpu-heavy-game" ? claim : {
      ...claim, evidence: claim.evidence!.map((entry) => ({ ...entry, configuration: { ...entry.configuration!, resolution: "4k" } })),
    });
    expect(check(fps, ["gpu-upgrade-gpu-heavy-game"], reworded)).toEqual(["alanwake2"]);
    const sentenceOnly = approved.map((claim) => claim.claimId !== "gpu-upgrade-gpu-heavy-game" ? claim : { ...claim, evidence: undefined });
    expect(check(fps, ["gpu-upgrade-gpu-heavy-game"], sentenceOnly)).toEqual(["alanwake2"]);
    // A percentage needs evidence that carries the percentage: the FPS-only claim is not enough.
    expect(check(graphic({ games: ["alanwake2"] }), ["gpu-upgrade-gpu-heavy-game"])).toEqual(["alanwake2"]);
    expect(check(graphic({ games: ["alanwake2"] }), ["gpu-upgrade-percent-gpu-heavy-game"])).toEqual([]);
  });

  it("refuses when exactly one part of the tuple differs from the evidence", () => {
    const approved = mission.research.safeClaims;
    const claimId = "gpu-upgrade-percent-gpu-heavy-game";
    const pct = graphic({ games: ["alanwake2"] });
    const with_ = (change: (entry: { configuration: Record<string, unknown>; fields: Record<string, unknown> }) => void) => approved.map((claim) => claim.claimId !== claimId ? claim : {
      ...claim, evidence: claim.evidence!.map((entry) => {
        const copy = { ...entry, configuration: { ...entry.configuration! } as Record<string, unknown>, fields: { ...entry.fields } as Record<string, unknown> };
        change(copy);
        return copy as never;
      }),
    });
    const refused = (claims: typeof approved) => unsupportedGraphicValues({
      beats: [{ visualIds: ["g"], factDependencies: [claimId] }], graphics: [resolveDataMotionGraphic(pct, views)], approvedClaims: claims,
    }).length === 1;
    expect(refused(approved)).toBe(false);
    expect(refused(with_((e) => { e.configuration.gameId = "valorant"; }))).toBe(true);
    expect(refused(with_((e) => { e.configuration.resolution = "4k"; }))).toBe(true);
    expect(refused(with_((e) => { e.configuration.preset = "ultra"; }))).toBe(true);
    expect(refused(with_((e) => { e.fields.cpu = "i5-12400f"; }))).toBe(true);
    expect(refused(with_((e) => { e.fields.beforeGpu = "rtx5070"; e.fields.afterGpu = "rtx4060"; }))).toBe(true);
    expect(refused(with_((e) => { e.fields.estimatedFpsBefore = 44; }))).toBe(true);
    expect(refused(with_((e) => { e.fields.estimatedFpsAfter = 66; }))).toBe(true);
    expect(refused(with_((e) => { e.fields.percent = 50; }))).toBe(true);
  });

  it("upgrade-intro shows the mission's own question and the parts, and no values", () => {
    const intro = graphic({ template: "upgrade-intro" });
    expect(() => resolveDataMotionGraphic(intro, views)).toThrow(/mission's question/);
    const resolved = resolveDataMotionGraphic(intro, views, { viewerQuestion: mission.viewerQuestion });
    expect(resolved.headline).toBe("Which game gets the bigger percentage boost?");
    expect([resolved.beforeGpu.name, resolved.afterGpu.name, resolved.beforeCpu.name, resolved.afterCpu.name, resolved.setting])
      .toEqual(["RTX 4060", "RTX 5070", "Ryzen 5 7600", "Ryzen 5 7600", "1440p High"]);
    expect(resolved.games.map((game) => game.name)).toEqual(["Alan Wake 2", "Valorant"]);
    expect(valuesShown(resolved)).toEqual([]);
  });

  it("keeps each game's colour across scenes, whatever order or company a scene shows it in", () => {
    const { proposals } = pass(batch());
    const colours = new Map<string, Set<number | undefined>>();
    for (const graphic of proposals[0].motionGraphics) for (const game of graphic.games) {
      colours.set(game.gameId, (colours.get(game.gameId) ?? new Set()).add(game.colour));
    }
    expect([...colours.entries()].sort().map(([id, set]) => [id, [...set]])).toEqual([["alanwake2", [0]], ["valorant", [1]]]);
  });

  it("is one picture per template and game set, whatever its id", () => {
    expect(pictureIdentity(graphic({ visualId: "a" }))).toBe(pictureIdentity(graphic({ visualId: "b" })));
    expect(pictureIdentity(graphic())).not.toBe(pictureIdentity(graphic({ template: "fps-change" })));
    expect(pictureIdentity(graphic())).not.toBe(pictureIdentity(graphic({ games: ["valorant", "alanwake2"] })));
  });
});

describe("percent-change stages: the comparison stays on screen while the story ends", () => {
  it("adds only the fixed line the graphic's own values make true", () => {
    const explain = resolveDataMotionGraphic(graphic({ stage: "explain" }), views, { productDestination: "/compare" });
    expect(stageNoteText(explain)).toBe("Same upgrade. Different gains by game.");
    // The values behind the line are the same tuple the reveal shows.
    expect(valuesShown(explain)).toEqual(valuesShown(resolveDataMotionGraphic(graphic(), views)));
    const ask = resolveDataMotionGraphic(graphic({ stage: "ask" }), views, { productDestination: "/compare" });
    expect(stageNoteText(ask)).toBe("Which game would you upgrade for? specsmithpc.com/compare");
    expect(resolveDataMotionGraphic(graphic(), views).note).toBeNull();
  });

  it("refuses a stage its values cannot support", () => {
    // "Different gains by game" needs two games with different percentages.
    expect(() => resolveDataMotionGraphic(graphic({ stage: "explain", games: ["alanwake2"] }), views)).toThrow(/compares games and shows 1/);
    // The ask stage links the product destination; it never invents one.
    expect(() => resolveDataMotionGraphic(graphic({ stage: "ask" }), views)).toThrow(/product destination/);
    // ...and refuses it when the percentages are equal, whatever the games.
    const same = { gameId: "x", name: "X", before: 50, after: 60, percent: 20, formula: "" };
    expect(() => stageNote("g", "explain", [same, { ...same, gameId: "y", name: "Y" }], "/compare")).toThrow(/false here; the percentages are equal/);
    expect(stageNote("g", "explain", [same, { ...same, gameId: "y", name: "Y", percent: 21 }], "/compare")?.lines).toEqual(["Same upgrade.", "Different gains by game."]);
    expect(dataMotionGraphicDefects(graphic({ template: "fps-change", stage: "explain" }))).toContain("Only a percent-change graphic has stages.");
    expect(dataMotionGraphicDefects(graphic({ stage: "shout" as never })).join(" ")).toMatch(/Unknown stage/);
  });

  it("labels a percentage as an estimated percentage boost, beside the estimated FPS it is computed from", () => {
    const labels = graphicLabels(resolveDataMotionGraphic(graphic(), views));
    expect(labels).toContain("Estimated percentage boost");
    expect(labels).toContain("Estimated FPS");
  });

  it("counts a later stage as a new picture, and the same stage under another id as the same one", () => {
    expect(pictureIdentity(graphic({ stage: "explain" }))).not.toBe(pictureIdentity(graphic()));
    expect(pictureIdentity(graphic({ stage: "ask" }))).not.toBe(pictureIdentity(graphic({ stage: "explain" })));
    expect(pictureIdentity(graphic({ stage: "reveal" }))).toBe(pictureIdentity(graphic()));
    expect(pictureIdentity(graphic({ visualId: "x", stage: "ask" }))).toBe(pictureIdentity(graphic({ visualId: "y", stage: "ask" })));
  });

  it("drops a beat's caption only when it is exactly the line its graphic draws", () => {
    const proposal = pass(batch()).proposals[0];
    const plan = buildCreativeProposalProductionPlan({ packageId: "p", ideaId: "i", campaignId: "c", feature: "compare", subjectIds: [] } as never, proposal as never);
    const cues = (plan.platforms[0].tasks.find((task) => task.capability === "caption-render") as unknown as { captionRenderState: { cues: { startSecond: number; text: string }[] } }).captionRenderState.cues;
    const carried = proposal.concept.beats.filter((beat) => beat.visualIds.some((id) => id.endsWith("-explain") || id.endsWith("-ask")));
    expect(carried).toHaveLength(2);
    for (const beat of carried) expect(cues.some((cue) => cue.startSecond === beat.startSecond)).toBe(false);
    expect(cues).toHaveLength(proposal.concept.beats.length - 2);

    // A caption that only resembles the graphic's line stays in the caption band.
    const concepts = batch();
    concepts[0] = { ...concepts[0], beats: concepts[0].beats.map((beat) => beat.visualIds.includes("pct-aw-val-explain") ? { ...beat, onScreenText: "Same upgrade, different gains" } : beat) };
    const near = pass(concepts).proposals[0];
    const nearPlan = buildCreativeProposalProductionPlan({ packageId: "p", ideaId: "i", campaignId: "c", feature: "compare", subjectIds: [] } as never, near as never);
    const nearCues = (nearPlan.platforms[0].tasks.find((task) => task.capability === "caption-render") as unknown as { captionRenderState: { cues: { text: string }[] } }).captionRenderState.cues;
    expect(nearCues.map((cue) => cue.text)).toContain("Same upgrade, different gains");
  });
});

describe("a percentage is never labelled as FPS", () => {
  const storyboardWith = (onScreenText: string, narration = "Here is the result."): PlatformScriptStoryboard => ({
    platform: "youtube-shorts", title: "t", targetDurationSeconds: 4, narrationStyle: "", finalCta: "",
    factualGuardrails: [], beats: [{ purpose: "evidence", startSecond: 0, endSecond: 4, narration, onScreenText, visualDirection: "" }],
  } as unknown as PlatformScriptStoryboard);
  const percentLabelFailures = (text: string, narration?: string) =>
    checkScriptAgainstResearch(storyboardWith(text, narration), mission.research)
      .filter((finding) => finding.severity === "hard-fail" && /Estimated percentage boost/.test(finding.message));

  it("refuses the earlier caption, which labelled two percentages \"Estimated FPS\"", () => {
    const failures = percentLabelFailures("51% vs 16% · Estimated FPS");
    expect(failures).toHaveLength(1);
    expect(failures[0].location).toBe("beat-1.onScreenText");
  });

  it("accepts a percentage labelled as an estimated boost", () => {
    expect(percentLabelFailures("Estimated percentage boost: 51% vs 16%")).toEqual([]);
    expect(percentLabelFailures("Estimated percentage boost: 51% vs 16%", "That's an estimated 51% boost for Alan Wake 2, and just 16% for Valorant.")).toEqual([]);
    expect(percentLabelFailures("Estimated percentage boost: 51% vs 16%", "As an estimated boost, that's 51% against 16%.")).toEqual([]);
  });

  it("requires the label on the percentage claims only, not on the FPS claims", () => {
    const wording = Object.fromEntries(mission.research.safeClaims.map((claim) => [claim.claimId, claim.requiredWording]));
    expect(wording["gpu-upgrade-gpu-heavy-game"]).toEqual(["Estimated FPS"]);
    for (const id of ["gpu-upgrade-percent-gpu-heavy-game", "gpu-upgrade-percent-cpu-heavy-game", "bigger-percentage-boost"]) {
      expect(wording[id]).toEqual(["Estimated FPS", "Estimated percentage boost"]);
    }
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
    expect(proposal.motionGraphicProblems.join(" ")).toMatch(/shows valorant 263 → 305 \(16%\) at 1440p high, rtx4060 → rtx5070 with r5-7600, and no approved claim bound on that beat covers/);
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
