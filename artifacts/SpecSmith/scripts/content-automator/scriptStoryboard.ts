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

/** Words a natural read fits into a minute. espeak-ng measures at ~158. */
export const NARRATION_WORDS_PER_MINUTE = 165;

/** Mirrors motionCompositor.ts's voice-overrun tolerance, so they agree. */
export const NARRATION_OVERRUN_TOLERANCE = 1.25;

/** Seconds a piece of narration needs, spoken naturally. */
export function narrationSecondsFor(text: string, wordsPerMinute = NARRATION_WORDS_PER_MINUTE): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / wordsPerMinute) * 60;
}

/**
 * Refuses a storyboard whose words cannot be spoken in the time it allotted.
 *
 * FAILS AT GENERATION, NOT AT RENDER. The overrun that started all of this
 * surfaced three stages downstream, inside ffmpeg, as a compositor error
 * about voice duration — by which point an idea, a package, a plan and five
 * real browser captures had already been produced. A storyboard that cannot
 * be read aloud in its own runtime is malformed, and the cheapest place to
 * say so is where it is written.
 *
 * Deliberately NOT a rescale. Stretching the clock to fit the words was the
 * previous accommodation, and it made a 24-second short 34 seconds long
 * without anyone choosing that. The budget is the constraint; the copy moves.
 *
 * THE TOLERANCE IS THE COMPOSITOR'S OWN, DELIBERATELY. motionCompositor.ts
 * refuses narration beyond `duration * 1.25 + 0.25`, holding the final visual
 * for anything smaller. Matching it exactly means the two can never disagree:
 * generation rejects precisely what rendering would reject, no more and no
 * less. A stricter number here would hard-fail the whole idea pipeline over a
 * fraction of a second that renders perfectly well — and several real
 * generated ideas land 1-2% over because their OWN hooks are long, which is a
 * fact about those ideas rather than a defect in these templates.
 *
 * The original failure this exists for was 36% over. It is caught.
 */
export function assertNarrationFitsDuration(
  script: { platform: string; targetDurationSeconds: number; beats: readonly { purpose: string; narration: string }[] },
  wordsPerMinute = NARRATION_WORDS_PER_MINUTE,
): void {
  const needed = narrationSecondsFor(script.beats.map((beat) => beat.narration).join(" "), wordsPerMinute);
  if (needed <= script.targetDurationSeconds * NARRATION_OVERRUN_TOLERANCE + 0.25) return;
  const perBeat = script.beats
    .map((beat) => `${beat.purpose} ${narrationSecondsFor(beat.narration, wordsPerMinute).toFixed(1)}s`)
    .join(", ");
  throw new Error(
    `${script.platform} narration needs ${needed.toFixed(1)}s at ${wordsPerMinute} wpm but the script allots `
    + `${script.targetDurationSeconds}s. Shorten the copy; do not stretch the clock. Per beat: ${perBeat}.`,
  );
}

/**
 * Narration is written to a WORD BUDGET, because it is going to be spoken.
 *
 * A 24-second short at a natural 165 wpm holds about 66 words. The first
 * version of these templates produced 90 for that target — 225 wpm, far
 * outside the 150-180 wpm range natural speech occupies — and every beat
 * overran its own window. Nothing caught it for as long as the storyboard was
 * never rendered; the first real render failed the compositor's voice-overrun
 * guard immediately.
 *
 * So the fixed prose here is deliberately terse and carries no sentence that
 * the pictures already say. `userProblem` left the commitment beat entirely:
 * it is context for a planner, not a line to read aloud over a two-second
 * shot. What remains of each template is a handful of words wrapped around
 * the idea's OWN copy — the hook, the angle, the CTA — which is the part a
 * writer actually chose.
 *
 * `assertNarrationFitsDuration` enforces the budget at generation time, so a
 * storyboard that cannot be spoken fails here rather than three stages later
 * inside ffmpeg.
 */
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
      narration: `Decide before the reveal.`,
      visualDirection: `${variant.opening} Visually lock the viewer into a choice before exposing the decisive evidence.`,
      onScreenText: "LOCK YOUR PICK",
      factDependencies: factSlice(idea.requiredFacts, 0),
    },
    {
      startSecond: 6,
      endSecond: 12,
      purpose: "evidence",
      narration: `Verified inputs decide this, not the obvious answer.`,
      visualDirection: `Reveal one verified input through the real ${idea.productConnection.feature} workflow. Every number shown must map to a required fact.`,
      onScreenText: "REAL SPECS • REAL PRICES • REAL RULES",
      factDependencies: factSlice(idea.requiredFacts, 1),
    },
    {
      startSecond: 12,
      endSecond: 18,
      purpose: "reversal",
      narration: `The tradeoff that flips it: ${idea.angle}`,
      visualDirection: `${idea.creativeDNA.patternInterrupt} Show the strongest counterpoint instead of racing straight to a predetermined winner.`,
      onScreenText: "BUT HERE'S THE CATCH",
      factDependencies: factSlice(idea.requiredFacts, 2),
    },
    {
      startSecond: 18,
      endSecond: Math.max(21, duration - 2),
      purpose: "payoff",
      narration: `SpecSmith settles it on verified facts alone.`,
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
  const script: PlatformScriptStoryboard = {
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

  // Malformed here is cheaper than malformed in ffmpeg.
  assertNarrationFitsDuration(script);
  return script;
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
    feature: contentPackage.feature,
    route: idea.productConnection.route,
    subjectIds: [...idea.subjectIds],
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
