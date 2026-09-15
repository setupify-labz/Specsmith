// Provider inventory: what this repository can actually reach, and at what cost.
//
// WHY THIS IS CODE AND NOT A PARAGRAPH IN A PULL REQUEST
// -------------------------------------------------------
// "Which providers are wired up?" is a question whose answer decays the moment
// anyone edits a file. The records below are validated against the real source
// tree by providerInventory.test.ts: a provider cannot name a module that does
// not exist, cannot name a caller that does not import it, and cannot claim an
// environment variable the module never reads.
//
// WHAT IT IS FOR
// ---------------
// The $0 operating requirement is only checkable if it is known which providers
// can spend money and whether anything core depends on them. `coreDependency`
// is the field that matters: every provider below is optional, and the offline
// pipeline runs to completion with none of them configured.

export interface ProviderRecord {
  readonly name: string;
  /** Path relative to content-automator/, or "" when the provider is absent. */
  readonly module: string;
  /** Non-test modules that import it. Empty means dormant. */
  readonly callers: readonly string[];
  readonly status: "active" | "dormant" | "optional-inert" | "absent";
  /** Environment variables the module actually reads. */
  readonly requiredEnv: readonly string[];
  /** Can it execute today, in this repository, as configured? */
  readonly canExecute: "no-credentials" | "yes-local" | "yes-if-configured";
  /** Could using it cost money? */
  readonly paidUsagePossible: boolean;
  readonly freeTierHandling: string;
  readonly fallback: string;
  /** Does any core path break without it? This must be false for all of them. */
  readonly coreDependency: boolean;
  readonly notes: string;
}

export const PROVIDER_INVENTORY: readonly ProviderRecord[] = [
  {
    name: "Google Gemini / Veo (video generation)",
    module: "geminiVeoVideo.ts",
    callers: ["videoGenerationSmoke.ts"],
    status: "optional-inert",
    requiredEnv: ["GEMINI_API_KEY", "GEMINI_VEO_MODEL_ID", "GEMINI_VEO_BASE_URL", "GEMINI_VEO_RESOLUTION"],
    canExecute: "no-credentials",
    paidUsagePossible: true,
    freeTierHandling: "Config resolution returns undefined when GEMINI_API_KEY is absent, so the adapter is never constructed. No workflow sets it.",
    fallback: "The offline compositor renders from deterministic UI capture plus ffmpeg; no generative video is used anywhere in the offline pipeline.",
    coreDependency: false,
    notes: "Reached only through a smoke script that must be run deliberately. Veo generation is paid; nothing invokes it automatically.",
  },
  {
    name: "ElevenLabs (text to speech)",
    module: "elevenLabsTts.ts",
    callers: ["compositorSmoke.ts", "ttsSmokeTest.ts", "localFixtureTts.ts"],
    status: "optional-inert",
    requiredEnv: ["ELEVENLABS_API_KEY", "ELEVENLABS_TTS_ENDPOINT", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID"],
    canExecute: "no-credentials",
    paidUsagePossible: true,
    freeTierHandling: "Config resolution returns undefined without ELEVENLABS_API_KEY.",
    fallback: "localFixtureTts.ts drives local espeak-ng, which is what the offline pipeline and CI actually use. Free, local, no quota.",
    coreDependency: false,
    notes: "The free local path is the DEFAULT rather than a degraded mode; the paid path requires an explicit key.",
  },
  {
    name: "ElevenLabs (video generation)",
    module: "elevenLabsVideo.ts",
    callers: [],
    status: "dormant",
    requiredEnv: ["ELEVENLABS_VIDEO_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VIDEO_ENDPOINT", "ELEVENLABS_VIDEO_MODEL_ID"],
    canExecute: "no-credentials",
    paidUsagePossible: true,
    freeTierHandling: "Config resolution returns undefined without a key.",
    fallback: "Not used; the offline compositor covers the rendering path.",
    coreDependency: false,
    notes: "No non-test module imports this. It is dead weight on the current path.",
  },
  {
    name: "Meshy (3D asset ingestion)",
    module: "meshyIngestion.ts",
    callers: ["meshyIngestCli.ts"],
    status: "dormant",
    requiredEnv: [],
    canExecute: "yes-local",
    paidUsagePossible: false,
    freeTierHandling: "Not applicable: this module ingests already-produced asset files and makes no API call of its own.",
    fallback: "None needed.",
    coreDependency: false,
    notes: "Reached only through an explicit CLI. It carries its own MeshyProvenance type for asset lineage.",
  },
  {
    name: "Metricool (publishing and analytics REST)",
    module: "metricoolClient.ts",
    callers: ["metricoolAnalyticsCollector.ts", "analyticsPassCli.ts", "analyticsOrchestrator.ts", "metricoolLiveSmoke.ts"],
    status: "optional-inert",
    requiredEnv: [],
    canExecute: "no-credentials",
    paidUsagePossible: false,
    freeTierHandling: "The founder's current Metricool plan exposes no REST API. metricoolRestAvailability() reports unavailable whenever credentials are absent, and publishApprovedPackage refuses with rest-unavailable before touching anything.",
    fallback: "The READY_TO_PUBLISH handoff, plus connector-relayed analytics ingestion. Both are free and require no API access.",
    coreDependency: false,
    notes: "Deliberately kept inert by MASTER #1's work. Nothing in this MASTER changes that.",
  },
  {
    name: "YouTube Data API (audio trend source)",
    module: "youtubeTrendSource.ts",
    callers: ["multiTrendSource.ts"],
    status: "optional-inert",
    requiredEnv: ["YOUTUBE_DATA_API_KEY", "YOUTUBE_TREND_REGION", "YOUTUBE_TREND_ENDPOINT"],
    canExecute: "no-credentials",
    paidUsagePossible: false,
    freeTierHandling: "Free tier with a daily quota. Config resolution returns undefined without a key, so no call is attempted.",
    fallback: "Audio trend refresh simply reports no source configured.",
    coreDependency: false,
    notes: "Evidences AUDIO trends only. It is not a source of topic-trend evidence and is not used by the research modules.",
  },
  {
    name: "TikTok Business API (audio trend source)",
    module: "trendSource.ts",
    callers: ["multiTrendSource.ts"],
    status: "optional-inert",
    requiredEnv: ["TIKTOK_BUSINESS_ACCESS_TOKEN", "TIKTOK_BUSINESS_ID", "TIKTOK_TREND_COUNTRY"],
    canExecute: "no-credentials",
    paidUsagePossible: false,
    freeTierHandling: "Requires a business account token that is not set.",
    fallback: "The audio-trend refresh reports no source configured; no core path depends on audio trend data.",
    coreDependency: false,
    notes: "Audio trends only.",
  },
  {
    name: "Bundle.social (TikTok trend relay)",
    module: "bundleTikTokTrendSource.ts",
    callers: ["multiTrendSource.ts"],
    status: "optional-inert",
    requiredEnv: ["BUNDLE_SOCIAL_API_KEY", "BUNDLE_TIKTOK_TREND_ENDPOINT"],
    canExecute: "no-credentials",
    paidUsagePossible: true,
    freeTierHandling: "Config resolution returns undefined without a key.",
    fallback: "The audio-trend refresh reports no source configured and the pipeline continues; no audio trend data is required to build, render or review a creative.",
    coreDependency: false,
    notes: "A paid relay service. Not configured, not called.",
  },
  {
    name: "Instagram (audio trend feed)",
    module: "instagramTrendSource.ts",
    callers: ["multiTrendSource.ts"],
    status: "optional-inert",
    requiredEnv: ["INSTAGRAM_AUDIO_TREND_FEED_URL", "INSTAGRAM_AUDIO_TREND_FEED_TOKEN"],
    canExecute: "no-credentials",
    paidUsagePossible: false,
    freeTierHandling: "Requires an operator-supplied feed URL that is not set.",
    fallback: "The audio-trend refresh reports no source configured; no core path depends on audio trend data.",
    coreDependency: false,
    notes: "Audio trends only.",
  },
  {
    name: "Web search / research provider",
    module: "",
    callers: [],
    status: "absent",
    requiredEnv: [],
    canExecute: "no-credentials",
    paidUsagePossible: false,
    freeTierHandling: "Not applicable: no such provider exists in this repository.",
    fallback: "Evidence arrives through the transport-independent ingestion boundary in v2/research/ingestion.ts, relayed by a connector or a person.",
    coreDependency: false,
    notes: "THE load-bearing entry. There is no autonomous web access, which is why research planning, disconfirmation search and trend collection are recorded as blocked rather than built. No fake network client was added to disguise that.",
  },
  {
    name: "ffmpeg / ffprobe (local)",
    module: "motionCompositor.ts",
    callers: ["offlineCompositorSmoke.ts", "compositorSmoke.ts"],
    status: "active",
    requiredEnv: ["SPECSMITH_FFMPEG_PATH", "SPECSMITH_FFPROBE_PATH"],
    canExecute: "yes-local",
    paidUsagePossible: false,
    freeTierHandling: "Local binary. No quota, no account, no network.",
    fallback: "None needed.",
    coreDependency: true,
    notes: "The only core dependency in this table, and it is free and local. Env vars override the binary path; both default sensibly.",
  },
  {
    name: "espeak-ng (local TTS)",
    module: "localFixtureTts.ts",
    callers: ["offlineCompositorSmoke.ts"],
    status: "active",
    requiredEnv: ["SPECSMITH_ESPEAK_PATH"],
    canExecute: "yes-local",
    paidUsagePossible: false,
    freeTierHandling: "Local binary.",
    fallback: "None needed.",
    coreDependency: false,
    notes: "This is what makes the offline pipeline free: narration never touches a paid provider.",
  },
];

/** Providers that could cost money if someone configured them. */
export function paidCapableProviders(): readonly ProviderRecord[] {
  return PROVIDER_INVENTORY.filter((record) => record.paidUsagePossible);
}

/** Anything core must also be free and local, or the $0 requirement is a wish. */
export function coreDependencies(): readonly ProviderRecord[] {
  return PROVIDER_INVENTORY.filter((record) => record.coreDependency);
}

export function formatProviderInventory(): string {
  const lines: string[] = ["PROVIDER INVENTORY"];
  for (const record of PROVIDER_INVENTORY) {
    lines.push(`  ${record.name} [${record.status}]`);
    lines.push(`     module:   ${record.module || "(none in this repository)"}`);
    lines.push(`     callers:  ${record.callers.length ? record.callers.join(", ") : "(none — dormant)"}`);
    lines.push(`     env:      ${record.requiredEnv.length ? record.requiredEnv.join(", ") : "(none)"}`);
    lines.push(`     executes: ${record.canExecute}; paid usage possible: ${record.paidUsagePossible}; core: ${record.coreDependency}`);
    lines.push(`     fallback: ${record.fallback}`);
  }
  return lines.join("\n");
}
