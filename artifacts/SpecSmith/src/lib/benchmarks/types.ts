// Measured-benchmark engine — SpecSmith's honest-FPS system.
//
// Core rule (non-negotiable, per the spec this was built from): every FPS
// number this system displays must trace to a real, cited source. There is
// no formula fallback here — see lookup.ts. If no matching record exists,
// callers get null and must show "No verified benchmark available," never
// a guess.

export type Resolution = '1080p' | '1440p' | '4k';
/**
 * A closed set of cross-game normalized quality tiers, not a literal
 * transcription of any one game's menu labels. 'extreme' was added for
 * titles (e.g. Forza Horizon 5) that ship a real 5th tier strictly above
 * their own "Ultra" — a demonstrated, recurring naming pattern, not a
 * one-off. When a source's tested setting doesn't cleanly match any of
 * these five, do not force-map it here — reject the record, or record the
 * verbatim name in BenchmarkRecord.presetLabel alongside the closest
 * honest bucket, and say so in notes.
 */
export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'extreme';
export type Upscaler = 'native' | 'dlss' | 'fsr' | 'xess';

/**
 * 'unknown' means this specific feature's support in this game has not
 * been independently verified yet — never inferred from general knowledge
 * of the game/engine. It exists so a new GameFeatureProfile can be created
 * the moment a game needs its first BenchmarkRecord (all five features
 * seeded 'unknown'), instead of requiring every feature to be fully
 * researched upfront before any record for that game can be added at all.
 * Each feature is upgraded to 'supported'/'unsupported'/'conditional'
 * independently, later, as it's actually confirmed — the same incremental,
 * disclosed-gap discipline BenchmarkRecord.confirmedFields already uses.
 * lookupVerifiedFps treats 'unknown' the same as 'supported' for gating
 * (only 'unsupported'/'conditional' short-circuit a query) — an unverified
 * feature must never be presumed broken.
 */
export type FeatureSupportStatus = 'supported' | 'unsupported' | 'conditional' | 'unknown';

export interface FeatureSupport {
  status: FeatureSupportStatus;
  /** Required only when status is 'conditional' — e.g. "requires DX12 renderer". */
  requirements?: string[];
  notes?: string;
}

export interface GameFeatureProfile {
  /**
   * This namespace is intentionally independent of games.json (the
   * Estimator's own catalog of games with a base_fps grid) — a game can
   * have a verified-benchmark profile without ever being added to the
   * Estimator, and vice versa. Marvel Rivals proves this today: it has a
   * profile here and no games.json entry at all. Do not add a "must also
   * exist in games.json" check anywhere in this system — see
   * validateBenchmarkRecord's doc comment in validate.ts and
   * getCoverageSummary's `gamesNotInEstimatorCatalog` in lookup.ts, which
   * exists specifically to surface the cross-catalog gap as an honest
   * observation rather than an error.
   */
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

/**
 * Every field spec §5 requires — explicitly marked present or missing per
 * record. onePercentLow/zeroPointOnePercentLow are only relevant when the
 * record actually sets that (optional) field — their presence here just
 * gives a source that explicitly states a 1%-low figure a real
 * confirmedFields name to claim, instead of no schema-sanctioned way to
 * mark it confirmed at all.
 */
export const REQUIRED_PROVENANCE_FIELDS = [
  'cpu', 'gpu', 'resolution', 'preset', 'rayTracingState', 'upscaler', 'upscalerMode',
  'frameGenerationState', 'averageFps', 'onePercentLow', 'zeroPointOnePercentLow',
  'nativeVsDisplayed', 'methodology', 'sourcePublicationDate', 'evidenceGrade', 'sourceUrl',
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
  /**
   * Verbatim in-game setting name, when it differs from or is more
   * specific than the normalized `preset` bucket above (e.g. source says
   * "Extreme" — a real 5th tier above Ultra in that particular game).
   * Optional: most sources map cleanly onto the 5 base Preset values and
   * need nothing here. Never invent this from the preset value — only set
   * it when the source's own wording differs.
   */
  presetLabel?: string;
  rayTracing: boolean;
  upscaler: Upscaler;
  /** Which DLSS/FSR/XeSS quality mode, when upscaler !== 'native'. Unset means the source didn't specify one — treat as a gap, not as "any mode". */
  upscalerMode?: string;
  /**
   * A real, source-described settings toggle that doesn't correspond to
   * any other field here — e.g. Marvel Rivals' in-game "Lumen Global
   * Illumination" switch, which is neither the same thing as the
   * `rayTracing` boolean nor a `preset` tier (see the seeded
   * mr-rtx3060-...-lumengi-off record for a real example). Leave unset for
   * a record representing the baseline/default state; only set it when
   * the source explicitly documents a distinct, named non-default variant
   * — never invent one to force two otherwise-identical records apart.
   */
  settingsVariant?: string;
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
