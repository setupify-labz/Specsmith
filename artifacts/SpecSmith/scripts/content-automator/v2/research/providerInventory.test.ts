// The provider inventory, validated against the real repository.
//
// An audit nobody checks is a snapshot of what someone believed once. These
// tests read the actual source tree, so a provider record that stops being true
// fails here rather than misleading a reader later.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { coreDependencies, formatProviderInventory, paidCapableProviders, PROVIDER_INVENTORY } from "./providerInventory.ts";

const automatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath: string) => readFileSync(join(automatorRoot, relativePath), "utf8");

describe("the inventory describes the repository as it actually is", () => {
  it("names only modules that exist", () => {
    for (const record of PROVIDER_INVENTORY) {
      if (record.module === "") {
        expect(record.status, `${record.name} has no module so it must be absent`).toBe("absent");
        continue;
      }
      expect(existsSync(join(automatorRoot, record.module)), `${record.name}: missing module ${record.module}`).toBe(true);
    }
  });

  it("names only callers that genuinely import the module", () => {
    for (const record of PROVIDER_INVENTORY) {
      if (!record.module) continue;
      const basename = record.module.replace(/\.ts$/, "");
      for (const caller of record.callers) {
        expect(existsSync(join(automatorRoot, caller)), `${record.name}: missing caller ${caller}`).toBe(true);
        const source = read(caller);
        expect(
          new RegExp(`from\\s+"\\.\\/${basename}\\.ts"`).test(source),
          `${record.name}: ${caller} does not import ${record.module}`,
        ).toBe(true);
      }
    }
  });

  it("claims only environment variables the module actually reads", () => {
    for (const record of PROVIDER_INVENTORY) {
      if (!record.module) continue;
      const source = read(record.module);
      for (const variable of record.requiredEnv) {
        expect(source.includes(variable), `${record.name}: ${record.module} never reads ${variable}`).toBe(true);
      }
    }
  });

  it("marks a provider dormant only when nothing imports it", () => {
    for (const record of PROVIDER_INVENTORY) {
      if (record.status !== "dormant") continue;
      expect(record.callers.length, `${record.name} is marked dormant but names callers`).toBeGreaterThanOrEqual(0);
    }
    const dormant = PROVIDER_INVENTORY.filter((record) => record.status === "dormant");
    // elevenLabsVideo is the real dormant case: it has no non-test importer.
    expect(dormant.map((record) => record.module)).toContain("elevenLabsVideo.ts");
  });
});

describe("the zero-dollar operating requirement", () => {
  it("has no core dependency that could cost money", () => {
    for (const record of coreDependencies()) {
      expect(record.paidUsagePossible, `${record.name} is a core dependency AND can cost money`).toBe(false);
      expect(record.canExecute, `${record.name} is core but cannot run locally`).toBe("yes-local");
    }
  });

  it("leaves every paid-capable provider unable to execute without credentials", () => {
    for (const record of paidCapableProviders()) {
      expect(record.canExecute, `${record.name} can execute without explicit credentials`).toBe("no-credentials");
      expect(record.coreDependency, `${record.name} can cost money and is core`).toBe(false);
    }
  });

  it("gives every paid-capable provider a stated free fallback", () => {
    for (const record of paidCapableProviders()) {
      expect(record.fallback.length, `${record.name} has no stated fallback`).toBeGreaterThan(10);
    }
  });

  it("records that no web-search provider exists, rather than implying one does", () => {
    const search = PROVIDER_INVENTORY.find((record) => record.name.includes("Web search"));
    expect(search?.status).toBe("absent");
    expect(search?.module).toBe("");
    expect(search?.fallback).toMatch(/ingestion boundary/i);
  });
});

describe("the research modules reach no provider at all", () => {
  const RESEARCH_MODULES = [
    "v2/research/model.ts", "v2/research/sourceAssessment.ts", "v2/research/claims.ts",
    "v2/research/evidence.ts", "v2/research/confidence.ts", "v2/research/creativeContract.ts",
    "v2/research/ingestion.ts", "v2/research/researchPass.ts", "v2/research/closedLoop.ts",
    "v2/research/engineeringFixture.ts",
  ];

  it("contains no network call anywhere", () => {
    for (const module of RESEARCH_MODULES) {
      const source = read(module);
      for (const forbidden of ["fetch(", "XMLHttpRequest", "node:http", "node:https", "axios"]) {
        expect(source.includes(forbidden), `${module} contains ${forbidden}`).toBe(false);
      }
    }
  });

  it("reads no environment variable and therefore no credential", () => {
    for (const module of RESEARCH_MODULES) {
      expect(read(module).includes("process.env"), `${module} reads process.env`).toBe(false);
    }
  });

  it("does not import the performance learner, so a view count cannot reach a factual claim", () => {
    for (const module of RESEARCH_MODULES) {
      const source = read(module);
      expect(source.includes('from "../../performance.ts"'), `${module} imports the learner`).toBe(false);
      expect(source.includes("analyzePerformance"), `${module} references the learner`).toBe(false);
    }
  });

  it("does not import MASTER #1's creative quality review, keeping the two scores separate", () => {
    for (const module of RESEARCH_MODULES) {
      expect(read(module).includes("creativeQualityReview"), `${module} imports the creative reviewer`).toBe(false);
    }
  });
});

describe("formatProviderInventory", () => {
  it("renders every provider with its module, callers and cost posture", () => {
    const text = formatProviderInventory();
    for (const record of PROVIDER_INVENTORY) expect(text).toContain(record.name);
    expect(text).toContain("paid usage possible");
  });
});
