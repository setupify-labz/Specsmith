// MASTER #6 — The editorial-subtotal qualifier must be enforced, not optional.
//
// "Same price" is true of the two CPU-and-GPU pairs at SpecSmith's editorial
// catalog prices and false of almost anything a viewer would do with it: it is
// not a complete build, it is not a live retail quote, and the Compare page
// does not display a price at all.
//
// So the qualifier is carried as requiredWording on the claim. This file proves
// that dropping it fails, rather than trusting an author to remember.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { DEMO_MISSION, DEMO_RESEARCH } from "../../creativeFileWorkflowCli.ts";
import { runCreativeFileWorkflow } from "./fileWorkflowPass.ts";
import cpus from "../../../../src/data/cpus.json" with { type: "json" };
import gpus from "../../../../src/data/gpus.json" with { type: "json" };

const HERE = dirname(fileURLToPath(import.meta.url));
const ATTEMPT_3 = join(HERE, "..", "..", "fixtures", "creative-file-workflow", "batches", "attempt-3");

const PRICE_CLAIM = DEMO_RESEARCH.safeClaims.find(
  (claim) => claim.claimId === "SYNTHETIC_ENGINEERING_FIXTURE-editorial-parts-subtotal",
)!;

function priceOf(list: { id: string; price_usd: number }[], id: string): number {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`catalog drift: ${id}`);
  return found.price_usd;
}

// The strict gate enforces requiredWording only for two hard-coded requirement
// shapes; arbitrary required wording is carried but never checked there. The
// general rule is enforced by the file workflow instead, so that is what these
// tests exercise.
async function workflowOn(priceNarration: string) {
  const directory = mkdtempSync(join(tmpdir(), "specsmith-price-qualifier-"));
  try {
    const batchDirectory = join(directory, "batches", "attempt-1");
    mkdirSync(batchDirectory, { recursive: true });

    const template = JSON.parse(readFileSync(join(ATTEMPT_3, "01-commit-first.json"), "utf8")) as {
      beats: { narration: string; factDependencies: string[] }[];
    };
    const concepts = ["a", "b", "c"].map((suffix, index) => {
      const copy = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
      copy.conceptId = `probe-${suffix}`;
      copy.axes = {
        audienceExperience: ["participant", "investigator", "spectator"][index],
        explanatoryStructure: ["prediction-then-reveal", "question-evidence-boundary", "continuum-then-falsification"][index],
        visualMechanism: "single-surface-hold",
      };
      copy.viewerTakeaway = `Distinct takeaway ${suffix}.`;
      (copy.beats as { narration: string; factDependencies: string[] }[]).forEach((beat) => {
        if (beat.factDependencies.includes(PRICE_CLAIM.claimId)) beat.narration = priceNarration;
      });
      return copy;
    });
    concepts.forEach((concept, index) => {
      writeFileSync(join(batchDirectory, `${index + 1}.json`), `${JSON.stringify(concept, null, 2)}\n`, "utf8");
    });

    return await runCreativeFileWorkflow(directory, DEMO_MISSION);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function requiredText(result: Awaited<ReturnType<typeof workflowOn>>): string {
  return (result.feedback[0]?.concepts ?? []).flatMap((entry) => entry.required).join(" ");
}

describe("the price identity is real", () => {
  it("still holds in the shipped catalog", () => {
    const a = priceOf(gpus as never, "rtx5060ti") + priceOf(cpus as never, "i3-13100f");
    const b = priceOf(gpus as never, "rtx4060ti") + priceOf(cpus as never, "r5-9600x");
    expect(a).toBe(b);
  });
});

describe("the qualifier is carried by the claim, not by the author's goodwill", () => {
  it("requires both halves of the qualifier", () => {
    expect(PRICE_CLAIM.requiredWording).toEqual([
      "editorial CPU-and-GPU parts subtotal",
      "not a complete build and not a live retail price",
    ]);
  });

  it("accepts the claim stated with its qualifier", async () => {
    const result = await workflowOn(
      `${PRICE_CLAIM.proposition} That is an editorial CPU-and-GPU parts subtotal, not a complete build and not a live retail price.`,
    );
    // Scope: this file is about the qualifier. The probe batch is three clones
    // of one treatment, so the divergence rule blocks it for an unrelated and
    // correct reason; asserting overall readiness here would be asserting
    // something this test does not control.
    expect(requiredText(result)).not.toMatch(/Required wording missing/);
  });

  it("rejects the bare price identity with the qualifier dropped", async () => {
    const result = await workflowOn(PRICE_CLAIM.proposition);
    expect(requiredText(result)).toMatch(/Required wording missing/);
    expect(result.packet.machineChecksPassed).toBe(false);
  });

  it("rejects a half-qualifier that omits the live-price caveat", async () => {
    const result = await workflowOn(`${PRICE_CLAIM.proposition} That is an editorial CPU-and-GPU parts subtotal.`);
    expect(requiredText(result)).toMatch(/not a complete build and not a live retail price/);
    expect(result.packet.machineChecksPassed).toBe(false);
  });

  it("is not enforced by MASTER #2's contract, which only checks two fixed requirement shapes", () => {
    // Recorded so nobody later assumes the audited gate is covering this.
    const contractSource = readFileSync(
      join(HERE, "..", "research", "creativeContract.ts"),
      "utf8",
    );
    expect(contractSource).toContain('requirement.includes("Estimated FPS")');
    expect(contractSource).toContain('requirement.includes("never imply this is a live price")');
    for (const wording of PRICE_CLAIM.requiredWording) {
      expect(contractSource).not.toContain(wording);
    }
  });
});

describe("the revised batch actually carries it", () => {
  it.each(["01-commit-first.json", "02-three-checks.json"])("%s states the qualifier verbatim", (file) => {
    const concept = JSON.parse(readFileSync(join(ATTEMPT_3, file), "utf8")) as {
      beats: { narration: string; factDependencies: string[] }[];
    };
    const priceBeat = concept.beats.find((beat) => beat.factDependencies.includes(PRICE_CLAIM.claimId));
    expect(priceBeat).toBeDefined();
    for (const wording of PRICE_CLAIM.requiredWording) {
      expect(priceBeat!.narration).toContain(wording);
    }
  });

  it("never claims a complete build or a live price anywhere in the batch", () => {
    for (const file of ["01-commit-first.json", "02-three-checks.json", "03-vanishing-gap.json"]) {
      const concept = JSON.parse(readFileSync(join(ATTEMPT_3, file), "utf8")) as {
        beats: { narration: string; onScreenText: string }[];
      };
      const text = concept.beats.map((beat) => `${beat.narration} ${beat.onScreenText}`).join(" ").toLowerCase();
      for (const forbidden of ["full build", "whole build", "complete pc", "today's price", "current price", "buy it for"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it("makes no market-wide assertion about other comparison sites", () => {
    // "Most comparisons show you the value and hide the range" was a claim
    // about every other product on the market, with nothing behind it. The
    // revision says only what is checkable about SpecSmith's own page.
    for (const file of ["01-commit-first.json", "02-three-checks.json", "03-vanishing-gap.json"]) {
      const concept = JSON.parse(readFileSync(join(ATTEMPT_3, file), "utf8")) as {
        beats: { narration: string; onScreenText: string }[];
      };
      const text = concept.beats.map((beat) => `${beat.narration} ${beat.onScreenText}`).join(" ").toLowerCase();
      for (const forbidden of ["most comparisons", "most sites", "everyone else", "other sites", "the industry"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it("keeps the earlier attempts intact, including the wording that was revised away", () => {
    // Provenance: the original drafts are evidence of what was actually
    // authored and why it was changed. Rewriting them would erase the record.
    const earlier = JSON.parse(
      readFileSync(join(ATTEMPT_3, "..", "attempt-2", "03-vanishing-gap.json"), "utf8"),
    ) as { beats: { narration: string }[] };
    expect(earlier.beats.map((beat) => beat.narration).join(" ")).toContain("Most comparisons");
  });
});
