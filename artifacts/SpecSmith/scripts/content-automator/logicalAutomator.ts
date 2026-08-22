import { buildStrategyBatch } from "./strategist.ts";
import { analyzePerformance } from "./performance.ts";
import type {
  AutomationBatch,
  ContentFormat,
  ContentIdea,
  DailyVideoPlan,
  FactorLearning,
  HardwareItem,
  PerformanceLearning,
  VideoPerformanceRecord,
} from "./types.ts";

const DAILY_VIDEO_COUNT = 5;
const QUALITY_FLOOR = 7.5;
const RADICAL_FORMATS = new Set<ContentFormat>(["experiment", "visual-story", "game", "simulation"]);
const MIN_RADICAL_VIDEOS = 3;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function worldName(idea: ContentIdea): string {
  return idea.creativeDNA.visualWorld.split(" — ")[0].trim();
}

export function hookFamilyOfIdea(idea: ContentIdea): string {
  if (idea.format === "game") return "interactive-choice";
  if (idea.format === "buyer-warning") return "buyer-warning";
  if (idea.format === "comparison") return "price-gap-comparison";
  if (idea.format === "visual-story") return "visual-metaphor";
  if (idea.format === "simulation") return "rules-based-simulation";
  if (idea.format === "experiment") return "story-experiment";
  if (idea.format === "value") return "value-reveal";
  if (idea.format === "build") return "budget-allocation";
  return "curiosity-reveal";
}

function provenLift(learning: FactorLearning[] | undefined, factor: string): number {
  if (!learning) return 0;
  const match = learning.find((entry) => entry.factor === factor);
  if (!match || match.sampleSize < 3 || match.status === "explore") return 0;
  return match.liftVsBaseline;
}

export function learningAdjustmentForIdea(idea: ContentIdea, learning?: PerformanceLearning): number {
  if (!learning || learning.videoCount < 3) return 0;

  const formatLift = provenLift(learning.byFormat, idea.format);
  const worldLift = provenLift(learning.byVisualWorld, worldName(idea));
  const narrativeLift = provenLift(learning.byNarrativeEngine, idea.creativeDNA.narrativeEngine);
  const hookLift = provenLift(learning.byHookFamily, hookFamilyOfIdea(idea));

  // Performance lives on a 0..100 scale while creative quality lives on 1..10.
  // Keep historical feedback deliberately bounded so yesterday cannot erase exploration.
  const adjustment = (
    formatLift * 0.30 +
    worldLift * 0.25 +
    narrativeLift * 0.20 +
    hookLift * 0.25
  ) / 10;

  return round(clamp(adjustment, -0.8, 0.8));
}

function passesQualityGate(idea: ContentIdea, adjustment: number): boolean {
  const adjustedTotal = idea.scores.total + adjustment;
  return (
    adjustedTotal >= QUALITY_FLOOR &&
    idea.scores.originality >= 7 &&
    idea.scores.retentionPotential >= 7 &&
    idea.scores.visualPotential >= 7 &&
    idea.creativeDNA.antiSlopRules.length >= 6 &&
    idea.requiredFacts.length > 0
  );
}

function selectionScore(idea: ContentIdea, adjustment: number, selected: ContentIdea[]): number {
  let score = idea.scores.total + adjustment;
  const world = worldName(idea);

  // Diversity is a quality constraint, not decoration. Five clones do not teach us anything.
  if (selected.some((picked) => picked.format === idea.format)) score -= 0.45;
  if (selected.some((picked) => worldName(picked) === world)) score -= 0.65;
  if (selected.some((picked) => picked.subjectIds.some((id) => idea.subjectIds.includes(id)))) score -= 0.30;

  // Preserve some exploration even after performance history exists.
  if (RADICAL_FORMATS.has(idea.format)) score += 0.15;
  return score;
}

function experimentFor(idea: ContentIdea): DailyVideoPlan["experiment"] {
  const hookFamily = hookFamilyOfIdea(idea);
  const primaryMetric: DailyVideoPlan["experiment"]["primaryMetric"] =
    idea.format === "game" ? "hook"
      : idea.format === "visual-story" || idea.format === "simulation" ? "retention"
        : idea.format === "buyer-warning" || idea.format === "comparison" || idea.format === "value" ? "site-clicks"
          : "shares";

  return {
    hypothesis: `${hookFamily} + ${worldName(idea)} will outperform the current baseline on ${primaryMetric} without sacrificing factual accuracy.`,
    primaryMetric,
    holdConstant: [
      "Use the same factual verification standard and never invent hardware claims.",
      "Use one trackable campaign id per video so site traffic can be attributed back to this exact idea.",
      "Do not change multiple core creative variables merely to rescue a weak result; preserve learnable experiments.",
    ],
  };
}

export function buildAutomationBatch(
  gpus: HardwareItem[],
  cpus: HardwareItem[],
  performanceRecords: VideoPerformanceRecord[] = [],
  now = new Date(),
): AutomationBatch {
  const strategy = buildStrategyBatch(gpus, cpus, now);
  const performanceLearning = performanceRecords.length > 0
    ? analyzePerformance(performanceRecords, now)
    : undefined;

  const candidates = strategy.candidates
    .map((idea) => ({
      idea,
      adjustment: learningAdjustmentForIdea(idea, performanceLearning),
    }))
    .filter(({ idea, adjustment }) => passesQualityGate(idea, adjustment));

  if (candidates.length < DAILY_VIDEO_COUNT) {
    throw new Error(
      `Quality gate produced ${candidates.length}/${DAILY_VIDEO_COUNT} publishable concepts. Regenerate concepts; do not lower the quality floor.`,
    );
  }

  const selected: ContentIdea[] = [];
  const chosen = new Map<string, { adjustment: number; qualityScore: number }>();

  const addBest = (pool: typeof candidates) => {
    const remaining = pool.filter(({ idea }) => !chosen.has(idea.id));
    if (!remaining.length) return false;
    const best = remaining
      .map((entry) => ({ ...entry, selection: selectionScore(entry.idea, entry.adjustment, selected) }))
      .sort((a, b) => b.selection - a.selection || b.idea.scores.originality - a.idea.scores.originality || a.idea.id.localeCompare(b.idea.id))[0];
    selected.push(best.idea);
    chosen.set(best.idea.id, {
      adjustment: best.adjustment,
      qualityScore: round(best.idea.scores.total + best.adjustment),
    });
    return true;
  };

  // Three of five slots must be radical enough to expand the creative frontier.
  while (selected.filter((idea) => RADICAL_FORMATS.has(idea.format)).length < MIN_RADICAL_VIDEOS) {
    if (!addBest(candidates.filter(({ idea }) => RADICAL_FORMATS.has(idea.format)))) break;
  }

  while (selected.length < DAILY_VIDEO_COUNT) {
    if (!addBest(candidates)) break;
  }

  if (selected.length !== DAILY_VIDEO_COUNT) {
    throw new Error(`Selector produced ${selected.length}/${DAILY_VIDEO_COUNT} videos. Refuse to ship an incomplete daily batch.`);
  }

  const dailyFive: DailyVideoPlan[] = selected.map((idea, index) => {
    const metadata = chosen.get(idea.id)!;
    return {
      rank: index + 1,
      idea,
      qualityScore: metadata.qualityScore,
      learningAdjustment: metadata.adjustment,
      experiment: experimentFor(idea),
    };
  });

  return {
    generatedAt: now.toISOString(),
    candidateCount: strategy.candidateCount,
    qualityFloor: QUALITY_FLOOR,
    dailyFive,
    performanceLearning,
  };
}
