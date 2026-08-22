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
