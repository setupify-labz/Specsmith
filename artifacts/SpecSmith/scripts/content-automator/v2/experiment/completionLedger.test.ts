// MASTER #5 — Ledger validation and structural guarantees.
//
// These tests read the REAL source tree. A section cannot claim `tested` by
// assertion: its modules must exist, a non-test module must genuinely import
// them, and a test file must exist.
//
// The structural assertions below are the load-bearing proofs for sections 18,
// 59, 87, 94, 95, 99 and 100. They are not about behaviour but about what this
// code is CAPABLE of reaching: no fetch, no environment variable, no provider,
// no clock read, no p-value, no composite score, no memory write, no publish.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatMaster5Ledger,
  MASTER5_LEDGER,
  sectionsByStatus,
  SECTION_STATUSES,
} from "./completionLedger.ts";
import { assertZeroCostExperiment, formatExperimentReport, runExperimentPass } from "./experimentPass.ts";
import { registerExperiment } from "./registry.ts";
import { AssignmentLedger } from "./assignment.ts";
import { buildObservation, ObservationStore } from "./observation.ts";
import {
  FIXTURE_IDS,
  FIXTURE_PUBLISHED_AT,
  FIXTURE_SHAS,
  fixtureCleanExperiment,
  fixtureCleanShippedFacts,
  fixtureControlAnalytics,
  fixtureGuardrailsPassing,
  fixtureLineage,
  fixtureVariantAnalytics,
} from "./engineeringFixture.ts";

const AUTOMATOR_ROOT = join(import.meta.dirname, "..", "..");
const EXPERIMENT_DIR = "v2/experiment";
const NOW = new Date("2026-09-15T12:00:00.000Z");
const ENGINEERING = { allowSynthetic: true } as const;

function readModule(relativePath: string): string {
  return readFileSync(join(AUTOMATOR_ROOT, relativePath), "utf8");
}

/**
 * Source with comments AND string literals removed.
 *
 * Both have to go. A comment explaining why we never call `fetch`, an error
 * message mentioning `process.env`, or a ledger note about p-values are all
 * prose — and a scan that flags them is checking spelling rather than
 * capability. What remains is executable code, which is what these assertions
 * are actually about.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, '""');
}

function sourceFiles(): readonly { readonly path: string; readonly source: string }[] {
  return readdirSync(join(AUTOMATOR_ROOT, EXPERIMENT_DIR))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ path: `${EXPERIMENT_DIR}/${name}`, source: readModule(`${EXPERIMENT_DIR}/${name}`) }));
}

describe("the ledger describes the real source tree", () => {
  it("covers all 100 sections exactly once", () => {
    expect(MASTER5_LEDGER).toHaveLength(100);
    const numbers = MASTER5_LEDGER.map((record) => record.section);
    expect(new Set(numbers).size).toBe(100);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(100);
  });

  it("uses only recognised statuses", () => {
    for (const record of MASTER5_LEDGER) expect(SECTION_STATUSES).toContain(record.status);
  });

  it("names only modules, callers and tests that exist", () => {
    for (const record of MASTER5_LEDGER) {
      for (const path of [...record.modules, ...record.callers, ...record.tests]) {
        expect(existsSync(join(AUTOMATOR_ROOT, path)), `${record.section}: ${path}`).toBe(true);
      }
    }
  });

  it("requires a tested section to have a module, a caller and a test", () => {
    for (const record of sectionsByStatus("tested")) {
      expect(record.modules.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
      expect(record.callers.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
      expect(record.tests.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
    }
  });

  it("requires a tested section's caller to genuinely import its module", () => {
    for (const record of sectionsByStatus("tested")) {
      const callerSources = record.callers.map((caller) => readModule(caller));
      for (const modulePath of record.modules) {
        const basename = modulePath.split("/").pop()!;
        const imported = callerSources.some((source) => source.includes(basename));
        expect(imported, `section ${record.section} (${record.name}): no caller imports ${basename}`).toBe(true);
      }
    }
  });

  it("gives every section an explanatory note", () => {
    for (const record of MASTER5_LEDGER) {
      expect(record.note.length, `${record.section} ${record.name}`).toBeGreaterThan(40);
    }
  });

  it("renders a readable ledger", () => {
    const rendered = formatMaster5Ledger();
    expect(rendered).toContain("MASTER #5 COMPLETION LEDGER");
    expect(rendered).toContain("TOTAL: 100 sections");
  });
});

describe("MASTER #5 requires no provider, no network and no spend", () => {
  const files = sourceFiles();

  it("contains no network call anywhere", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${file.path} must not use XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
      expect(code, `${file.path} must not import node:http`).not.toMatch(/from "node:https?"/);
    }
  });

  it("reads no environment variable", () => {
    for (const file of files) {
      expect(codeOnly(file.source), `${file.path}`).not.toMatch(/process\.env/);
    }
  });

  it("imports no provider adapter", () => {
    const providers = [
      "elevenLabs", "geminiVeo", "meshy", "metricool", "metricoolAnalyticsCollector",
      "youtubeTrendSource", "tiktokTrendSource", "instagramTrendSource", "bundleSocial",
    ];
    for (const file of files) {
      for (const provider of providers) {
        expect(file.source, `${file.path} must not import ${provider}`).not.toMatch(
          new RegExp(`from\\s+"[^"]*${provider}[^"]*"`, "i"),
        );
      }
    }
  });

  it("never reads the clock", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path} must not call Date.now()`).not.toMatch(/Date\.now\s*\(/);
      expect(code, `${file.path} must not construct new Date() with no argument`).not.toMatch(/new Date\s*\(\s*\)/);
    }
  });
});

describe("no fake statistics and no composite score", () => {
  const files = sourceFiles();

  it("computes no p-value or confidence figure", () => {
    for (const file of files) {
      const code = codeOnly(file.source).toLowerCase();
      expect(code, `${file.path}`).not.toMatch(/\bp-?value\b/);
      expect(code, `${file.path}`).not.toMatch(/\bconfidenceinterval\b/);
      expect(code, `${file.path}`).not.toMatch(/\bstandarderror\b/);
      expect(code, `${file.path}`).not.toMatch(/\btstatistic\b/);
      expect(code, `${file.path}`).not.toMatch(/\bchisquare\b/);
    }
  });

  it("defines no blended content score", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path}`).not.toMatch(/function\s+computeContentScore/);
      expect(code, `${file.path}`).not.toMatch(/function\s+overallScore/);
      expect(code, `${file.path}`).not.toMatch(/function\s+compositeScore/);
    }
  });

  it("normalizes no metric across platforms", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path}`).not.toMatch(/function\s+normalizeMetricAcrossPlatforms/);
      expect(code, `${file.path}`).not.toMatch(/PLATFORM_CONVERSION_FACTOR/);
    }
  });
});

describe("MASTER #5 does not reach past its boundaries", () => {
  const files = sourceFiles();

  it("writes no durable memory (MASTER #6 boundary)", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path}`).not.toMatch(/function\s+writeMemory/);
      expect(code, `${file.path}`).not.toMatch(/function\s+consolidateBelief/);
      expect(code, `${file.path}`).not.toMatch(/function\s+updateLongTermMemory/);
      expect(code, `${file.path}`).not.toMatch(/writeFileSync|appendFileSync/);
    }
  });

  it("publishes and schedules nothing (MASTER #8 boundary)", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path}`).not.toMatch(/function\s+publish/);
      expect(code, `${file.path}`).not.toMatch(/function\s+schedule/);
      expect(code, `${file.path}`).not.toMatch(/function\s+allocateProduction/);
    }
  });

  it("reuses the existing analytics contract rather than defining a competing one", () => {
    const observation = readModule("v2/experiment/observation.ts");
    expect(observation).toMatch(/from "\.\.\/\.\.\/connectorAnalyticsIngestion\.ts"/);
    expect(observation).toMatch(/from "\.\.\/\.\.\/analyticsIngestion\.ts"/);
  });

  it("reuses the existing window and platform types", () => {
    const model = readModule("v2/experiment/model.ts");
    expect(model).toMatch(/export type \{ SnapshotWindow as ObservationWindow \}/);
    expect(model).toMatch(/import type \{ VideoPlatform \} from "\.\.\/\.\.\/types\.ts"/);
  });

  it("authorises no factual claim and removes no caveat", () => {
    for (const file of files) {
      const code = codeOnly(file.source);
      expect(code, `${file.path}`).not.toMatch(/function\s+approveClaim/);
      expect(code, `${file.path}`).not.toMatch(/function\s+removeRequiredWording/);
      expect(code, `${file.path}`).not.toMatch(/function\s+relaxGuardrail/);
    }
  });
});

describe("the pass runs end to end deterministically", () => {
  function runPass() {
    const experiment = registerExperiment(fixtureCleanExperiment(NOW), NOW);
    const assignments = new AssignmentLedger();
    const assignedAt = new Date("2026-08-31T12:00:00.000Z");
    assignments.bind({
      experimentId: FIXTURE_IDS.experimentId, experimentRevision: 1, variantId: FIXTURE_IDS.controlVariantId,
      creativeId: FIXTURE_IDS.controlCreativeId, creativeLineageId: FIXTURE_IDS.controlLineageId,
      platform: "youtube-shorts", packageId: FIXTURE_IDS.packageId, approvedMediaSha256: FIXTURE_SHAS.control,
      providerPostId: FIXTURE_IDS.controlPostId, publishedAt: FIXTURE_PUBLISHED_AT, now: assignedAt,
    });
    assignments.bind({
      experimentId: FIXTURE_IDS.experimentId, experimentRevision: 1, variantId: FIXTURE_IDS.variantId,
      creativeId: FIXTURE_IDS.variantCreativeId, creativeLineageId: FIXTURE_IDS.variantLineageId,
      platform: "youtube-shorts", packageId: FIXTURE_IDS.packageId, approvedMediaSha256: FIXTURE_SHAS.variant,
      providerPostId: FIXTURE_IDS.variantPostId, publishedAt: FIXTURE_PUBLISHED_AT, now: assignedAt,
    });

    const store = new ObservationStore();
    for (const [creativeId, analytics] of [
      [FIXTURE_IDS.controlCreativeId, fixtureControlAnalytics()],
      [FIXTURE_IDS.variantCreativeId, fixtureVariantAnalytics()],
    ] as const) {
      store.record(
        buildObservation({
          analytics, assignment: assignments.forCreative(creativeId)!, expectedWindow: "24h",
          synthetic: true, environment: ENGINEERING, now: NOW, producedBy: "ledger-test",
        }),
      );
    }

    return {
      experiment: experiment.experiment,
      result: runExperimentPass({
        experiment: experiment.experiment,
        preregistration: experiment.preregistration,
        assignments: assignments.all(),
        observations: store.forExperiment(FIXTURE_IDS.experimentId),
        lineage: fixtureLineage(),
        shippedFacts: fixtureCleanShippedFacts(),
        guardrailResults: fixtureGuardrailsPassing(),
        replications: [],
        conflictingExperimentIds: [],
        supportingExperimentIds: [],
        daysRunning: 14,
        unresolvedHypotheses: 2,
        synthetic: true,
        now: NOW,
        producedBy: "ledger-test",
      }),
    };
  }

  it("produces an interpretation, a decision and a learning candidate", () => {
    const { result } = runPass();
    expect(result.interpretation).not.toBeNull();
    expect(result.decision).toBe("replicate");
    expect(result.learningCandidate).not.toBeNull();
    expect(result.learningCandidate?.recommendedMemoryAction).toBe("store-as-directional");
  });

  it("is deterministic", () => {
    expect(runPass().result.resultHash).toBe(runPass().result.resultHash);
  });

  it("requires no paid access", () => {
    const check = assertZeroCostExperiment(runPass().result);
    expect(check.ok).toBe(true);
    expect(check.reason).toMatch(/no provider call, no network access and no credentials/);
  });

  it("renders a report covering every required heading", () => {
    const { experiment, result } = runPass();
    const report = formatExperimentReport(result, experiment);
    for (const heading of [
      "EXPERIMENT", "HYPOTHESIS", "SCOPE", "VARIANTS", "PRIMARY METRIC", "GUARDRAILS",
      "WHAT WE CAN SAY", "WHAT WE CANNOT SAY", "VALIDITY", "SAMPLE", "EVIDENCE",
      "DECISION", "NEXT EXPERIMENT", "SYNTHETIC", "PROVENANCE",
    ]) {
      expect(report, `report should contain ${heading}`).toContain(heading);
    }
  });

  it("marks the synthetic run as synthetic in the report", () => {
    const { experiment, result } = runPass();
    expect(formatExperimentReport(result, experiment)).toMatch(/SYNTHETIC: YES — engineering fixture/);
  });
});
