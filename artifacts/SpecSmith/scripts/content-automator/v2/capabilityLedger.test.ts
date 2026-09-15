// The test that makes the capability ledger mean something.
//
// A status field is worthless if it is just a string someone typed. This file
// reads the REAL source tree and refuses the ledger's claims unless they hold:
// a capability cannot claim `integrated` unless a named caller genuinely
// imports one of its modules, and cannot claim `verified` unless a test file
// covering it exists. Marking something verified therefore requires doing the
// work, not editing a string.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CAPABILITY_LEDGER, CAPABILITY_STATUSES, formatLedger, ledgerByStatus } from "./capabilityLedger.ts";

const automatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAIMS_ARTEFACTS = ["implemented", "integrated", "verified", "in-progress"];
const CLAIMS_NOTHING = ["not-started", "blocked-external", "blocked-human", "rejected-not-useful"];
/** Every section of the V2 brief must be accounted for, including refusals. */
const ROADMAP_SECTIONS = Array.from({ length: 35 }, (_, index) => index + 1);

function read(relativePath: string): string {
  return readFileSync(join(automatorRoot, relativePath), "utf8");
}

describe("capability ledger shape", () => {
  it("covers every roadmap section exactly once", () => {
    const sections = CAPABILITY_LEDGER.map((record) => record.section).sort((a, b) => a - b);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections).toEqual(ROADMAP_SECTIONS);
  });

  it("uses only declared statuses and always explains itself", () => {
    for (const record of CAPABILITY_LEDGER) {
      expect(CAPABILITY_STATUSES, `section ${record.section}`).toContain(record.status);
      expect(record.note.length, `section ${record.section} must carry a note`).toBeGreaterThan(20);
      expect(record.name.length, `section ${record.section} must be named`).toBeGreaterThan(0);
    }
  });
});

describe("capability ledger claims are true of the real source tree", () => {
  it("names only modules that actually exist", () => {
    for (const record of CAPABILITY_LEDGER) {
      for (const module of record.modules) {
        expect(existsSync(join(automatorRoot, module)), `section ${record.section} names missing module ${module}`).toBe(true);
      }
    }
  });

  it("requires a claimed caller to genuinely import one of the capability's modules", () => {
    for (const record of CAPABILITY_LEDGER) {
      if (record.status !== "integrated" && record.status !== "verified") continue;
      expect(record.callers.length, `section ${record.section} claims ${record.status} with no caller`).toBeGreaterThan(0);

      for (const caller of record.callers) {
        expect(existsSync(join(automatorRoot, caller)), `section ${record.section} names missing caller ${caller}`).toBe(true);
        const source = read(caller);
        const imports = record.modules.some((module) => {
          const basename = module.replace(/^.*\//, "").replace(/\.ts$/, "");
          return new RegExp(`from\\s+"[^"]*${basename}\\.ts"`).test(source);
        });
        expect(imports, `section ${record.section}: ${caller} does not import any of ${record.modules.join(", ")}`).toBe(true);
      }
    }
  });

  it("requires a verified capability to name a test file that exists", () => {
    for (const record of ledgerByStatus("verified")) {
      expect(record.tests.length, `section ${record.section} claims verified with no test`).toBeGreaterThan(0);
      for (const test of record.tests) {
        expect(existsSync(join(automatorRoot, test)), `section ${record.section} names missing test ${test}`).toBe(true);
      }
    }
  });

  it("refuses a blocked or not-started capability that quietly claims modules, callers or tests", () => {
    for (const record of CAPABILITY_LEDGER) {
      if (!CLAIMS_NOTHING.includes(record.status)) continue;
      expect(record.modules, `section ${record.section} is ${record.status} but names modules`).toEqual([]);
      expect(record.callers, `section ${record.section} is ${record.status} but names callers`).toEqual([]);
      expect(record.tests, `section ${record.section} is ${record.status} but names tests`).toEqual([]);
    }
  });

  it("refuses an implemented-or-better capability that names no module", () => {
    for (const record of CAPABILITY_LEDGER) {
      if (!CLAIMS_ARTEFACTS.includes(record.status)) continue;
      expect(record.modules.length, `section ${record.section} is ${record.status} but names no module`).toBeGreaterThan(0);
    }
  });

  it("has no capability stuck at 'implemented' — a module nothing calls is dead code", () => {
    // `implemented` is a legal status, but a capability that stays there is
    // architecture theatre by this repository's own rule. Reaching it means
    // either wiring the module up or deleting it.
    expect(ledgerByStatus("implemented").map((record) => record.name)).toEqual([]);
  });
});

describe("formatLedger", () => {
  it("renders every capability under its status", () => {
    const text = formatLedger();
    for (const record of CAPABILITY_LEDGER) {
      expect(text).toContain(record.name);
    }
  });
});
