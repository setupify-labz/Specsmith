import type { ContentIdea, ContentPackage, VideoPlatform } from "./types.ts";

const PLATFORM_SOURCE: Record<VideoPlatform, string> = {
  "youtube-shorts": "youtube",
  tiktok: "tiktok",
  "instagram-reels": "instagram",
};

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function ctaFor(idea: ContentIdea, platform: VideoPlatform): string {
  const destination = idea.productConnection.route;
  if (platform === "tiktok") {
    return `Try the full decision in SpecSmith at ${destination}; commit to your answer before opening the result.`;
  }
  if (platform === "instagram-reels") {
    return `Open SpecSmith at ${destination} to see the full result, tradeoffs, and next action.`;
  }
  return `Continue this exact decision in SpecSmith at ${destination}.`;
}

export function buildContentPackage(idea: ContentIdea, generatedAt: Date): ContentPackage {
  const date = generatedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const base = slug(idea.id || idea.title);
  const campaignId = `ss-${date}-${base}`;

  const platforms: ContentPackage["platforms"] = [
    {
      platform: "youtube-shorts",
      objective: "hook",
      opening: `${idea.hook} Start with the conflict already visible and reveal the answer through the SpecSmith feature, not a generic presenter intro.`,
      pacing: "Fast causal progression: hook -> first evidence -> reversal -> SpecSmith result -> immediate continuation cue. Keep every beat necessary to the decision.",
      ending: `Land on the useful answer, then show that the viewer can continue the exact workflow inside ${idea.productConnection.route}.`,
      captionAngle: `${idea.title} — the full decision continues in SpecSmith.`,
      cta: ctaFor(idea, "youtube-shorts"),
    },
    {
      platform: "tiktok",
      objective: "interaction",
      opening: `Force a prediction immediately: ${idea.hook}`,
      pacing: "Hold back the decisive fact long enough for the viewer to choose; use comments/mental commitment as part of the story, then reveal through SpecSmith.",
      ending: `Reveal whether the viewer's choice survives the SpecSmith result and invite them to run the decision themselves at ${idea.productConnection.route}.`,
      captionAngle: `Pick before the reveal: ${idea.title}`,
      cta: ctaFor(idea, "tiktok"),
    },
    {
      platform: "instagram-reels",
      objective: "polish",
      opening: `Open on the strongest visual state from ${idea.creativeDNA.visualWorld}; make the SpecSmith-powered decision understandable with sound off.`,
      pacing: "Clean visual hierarchy, fewer but stronger text moments, precise transitions tied to evidence, and a polished final result card that matches SpecSmith's product language.",
      ending: `End on the final decision plus a clean visual path into ${idea.productConnection.route}.`,
      captionAngle: `${idea.title} — built from a real SpecSmith decision workflow.`,
      cta: ctaFor(idea, "instagram-reels"),
    },
  ];

  return {
    packageId: `pkg-${campaignId}`,
    campaignId,
    ideaId: idea.id,
    corePromise: `${idea.productConnection.userProblem} ${idea.productConnection.sitePayoff}`,
    feature: idea.productConnection.feature,
    subjectIds: [...idea.subjectIds],
    requiredFacts: [...idea.requiredFacts],
    platforms,
    site: {
      route: idea.productConnection.route,
      pagePurpose: idea.productConnection.whySpecSmith,
      sections: [
        "The exact question or challenge from the video",
        "The verified inputs and constraints used",
        "SpecSmith's result and the reasoning behind it",
        "Tradeoffs or alternate choices the short could not fully show",
        `A direct next action: ${idea.productConnection.continuationAction}`,
      ],
      continuationAction: idea.productConnection.continuationAction,
    },
    attribution: {
      utmSourceByPlatform: PLATFORM_SOURCE,
      utmMedium: "short-form-video",
      utmCampaign: campaignId,
      conversionEvents: ["site-click", "feature-open", "builder-start", "compare-open", "affiliate-click"],
    },
  };
}

export function buildContentPackages(ideas: ContentIdea[], generatedAt: Date): ContentPackage[] {
  return ideas.map((idea) => buildContentPackage(idea, generatedAt));
}
