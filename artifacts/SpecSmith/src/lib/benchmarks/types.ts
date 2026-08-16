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

/**
 * How this record was actually obtained — distinct from evidenceQuality
 * (which grades the source's own rigor). 'search-summary' means an AI web
 * search returned a citation and a paraphrased claim about the source's
 * content; nobody — human or model — has read the original page directly.
 * 'direct-fetch' means the page itself was retrieved and read. Collapsing
 * this into evidenceQuality would hide a real distinction: a reputable
 * publication (high evidenceQuality) whose content was never actually
 * read by us (search-summary) is not the same confidence level as one
 * that was.
 */
export type VerificationMethod = 'search-summary' | 'direct-fetch';

/** Every field spec §5 requires — explicitly marked present or missing per record. */
export const REQUIRED_PROVENANCE_FIELDS = [
  'cpu', 'gpu', 'resolution', 'preset', 'rayTracingState', 'upscaler', 'upscalerMode',
  'frameGenerationState', 'averageFps', 'nativeVsDisplayed', 'methodology',
  'sourcePublicationDate', 'evidenceGrade', 'sourceUrl',
] as const;
export type ProvenanceField = (typeof REQUIRED_PROVENANCE_FIELDS)[number];

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
  /** Which DLSS/FSR/XeSS quality mode, when upscaler !== 'native'. Unset means the source didn't specify one — treat as a gap, not as "any mode". */
  upscalerMode?: string;
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
  verificationMethod: VerificationMethod;
  /** Subset of REQUIRED_PROVENANCE_FIELDS this record actually has confirmed. Anything absent is a known, disclosed gap — never silently assumed. */
  confirmedFields: ProvenanceField[];
  notes?: string;
}

export type ResultState = 'MEASURED' | 'UNSUPPORTED' | 'CONDITIONAL' | 'NOT_AVAILABLE';

export interface VerifiedFpsResult {
  state: ResultState;
  record?: BenchmarkRecord;
  /** Populated when state is UNSUPPORTED or CONDITIONAL. */
  featureNote?: string;
}
