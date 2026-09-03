import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createFullDryRunRegistry, renderProductionPackage } from "./rendering.ts";
import type { AutomationBatch } from "./types.ts";

const strategyPath = resolve(process.cwd(), "content-ideas/generated/latest-strategy.json");
const outputPath = resolve(process.cwd(), "content-ideas/generated/latest-render-dry-run.json");

const raw = await readFile(strategyPath, "utf8");
const batch = JSON.parse(raw) as AutomationBatch;
if (!Array.isArray(batch.productionPlans) || batch.productionPlans.length === 0) {
  throw new Error("latest-strategy.json does not contain production plans; run content:strategist first");
}

const registry = createFullDryRunRegistry();
const results = [];
for (const productionPackage of batch.productionPlans) {
  results.push(...await renderProductionPackage(productionPackage, registry, { maxAttemptsPerCapability: 1 }));
}

const failed = results.filter((result) => result.status !== "succeeded");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), dryRun: true, results }, null, 2)}\n`, "utf8");

console.log(`Rendering dry run executed ${results.length} platform renders across ${batch.productionPlans.length} content packages.`);
console.log(`Succeeded: ${results.length - failed.length}; failed: ${failed.length}.`);
console.log(`Saved: ${outputPath}`);

if (failed.length > 0) {
  throw new Error(`Rendering dry run failed for ${failed.length}/${results.length} platform renders`);
}
