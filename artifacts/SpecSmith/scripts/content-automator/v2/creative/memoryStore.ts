/** Immutable, versioned JSON records, following the publication store's local
 * directory convention. No implicit persistence, provider or publishing call. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CREATIVE_MEMORY_VERSION, CreativeMemoryError, recordCreativeDecision,
  type CreativeMemoryEntry, type RecordInput } from "./memory.ts";

export class CreativeMemoryStore {
  private readonly directory: string;
  constructor(root: string, readonly allowSynthetic = false) {
    this.directory = join(root, allowSynthetic ? "creative-memory-engineering" : "creative-memory-production");
  }
  append(input: RecordInput): CreativeMemoryEntry {
    const entry = recordCreativeDecision({ ...input, allowSynthetic: this.allowSynthetic });
    mkdirSync(this.directory, { recursive: true });
    const file = join(this.directory, `${createHash("sha256").update(entry.entryId).digest("hex")}.json`);
    const serialized = JSON.stringify(entry);
    try { writeFileSync(file, serialized, { encoding: "utf8", flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (readFileSync(file, "utf8") !== serialized) throw new CreativeMemoryError("Conflicting memory replay; use a new revision ID.");
    }
    return structuredClone(entry);
  }
  load(): CreativeMemoryEntry[] {
    let names: string[];
    try { names = readdirSync(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort().map((name) => {
      const entry = JSON.parse(readFileSync(join(this.directory, name), "utf8")) as CreativeMemoryEntry;
      if (entry.version !== CREATIVE_MEMORY_VERSION || typeof entry.entryId !== "string" ||
          !entry.decision || !entry.outcome || typeof entry.synthetic !== "boolean" ||
          !Number.isFinite(Date.parse(entry.recordedAt)) || (!this.allowSynthetic && entry.synthetic)) {
        throw new CreativeMemoryError("Malformed or incompatible memory record; refusing retrieval.");
      }
      return entry;
    });
  }
}
