import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEMO_MISSION, DEMO_WORKFLOW_DIRECTORY } from "../../creativeFileWorkflowCli.ts";
import { importAuthoredBatch } from "./fileWorkflow.ts";
import { runCreativeFileWorkflow } from "./fileWorkflowPass.ts";
import { checkRenderDeliverability } from "./renderDeliverability.ts";
import type { CreativeConcept } from "./concept.ts";
import type { CreativeMissionInput } from "./proposalPass.ts";

const PRICE_ID = "SYNTHETIC_ENGINEERING_FIXTURE-editorial-parts-subtotal";
async function probe(edit: (concepts: CreativeConcept[]) => void,
  mission: Omit<CreativeMissionInput, "concepts"> = DEMO_MISSION) {
  const root = mkdtempSync(join(tmpdir(), "specsmith-wording-repair-"));
  try {
    const concepts = structuredClone(importAuthoredBatch(DEMO_WORKFLOW_DIRECTORY, 3).concepts) as CreativeConcept[];
    edit(concepts);
    const batch = join(root, "batches", "attempt-1");
    mkdirSync(batch, { recursive: true });
    concepts.forEach((concept, index) => writeFileSync(join(batch, `${index}.json`), JSON.stringify(concept)));
    return await runCreativeFileWorkflow(root, mission);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function replacePrice(concepts: CreativeConcept[], text: string, bound: boolean) {
  const concept = concepts[0];
  const beats = concept.beats.map((beat) => beat.factDependencies.includes(PRICE_ID)
    ? { ...beat, narration: text, onScreenText: "Inspect the parts", factDependencies: bound ? [PRICE_ID] : [] } : beat);
  concepts[0] = { ...concept, beats };
}
function deliver(text: string) {
  return checkRenderDeliverability({ conceptId: "probe", surface: "compare", captureType: "static",
    lines: [{ location: "beat-1.narration", text }] });
}

describe("price wording cannot escape through omitted metadata", () => {
  it.each(["These two builds cost the same.", "Same price.", "The parts have identical prices.", "Equal subtotals."])("rejects an unbound assertion: %s", async (text) => {
    const result = await probe((concepts) => replacePrice(concepts, text, false));
    expect(result.feedback[0].concepts[0].required.join(" ")).toContain("Required wording missing at beat-2");
    expect(result.feedback[0].concepts[0].required.join(" ")).toContain(text);
    expect(result.packet.machineChecksPassed).toBe(false);
    expect(result.packet.humanReviewReady).toBe(false);
    expect(result.workflowStatus).toBe("revision-required");
    expect(result.packet.approved).toBe(false);
  });
  it("still rejects a bound assertion with its qualifier missing", async () => {
    const result = await probe((concepts) => replacePrice(concepts, "Same price.", true));
    expect(result.packet.humanReviewReady).toBe(false);
  });
  it("accepts a qualified unbound paraphrase, without inferring approval", async () => {
    const result = await probe((concepts) => replacePrice(concepts,
      "These parts cost the same: an editorial CPU-and-GPU parts subtotal, not a complete build and not a live retail price.", false));
    expect(result.packet.machineChecksPassed).toBe(true); expect(result.packet.approved).toBe(false);
  });
  it("allows unrelated part/count wording and the real revised batch", async () => {
    const result = await probe(() => {});
    expect(result.packet.machineChecksPassed).toBe(true); expect(result.packet.approved).toBe(false);
  });
  it("routes an unqualified title to the mission owner", async () => {
    const result = await probe(() => {}, { ...DEMO_MISSION, viewerQuestion: "Same price, different parts." });
    expect(result.feedback[0].concepts[0].missionBlockers.join(" ")).toContain("Required wording missing at title");
    expect(result.packet.humanReviewReady).toBe(false);
  });
  it("rejects price identity when research permits no editorial price claim", async () => {
    const mission = { ...DEMO_MISSION, research: { ...DEMO_MISSION.research,
      safeClaims: DEMO_MISSION.research.safeClaims.filter((claim) => claim.claimId !== PRICE_ID) } };
    const result = await probe((concepts) => {
      concepts.forEach((concept, index) => { concepts[index] = { ...concept, beats: concept.beats.map((beat) =>
        beat.factDependencies.includes(PRICE_ID) ? { ...beat, narration: "Inspect the selected part names.",
          onScreenText: "Part names", factDependencies: [] } : beat) }; });
      concepts[0] = { ...concepts[0], beats: concepts[0].beats.map((beat, index) => index === 1
        ? { ...beat, narration: "These builds cost the same." } : beat) };
    }, mission);
    expect(result.feedback[0].concepts[0].required.join(" ")).toContain("Unapproved price identity");
    expect(result.packet.humanReviewReady).toBe(false);
  });
  it("checks an unqualified CTA and on-screen wording too", async () => {
    const result = await probe((concepts) => {
      concepts[0] = { ...concepts[0], beats: concepts[0].beats.map((beat) => beat.purpose === "cta"
        ? { ...beat, narration: "These builds cost the same.", onScreenText: "Same price" } : beat) };
    });
    expect(result.feedback[0].concepts[0].required.join(" ")).toContain("Required wording missing at cta");
    expect(result.packet.humanReviewReady).toBe(false);
  });
});

describe("absence statements are not visual promises", () => {
  it.each([
    "The range around each estimate is not displayed here.",
    "The range behind this value is never shown.",
    "Error bars are not rendered on this page.",
    "The page does not show the range.",
    "The price on this page is not displayed.",
    "There are no error bars here.",
  ])("allows an honest absence: %s", (text) => expect(deliver(text)).toEqual([]));
  it.each([
    "The range around this number is shown here.",
    "Not only is the range shown here, it is highlighted.",
    "The range is not shown, but now show the range.",
    "Error bars are not shown. Look at the range around the number.",
    "The range is not displayed here; see the prices here.",
    "The range is not shown and the range is drawn here.",
    "Error bars are not shown, but look at the price on this page.",
    "Look at the range around the value, which is not displayed here.",
  ])("still blocks an impossible promise: %s", (text) => {
    expect(deliver(text).some((finding) => finding.code === "promises-absent-element")).toBe(true);
  });
});
