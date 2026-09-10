import type { ContentFormat, ContentIdea, SiteFeature, VideoPlatform } from "./types.ts";

export const HASHTAG_STRATEGY_ID = "intent-balanced-v1" as const;
export const BRAND_HASHTAG = "#SpecSmithPC";

const PLATFORM_LIMITS: Record<VideoPlatform, number> = {
  "youtube-shorts": 4,
  tiktok: 5,
  "instagram-reels": 5,
};

const FORMAT_TAGS: Record<ContentFormat, string> = {
  comparison: "#PCComparison",
  build: "#PCBuild",
  myth: "#PCTips",
  "buyer-warning": "#PCBuyingGuide",
  value: "#PCValue",
  experiment: "#PCPerformance",
  "visual-story": "#PCGaming",
  game: "#PCBuild",
  simulation: "#PCPerformance",
};

const FEATURE_TAGS: Record<SiteFeature, string> = {
  builder: "#PCBuilder",
  compare: "#PCParts",
  "build-crate": "#PCBuild",
  "build-guides": "#PCBuildGuide",
  gallery: "#GamingSetup",
  upgrade: "#PCUpgrade",
  "parts-catalog": "#PCParts",
  "price-guesser": "#PCPrices",
};

const PLATFORM_BROAD_TAGS: Record<VideoPlatform, string[]> = {
  "youtube-shorts": ["#PCGaming", "#GamingPC"],
  tiktok: ["#GamingPC", "#PCGaming", "#PCBuild"],
  "instagram-reels": ["#GamingPC", "#PCGaming", "#PCBuild"],
};

const BLOCKED_LOW_INTENT_TAGS = new Set([
  "#fyp",
  "#foryou",
  "#foryoupage",
  "#viral",
  "#trending",
  "#explorepage",
]);

function normalizeHashtag(value: string): string | null {
  const body = value.replace(/^#+/, "").replace(/[^a-zA-Z0-9]/g, "");
  if (!body) return null;
  const tag = `#${body}`;
  if (BLOCKED_LOW_INTENT_TAGS.has(tag.toLowerCase())) return null;
  return tag;
}

function extractHardwareHashtags(text: string): string[] {
  const tags: string[] = [];

  for (const match of text.matchAll(/\bRTX\s*(\d{4})(?:\s*(SUPER|TI))?\b/gi)) {
    const suffix = match[2] ? match[2].toUpperCase() === "SUPER" ? "Super" : "Ti" : "";
    tags.push(`#RTX${match[1]}${suffix}`);
  }

  for (const match of text.matchAll(/\bRX\s*(\d{4})(?:\s*(XTX|XT))?\b/gi)) {
    const suffix = match[2] ? match[2].toUpperCase() : "";
    tags.push(`#RX${match[1]}${suffix}`);
  }

  for (const match of text.matchAll(/\bRYZEN\s*([3579])\s*(\d{4}[A-Z0-9]*)\b/gi)) {
    tags.push(`#Ryzen${match[1]}${match[2].toUpperCase()}`);
  }

  for (const match of text.matchAll(/\b(?:INTEL\s+)?CORE\s*(I[3579])[-\s]?(\d{4,5}[A-Z]*)\b/gi)) {
    tags.push(`#IntelCore${match[1].toUpperCase()}${match[2].toUpperCase()}`);
  }

  return tags;
}

function uniqueValid(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tags) {
    const tag = normalizeHashtag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

/**
 * Build a small, high-intent hashtag set for publication.
 *
 * Rules:
 * - always preserve the SpecSmithPC brand tag;
 * - prefer exact hardware model tags when the idea itself names them;
 * - add one feature/format tag and only then broad PC tags;
 * - cap tags per platform instead of stuffing captions;
 * - never inject low-intent spam tags such as #fyp or #viral.
 *
 * This is intentionally deterministic. Trend-aware hashtag experiments can be
 * layered on later, but the baseline publisher must remain reproducible and
 * should never invent a product model that is not present in the idea.
 */
export function buildHashtags(idea: ContentIdea, platform: VideoPlatform): string[] {
  const searchableText = [idea.title, idea.hook, idea.angle, ...idea.requiredFacts].join(" ");
  const exactHardware = extractHardwareHashtags(searchableText);
  const candidates = [
    BRAND_HASHTAG,
    ...exactHardware,
    FEATURE_TAGS[idea.productConnection.feature],
    FORMAT_TAGS[idea.format],
    ...PLATFORM_BROAD_TAGS[platform],
  ];

  return uniqueValid(candidates).slice(0, PLATFORM_LIMITS[platform]);
}
