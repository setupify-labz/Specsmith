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
  /**
   * Canonical SpecSmith catalog ids this package is about, carried straight
   * from the idea. Needed so a deterministic UI render can reproduce the exact
   * hardware state without parsing it back out of prose.
   */
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
  /** The product surface this story lands on. */
  feature: SiteFeature;
  /** The exact SpecSmith route the CTA points at. */
  route: string;
  /** Canonical catalog ids, forwarded so the production planner can use them. */
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
  /**
   * Structured state for a `deterministic-ui-render` task.
   *
   * inputRequirements is prose aimed at a human or a generative model, which
   * is right for video-generation but unusable for a deterministic capture:
   * reproducing an exact SpecSmith state needs canonical catalog ids, and
   * recovering those by parsing a sentence would be the guessing that this
   * capability exists to eliminate.
   *
   * Optional and untyped here on purpose. Optional, so every existing planner,
   * task and test is unaffected. `unknown`, because it is validated at the
   * boundary by parseUiRenderRequest() in uiRender/uiRenderState.ts — typing it
   * concretely would make this module depend on the renderer, and would also
   * imply a compile-time guarantee that does not exist for a value that may
   * have been produced by a model or loaded from JSON.
   *
   * A deterministic-ui-render task without this field fails closed.
   */
  uiRenderState?: unknown;
  /**
   * Structured prompt/timing for generative video. The planner owns the story
   * intent; provider adapters validate this value instead of reverse-parsing
   * beat timing or model settings from prose.
   */
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
  byFormat: FactorLearning[];
  byVisualWorld: FactorLearning[];
  byNarrativeEngine: FactorLearning[];
  byHookFamily: FactorLearning[];
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
  performanceLearning?: PerformanceLearning;
}
