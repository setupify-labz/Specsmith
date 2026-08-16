// Measured-benchmark engine — SpecSmith's honest-FPS system.
//
// Core rule (non-negotiable, per the spec this was built from): every FPS
// number this system displays must trace to a real, cited source. There is
// no formula fallback here — see lookup.ts. If no matching record exists,
// callers get null and must show "No verified benchmark available," never
// a guess.

export type Resolution = '1080p' | '1440p' | '4k';
export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export type Upscaler = 'native' | 'dlss' | 'fsr' | 'xess';

export type FeatureSupportStatus = 'supported' | 'unsupported' | 'conditional';

export interface FeatureSupport {
  status: FeatureSupportStatus;
  /** Required only when status is 'conditional' — e.g. "requires DX12 renderer". */
  requirements?: string[];
  notes?: string;
}

export interface GameFeatureProfile {
  gameId: string;
  name: string;
  engine?: string;
  dlss: FeatureSupport;
  fsr: FeatureSupport;
  xess: FeatureSupport;
  frameGeneration: FeatureSupport;
  rayTracing: FeatureSupport;
  fpsCap?: { value: number; notes?: string };
}

/** A/B/C/D per the spec's source-quality hierarchy — see README_evidence-quality.md. */
export type EvidenceQuality = 'A' | 'B' | 'C' | 'D';

export interface BenchmarkSource {
  url: string;
  publisher: string;
  title?: string;
  /** ISO date the article/video was published, if known. */
  publishedAt?: string;
  /** ISO date this record was added to SpecSmith (always known). */
  accessedAt: string;
}

export interface BenchmarkRecord {
  id: string;
  gameId: string;
  cpuId: string;
  gpuId: string;
  ramId?: string;
  resolution: Resolution;
  preset: Preset;
  rayTracing: boolean;
  upscaler: Upscaler;
  /**
   * True if this record's averageFps reflects Frame-Generation-boosted
   * *displayed* frames, not independently rendered ones (spec rule 9 —
   * these must never be silently presented as native FPS).
   */
  frameGeneration: boolean;
  gameVersion?: string;
  driverVersion?: string;
  averageFps: number;
  onePercentLow?: number;
  zeroPointOnePercentLow?: number;
  source: BenchmarkSource;
  evidenceQuality: EvidenceQuality;
  notes?: string;
}

export type ResultState = 'MEASURED' | 'UNSUPPORTED' | 'CONDITIONAL' | 'NOT_AVAILABLE';

export interface VerifiedFpsResult {
  state: ResultState;
  record?: BenchmarkRecord;
  /** Populated when state is UNSUPPORTED or CONDITIONAL. */
  featureNote?: string;
}
