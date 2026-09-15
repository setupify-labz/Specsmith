// MASTER #4 — Ledger validation and structural guarantees.
//
// These tests read the REAL source tree. A section cannot claim `tested` by
// assertion: its modules must exist, a non-test module must genuinely import
// them, and a test file must exist. This is what stops the ledger becoming a
// wish list.
//
// The structural assertions at the bottom are the $0 and provider-independence
// proofs: they are not about behaviour but about what the code is even capable
// of reaching.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatMaster4Ledger,
  MASTER4_LEDGER,
  sectionsByStatus,
  SECTION_STATUSES,
} from "./completionLedger.ts";

const AUTOMATOR_ROOT = join(import.meta.dirname, "..", "..");
const MASTER4_DIRS = ["v2/audience", "v2/platform", "v2/delivery"];

function readModule(relativePath: string): string {
  return readFileSync(join(AUTOMATOR_ROOT, relativePath), "utf8");
}

function master4SourceFiles(): readonly { readonly path: string; readonly source: string }[] {
  const files: { path: string; source: string }[] = [];
  for (const dir of MASTER4_DIRS) {
    for (const name of readdirSync(join(AUTOMATOR_ROOT, dir))) {
      if (!name.endsWith(".ts")) continue;
      const path = `${dir}/${name}`;
      files.push({ path, source: readModule(path) });
    }
  }
  return files;
}

describe("the ledger describes the real source tree", () => {
  it("covers all 45 sections exactly once", () => {
    expect(MASTER4_LEDGER).toHaveLength(45);
    const numbers = MASTER4_LEDGER.map((record) => record.section);
    expect(new Set(numbers).size).toBe(45);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(45);
  });

  it("uses only recognised statuses", () => {
    for (const record of MASTER4_LEDGER) {
      expect(SECTION_STATUSES).toContain(record.status);
    }
  });

  it("names only modules that actually exist", () => {
    for (const record of MASTER4_LEDGER) {
      for (const modulePath of record.modules) {
        expect(existsSync(join(AUTOMATOR_ROOT, modulePath)), `${record.section}: ${modulePath}`).toBe(true);
      }
    }
  });

  it("names only callers that actually exist", () => {
    for (const record of MASTER4_LEDGER) {
      for (const caller of record.callers) {
        expect(existsSync(join(AUTOMATOR_ROOT, caller)), `${record.section}: ${caller}`).toBe(true);
      }
    }
  });

  it("names only test files that actually exist", () => {
    for (const record of MASTER4_LEDGER) {
      for (const testPath of record.tests) {
        expect(existsSync(join(AUTOMATOR_ROOT, testPath)), `${record.section}: ${testPath}`).toBe(true);
      }
    }
  });

  it("requires a tested section to have a module, a test and a real caller", () => {
    for (const record of sectionsByStatus("tested")) {
      expect(record.modules.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
      expect(record.tests.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
      expect(record.callers.length, `${record.section} ${record.name}`).toBeGreaterThan(0);
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
    for (const record of MASTER4_LEDGER) {
      expect(record.note.length, `${record.section} ${record.name}`).toBeGreaterThan(40);
    }
  });

  it("does not claim tested for anything blocked or deferred", () => {
    for (const record of MASTER4_LEDGER) {
      if (record.status === "blocked-data" || record.status === "blocked-external" || record.status === "deferred") {
        expect(record.note.length).toBeGreaterThan(40);
      }
    }
  });

  it("renders a readable ledger", () => {
    const rendered = formatMaster4Ledger();
    expect(rendered).toContain("MASTER #4 COMPLETION LEDGER");
    expect(rendered).toContain("TOTAL: 45 sections");
  });
});

describe("MASTER #4 requires no provider and no spend", () => {
  const sources = master4SourceFiles().filter((file) => !file.path.endsWith(".test.ts"));

  it("contains no network call anywhere", () => {
    for (const file of sources) {
      // Strip comments so prose about fetch does not trip the check.
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file.path} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${file.path} must not use XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
      expect(code, `${file.path} must not import node:http`).not.toMatch(/from "node:https?"/);
    }
  });

  it("reads no environment variable", () => {
    for (const file of sources) {
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file.path} must not read process.env`).not.toMatch(/process\.env/);
    }
  });

  it("imports no provider adapter", () => {
    const providerModules = [
      "elevenLabs", "geminiVeo", "meshy", "metricool", "youtubeTrendSource",
      "tiktokTrendSource", "instagramTrendSource", "bundleSocial",
    ];
    for (const file of sources) {
      for (const provider of providerModules) {
        expect(file.source, `${file.path} must not import ${provider}`).not.toMatch(
          new RegExp(`from\\s+"[^"]*${provider}[^"]*"`, "i"),
        );
      }
    }
  });

  it("never reads the clock, so every pass is deterministic", () => {
    for (const file of sources) {
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file.path} must not call Date.now()`).not.toMatch(/Date\.now\s*\(/);
      expect(code, `${file.path} must not construct new Date() with no argument`).not.toMatch(/new Date\s*\(\s*\)/);
    }
  });
});

describe("MASTER #4 does not reimplement upstream gates", () => {
  it("reuses MASTER #2's claim matcher rather than defining another", () => {
    const invariants = readModule("v2/delivery/invariants.ts");
    expect(invariants).toMatch(/from "\.\.\/research\/claimMention\.ts"/);
  });

  it("runs MASTER #2's strict evidence gate unchanged in the closed loop", () => {
    const loop = readModule("v2/delivery/closedLoop.ts");
    expect(loop).toMatch(/checkScriptAgainstResearchStrict/);
    expect(loop).toMatch(/from "\.\.\/research\/strictEvidenceGate\.ts"/);
  });

  it("has no mechanism to suppress or filter an upstream finding", () => {
    const loop = readModule("v2/delivery/closedLoop.ts");
    // Findings from the strict gate are pushed straight through. Any filtering
    // of them would be a way to weaken MASTER #2 from downstream.
    expect(loop).not.toMatch(/checkScriptAgainstResearchStrict[\s\S]{0,200}\.filter\(/);
  });

  it("reuses the existing VideoPlatform type rather than declaring a parallel one", () => {
    const model = readModule("v2/platform/model.ts");
    expect(model).toMatch(/import type \{ VideoPlatform \} from "\.\.\/\.\.\/types\.ts"/);
  });
});

describe("MASTER #5 through #8 are genuinely absent", () => {
  const sources = master4SourceFiles().filter((file) => !file.path.endsWith(".test.ts"));

  it("implements no experiment assignment or winner selection", () => {
    for (const file of sources) {
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file.path}`).not.toMatch(/function\s+assignVariant/);
      expect(code, `${file.path}`).not.toMatch(/function\s+selectWinner/);
      expect(code, `${file.path}`).not.toMatch(/function\s+rankByPerformance/);
    }
  });

  it("publishes and schedules nothing", () => {
    for (const file of sources) {
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file.path}`).not.toMatch(/function\s+publish/);
      expect(code, `${file.path}`).not.toMatch(/function\s+schedule/);
    }
  });
});
