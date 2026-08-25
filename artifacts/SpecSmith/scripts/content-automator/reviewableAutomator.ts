import { buildAutomationBatch } from "./logicalAutomator.ts";
import type { CreativeRuntimeMetadata } from "./creativeFingerprint.ts";
import { buildQualityReviewRequests, type QualityReviewRequest } from "./qualityReviewer.ts";
import type { AutomationBatch, HardwareItem, VideoPerformanceRecord } from "./types.ts";

export type ReviewableAutomationBatch = AutomationBatch & {
  qualityReviewRequests: QualityReviewRequest[];
};

export function buildReviewableAutomationBatch(
  gpus: HardwareItem[],
  cpus: HardwareItem[],
  performanceRecords: VideoPerformanceRecord[] = [],
  now = new Date(),
  creativeRuntimeDefaults: CreativeRuntimeMetadata = {},
): ReviewableAutomationBatch {
  const batch = buildAutomationBatch(gpus, cpus, performanceRecords, now, creativeRuntimeDefaults);
  const qualityReviewRequests = buildQualityReviewRequests(
    batch.contentPackages,
    batch.scriptStoryboards,
    batch.productionPlans,
  );

  return {
    ...batch,
    qualityReviewRequests,
  };
}
