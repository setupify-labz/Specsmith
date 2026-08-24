import type { ProductConnection, SiteFeature } from "./types.ts";

export interface ProductSurface {
  feature: SiteFeature;
  route: string;
  purpose: string;
  contentJobs: string[];
}

export const PRODUCT_SURFACES: ProductSurface[] = [
  {
    feature: "builder",
    route: "/builder",
    purpose: "Build and refine a PC around budget, performance, and compatibility decisions.",
    contentJobs: ["budget challenge", "build rescue", "constraint build", "spend-the-next-$200 decision"],
  },
  {
    feature: "compare",
    route: "/compare",
    purpose: "Compare hardware choices and make a clearer buy decision.",
    contentJobs: ["blind comparison", "price-gap decision", "pick-before-reveal", "value tradeoff"],
  },
  {
    feature: "build-crate",
    route: "/crate",
    purpose: "Open a randomized but real, compatible build from SpecSmith's parts database, then refine or share it.",
    contentJobs: ["crate challenge", "rare pull reaction", "can-this-random-build-win", "fix-the-crate"],
  },
  {
    feature: "build-guides",
    route: "/best-pc-for",
    purpose: "Turn use cases and budgets into concrete build guidance.",
    contentJobs: ["best PC for a use case", "budget ladder", "one-rule build", "guide showdown"],
  },
  {
    feature: "gallery",
    route: "/gallery",
    purpose: "Showcase builds and give viewers something concrete to inspect, copy, or improve.",
    contentJobs: ["rate this build", "spot the mistake", "community build rescue", "before-and-after build"],
  },
  {
    feature: "upgrade",
    route: "/upgrade-calculator",
    purpose: "Help users decide whether an upgrade is worthwhile and where to spend next.",
    contentJobs: ["upgrade first", "$200 upgrade challenge", "keep-or-replace", "old-PC rescue"],
  },
  {
    feature: "parts-catalog",
    route: "/parts-guides",
    purpose: "Evaluate parts, tiers, prices, and recommendations across the catalog.",
    contentJobs: ["best value pick", "buyer warning", "tier challenge", "hidden-value part"],
  },
  {
    feature: "price-guesser",
    route: "/price-guesser",
    purpose: "Turn real hardware prices into an interactive guessing game.",
    contentJobs: ["guess the GPU price", "higher-or-lower", "price shock", "brand-hidden price challenge"],
  },
];

export function connection(
  feature: SiteFeature,
  userProblem: string,
  whySpecSmith: string,
  continuationAction: string,
  sitePayoff: string,
): ProductConnection {
  const surface = PRODUCT_SURFACES.find((item) => item.feature === feature);
  if (!surface) throw new Error(`Unknown SpecSmith feature: ${feature}`);
  return {
    feature,
    route: surface.route,
    userProblem,
    whySpecSmith,
    continuationAction,
    sitePayoff,
  };
}
