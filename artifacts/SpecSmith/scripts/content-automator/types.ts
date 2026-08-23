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
export type HashtagStrategyId = "intent-balanced-v1";
export type DensityBand = "low" | "medium" | "high" | "unknown";
export type SnapshotWindow = "1h" | "6h" | "24h" | "72h" | "7d";
export type ContentFreshness = "evergreen" | "timely" | "launch-window" | "unknown";
export type FirstVisualType =
  | "generated-cinematic"
  | "deterministic-ui"
  | "exact-product-asset"
  | "motion-graphic"
  | "mixed"
  | "unknown";

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

export interface PlatformContentVariant {
  platform: VideoPlatform;
  objective: "hook" | "interaction" | "polish";
  opening: string;
  pacing: string;
  ending: string;
  captionAngle: string;
  cta: string;
  hashtagStrategy: HashtagStrategyId;
  hashtags: string[];
}

export interface SiteContentVariant {
  route: string;
  pagePurpose: string;
  sections: string[];
  continuationAction: string;
}

export interface ContentPackage {
  packageId: string;
  campaignId: string;
  ideaId: string;
  corePromise: string;
  feature: SiteFeature;
  /** Canonical SpecSmithPC catalog ids used by deterministic rendering and analytics. */
  subjectIds: string[];
  requiredFacts: string[];
  platforms: PlatformContentVariant[];
  site: SiteContentVariant;
  attribution: {
    utmSourceByPlatform: Record<VideoPlatform, string>;
    utmMedium: "short-form-video";
    utmCampaign: string;
    conversionEvents: string[];
  };
}

export interface StoryboardBeat {
  startSecond: number;
  endSecond: number;
  purpose: "hook" | "commitment" | "evidence" | "reversal" | "payoff" | "cta";
  narration: string;
  visualDirection: string;
  onScreenText: string;
  factDependencies: string[];
}

export interface PlatformScriptStoryboard {
  platform: VideoPlatform;
  targetDurationSeconds: number;
  title: string;
  narrationStyle: string;
  beats: StoryboardBeat[];
  finalCta: string;
  factualGuardrails: string[];
}

export interface ScriptStoryboardPackage {
  packageId: string;
  ideaId: string;
  campaignId: string;
  feature: SiteFeature;
  route: string;
  subjectIds: string[];
  scripts: PlatformScriptStoryboard[];
}

export type ProductionCapability =
  | "deterministic-ui-render"
  | "video-generation"
  | "image-generation"
  | "text-to-speech"
  | "music-sfx"
  | "motion-compositor"
  | "caption-render";

export interface ProductionTask {
  taskId: string;
  capability: ProductionCapability;
  sourceBeat: number | null;
  purpose: string;
  inputRequirements: string[];
  outputRequirements: string[];
  fallbackCapability?: ProductionCapability;
  /** Structured state validated by the deterministic UI renderer boundary. */
  uiRenderState?: unknown;
  /** Structured prompt/timing validated by the selected video provider adapter. */
  videoGenerationState?: unknown;
}

export interface PlatformProductionPlan {
  platform: VideoPlatform;
  targetDurationSeconds: number;
  tasks: ProductionTask[];
  renderOrder: string[];
  qualityChecks: string[];
}

export interface ProductionPlanPackage {
  packageId: string;
  ideaId: string;
  campaignId: string;
  platforms: PlatformProductionPlan[];
}

export interface CreativeFingerprint {
  version: "creative-fingerprint-v1";
  creativeId: string;
  packageId: string;
  campaignId: string;
  ideaId: string;
  platform: VideoPlatform;
  format: ContentFormat;
  feature: SiteFeature;
  subjectIds: string[];
  hookFamily: string;
  hookText: string;
  visualWorld: string;
  narrativeEngine: string;
  targetDurationSeconds: number;
  beatCount: number;
  plannedBeatChangesPer10Seconds: number;
  editDensity: DensityBand;
  captionedBeatRatio: number;
  captionDensity: DensityBand;
  firstVisualType: FirstVisualType;
  voiceId?: string;
  voiceName?: string;
  narrationSpeed?: number;
  musicStyle?: string;
  sfxDensity: DensityBand;
  ctaFamily: string;
  ctaTimingBucket: "early" | "middle" | "late";
  hashtagStrategy: HashtagStrategyId;
  hashtags: string[];
  experimentId: string;
  experimentPrimaryMetric: "hook" | "retention" | "shares" | "site-clicks";
  changedVariable: string;
  parentCreativeId?: string;
  contentFreshness: ContentFreshness;
  generatedVisualRatio?: number;
  uiProofRatio?: number;
  exactProductAssetRatio?: number;
  generationCostUsd?: number;
  generationSeconds?: number;
}

export interface RetentionPoint {
  elapsedRatio: number;
  audienceRatio: number;
}

export interface TrafficSourceBreakdown {
  forYou?: number;
  following?: number;
  hashtag?: number;
  sound?: number;
  profile?: number;
  search?: number;
}

export interface VideoPerformanceRecord {
  videoId: string;
  creativeId?: string;
  ideaId: string;
  platform: VideoPlatform;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  shownOrImpressions?: number;
  reach?: number;
  engagedViews?: number;
  stayedToWatchRate?: number;
  fullVideoWatchedRate?: number;
  averageViewDurationSeconds?: number;
  averagePercentageViewed?: number;
  retentionCurve?: RetentionPoint[];
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
  followsGained?: number;
  profileVisits?: number;
  siteClicks?: number;
  builderStarts?: number;
  affiliateClicks?: number;
  trafficSources?: TrafficSourceBreakdown;
  snapshotWindow?: SnapshotWindow;
  format: ContentFormat;
  visualWorld: string;
  narrativeEngine: string;
  hookFamily: string;
  durationBucket: "under-20" | "20-29" | "30-44" | "45-plus";
  firstVisualType?: FirstVisualType;
  editDensity?: DensityBand;
  captionDensity?: DensityBand;
  ctaFamily?: string;
  experimentId?: string;
  changedVariable?: string;
  parentCreativeId?: string;
  contentFreshness?: ContentFreshness;
  voiceId?: string;
  voiceName?: string;
  generationCostUsd?: number;
  generationSeconds?: number;
  hashtagStrategy?: HashtagStrategyId;
  hashtags?: string[];
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
  byPlatform: FactorLearning[];
  byFormat: FactorLearning[];
  byVisualWorld: FactorLearning[];
  byNarrativeEngine: FactorLearning[];
  byHookFamily: FactorLearning[];
  byDurationBucket: FactorLearning[];
  byFirstVisualType: FactorLearning[];
  byEditDensity: FactorLearning[];
  byCaptionDensity: FactorLearning[];
  byCtaFamily: FactorLearning[];
  byHashtagStrategy: FactorLearning[];
  byVoice: FactorLearning[];
  byVoiceAndFormat: FactorLearning[];
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
  contentPackages: ContentPackage[];
  scriptStoryboards: ScriptStoryboardPackage[];
  productionPlans: ProductionPlanPackage[];
  creativeFingerprints: CreativeFingerprint[];
  performanceLearning?: PerformanceLearning;
}
