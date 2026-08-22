import type { ContentIdea, ProductionPlanPackage, VideoPlatform } from "./types.ts";

export type AudioRightsStatus = "platform-cleared" | "commercial-cleared" | "unknown" | "not-cleared";
export type AudioAttachMode = "platform-publish" | "render";

export interface TrendingAudioCandidate {
  id: string;
  platform: VideoPlatform;
  title: string;
  artist?: string;
  capturedAt: string;
  rightsStatus: AudioRightsStatus;
  popularityScore: number;
  velocityScore: number;
  saturationScore: number;
  tags: string[];
  source?: string;
  sourceContentId?: string;
  platformAudioId?: string;
  commercialMusicId?: string;
  durationSeconds?: number;
  previewUrl?: string;
  region?: string;
  rankPosition?: number;
}

export interface AudioTrendSnapshot {
  capturedAt: string;
  candidates: TrendingAudioCandidate[];
}

export interface AudioSelection {
  ideaId: string;
  platform: VideoPlatform;
  mode: "trending" | "original";
  candidateId?: string;
  platformAudioId?: string;
  title?: string;
  artist?: string;
  score: number;
  attachMode: AudioAttachMode;
  reason: string;
  rightsStatus?: AudioRightsStatus;
  source?: string;
}

const PLATFORMS: VideoPlatform[] = ["youtube-shorts", "tiktok", "instagram-reels"];
const TREND_MAX_AGE_DAYS = 7;
const TREND_MIN_SCORE = 67;

const clamp100 = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function ageDays(timestamp: string, now: Date): number {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - parsed.getTime()) / 86_400_000);
}

function words(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  );
}

function creativeFit(idea: ContentIdea, candidate: TrendingAudioCandidate): number {
  const ideaWords = words([
    idea.title,
    idea.hook,
    idea.angle,
    idea.format,
    idea.productConnection.feature,
    idea.creativeDNA.audioDirection,
    idea.creativeDNA.narrativeEngine,
  ].join(" "));

  const tags = candidate.tags.map((tag) => tag.toLowerCase());
  if (tags.length === 0) return 45;

  let matches = 0;
  for (const tag of tags) {
    const tagWords = [...words(tag)];
    if (tagWords.some((word) => ideaWords.has(word))) matches += 1;
  }

  const base = 40 + Math.min(45, matches * 15);
  const gameBonus = idea.format === "game" && tags.some((tag) => /game|countdown|tension|choice|reveal/.test(tag)) ? 15 : 0;
  const revealBonus = /reveal|impact|tension|drop/.test(idea.creativeDNA.audioDirection.toLowerCase()) && tags.some((tag) => /reveal|impact|tension|drop/.test(tag)) ? 10 : 0;
  return clamp100(base + gameBonus + revealBonus);
}

function isEligible(candidate: TrendingAudioCandidate, now: Date): boolean {
  if (candidate.rightsStatus !== "platform-cleared" && candidate.rightsStatus !== "commercial-cleared") return false;
  if (ageDays(candidate.capturedAt, now) > TREND_MAX_AGE_DAYS) return false;
  return [candidate.popularityScore, candidate.velocityScore, candidate.saturationScore].every((score) => Number.isFinite(score) && score >= 0 && score <= 100);
}

function scoreCandidate(idea: ContentIdea, candidate: TrendingAudioCandidate, now: Date): number {
  const freshness = clamp100(100 - ageDays(candidate.capturedAt, now) * (100 / TREND_MAX_AGE_DAYS));
  const fit = creativeFit(idea, candidate);
  const unsaturated = 100 - candidate.saturationScore;
  return round(
    candidate.velocityScore * 0.30 +
    candidate.popularityScore * 0.22 +
    freshness * 0.15 +
    fit * 0.23 +
    unsaturated * 0.10,
  );
}

function originalFallback(idea: ContentIdea, platform: VideoPlatform, reason: string): AudioSelection {
  return {
    ideaId: idea.id,
    platform,
    mode: "original",
    score: 0,
    attachMode: "render",
    reason: `${reason} Use an original/licensed SpecSmith music bed and SFX matched to: ${idea.creativeDNA.audioDirection}`,
  };
}

export function selectAudioForIdea(
  idea: ContentIdea,
  platform: VideoPlatform,
  snapshot: AudioTrendSnapshot | undefined,
  now = new Date(),
  excludedCandidateIds = new Set<string>(),
): AudioSelection {
  if (!snapshot) return originalFallback(idea, platform, "No current trend snapshot is available.");
  if (ageDays(snapshot.capturedAt, now) > TREND_MAX_AGE_DAYS) {
    return originalFallback(idea, platform, "The trend snapshot is stale.");
  }

  const ranked = snapshot.candidates
    .filter((candidate) => candidate.platform === platform)
    .filter((candidate) => !excludedCandidateIds.has(candidate.id))
    .filter((candidate) => isEligible(candidate, now))
    .map((candidate) => ({ candidate, score: scoreCandidate(idea, candidate, now), fit: creativeFit(idea, candidate) }))
    .filter((entry) => entry.fit >= 55)
    .sort((a, b) => b.score - a.score || b.fit - a.fit || a.candidate.id.localeCompare(b.candidate.id));

  const best = ranked[0];
  if (!best || best.score < TREND_MIN_SCORE) {
    return originalFallback(idea, platform, "No cleared trending sound fits this concept strongly enough.");
  }

  return {
    ideaId: idea.id,
    platform,
    mode: "trending",
    candidateId: best.candidate.id,
    platformAudioId: best.candidate.platformAudioId,
    title: best.candidate.title,
    artist: best.candidate.artist,
    score: best.score,
    attachMode: best.candidate.rightsStatus === "platform-cleared" ? "platform-publish" : "render",
    reason: `Selected because it is cleared, current, rising, and meaningfully fits the video's creative direction. Fit score ${best.fit}/100.`,
    rightsStatus: best.candidate.rightsStatus,
    source: best.candidate.source,
  };
}

export function buildAudioSelections(
  ideas: ContentIdea[],
  snapshot: AudioTrendSnapshot | undefined,
  now = new Date(),
): AudioSelection[] {
  const selections: AudioSelection[] = [];
  const usedByPlatform = new Map<VideoPlatform, Set<string>>();

  for (const idea of ideas) {
    for (const platform of PLATFORMS) {
      const used = usedByPlatform.get(platform) ?? new Set<string>();
      const selection = selectAudioForIdea(idea, platform, snapshot, now, used);
      selections.push(selection);
      if (selection.candidateId) used.add(selection.candidateId);
      usedByPlatform.set(platform, used);
    }
  }

  return selections;
}

export function applyAudioSelectionsToProductionPlans(
  productionPlans: ProductionPlanPackage[],
  selections: AudioSelection[],
): ProductionPlanPackage[] {
  const selectionByKey = new Map(selections.map((entry) => [`${entry.ideaId}:${entry.platform}`, entry]));

  return productionPlans.map((productionPackage) => ({
    ...productionPackage,
    platforms: productionPackage.platforms.map((platformPlan) => {
      const selection = selectionByKey.get(`${productionPackage.ideaId}:${platformPlan.platform}`);
      if (!selection) return platformPlan;

      return {
        ...platformPlan,
        tasks: platformPlan.tasks.map((task) => {
          if (task.capability !== "music-sfx") return task;

          const platformId = selection.platformAudioId ? ` Platform audio id: ${selection.platformAudioId}.` : "";
          const instruction = selection.mode === "trending"
            ? selection.attachMode === "platform-publish"
              ? `Use trending audio '${selection.title}'${selection.artist ? ` by ${selection.artist}` : ""} as a platform-native publish-time audio selection.${platformId} Do not bake the track into the rendered master unless the platform/license explicitly permits it.`
              : `Use cleared trending audio '${selection.title}'${selection.artist ? ` by ${selection.artist}` : ""} in the render, preserving narration intelligibility and license metadata.`
            : "Use an original or licensed SpecSmith-safe music bed; do not substitute an uncleared trending sound.";

          return {
            ...task,
            inputRequirements: [...task.inputRequirements, instruction, selection.reason],
          };
        }),
      };
    }),
  }));
}
