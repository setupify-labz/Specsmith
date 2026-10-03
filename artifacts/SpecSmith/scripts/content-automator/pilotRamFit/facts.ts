// The facts behind the "will my old DDR4 fit?" pilot Short, read from
// SpecSmith's own catalog and compatibility checker at render time.
//
// Nothing here is an FPS figure, an estimate or a benchmark. Every claim is a
// catalog specification (socket, supported RAM generation) or the verdict of
// the same checkCompatibility() the Builder runs, and the render refuses to
// start if any of them stops holding. Change the catalog and the video stops
// rendering rather than saying something the site no longer says.

import components from "../../../src/data/components.json" with { type: "json" };
import cpus from "../../../src/data/cpus.json" with { type: "json" };
import { checkCompatibility, type CompatibilityWarning } from "../../../src/lib/compatibility.ts";

export interface CatalogCpu { readonly id: string; readonly name: string; readonly socket: string; readonly supported_ram: string[]; readonly tdp_watts: number }
export interface CatalogBoard { readonly id: string; readonly name: string; readonly socket: string; readonly supported_ram: string[] }
export interface CatalogRam { readonly id: string; readonly name: string; readonly type: string }

/** The parts the video shows. Ids, not names: a renamed part fails loudly. */
export const PILOT_PARTS = {
  cpu: "i5-12400f",
  ddr4Board: "b660mpro",
  ddr5Board: "b760mawifi",
  oldRam: "cv16ddr4",
  /** Fix 1: DDR5 memory for the DDR5 board. */
  newRam: "kf16ddr5",
} as const;

export interface RamFitFacts {
  readonly cpu: CatalogCpu;
  readonly ddr4Board: CatalogBoard;
  readonly ddr5Board: CatalogBoard;
  readonly oldRam: CatalogRam;
  readonly newRam: CatalogRam;
  /** checkCompatibility(cpu, ddr5Board, oldRam): the Builder's warning, verbatim. */
  readonly mismatch: CompatibilityWarning;
  /** checkCompatibility(cpu, ddr4Board, oldRam): what passed (fix 2). */
  readonly matchPassed: readonly string[];
  /** checkCompatibility(cpu, ddr5Board, newRam): what passed (fix 1). */
  readonly newRamPassed: readonly string[];
  /** Catalog-wide: how many LGA1700 boards take each generation (none take both). */
  readonly lga1700Boards: { readonly ddr4: number; readonly ddr5: number; readonly both: number };
}

const byId = <T extends { id: string }>(list: readonly T[], id: string, kind: string): T => {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown ${kind} id ${id}; refusing to substitute another part.`);
  return found;
};

export class PilotFactError extends Error {
  constructor(message: string) {
    super(`The catalog no longer supports this video: ${message}`);
    this.name = "PilotFactError";
  }
}

export function ramFitFacts(parts: typeof PILOT_PARTS = PILOT_PARTS): RamFitFacts {
  const cpu = byId(cpus as CatalogCpu[], parts.cpu, "CPU");
  const boards = components.motherboards as CatalogBoard[];
  const ddr4Board = byId(boards, parts.ddr4Board, "motherboard");
  const ddr5Board = byId(boards, parts.ddr5Board, "motherboard");
  const oldRam = byId(components.ram as CatalogRam[], parts.oldRam, "RAM");
  const newRam = byId(components.ram as CatalogRam[], parts.newRam, "RAM");
  if (newRam.type !== "DDR5") throw new PilotFactError(`${newRam.name} is not DDR5.`);

  // "Same CPU, either board": the CPU supports both generations and fits both sockets.
  if (!cpu.supported_ram.includes("DDR4") || !cpu.supported_ram.includes("DDR5")) throw new PilotFactError(`${cpu.name} does not list both DDR4 and DDR5.`);
  if (ddr4Board.socket !== cpu.socket || ddr5Board.socket !== cpu.socket) throw new PilotFactError("the two boards do not share the CPU's socket.");
  // "Each board takes one generation."
  if (ddr4Board.supported_ram.join() !== "DDR4") throw new PilotFactError(`${ddr4Board.name} is not DDR4-only.`);
  if (ddr5Board.supported_ram.join() !== "DDR5") throw new PilotFactError(`${ddr5Board.name} is not DDR5-only.`);
  if (oldRam.type !== "DDR4") throw new PilotFactError(`${oldRam.name} is not DDR4.`);

  // The Builder's own verdicts on the two builds the video shows.
  const wrong = checkCompatibility({ cpu, motherboard: ddr5Board, ram: oldRam });
  const mismatch = wrong.warnings.find((warning) => warning.id === "ram-type-mismatch");
  if (!mismatch || mismatch.type !== "error" || mismatch.confidence !== "certain") throw new PilotFactError("the Builder no longer flags DDR4 on a DDR5 board as a certain error.");
  if (!/keyed differently/.test(mismatch.detail)) throw new PilotFactError("the Builder no longer says the generations are keyed differently.");
  // The video's two fixes are the Builder's own: "Choose DDR5 memory, or a motherboard that supports DDR4."
  if (!/DDR5 memory/.test(mismatch.fix ?? "") || !/motherboard that supports DDR4/.test(mismatch.fix ?? "")) {
    throw new PilotFactError("the Builder's fix no longer names DDR5 memory and a DDR4 motherboard.");
  }
  const fix1 = checkCompatibility({ cpu, motherboard: ddr5Board, ram: newRam });
  if (fix1.warnings.length || !fix1.passed.includes("RAM type")) throw new PilotFactError("the Builder does not pass DDR5 memory on the DDR5 board.");
  const right = checkCompatibility({ cpu, motherboard: ddr4Board, ram: oldRam });
  if (right.warnings.length || !right.passed.includes("RAM type") || !right.passed.includes("CPU socket")) {
    throw new PilotFactError("the Builder does not pass the DDR4 build cleanly.");
  }

  const lga = boards.filter((board) => board.socket === cpu.socket);
  const lga1700Boards = {
    ddr4: lga.filter((board) => board.supported_ram.join() === "DDR4").length,
    ddr5: lga.filter((board) => board.supported_ram.join() === "DDR5").length,
    both: lga.filter((board) => board.supported_ram.includes("DDR4") && board.supported_ram.includes("DDR5")).length,
  };
  return { cpu, ddr4Board, ddr5Board, oldRam, newRam, mismatch, matchPassed: right.passed, newRamPassed: fix1.passed, lga1700Boards };
}

/** The Builder URL that reproduces the warning the video ends on. */
export const builderRoute = (parts: typeof PILOT_PARTS = PILOT_PARTS) =>
  `/builder?cpu=${parts.cpu}&motherboard=${parts.ddr5Board}&ram=${parts.oldRam}`;
