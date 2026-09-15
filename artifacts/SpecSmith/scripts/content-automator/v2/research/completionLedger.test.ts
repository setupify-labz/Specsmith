// The MASTER #2 completion ledger, validated against the real source tree.
//
// This is what makes the ledger a record rather than a wish: marking a section
// `tested` requires a module that exists, a caller that genuinely imports it,
// and a test file that is really there. Editing the string is not enough.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatMaster2Ledger, MASTER2_LEDGER, SECTION_STATUSES, sectionsByStatus } from "./completionLedger.ts";

const automatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath: string) => readFileSync(join(automatorRoot, relativePath), "utf8");

/** Statuses that assert working code exists. */
const CLAIMS_CODE = ["tested", "integrated", "implemented", "partially-implemented"];
/** Statuses that assert a real production consumer. */
const CLAIMS_CALLER = ["tested", "integrated"];
/** Statuses that must not quietly claim artefacts they do not have. */
const CLAIMS_NOTHING = ["blocked-external", "blocked-data", "deferred-to-master", "not-applicable"];

const BRIEF_SECTIONS = Array.from({ length: 78 }, (_, index) => index + 1);

describe("ledger shape", () => {
  it("covers every numbered section of the MASTER #2 brief exactly once", () => {
    const sections = MASTER2_LEDGER.map((record) => record.section).sort((a, b) => a - b);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections).toEqual(BRIEF_SECTIONS);
  });

  it("uses only declared statuses and always explains itself", () => {
    for (const record of MASTER2_LEDGER) {
      expect(SECTION_STATUSES, `§${record.section}`).toContain(record.status);
      expect(record.note.length, `§${record.section} needs a real note`).toBeGreaterThan(40);
    }
  });
});

describe("every claim in the ledger is true of the repository", () => {
  it("names only modules that exist", () => {
    for (const record of MASTER2_LEDGER) {
      for (const module of record.modules) {
        expect(existsSync(join(automatorRoot, module)), `§${record.section} names missing module ${module}`).toBe(true);
      }
    }
  });

  it("names only tests that exist", () => {
    for (const record of MASTER2_LEDGER) {
      for (const test of record.tests) {
        expect(existsSync(join(automatorRoot, test)), `§${record.section} names missing test ${test}`).toBe(true);
      }
    }
  });

  it("requires a claimed caller to genuinely import one of the section's modules", () => {
    for (const record of MASTER2_LEDGER) {
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
      expect(record.tests.length, `§${record.section} claims tested with no test file`).toBeGreaterThan(0);
    }
  });

  it("requires an implemented-or-better section to name a module", () => {
    for (const record of MASTER2_LEDGER) {
      if (!CLAIMS_CODE.includes(record.status)) continue;
      expect(record.modules.length, `§${record.section} is ${record.status} but names no module`).toBeGreaterThan(0);
    }
  });

  it("refuses a blocked or deferred section that quietly claims callers or tests", () => {
    for (const record of MASTER2_LEDGER) {
      if (!CLAIMS_NOTHING.includes(record.status)) continue;
      expect(record.callers, `§${record.section} is ${record.status} but names callers`).toEqual([]);
      expect(record.tests, `§${record.section} is ${record.status} but names tests`).toEqual([]);
    }
  });

  it("has no section stuck at 'implemented' — a module nothing calls is dead code", () => {
    expect(sectionsByStatus("implemented").map((record) => record.name)).toEqual([]);
  });
});

describe("the ledger is honest about what is not built", () => {
  it("records a real blocker count rather than claiming everything", () => {
    const blocked = MASTER2_LEDGER.filter((record) => record.status.startsWith("blocked") || record.status === "deferred-to-master");
    // If this ever reaches zero, either the work genuinely finished or someone
    // started marking blocked sections done. Both deserve a look.
    expect(blocked.length).toBeGreaterThan(0);
    for (const record of blocked) {
      expect(record.note, `§${record.section} must say WHY it is blocked`).toMatch(/\b(need|needs|require|requires|blocked|nothing|zero|does not exist|no )/i);
    }
  });

  it("names the web-access blocker as the reason planning and search are not built", () => {
    const planning = MASTER2_LEDGER.find((record) => record.section === 21)!;
    expect(planning.status).toBe("blocked-external");
    expect(planning.note).toMatch(/no autonomous web access/i);
  });

  it("marks the integration target as genuinely wired into the pipeline", () => {
    const target = MASTER2_LEDGER.find((record) => record.section === 77)!;
    expect(target.status).toBe("tested");
    expect(target.callers).toContain("endToEndOfflinePipeline.ts");
    // And the pipeline really does run it.
    expect(read("endToEndOfflinePipeline.ts")).toContain("runResearchClosedLoop");
  });
});

describe("formatMaster2Ledger", () => {
  it("renders every section under its status", () => {
    const text = formatMaster2Ledger();
    for (const record of MASTER2_LEDGER) expect(text).toContain(record.name);
  });
});
