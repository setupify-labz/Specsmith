// MASTER #6 — Concept critique and revision tests.

import { describe, expect, it } from "vitest";

import { critiqueConceptSet, reviseConcept } from "./conceptCritique.ts";
import type { CreativeConcept } from "./concept.ts";
import {
  AVAILABLE_CAPABILITIES,
  CAPABILITY_SPEC_CARD_SURFACE,
  DISCLOSURE_EDITORIAL_PRICE,
  DISCLOSURE_FPS_ESTIMATE,
  DISCLOSURE_MODEL_RANGE,
  PACKAGE_BRANCH,
  PACKAGE_CROSSOVER,
  PACKAGE_SPEC_FORENSICS,
  SECTION_ONE_PACKAGES,
} from "./sectionOnePackages.ts";

const ENV = {
  availableCapabilityIds: AVAILABLE_CAPABILITIES,
  guaranteedDisclosureIds: [DISCLOSURE_FPS_ESTIMATE, DISCLOSURE_EDITORIAL_PRICE, DISCLOSURE_MODEL_RANGE],
};

describe("critiquing the real section-1 set", () => {
  const critique = critiqueConceptSet({ ...ENV, concepts: SECTION_ONE_PACKAGES });

  it("passes the two producible packages clean, including their copy", () => {
    for (const conceptId of [PACKAGE_CROSSOVER.conceptId, PACKAGE_BRANCH.conceptId]) {
      const entry = critique.concepts.find((candidate) => candidate.conceptId === conceptId);
      expect(entry?.findings).toEqual([]);
      expect(entry?.ready).toBe(true);
    }
    expect(critique.readyConceptIds).toEqual([PACKAGE_CROSSOVER.conceptId, PACKAGE_BRANCH.conceptId]);
  });

  it("holds the third package back only on the capability it is missing", () => {
    const entry = critique.concepts.find((candidate) => candidate.conceptId === PACKAGE_SPEC_FORENSICS.conceptId);
    expect(entry?.humanRequired).toEqual([]);
    expect(entry?.blockedOnCapability.map((finding) => finding.code)).toEqual(["missing-capability"]);
    expect(critique.blockedConceptIds).toEqual([PACKAGE_SPEC_FORENSICS.conceptId]);
  });

  it("confirms the set itself is divergent", () => {
    expect(critique.setFindings).toEqual([]);
    expect(critique.divergent).toBe(true);
  });
});

describe("routing", () => {
  it("routes generated-sounding copy to a human rather than rewriting it", () => {
    const shouty: CreativeConcept = {
      ...PACKAGE_CROSSOVER,
      conceptId: "m6-shouty",
      beats: PACKAGE_CROSSOVER.beats.map((beat, index) =>
        index === 0 ? { ...beat, narration: "Act now before it's too late!!!" } : beat,
      ),
    };
    const critique = critiqueConceptSet({ ...ENV, concepts: [shouty] }).concepts[0];
    const copy = critique.findings.filter((finding) => finding.source === "copy");
    expect(copy.length).toBeGreaterThan(0);
    expect(copy.every((finding) => finding.routing === "human-required")).toBe(true);
    expect(critique.machineApplicable).toEqual([]);
  });

  it("routes an unrecognised structural defect to a human by default", () => {
    // Anything not explicitly admitted as machine-applicable must not be
    // auto-fixed, so a future defect code cannot silently become automatic.
    const broken: CreativeConcept = { ...PACKAGE_CROSSOVER, conceptId: "m6-broken", viewerTakeaway: " " };
    const critique = critiqueConceptSet({ ...ENV, concepts: [broken] }).concepts[0];
    expect(critique.humanRequired.map((finding) => finding.code)).toContain("no-viewer-takeaway");
    expect(critique.machineApplicable).toEqual([]);
  });

  it("separates a missing capability from a creative problem", () => {
    const critique = critiqueConceptSet({ ...ENV, concepts: [PACKAGE_SPEC_FORENSICS] }).concepts[0];
    expect(critique.blockedOnCapability).toHaveLength(1);
    expect(critique.ready).toBe(false);
  });
});

describe("revision applies only what a machine may honestly apply", () => {
  const withOrphan: CreativeConcept = {
    ...PACKAGE_CROSSOVER,
    conceptId: "m6-orphan",
    visuals: [
      ...PACKAGE_CROSSOVER.visuals,
      { kind: "decorative", visualId: "p1-orphan", description: "Soft gradient wash nobody shows." },
    ],
  };

  it("removes a declared visual that no beat shows", () => {
    const result = reviseConcept(withOrphan, ENV);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0].appliedCodes).toEqual(["visual-never-used"]);
    expect(result.concept.visuals.map((visual) => visual.visualId)).not.toContain("p1-orphan");
    expect(result.outstanding).toEqual([]);
  });

  it("stops as soon as a pass changes nothing rather than burning its budget", () => {
    expect(reviseConcept(PACKAGE_CROSSOVER, ENV).stoppedBecause).toBe("nothing-machine-applicable");
    expect(reviseConcept(withOrphan, ENV).stoppedBecause).toBe("no-further-change");
  });

  it("records lineage back to the parent concept", () => {
    const result = reviseConcept(withOrphan, ENV);
    expect(result.revisions[0].parentConceptId).toBe("m6-orphan");
    expect(result.concept.conceptId).toBe("m6-orphan-r1");
  });

  it("never rewrites narration or on-screen text", () => {
    const result = reviseConcept(withOrphan, ENV);
    expect(result.concept.beats.map((beat) => beat.narration)).toEqual(
      withOrphan.beats.map((beat) => beat.narration),
    );
    expect(result.concept.beats.map((beat) => beat.onScreenText)).toEqual(
      withOrphan.beats.map((beat) => beat.onScreenText),
    );
  });

  it("defers human-required findings with a reason instead of dropping them", () => {
    const orphanAndShouty: CreativeConcept = {
      ...withOrphan,
      conceptId: "m6-orphan-shouty",
      beats: withOrphan.beats.map((beat, index) =>
        index === 0 ? { ...beat, narration: "Act now before it's too late!!!" } : beat,
      ),
    };
    const result = reviseConcept(orphanAndShouty, ENV);
    expect(result.revisions[0].deferred.length).toBeGreaterThan(0);
    expect(result.revisions[0].deferred[0].reason).toMatch(/optimise the check rather than the video/);
    expect(result.outstanding.length).toBeGreaterThan(0);
  });

  it("leaves a blocked concept intact rather than weakening it to fit the renderer", () => {
    const result = reviseConcept(PACKAGE_SPEC_FORENSICS, ENV);
    expect(result.concept).toEqual(PACKAGE_SPEC_FORENSICS);
    expect(result.outstanding.map((finding) => finding.routing)).toContain("blocked-on-capability");
  });

  it("clears the block when the capability arrives", () => {
    const result = reviseConcept(PACKAGE_SPEC_FORENSICS, {
      ...ENV,
      availableCapabilityIds: [...AVAILABLE_CAPABILITIES, CAPABILITY_SPEC_CARD_SURFACE],
    });
    expect(result.outstanding).toEqual([]);
  });

  it("is deterministic", () => {
    expect(reviseConcept(withOrphan, ENV)).toEqual(reviseConcept(withOrphan, ENV));
  });
});
