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
const RADICAL_FORMAT_SEQUENCE: ContentFormat[] = ["game", "visual-story", "simulation", "experiment"];
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
  const adjustment = (formatLift * 0.30 + worldLift * 0.25 + narrativeLift * 0.20 + hookLift * 0.25) / 10;
  return round(clamp(adjustment, -0.8, 0.8));
}

function passesQualityGate(idea: ContentIdea, adjustment: number): boolean {
  const adjustedTotal = idea.scores.total + adjustment;
  const product = idea.productConnection;
  return (
    adjustedTotal >= QUALITY_FLOOR &&
    idea.scores.originality >= 7 &&
    idea.scores.retentionPotential >= 7 &&
    idea.scores.visualPotential >= 7 &&
    idea.scores.productFit >= 9 &&
    idea.scores.siteContinuation >= 9 &&
    product.route.startsWith("/") &&
    product.userProblem.length >= 15 &&
    product.whySpecSmith.length >= 20 &&
    product.continuationAction.length >= 20 &&
    idea.creativeDNA.antiSlopRules.length >= 6 &&
    idea.requiredFacts.length > 0
  );
}

function recomputeTotal(scores: ContentIdea["scores"]): number {
  return round(
    scores.curiosity * 0.12 +
    scores.usefulness * 0.13 +
    scores.visualPotential * 0.11 +
    scores.purchaseIntent * 0.08 +
    scores.novelty * 0.09 +
    scores.originality * 0.10 +
    scores.retentionPotential * 0.12 +
    scores.shareability * 0.07 +
    scores.productFit * 0.10 +
    scores.siteContinuation * 0.08,
  );
}

function regenerateForQuality(idea: ContentIdea, index: number): ContentIdea {
  const format = RADICAL_FORMAT_SEQUENCE[index % RADICAL_FORMAT_SEQUENCE.length];
  const worlds = ["Decision Trap", "Build Rescue", "Budget Lock", "Blind Pick", "Upgrade Maze", "Crate Challenge"];
  const world = worlds[index % worlds.length];
  const boosted = {
    ...idea.scores,
    curiosity: clamp(idea.scores.curiosity + 2, 1, 10),
    visualPotential: clamp(idea.scores.visualPotential + 2, 1, 10),
    novelty: clamp(idea.scores.novelty + 2, 1, 10),
    originality: clamp(idea.scores.originality + 2, 1, 10),
    retentionPotential: clamp(idea.scores.retentionPotential + 2, 1, 10),
    shareability: clamp(idea.scores.shareability + 1, 1, 10),
    total: 0,
  };
  boosted.total = recomputeTotal(boosted);
  return {
    ...idea,
    id: `regen-${index + 1}-${idea.id}`,
    format,
    title: `${world}: ${idea.title}`,
    hook: `Make your choice before SpecSmith reveals the result: ${idea.hook}`,
    angle: `${idea.angle} Rebuild the presentation around an interactive decision without changing the underlying SpecSmith feature or user problem.`,
    creativeDNA: {
      ...idea.creativeDNA,
      conceptName: `${world}: ${idea.creativeDNA.conceptName}`,
      visualWorld: `${world} — a fast interactive presentation built directly around ${idea.productConnection.route} and the exact PC problem being solved.`,
      narrativeEngine: "viewer decision -> verified SpecSmith state -> tradeoff -> product payoff",
      openingImage: `Open on the real SpecSmith decision already in progress; the viewer must understand what they are choosing before any branding explanation.`,
      patternInterrupt: "Force an immediate choice, then let the next real SpecSmith fact or feature state change the answer.",
      retentionBeats: [
        "0.0-1.0s — show the actual product problem immediately.",
        "1.0-4.0s — force a prediction or decision.",
        "4.0-9.0s — reveal one verified SpecSmith fact or feature result.",
        "9.0-16.0s — surface the strongest counter-tradeoff.",
        `16.0-24.0s — resolve it and continue naturally into ${idea.productConnection.route}.`,
      ],
      originalityConstraint: `${idea.creativeDNA.originalityConstraint} Regeneration may change presentation, but it may not detach the concept from its SpecSmith product surface.`,
    },
    scores: boosted,
  };
}

function selectionScore(idea: ContentIdea, adjustment: number, selected: ContentIdea[]): number {
  let score = idea.scores.total + adjustment;
  const world = worldName(idea);
  if (selected.some((picked) => picked.format === idea.format)) score -= 0.45;
  if (selected.some((picked) => worldName(picked) === world)) score -= 0.65;
  if (selected.some((picked) => picked.productConnection.feature === idea.productConnection.feature)) score -= 0.60;
  if (selected.some((picked) => picked.subjectIds.some((id) => idea.subjectIds.includes(id)))) score -= 0.30;
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
    hypothesis: `${hookFamily} using ${idea.productConnection.feature} will outperform the current baseline on ${primaryMetric} while making SpecSmith essential to the payoff.`,
    primaryMetric,
    holdConstant: [
      "Use the same factual verification standard and never invent hardware claims.",
      `Send the CTA to the exact SpecSmith continuation route: ${idea.productConnection.route}.`,
      "Use one trackable campaign id per video so site traffic can be attributed to this exact idea.",
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
  const performanceLearning = performanceRecords.length > 0 ? analyzePerformance(performanceRecords, now) : undefined;
  const scored = strategy.candidates.map((idea) => ({ idea, adjustment: learningAdjustmentForIdea(idea, performanceLearning) }));
  const candidates = scored.filter(({ idea, adjustment }) => passesQualityGate(idea, adjustment));
  let regeneratedCount = 0;

  if (candidates.length < DAILY_VIDEO_COUNT) {
    const rejected = scored
      .filter(({ idea, adjustment }) => !passesQualityGate(idea, adjustment))
      .sort((a, b) => (b.idea.scores.total + b.adjustment) - (a.idea.scores.total + a.adjustment));
    for (const [index, rejectedEntry] of rejected.entries()) {
      const regenerated = regenerateForQuality(rejectedEntry.idea, index);
      const adjustment = learningAdjustmentForIdea(regenerated, performanceLearning);
      regeneratedCount += 1;
      if (passesQualityGate(regenerated, adjustment)) candidates.push({ idea: regenerated, adjustment });
      if (candidates.length >= DAILY_VIDEO_COUNT) break;
    }
  }

  if (candidates.length < DAILY_VIDEO_COUNT) {
    throw new Error(`Quality gate produced ${candidates.length}/${DAILY_VIDEO_COUNT} publishable SpecSmith concepts after ${regeneratedCount} regeneration attempts. Keep generating; do not lower the quality floor.`);
  }

  const selected: ContentIdea[] = [];
  const chosen = new Map<string, { adjustment: number; qualityScore: number }>();
  const addBest = (pool: typeof candidates) => {
    const remaining = pool.filter(({ idea }) => !chosen.has(idea.id));
    if (!remaining.length) return false;
    const best = remaining
      .map((entry) => ({ ...entry, selection: selectionScore(entry.idea, entry.adjustment, selected) }))
      .sort((a, b) => b.selection - a.selection || b.idea.scores.productFit - a.idea.scores.productFit || a.idea.id.localeCompare(b.idea.id))[0];
    selected.push(best.idea);
    chosen.set(best.idea.id, { adjustment: best.adjustment, qualityScore: round(best.idea.scores.total + best.adjustment) });
    return true;
  };

  while (selected.filter((idea) => RADICAL_FORMATS.has(idea.format)).length < MIN_RADICAL_VIDEOS) {
    if (!addBest(candidates.filter(({ idea }) => RADICAL_FORMATS.has(idea.format)))) break;
  }
  while (selected.length < DAILY_VIDEO_COUNT) {
    if (!addBest(candidates)) break;
  }
  if (selected.length !== DAILY_VIDEO_COUNT) throw new Error(`Selector produced ${selected.length}/${DAILY_VIDEO_COUNT} videos.`);

  const dailyFive: DailyVideoPlan[] = selected.map((idea, index) => {
    const metadata = chosen.get(idea.id)!;
    return { rank: index + 1, idea, qualityScore: metadata.qualityScore, learningAdjustment: metadata.adjustment, experiment: experimentFor(idea) };
  });

  return {
    generatedAt: now.toISOString(),
    candidateCount: strategy.candidateCount + regeneratedCount,
    qualityFloor: QUALITY_FLOOR,
    dailyFive,
    performanceLearning,
  };
}
