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

/** Seconds a piece of narration needs, spoken naturally. */
export function narrationSecondsFor(text: string, wordsPerMinute = NARRATION_WORDS_PER_MINUTE): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / wordsPerMinute) * 60;
}

/**
 * Gives each beat a window big enough for the words it carries.
 *
 * THE WINDOWS WERE AUTHORED WITHOUT REFERENCE TO THE NARRATION. The fixed
 * 2/4/6/6/4/2 layout gave the hook two seconds and the call to action two
 * seconds, and both carry copy the IDEA supplies — a hook line and a CTA
 * line, eight to fourteen words each. Two seconds holds about five. No hook
 * has ever fitted its own window; nothing noticed while the storyboard was
 * never spoken aloud.
 *
 * THIS IS NOT THE RESCALING THAT WAS REMOVED. That stretched TOTAL runtime,
 * turning a 24-second short into a 34-second one nobody asked for. The total
 * here is exactly the platform duration, unchanged — what moves is how that
 * fixed budget is divided, and it is divided by how much each beat actually
 * has to say. Every beat keeps its order and the timeline stays contiguous.
 *
 * Slack beyond what the words need is shared out proportionally, so a beat
 * with more to say also gets more room to breathe rather than being cut to
 * the bone while a short beat holds a still frame.
 */
export function allocateBeatWindows(
  narrations: readonly string[],
  totalSeconds: number,
  wordsPerMinute = NARRATION_WORDS_PER_MINUTE,
): { startSecond: number; endSecond: number }[] {
  if (narrations.length === 0) return [];
  const needed = narrations.map((text) => narrationSecondsFor(text, wordsPerMinute));
  const totalNeeded = needed.reduce((sum, value) => sum + value, 0);

  // Weight by need when there is any, otherwise split evenly.
  const weights = totalNeeded > 0 ? needed : narrations.map(() => 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);

  const raw = weights.map((weight) => (weight / weightTotal) * totalSeconds);
  const rounded = raw.map((value) => Math.max(0.5, Math.round(value * 10) / 10));

  // Rounding must not change the runtime, so the drift lands on the last beat.
  const drift = totalSeconds - rounded.reduce((sum, value) => sum + value, 0);
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 10) / 10;

  // Accumulate in TENTHS as integers. Summing 0.1 floats drifts within six
  // beats — enough to make a window read 1.4000000000000004s and miss its own
  // allocation by a picosecond.
  const windows: { startSecond: number; endSecond: number }[] = [];
  let cursorTenths = 0;
  for (const span of rounded) {
    const spanTenths = Math.round(span * 10);
    windows.push({ startSecond: cursorTenths / 10, endSecond: (cursorTenths + spanTenths) / 10 });
    cursorTenths += spanTenths;
  }
  return windows;
}

/**
 * The authoring budget is STRICT. There is no tolerance here.
 *
 * An earlier version borrowed the compositor's 1.25x allowance so that
 * generation would reject exactly what rendering rejects. That was the wrong
 * boundary to share. The compositor's tolerance is an EMERGENCY GUARD at the
 * end of the pipeline — it holds the final visual for a small overshoot so a
 * render does not die on a rounding error. Authoring is not an emergency, and
 * borrowing an emergency allowance as a writing budget means every script may
 * be written 25% too long by default.
 *
 * So: the copy must fit the clock it was given, and each beat must fit its
 * own window. The compositor's allowance stays exactly where it was, doing
 * exactly what it was for.
 */
export function assertNarrationFitsDuration(
  script: { platform: string; targetDurationSeconds: number; beats: readonly { purpose: string; narration: string; startSecond: number; endSecond: number }[] },
  wordsPerMinute = NARRATION_WORDS_PER_MINUTE,
): void {
  const problems: string[] = [];

  const total = narrationSecondsFor(script.beats.map((beat) => beat.narration).join(" "), wordsPerMinute);
  if (total > script.targetDurationSeconds) {
    problems.push(
      `total narration needs ${total.toFixed(1)}s but the script allots ${script.targetDurationSeconds}s`,
    );
  }

  // PER BEAT, NOT JUST IN TOTAL. A script can fit overall while a single beat
  // carries twice the words its window holds — the voice then drifts out of
  // sync with the pictures and never recovers, which a total-only check
  // cannot see.
  for (const beat of script.beats) {
    // Windows are quantised to a tenth of a second, so a beat can miss its
    // own allocation by a rounding step without anything being wrong. Half a
    // step is the tolerance for THAT — arithmetic, not authoring. It is not a
    // writing allowance: 0.05s is a twentieth of a syllable.
    const window = Math.round((beat.endSecond - beat.startSecond) * 10) / 10;
    const needed = narrationSecondsFor(beat.narration, wordsPerMinute);
    if (needed > window + 0.05) {
      problems.push(`${beat.purpose} needs ${needed.toFixed(1)}s in a ${window}s window`);
    }
  }

  if (problems.length === 0) return;
  throw new Error(
    `${script.platform} narration does not fit at ${wordsPerMinute} wpm. `
    + "Shorten the copy; do not stretch the clock. "
    + problems.join("; ") + ".",
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
      narration: `Verified inputs decide it.`,
      visualDirection: `Reveal one verified input through the real ${idea.productConnection.feature} workflow. Every number shown must map to a required fact.`,
      onScreenText: "REAL SPECS • REAL PRICES • REAL RULES",
      factDependencies: factSlice(idea.requiredFacts, 1),
    },
    {
      startSecond: 12,
      endSecond: 18,
      purpose: "reversal",
      narration: `The catch: ${idea.angle}`,
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

/** Re-times authored beats onto windows sized by what each one says. */
function withAllocatedWindows(beats: StoryboardBeat[], totalSeconds: number): StoryboardBeat[] {
  const windows = allocateBeatWindows(beats.map((beat) => beat.narration), totalSeconds);
  return beats.map((beat, index) => ({ ...beat, ...windows[index] }));
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
    beats: withAllocatedWindows(buildBeats(idea, variant, duration), duration),
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
