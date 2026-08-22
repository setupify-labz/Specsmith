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

export type SiteFeature =
  | "builder"
  | "compare"
  | "build-crate"
  | "build-guides"
  | "gallery"
  | "upgrade"
  | "parts-catalog"
  | "price-guesser";

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

export interface ProductConnection {
  feature: SiteFeature;
  route: string;
  userProblem: string;
  whySpecSmith: string;
  continuationAction: string;
  sitePayoff: string;
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
  productConnection: ProductConnection;
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
    productFit: number;
    siteContinuation: number;
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
  elapsedRatio: number;
  audienceRatio: number;
}

export interface VideoPerformanceRecord {
  videoId: string;
  ideaId: string;
  platform: VideoPlatform;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  shownOrImpressions?: number;
  engagedViews?: number;
  stayedToWatchRate?: number;
  averageViewDurationSeconds?: number;
  averagePercentageViewed?: number;
  retentionCurve?: RetentionPoint[];
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  followsGained?: number;
  profileVisits?: number;
  siteClicks?: number;
  builderStarts?: number;
  affiliateClicks?: number;
  format: ContentFormat;
  visualWorld: string;
  narrativeEngine: string;
  hookFamily: string;
  durationBucket: "under-20" | "20-29" | "30-44" | "45-plus";
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
