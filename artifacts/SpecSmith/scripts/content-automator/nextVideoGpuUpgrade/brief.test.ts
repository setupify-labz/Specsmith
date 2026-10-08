// The next-video brief stays true to the shipped model, carries #174's
// learning as labelled context, and its three concepts still pass the
// existing workflow's gates without being approved.

import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCreativeFileWorkflow } from "../v2/creative/fileWorkflowPass.ts";
import { REFUSED_ANGLES, runGpuUpgradeResearch } from "./research.ts";
import { gpuUpgradeMission, publishedPostLearning, RESEARCH_RUN_AT, WORKFLOW_DIRECTORY } from "./workflowCli.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("research for the GPU-upgrade Short", () => {
  it("states exactly the numbers the shipped model computes, as production research", () => {
    const { result, facts } = runGpuUpgradeResearch(RESEARCH_RUN_AT);
    expect(result.containsSyntheticEvidence).toBe(false);
    expect([facts.gpuHeavy.fpsB, facts.gpuHeavy.fpsA, facts.cpuHeavy.fpsB, facts.cpuHeavy.fpsA]).toEqual([43, 65, 263, 305]);
    expect([facts.leadsA, facts.gameCount]).toEqual([20, 20]);
    const safe = Object.fromEntries(result.contract.safeClaims.map((claim) => [claim.claimId, claim]));
    expect(safe["gpu-upgrade-gpu-heavy-game"].proposition).toContain("from 43 to 65 FPS");
    expect(safe["gpu-upgrade-cpu-heavy-game"].proposition).toContain("from 263 to 305 FPS");
    expect(safe["gpu-upgrade-gpu-heavy-game"].requiredWording).toEqual(["Estimated FPS"]);
    // Every safe claim rests on a snapshot; nothing is safe merely because something contradicted it.
    expect(result.contract.safeClaims.every((claim) => claim.supportingSnapshotIds.length > 0)).toBe(true);
    expect(result.contract.unsafeClaims.map((claim) => claim.claimId).sort()).toEqual(["better-purchase", "measured-on-hardware"]);
  });

  it("computes each percentage from the two displayed estimates it names, and records the unrounded model ratio", () => {
    const { result, facts } = runGpuUpgradeResearch(RESEARCH_RUN_AT);
    expect([facts.gpuHeavy.percent, facts.cpuHeavy.percent]).toEqual([51, 16]);
    expect(facts.gpuHeavy.percent).toBe(Math.round(((65 - 43) / 43) * 100));
    expect(facts.cpuHeavy.percent).toBe(Math.round(((305 - 263) / 263) * 100));
    // The model's own ratio before Compare rounds: why the headline is computed from what is on screen.
    expect([facts.gpuHeavy.unroundedRatio, facts.cpuHeavy.unroundedRatio]).toEqual([1.496, 1.16]);
    const safe = Object.fromEntries(result.contract.safeClaims.map((claim) => [claim.claimId, claim]));
    expect(safe["gpu-upgrade-percent-gpu-heavy-game"].proposition).toContain("an estimated 51% boost: from 43 to 65 FPS, (65 − 43) ÷ 43");
    expect(safe["gpu-upgrade-percent-cpu-heavy-game"].proposition).toContain("an estimated 16% boost: from 263 to 305 FPS, (305 − 263) ÷ 263");
    expect(safe["bigger-percentage-boost"].state).toBe("strongly-supported");
    expect(result.contract.disputedClaims).toEqual([]);
  });

  it("keeps the mission at 1440p High only, asking the percentage question", () => {
    const { mission } = gpuUpgradeMission();
    expect(mission.viewerQuestion).toBe("Which game gets the bigger percentage boost?");
    expect(mission.additionalViews ?? []).toEqual([]);
    expect((mission.renderRequest as { state: { resolution: string; preset: string } }).state).toMatchObject({ resolution: "1440p", preset: "high" });
  });

  it("refuses the 4K angle because the model's per-game ratio does not change with resolution", () => {
    const { facts } = runGpuUpgradeResearch(RESEARCH_RUN_AT);
    expect(new Set(Object.values(facts.ratioByResolution)).size).toBe(1);
    expect(REFUSED_ANGLES.some((entry) => entry.angle.includes("4K"))).toBe(true);
  });
});

describe("the brief and its three concepts", () => {
  it("carry #174's report as labelled context, and pass the workflow's gates without approval", async () => {
    const { mission } = gpuUpgradeMission();
    const { report, handoff } = publishedPostLearning(mission);
    const memory = handoff.brief.memoryObservations;
    expect(memory.every((line) => line.includes(report.reportId))).toBe(true);
    const exploratory = memory.filter((line) => line.startsWith("Exploratory context"));
    expect(exploratory).toHaveLength(2);
    expect(exploratory.every((line) => line.includes("relayed connector snapshot") && line.includes("not ranked against other posts"))).toBe(true);
    expect(memory.some((line) => line.startsWith("Creative change to test") && line.includes("a hypothesis, not a finding"))).toBe(true);

    const directory = mkdtempSync(join(tmpdir(), "gpu-upgrade-brief-"));
    dirs.push(directory);
    cpSync(join(WORKFLOW_DIRECTORY, "batches"), join(directory, "batches"), { recursive: true });
    const result = await runCreativeFileWorkflow(directory, mission, { memoryObservations: memory });
    expect(result.workflowStatus).toBe("ready-for-human-review");
    expect(result.packet.approved).toBe(false);
    expect(result.packet.syntheticResearch).toBe(false);
  });

  it("keeps every concept under 30 s, opens on a caption at 0 s, and speaks no promotional outro", () => {
    const latest = readdirSync(join(WORKFLOW_DIRECTORY, "batches")).sort().at(-1)!;
    const files = readdirSync(join(WORKFLOW_DIRECTORY, "batches", latest));
    expect(files).toHaveLength(3);
    for (const file of files) {
      const concept = JSON.parse(readFileSync(join(WORKFLOW_DIRECTORY, "batches", latest, file), "utf8"));
      const beats = concept.beats as { startSecond: number; endSecond: number; narration: string; onScreenText: string; purpose: string }[];
      expect(beats.at(-1)!.endSecond).toBeLessThan(30);
      expect(beats[0]).toMatchObject({ startSecond: 0, purpose: "hook" });
      expect(beats[0].onScreenText.trim()).not.toBe("");
      const outro = beats.at(-1)!;
      expect(outro.narration).not.toMatch(/specsmith|\.com|visit|follow|subscribe|link/i);
      expect(outro.onScreenText).toContain("specsmithpc.com/compare");
    }
  });
});
