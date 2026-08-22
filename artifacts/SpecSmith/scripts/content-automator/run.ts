import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import gpus from "../../src/data/gpus.json" with { type: "json" };
import cpus from "../../src/data/cpus.json" with { type: "json" };
import { buildReviewableAutomationBatch } from "./reviewableAutomator.ts";
import type { HardwareItem, VideoPerformanceRecord } from "./types.ts";

const historyPath = resolve(process.cwd(), "content-ideas/generated/performance-history.json");

async function loadPerformanceHistory(): Promise<VideoPerformanceRecord[]> {
  try {
    const raw = await readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("performance-history.json must contain a JSON array");
    return parsed as VideoPerformanceRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const performanceHistory = await loadPerformanceHistory();
const batch = buildReviewableAutomationBatch(
  gpus as HardwareItem[],
  cpus as HardwareItem[],
  performanceHistory,
);

const outputPath = resolve(process.cwd(), "content-ideas/generated/latest-strategy.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");

console.log(`Generated ${batch.candidateCount} candidate concepts.`);
console.log(`Quality floor: ${batch.qualityFloor}/10`);
console.log(`Prepared ${batch.qualityReviewRequests.length} platform review contracts.`);
console.log("Daily 5:");
for (const plan of batch.dailyFive) {
  const adjustment = plan.learningAdjustment === 0
    ? ""
    : `, learning ${plan.learningAdjustment > 0 ? "+" : ""}${plan.learningAdjustment}`;
  console.log(`${plan.rank}. [${plan.idea.format}] ${plan.idea.title} — ${plan.qualityScore}/10${adjustment}`);
}

if (batch.performanceLearning) {
  console.log(`Learning from ${batch.performanceLearning.videoCount} historical videos; baseline ${batch.performanceLearning.baselineScore}/100.`);
  for (const recommendation of batch.performanceLearning.recommendations.slice(0, 5)) {
    console.log(`- ${recommendation}`);
  }
} else {
  console.log("No performance history yet. The first batch is exploration-first.");
}

console.log(`Saved: ${outputPath}`);
