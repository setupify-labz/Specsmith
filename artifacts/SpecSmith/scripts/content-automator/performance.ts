import type {
  FactorLearning,
  PerformanceLearning,
  PerformanceScore,
  RetentionPoint,
  VideoPerformanceRecord,
} from "./types.ts";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function asRatio(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return value > 1 ? value / 100 : value;
}

function ratePerThousand(count: number | undefined, views: number): number | null {
  if (count === undefined || views <= 0 || !Number.isFinite(count) || count < 0) return null;
  return (count / views) * 1000;
}

function weightedAverage(parts: Array<{ value: number | null; weight: number }>): number | null {
  const available = parts.filter((part): part is { value: number; weight: number } => part.value !== null);
  if (available.length === 0) return null;
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  return available.reduce((sum, part) => sum + part.value * part.weight, 0) / weight;
}

function retentionAt(curve: RetentionPoint[] | undefined, elapsedRatio: number): number | null {
  if (!curve?.length) return null;
  const valid = curve.filter((point) =>
    Number.isFinite(point.elapsedRatio) &&
    Number.isFinite(point.audienceRatio) &&
    point.elapsedRatio >= 0 &&
    point.elapsedRatio <= 1 &&
    point.audienceRatio >= 0,
  );
  if (!valid.length) return null;
  const nearest = valid.reduce((best, point) =>
    Math.abs(point.elapsedRatio - elapsedRatio) < Math.abs(best.elapsedRatio - elapsedRatio) ? point : best,
  );
  return nearest.audienceRatio;
}

function voiceLabel(record: VideoPerformanceRecord): string {
  const name = record.voiceName?.trim();
  const id = record.voiceId?.trim();
  if (name && id) return `${name} [${id}]`;
  return name || id || "";
}

export function scoreVideo(record: VideoPerformanceRecord): PerformanceScore {
  const opportunityCount = Math.max(record.shownOrImpressions ?? 0, record.reach ?? 0, record.views, 0);

  const stayedRate = asRatio(record.stayedToWatchRate) ?? (
    record.shownOrImpressions && record.engagedViews !== undefined
      ? record.engagedViews / record.shownOrImpressions
      : null
  );
  const hook = stayedRate === null ? null : clamp(stayedRate * 100);

  const averagePercent = asRatio(record.averagePercentageViewed) ?? (
    record.averageViewDurationSeconds !== undefined && record.durationSeconds > 0
      ? record.averageViewDurationSeconds / record.durationSeconds
      : null
  );
  const nearCompletion = retentionAt(record.retentionCurve, 0.95) ?? asRatio(record.fullVideoWatchedRate);
  const retention = weightedAverage([
    { value: averagePercent === null ? null : clamp(averagePercent * 100, 0, 120), weight: 0.65 },
    { value: nearCompletion === null ? null : clamp(nearCompletion * 100, 0, 120), weight: 0.35 },
  ]);

  const likeRate = ratePerThousand(record.likes, record.views);
  const commentRate = ratePerThousand(record.comments, record.views);
  const shareRate = ratePerThousand(record.shares, record.views);
  const saveRate = ratePerThousand(record.saves, record.views);
  const engagement = weightedAverage([
    { value: likeRate === null ? null : clamp((likeRate / 60) * 100), weight: 0.15 },
    { value: commentRate === null ? null : clamp((commentRate / 8) * 100), weight: 0.20 },
    { value: shareRate === null ? null : clamp((shareRate / 10) * 100), weight: 0.40 },
    { value: saveRate === null ? null : clamp((saveRate / 12) * 100), weight: 0.25 },
  ]);

  const followRate = ratePerThousand(record.followsGained, record.views);
  const siteClickRate = ratePerThousand(record.siteClicks, record.views);
  const builderStartRate = ratePerThousand(record.builderStarts, record.views);
  const affiliateClickRate = ratePerThousand(record.affiliateClicks, record.views);
  const conversion = weightedAverage([
    { value: followRate === null ? null : clamp((followRate / 10) * 100), weight: 0.20 },
    { value: siteClickRate === null ? null : clamp((siteClickRate / 20) * 100), weight: 0.40 },
    { value: builderStartRate === null ? null : clamp((builderStartRate / 10) * 100), weight: 0.25 },
    { value: affiliateClickRate === null ? null : clamp((affiliateClickRate / 5) * 100), weight: 0.15 },
  ]);

  // Raw view count is deliberately excluded. Distribution is an opportunity, not proof of quality.
  const overall = weightedAverage([
    { value: hook, weight: 0.30 },
    { value: retention, weight: 0.35 },
    { value: engagement, weight: 0.20 },
    { value: conversion, weight: 0.15 },
  ]) ?? 0;

  const confidence: PerformanceScore["confidence"] = opportunityCount >= 5000
    ? "high"
    : opportunityCount >= 500
      ? "medium"
      : "low";

  return {
    videoId: record.videoId,
    opportunityCount,
    hook: hook === null ? null : round(hook),
    retention: retention === null ? null : round(retention),
    engagement: engagement === null ? null : round(engagement),
    conversion: conversion === null ? null : round(conversion),
    overall: round(overall),
    confidence,
  };
}

function confidenceWeight(score: PerformanceScore): number {
  if (score.confidence === "high") return 1;
  if (score.confidence === "medium") return 0.6;
  return 0.25;
}

function learnFactor(
  records: VideoPerformanceRecord[],
  scores: Map<string, PerformanceScore>,
  factorOf: (record: VideoPerformanceRecord) => string,
  baseline: number,
  options: {
    minimumSamples?: number;
    minimumConfidenceWeight?: number;
    sampleKeyOf?: (record: VideoPerformanceRecord) => string;
  } = {},
): FactorLearning[] {
  const groups = new Map<string, VideoPerformanceRecord[]>();
  for (const record of records) {
    const factor = factorOf(record).trim();
    // "unknown"/"unassigned" are absence sentinels, not creative choices.
    // Grouping them produced learnings like "unknown first-visual performs
    // well", which is a statement about missing metadata, not about creative.
    if (!factor || factor === "unknown" || factor === "unassigned") continue;
    const group = groups.get(factor) ?? [];
    group.push(record);
    groups.set(factor, group);
  }

  return [...groups.entries()].map(([factor, group]) => {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (const record of group) {
      const score = scores.get(record.videoId);
      if (!score) continue;
      const weight = confidenceWeight(score);
      weightedTotal += score.overall * weight;
      weightTotal += weight;
    }
    const observed = weightTotal > 0 ? weightedTotal / weightTotal : baseline;
    const sampleSize = new Set(group.map((record) => options.sampleKeyOf?.(record) ?? record.videoId)).size;

    // Three baseline-equivalent prior samples stop one lucky upload from becoming a fake rule.
    const priorWeight = 3;
    const shrunk = ((observed * sampleSize) + (baseline * priorWeight)) / (sampleSize + priorWeight);
    const lift = shrunk - baseline;
    const enoughEvidence = sampleSize >= (options.minimumSamples ?? 3) &&
      weightTotal >= (options.minimumConfidenceWeight ?? 0);
    const status: FactorLearning["status"] = !enoughEvidence
      ? "explore"
      : lift >= 5
        ? "promote"
        : lift <= -5
          ? "retire"
          : "neutral";

    return {
      factor,
      sampleSize,
      weightedScore: round(shrunk),
      liftVsBaseline: round(lift),
      status,
    };
  }).sort((a, b) => b.liftVsBaseline - a.liftVsBaseline || b.sampleSize - a.sampleSize || a.factor.localeCompare(b.factor));
}

export function analyzePerformance(records: VideoPerformanceRecord[], now = new Date()): PerformanceLearning {
  const videos = records.map(scoreVideo);
  const scoreMap = new Map(videos.map((score) => [score.videoId, score]));

  const usable = videos.filter((score) => score.opportunityCount > 0);
  const totalWeight = usable.reduce((sum, score) => sum + confidenceWeight(score), 0);
  const baselineScore = totalWeight > 0
    ? usable.reduce((sum, score) => sum + score.overall * confidenceWeight(score), 0) / totalWeight
    : 0;

  const byPlatform = learnFactor(records, scoreMap, (record) => record.platform, baselineScore);
  const byFormat = learnFactor(records, scoreMap, (record) => record.format, baselineScore);
  const byVisualWorld = learnFactor(records, scoreMap, (record) => record.visualWorld, baselineScore);
  const byNarrativeEngine = learnFactor(records, scoreMap, (record) => record.narrativeEngine, baselineScore);
  const byHookFamily = learnFactor(records, scoreMap, (record) => record.hookFamily, baselineScore);
  const byDurationBucket = learnFactor(records, scoreMap, (record) => record.durationBucket, baselineScore);
  const byFirstVisualType = learnFactor(records, scoreMap, (record) => record.firstVisualType ?? "", baselineScore);
  const byEditDensity = learnFactor(records, scoreMap, (record) => record.editDensity ?? "", baselineScore);
  const byCaptionDensity = learnFactor(records, scoreMap, (record) => record.captionDensity ?? "", baselineScore);
  const byCtaFamily = learnFactor(records, scoreMap, (record) => record.ctaFamily ?? "", baselineScore);
  const byHashtagStrategy = learnFactor(records, scoreMap, (record) => record.hashtagStrategy ?? "", baselineScore);
  const voiceLearningOptions = {
    minimumSamples: 15,
    // Fifteen medium-confidence posts equal 9 effective samples. This prevents
    // a pile of near-zero-distribution uploads from authorizing a voice change.
    minimumConfidenceWeight: 9,
    // Cross-posting one creative to three platforms is still one creative
    // experiment for the voice-switch gate.
    sampleKeyOf: (record: VideoPerformanceRecord) => record.ideaId.trim() || record.creativeId?.trim() || record.videoId,
  };
  const byVoice = learnFactor(records, scoreMap, voiceLabel, baselineScore, voiceLearningOptions);
  const byVoiceAndFormat = learnFactor(
    records,
    scoreMap,
    (record) => {
      const voice = voiceLabel(record);
      return voice ? `${voice} × ${record.format}` : "";
    },
    baselineScore,
    voiceLearningOptions,
  );

  const recommendations: string[] = [];
  const creativeLearnings = [
    ...byFormat,
    ...byVisualWorld,
    ...byNarrativeEngine,
    ...byHookFamily,
    ...byDurationBucket,
    ...byFirstVisualType,
    ...byEditDensity,
    ...byCaptionDensity,
    ...byCtaFamily,
    ...byHashtagStrategy,
  ];
  const voiceLearnings = [...byVoice, ...byVoiceAndFormat];
  const promoted = creativeLearnings.filter((learning) => learning.status === "promote").slice(0, 5);
  const retired = creativeLearnings
    .filter((learning) => learning.status === "retire")
    .sort((a, b) => a.liftVsBaseline - b.liftVsBaseline)
    .slice(0, 3);
  const explore = creativeLearnings
    .filter((learning) => learning.status === "explore")
    .sort((a, b) => a.sampleSize - b.sampleSize)
    .slice(0, 3);

  for (const learning of promoted) {
    recommendations.push(`Promote ${learning.factor}: ${learning.liftVsBaseline >= 0 ? "+" : ""}${learning.liftVsBaseline} quality-score lift across ${learning.sampleSize} videos.`);
  }
  for (const learning of retired) {
    recommendations.push(`Reduce ${learning.factor}: ${learning.liftVsBaseline} quality-score lift across ${learning.sampleSize} videos; test a replacement rather than cloning it.`);
  }
  for (const learning of explore) {
    recommendations.push(`Keep exploring ${learning.factor}: only ${learning.sampleSize} video${learning.sampleSize === 1 ? "" : "s"}, so there is not enough evidence to exploit or retire it.`);
  }

  const strongestVoice = byVoice.find((learning) => learning.status === "promote");
  const weakestVoice = [...byVoice]
    .filter((learning) => learning.status === "retire")
    .sort((a, b) => a.liftVsBaseline - b.liftVsBaseline)[0];
  if (strongestVoice) {
    recommendations.push(`Voice recommendation only: favor more tests of ${strongestVoice.factor} after ${strongestVoice.sampleSize} sufficiently confident creative samples (${strongestVoice.liftVsBaseline >= 0 ? "+" : ""}${strongestVoice.liftVsBaseline} lift). Do not switch production automatically.`);
  }
  if (weakestVoice) {
    recommendations.push(`Voice recommendation only: consider reducing ${weakestVoice.factor} after ${weakestVoice.sampleSize} sufficiently confident creative samples (${weakestVoice.liftVsBaseline} lift), but keep a holdout and do not switch production automatically.`);
  }
  if (voiceLearnings.length > 0 && !strongestVoice && !weakestVoice) {
    recommendations.push("Voice experiment is still inconclusive; keep rotating voices across multiple topics/formats instead of declaring a winner from a small sample.");
  }
  if (records.length === 0) {
    recommendations.push("No performance history yet. Run deliberately different creative experiments and collect normalized retention, engagement, conversion, publishing, and creative-fingerprint metadata before optimizing.");
  }

  return {
    generatedAt: now.toISOString(),
    videoCount: records.length,
    baselineScore: round(baselineScore),
    videos,
    byPlatform,
    byFormat,
    byVisualWorld,
    byNarrativeEngine,
    byHookFamily,
    byDurationBucket,
    byFirstVisualType,
    byEditDensity,
    byCaptionDensity,
    byCtaFamily,
    byHashtagStrategy,
    byVoice,
    byVoiceAndFormat,
    recommendations,
  };
}
