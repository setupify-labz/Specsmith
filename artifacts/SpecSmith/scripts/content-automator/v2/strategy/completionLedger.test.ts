// The MASTER #3 ledger, validated against the real source tree, plus the
// structural $0 and provider-independence assertions.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatMaster3Ledger, MASTER3_LEDGER, SECTION_STATUSES, sectionsByStatus } from "./completionLedger.ts";

const automatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath: string) => readFileSync(join(automatorRoot, relativePath), "utf8");

const CLAIMS_CODE = ["tested", "integrated", "partially-implemented"];
const CLAIMS_CALLER = ["tested", "integrated"];
const CLAIMS_NOTHING = ["blocked-external", "blocked-data", "deferred-to-master", "not-applicable"];
const BRIEF_SECTIONS = Array.from({ length: 58 }, (_, index) => index + 1);

/** Every non-test module in the strategy layer. */
const STRATEGY_MODULES = [
  "v2/strategy/model.ts", "v2/strategy/signals.ts", "v2/strategy/opportunity.ts",
  "v2/strategy/portfolio.ts", "v2/strategy/priority.ts", "v2/strategy/contentMission.ts",
  "v2/strategy/hypotheses.ts", "v2/strategy/critic.ts", "v2/strategy/strategyPass.ts",
  "v2/strategy/closedLoop.ts", "v2/strategy/engineeringFixture.ts", "v2/strategy/completionLedger.ts",
];

describe("ledger shape", () => {
  it("covers every numbered section of the MASTER #3 brief exactly once", () => {
    const sections = MASTER3_LEDGER.map((record) => record.section).sort((a, b) => a - b);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections).toEqual(BRIEF_SECTIONS);
  });

  it("uses only declared statuses and always explains itself", () => {
    for (const record of MASTER3_LEDGER) {
      expect(SECTION_STATUSES, `§${record.section}`).toContain(record.status);
      expect(record.note.length, `§${record.section} needs a real note`).toBeGreaterThan(40);
    }
  });
});

describe("every ledger claim is true of the repository", () => {
  it("names only modules that exist", () => {
    for (const record of MASTER3_LEDGER) {
      for (const module of record.modules) {
        expect(existsSync(join(automatorRoot, module)), `§${record.section} names missing module ${module}`).toBe(true);
      }
    }
  });

  it("names only tests that exist", () => {
    for (const record of MASTER3_LEDGER) {
      for (const test of record.tests) {
        expect(existsSync(join(automatorRoot, test)), `§${record.section} names missing test ${test}`).toBe(true);
      }
    }
  });

  it("requires a claimed caller to genuinely import one of the section's modules", () => {
    for (const record of MASTER3_LEDGER) {
      if (!CLAIMS_CALLER.includes(record.status)) continue;
      expect(record.callers.length, `§${record.section} claims ${record.status} with no caller`).toBeGreaterThan(0);
      for (const caller of record.callers) {
        expect(existsSync(join(automatorRoot, caller)), `§${record.section} names missing caller ${caller}`).toBe(true);
        const source = read(caller);
        const imports = record.modules.some((module) => {
          const basename = module.replace(/^.*\//, "").replace(/\.ts$/, "");
          return new RegExp(`from\\s+"[^"]*${basename}\\.ts"`).test(source);
        });
        expect(imports, `§${record.section}: ${caller} imports none of ${record.modules.join(", ")}`).toBe(true);
      }
    }
  });

  it("requires a tested section to name at least one test", () => {
    for (const record of sectionsByStatus("tested")) {
      expect(record.tests.length, `§${record.section} claims tested with no test`).toBeGreaterThan(0);
    }
  });

  it("requires an implemented-or-better section to name a module", () => {
    for (const record of MASTER3_LEDGER) {
      if (!CLAIMS_CODE.includes(record.status)) continue;
      expect(record.modules.length, `§${record.section} is ${record.status} but names no module`).toBeGreaterThan(0);
    }
  });

  it("refuses a blocked or deferred section that quietly claims callers or tests", () => {
    for (const record of MASTER3_LEDGER) {
      if (!CLAIMS_NOTHING.includes(record.status)) continue;
      expect(record.callers, `§${record.section} is ${record.status} but names callers`).toEqual([]);
      expect(record.tests, `§${record.section} is ${record.status} but names tests`).toEqual([]);
    }
  });

  it("is honest about what is not built, and says why", () => {
    const blocked = MASTER3_LEDGER.filter(
      (record) => record.status.startsWith("blocked") || record.status === "deferred-to-master",
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const record of blocked) {
      expect(record.note, `§${record.section} must say WHY`).toMatch(/\b(need|needs|require|requires|nothing|no |not )/i);
    }
  });

  it("marks the real integration target as wired into the pipeline", () => {
    const mission = MASTER3_LEDGER.find((record) => record.section === 14)!;
    expect(mission.callers).toContain("endToEndOfflinePipeline.ts");
    const pipeline = read("endToEndOfflinePipeline.ts");
    expect(pipeline).toContain("runStrategyClosedLoop");
    expect(pipeline).toContain("assertMissionGovernsCreative");
    expect(pipeline).toContain("assertZeroCostCore");
  });
});

describe("provider independence and the zero-dollar core", () => {
  it("contains no network call in any strategy module", () => {
    for (const module of STRATEGY_MODULES) {
      const source = read(module);
      for (const forbidden of ["fetch(", "XMLHttpRequest", "node:http", "node:https", "axios", "undici"]) {
        expect(source.includes(forbidden), `${module} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("reads no environment variable and therefore no credential", () => {
    for (const module of STRATEGY_MODULES) {
      expect(read(module).includes("process.env"), `${module} reads process.env`).toBe(false);
    }
  });

  it("imports no provider adapter", () => {
    const providers = [
      "metricoolClient", "geminiVeoVideo", "elevenLabsTts", "elevenLabsVideo",
      "meshyIngestion", "trendSource", "youtubeTrendSource", "instagramTrendSource",
      "bundleTikTokTrendSource", "multiTrendSource",
    ];
    for (const module of STRATEGY_MODULES) {
      const source = read(module);
      for (const provider of providers) {
        expect(source.includes(provider), `${module} references the ${provider} adapter`).toBe(false);
      }
    }
  });

  it("does not import the performance learner, so a view count cannot reach a strategic decision", () => {
    for (const module of STRATEGY_MODULES) {
      const source = read(module);
      expect(source.includes("analyzePerformance"), `${module} references the learner`).toBe(false);
      expect(source.includes('from "../../performance.ts"'), `${module} imports the learner`).toBe(false);
    }
  });

  it("reads no clock, so every pass is deterministic", () => {
    for (const module of STRATEGY_MODULES) {
      const source = read(module);
      // `new Date(` with no argument is a clock read. Constructing from a value
      // or from an offset is fine and is what the decay rules do.
      expect(/new Date\(\s*\)/.test(source), `${module} reads the wall clock`).toBe(false);
      expect(source.includes("Date.now()"), `${module} reads the wall clock`).toBe(false);
    }
  });

  it("does not weaken MASTER #2 by re-deriving what may be said", () => {
    // Strategy may READ the contract and must not build one of its own.
    for (const module of STRATEGY_MODULES) {
      expect(read(module).includes("buildResearchCreativeContract"), `${module} builds its own research contract`).toBe(false);
    }
    // And the mission must carry MASTER #2's claims rather than recompute them.
    expect(read("v2/strategy/contentMission.ts")).toContain("contract.safeClaims");
  });

  it("routes the mission compliance check through MASTER #2's shared matcher", () => {
    const loop = read("v2/strategy/closedLoop.ts");
    expect(loop).toContain('from "../research/claimMention.ts"');
  });
});

describe("formatMaster3Ledger", () => {
  it("renders every section under its status", () => {
    const text = formatMaster3Ledger();
    for (const record of MASTER3_LEDGER) expect(text).toContain(record.name);
  });
});
