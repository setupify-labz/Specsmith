import type {
  ContentIdea,
  ContentPackage,
  PlatformContentVariant,
  PlatformScriptStoryboard,
  ScriptStoryboardPackage,
  StoryboardBeat,
  VideoPlatform,
} from "./types.ts";

const DURATION_BY_PLATFORM: Record<VideoPlatform, number> = {
  "youtube-shorts": 24,
  tiktok: 26,
  "instagram-reels": 24,
};

function variantFor(contentPackage: ContentPackage, platform: VideoPlatform): PlatformContentVariant {
  const variant = contentPackage.platforms.find((entry) => entry.platform === platform);
  if (!variant) throw new Error(`Missing ${platform} variant for package ${contentPackage.packageId}`);
  return variant;
}

function factSlice(facts: string[], index: number): string[] {
  if (!facts.length) return [];
  return [facts[index % facts.length]];
}

function buildBeats(idea: ContentIdea, variant: PlatformContentVariant, duration: number): StoryboardBeat[] {
  const route = idea.productConnection.route;
  const interactionPrefix = variant.platform === "tiktok" ? "Pick now. " : "";
  return [
    {
      startSecond: 0,
      endSecond: 2,
      purpose: "hook",
      narration: `${interactionPrefix}${idea.hook}`,
      visualDirection: `${idea.creativeDNA.openingImage} The first frame must show the actual decision, not a logo or generic PC B-roll.`,
      onScreenText: idea.title,
      factDependencies: [],
    },
    {
      startSecond: 2,
      endSecond: 6,
      purpose: "commitment",
      narration: `Before the answer appears, decide what you would do. ${idea.productConnection.userProblem}`,
      visualDirection: `${variant.opening} Visually lock the viewer into a choice before exposing the decisive evidence.`,
      onScreenText: "LOCK YOUR PICK",
      factDependencies: factSlice(idea.requiredFacts, 0),
    },
    {
      startSecond: 6,
      endSecond: 12,
      purpose: "evidence",
      narration: `Now use the verified SpecSmith inputs. The decision has to follow the real data, not the obvious-looking answer.`,
      visualDirection: `Reveal one verified input through the real ${idea.productConnection.feature} workflow. Every number shown must map to a required fact.`,
      onScreenText: "REAL SPECS • REAL PRICES • REAL RULES",
      factDependencies: factSlice(idea.requiredFacts, 1),
    },
    {
      startSecond: 12,
      endSecond: 18,
      purpose: "reversal",
      narration: `Here is the tradeoff that can flip the answer: ${idea.angle}`,
      visualDirection: `${idea.creativeDNA.patternInterrupt} Show the strongest counterpoint instead of racing straight to a predetermined winner.`,
      onScreenText: "BUT HERE'S THE CATCH",
      factDependencies: factSlice(idea.requiredFacts, 2),
    },
    {
      startSecond: 18,
      endSecond: Math.max(21, duration - 2),
      purpose: "payoff",
      narration: `SpecSmith resolves the exact decision, and the result should follow only from the verified facts available for this idea.`,
      visualDirection: `${idea.creativeDNA.payoff} End the story on the product result, not a generic engagement prompt.`,
      onScreenText: "SPECSMITH RESULT",
      factDependencies: [...idea.requiredFacts],
    },
    {
      startSecond: Math.max(21, duration - 2),
      endSecond: duration,
      purpose: "cta",
      narration: variant.cta,
      visualDirection: `Show the exact continuation destination ${route} and the next product action: ${idea.productConnection.continuationAction}`,
      onScreenText: `CONTINUE IN SPECSMITH → ${route}`,
      factDependencies: [],
    },
  ];
}

function buildPlatformScript(
  idea: ContentIdea,
  contentPackage: ContentPackage,
  platform: VideoPlatform,
): PlatformScriptStoryboard {
  const variant = variantFor(contentPackage, platform);
  const duration = DURATION_BY_PLATFORM[platform];
  return {
    platform,
    targetDurationSeconds: duration,
    title: idea.title,
    narrationStyle: platform === "tiktok"
      ? "Interactive and conversational; force a prediction before the reveal."
      : platform === "instagram-reels"
        ? "Tight and visually clean; narration supports the visual hierarchy instead of reading every stat."
        : "Fast explanatory challenge structure with a hard hook and clear product payoff.",
    beats: buildBeats(idea, variant, duration),
    finalCta: variant.cta,
    factualGuardrails: [
      "Do not invent prices, compatibility, benchmark results, product specs, or measured FPS.",
      "Any benchmark_score reference must be described as SpecSmith's internal score, not measured game FPS.",
      "If estimated FPS is introduced later, label it Estimated FPS explicitly.",
      "If a required fact cannot be verified, remove or regenerate the claim instead of guessing.",
      `The final product continuation must remain ${idea.productConnection.route}; do not substitute a generic homepage CTA.`,
    ],
  };
}

export function buildScriptStoryboardPackage(
  idea: ContentIdea,
  contentPackage: ContentPackage,
): ScriptStoryboardPackage {
  if (idea.id !== contentPackage.ideaId) {
    throw new Error(`Idea ${idea.id} does not match content package ${contentPackage.ideaId}`);
  }
  const platforms: VideoPlatform[] = ["youtube-shorts", "tiktok", "instagram-reels"];
  return {
    packageId: contentPackage.packageId,
    ideaId: idea.id,
    campaignId: contentPackage.campaignId,
    scripts: platforms.map((platform) => buildPlatformScript(idea, contentPackage, platform)),
  };
}

export function buildScriptStoryboardPackages(
  ideas: ContentIdea[],
  contentPackages: ContentPackage[],
): ScriptStoryboardPackage[] {
  const packageByIdea = new Map(contentPackages.map((entry) => [entry.ideaId, entry]));
  return ideas.map((idea) => {
    const contentPackage = packageByIdea.get(idea.id);
    if (!contentPackage) throw new Error(`Missing content package for idea ${idea.id}`);
    return buildScriptStoryboardPackage(idea, contentPackage);
  });
}
