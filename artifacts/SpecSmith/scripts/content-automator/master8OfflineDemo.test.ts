// The MASTER #8 offline demonstrations, run end to end in CI: the simulated
// success path reaches a learning report and a next brief through the real
// boundary, and the production refusal path stops where review or approval is
// missing. No real account, person or provider is involved.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMaster8Demos } from "./master8OfflineDemo.ts";

const dir = mkdtempSync(join(tmpdir(), "master8-demo-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("MASTER #8 offline demonstrations", () => {
  it("success: reviewed -> pending -> simulated approval -> simulated provider -> observations -> report -> next brief", async () => {
    const result = await runMaster8Demos(dir);

    expect(result.ledger.events.map((event) => event.status)).toEqual([
      "generated", "machine-reviewed", "human-review-pending", "publication-authorized",
      "submission-started", "submission-unknown", "draft-submitted", "published", "analytics-partial",
    ]);
    expect(result.ledger.events.slice(1).every((event) => event.simulated === true)).toBe(true);
    // The lost answer was reconciled, not resent: one post, one submission.
    expect(result.blind).toMatchObject({ refused: true, code: "outcome-unknown" });
    expect(result.log.join("\n")).toMatch(/posts held by the provider: 1; submissions received: 1/);

    expect(result.report.storeMode).toBe("simulation");
    expect(result.report.nextBrief.proposedChange).toMatchObject({ variable: "hookFamily", metric: "stayed-to-watch-rate" });
    expect(result.handoff.brief.memoryObservations.length).toBeGreaterThan(0);
    expect(result.handoff.evidence.reviewPacketIds.length).toBe(2);
    expect(readFileSync(join(dir, "success", "learning-report.txt"), "utf8")).toMatch(/SIMULATED DATA, NOT REAL PERFORMANCE/);
  }, 240_000);

  it("refusal: in a production store every step past human review is refused, and the ledger says where it stopped", async () => {
    const report = JSON.parse(readFileSync(join(dir, "refusal", "refusal-report.json"), "utf8")) as {
      steps: { step: string; refused: boolean; code: string }[]; ledger: { events: { status: string; simulated?: boolean }[] }; learningUnknowns: string[];
    };
    expect(report.steps.every((step) => step.refused)).toBe(true);
    expect(report.steps.map((step) => step.code)).toEqual([
      "ledger-refused", "packet-not-issued", "no-trusted-approval-mechanism", "no-trusted-approval-mechanism", "not-authorized", "synthetic-in-production",
    ]);
    expect(report.ledger.events.map((event) => event.status)).toEqual(["generated", "machine-reviewed", "human-review-pending"]);
    expect(report.ledger.events.some((event) => event.simulated)).toBe(false);
    expect(report.learningUnknowns[0]).toMatch(/No provider-confirmed publication exists/);
  });
});
