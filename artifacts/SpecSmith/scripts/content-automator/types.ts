export type ContentFormat =
  | "comparison"
  | "build"
  | "myth"
  | "buyer-warning"
  | "value"
  | "experiment"
  | "visual-story"
  | "game"
  | "simulation";

export type VideoPlatform = "youtube-shorts" | "tiktok" | "instagram-reels";

export interface HardwareItem {
  id: string;
  name: string;
  brand: string;
  price_usd: number;
  benchmark_score: number;
  release_year: number;
  tier?: number;
  vram_gb?: number;
}

export interface CreativeDNA {
  conceptName: string;
  visualWorld: string;
  narrativeEngine: string;
  openingImage: string;
  patternInterrupt: string;
  retentionBeats: string[];
  payoff: string;
  audioDirection: string;
  originalityConstraint: string;
  antiSlopRules: string[];
}

export interface ContentIdea {
  id: string;
  format: ContentFormat;
  title: string;
  hook: string;
  angle: string;
  targetAudience: string;
  requiredFacts: string[];
  subjectIds: string[];
  creativeDNA: CreativeDNA;
  scores: {
    curiosity: number;
    usefulness: number;
    visualPotential: number;
    purchaseIntent: number;
    novelty: number;
    originality: number;
    retentionPotential: number;
    shareability: number;
    total: number;
  };
}

export interface StrategyBatch {
  generatedAt: string;
  candidateCount: number;
  topFour: ContentIdea[];
  candidates: ContentIdea[];
}

export interface RetentionPoint {
  /** 0..1 through the video, e.g. 0.25 is 25% elapsed. */
  elapsedRatio: number;
  /** 0..n audience ratio. Values above 1 can happen on rewatches. */
  audienceRatio: number;
}

export interface VideoPerformanceRecord {
  videoId: string;
  ideaId: string;
  platform: VideoPlatform;
  publishedAt: string;
  durationSeconds: number;

  /** Exposure metrics. Do not use raw views alone to decide winners. */
  views: number;
  shownOrImpressions?: number;
  engagedViews?: number;
  stayedToWatchRate?: number;

  /** Retention metrics. */
  averageViewDurationSeconds?: number;
  averagePercentageViewed?: number;
  retentionCurve?: RetentionPoint[];

  /** Engagement metrics. */
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  followsGained?: number;

  /** SpecSmith conversion metrics attributed with a per-video campaign id. */
  profileVisits?: number;
  siteClicks?: number;
  builderStarts?: number;
  affiliateClicks?: number;

  /** Creative labels let the learner determine WHY a video worked. */
  format: ContentFormat;
  visualWorld: string;
  narrativeEngine: string;
  hookFamily: string;
  durationBucket: "under-20" | "20-29" | "30-44" | "45-plus";

  /** Production economics. */
  generationCostUsd?: number;
  generationSeconds?: number;
}

export interface PerformanceScore {
  videoId: string;
  opportunityCount: number;
  hook: number | null;
  retention: number | null;
  engagement: number | null;
  conversion: number | null;
  overall: number;
  confidence: "low" | "medium" | "high";
}

export interface FactorLearning {
  factor: string;
  sampleSize: number;
  weightedScore: number;
  liftVsBaseline: number;
  status: "explore" | "promote" | "neutral" | "retire";
}

export interface PerformanceLearning {
  generatedAt: string;
  videoCount: number;
  baselineScore: number;
  videos: PerformanceScore[];
  byFormat: FactorLearning[];
  byVisualWorld: FactorLearning[];
  byNarrativeEngine: FactorLearning[];
  byHookFamily: FactorLearning[];
  recommendations: string[];
}

export interface DailyVideoPlan {
  rank: number;
  idea: ContentIdea;
  qualityScore: number;
  learningAdjustment: number;
  experiment: {
    hypothesis: string;
    primaryMetric: "hook" | "retention" | "shares" | "site-clicks";
    holdConstant: string[];
  };
}

export interface AutomationBatch {
  generatedAt: string;
  candidateCount: number;
  qualityFloor: number;
  dailyFive: DailyVideoPlan[];
  performanceLearning?: PerformanceLearning;
}
