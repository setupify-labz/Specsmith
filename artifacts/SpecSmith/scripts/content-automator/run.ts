import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import gpus from "../../src/data/gpus.json" with { type: "json" };
import cpus from "../../src/data/cpus.json" with { type: "json" };
import { buildStrategyBatch } from "./strategist.ts";
import type { HardwareItem } from "./types.ts";

const batch = buildStrategyBatch(gpus as HardwareItem[], cpus as HardwareItem[]);
const outputPath = resolve(process.cwd(), "content-ideas/generated/latest-strategy.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");

console.log(`Generated ${batch.candidateCount} ranked ideas.`);
console.log("Top 4:");
for (const [index, idea] of batch.topFour.entries()) {
  const world = idea.creativeDNA.visualWorld.split(" — ")[0];
  console.log(`${index + 1}. [${idea.format}] ${idea.title} — ${idea.scores.total}/10`);
  console.log(`   Creative world: ${world}`);
  console.log(`   Hook: ${idea.hook}`);
}
console.log(`Saved: ${outputPath}`);
