import { connection } from "./productMap.ts";
import type { ContentIdea, CreativeDNA, HardwareItem, StrategyBatch } from "./types.ts";

const clamp = (value: number) => Math.max(1, Math.min(10, Math.round(value)));
const valueRatio = (item: HardwareItem) => item.benchmark_score / item.price_usd;
const RADICAL = new Set<ContentIdea["format"]>(["experiment", "visual-story", "game", "simulation"]);

type IdeaDraft = Omit<ContentIdea, "scores" | "creativeDNA">;

const FEATURE_WORLD = {
  builder: "SpecSmith Build Lab",
  compare: "SpecSmith Decision Arena",
  "build-crate": "Build Crate Reveal Room",
  "build-guides": "SpecSmith Mission Board",
  gallery: "SpecSmith Repair Bench",
  upgrade: "Upgrade Rescue Lab",
  "parts-catalog": "SpecSmith Parts Board",
  "price-guesser": "SpecSmith Price Stage",
} as const;

function creativeDNA(idea: IdeaDraft): CreativeDNA {
  const world = FEATURE_WORLD[idea.productConnection.feature];
  const interactive = RADICAL.has(idea.format);
  return {
    conceptName: `${world}: ${idea.title}`,
    visualWorld: `${world} — the real SpecSmith feature is part of the visual mechanic, not a logo pasted onto unrelated PC footage.`,
    narrativeEngine: interactive
      ? "viewer decision -> SpecSmith evidence -> reversal -> product result"
      : "real buyer problem -> SpecSmith analysis -> decision -> continue on site",
    openingImage: `Open inside ${world} with the problem already happening. The first frame must show a build, comparison, crate, upgrade, or part decision from SpecSmith.` ,
    patternInterrupt: `${idea.hook} Make the viewer choose, predict, or spot the mistake before SpecSmith reveals the answer.`,
    retentionBeats: [
      "0.0-1.2s — show the actual PC decision immediately; no logo intro.",
      "1.2-4.0s — force a prediction, choice, or challenge.",
      "4.0-9.0s — reveal the first verified SpecSmith fact or product state.",
      "9.0-16.0s — introduce the tradeoff or reversal that makes the first answer uncertain.",
      `16.0-26.0s — resolve the problem, then naturally continue into ${idea.productConnection.route}.`,
    ],
    payoff: `${idea.productConnection.sitePayoff} The final answer must come from verified SpecSmith data or an actual SpecSmith feature result.`,
    audioDirection: "Use sound to emphasize choices, reveals, crate pulls, swaps, and mistakes. Avoid a constant generic hype track.",
    originalityConstraint: "The concept fails if SpecSmith can be removed without changing the story. Creativity must amplify a real product action or PC decision.",
    antiSlopRules: [
      "No generic RGB montage as the core video.",
      "No fake benchmark, price, compatibility, build, or UI result.",
      "No static spec-card narration for most of the runtime.",
      "No unrelated visual metaphor whose connection to the PC decision needs explaining.",
      "No generic follow-for-more ending when the natural continuation is a SpecSmith feature.",
      "No concept may pass if another PC brand could replace SpecSmith with no meaningful change.",
      "If live price data is used, verify freshness before publishing.",
      "Estimated FPS must remain labeled estimated; benchmark_score is not measured game FPS.",
    ],
  };
}

function score(idea: IdeaDraft, signal = 0): ContentIdea {
  const radical = RADICAL.has(idea.format);
  const curiosity = clamp(7 + (radical ? 2 : 0) + signal);
  const usefulness = clamp(9 + signal * 0.25);
  const visualPotential = clamp(8 + (radical ? 1 : 0));
  const purchaseIntent = clamp(7 + (idea.productConnection.feature === "compare" || idea.productConnection.feature === "builder" || idea.productConnection.feature === "upgrade" ? 2 : 0));
  const novelty = clamp(7 + (radical ? 2 : 0));
  const originality = clamp(7 + (radical ? 2 : 0));
  const retentionPotential = clamp(8 + (radical ? 1 : 0));
  const shareability = clamp(7 + (idea.format === "game" || idea.productConnection.feature === "build-crate" ? 2 : 0));
  const productFit = 10;
  const siteContinuation = 10;
  const total = Number((
    curiosity * 0.12 + usefulness * 0.13 + visualPotential * 0.11 + purchaseIntent * 0.08 +
    novelty * 0.09 + originality * 0.10 + retentionPotential * 0.12 + shareability * 0.07 +
    productFit * 0.10 + siteContinuation * 0.08
  ).toFixed(2));
  return { ...idea, creativeDNA: creativeDNA(idea), scores: { curiosity, usefulness, visualPotential, purchaseIntent, novelty, originality, retentionPotential, shareability, productFit, siteContinuation, total } };
}

export function buildStrategyBatch(gpus: HardwareItem[], cpus: HardwareItem[], now = new Date()): StrategyBatch {
  const year = now.getUTCFullYear();
  const validGpus = gpus.filter((x) => x.price_usd > 0 && x.benchmark_score > 0 && x.release_year >= year - 4);
  const validCpus = cpus.filter((x) => x.price_usd > 0 && x.benchmark_score > 0 && x.release_year >= year - 5);
  const byPerf = [...validGpus].sort((a, b) => b.benchmark_score - a.benchmark_score);
  const byValue = [...validGpus].sort((a, b) => valueRatio(b) - valueRatio(a));
  const cpuValue = [...validCpus].sort((a, b) => valueRatio(b) - valueRatio(a));
  const ideas: ContentIdea[] = [];
  const push = (idea: IdeaDraft, signal = 0) => ideas.push(score(idea, signal));

  for (let i = 0; i < Math.min(6, byPerf.length - 1); i++) {
    const a = byPerf[i]; const b = byPerf[i + 1];
    const gap = Math.abs(a.price_usd - b.price_usd);
    push({
      id: `compare-${a.id}-${b.id}`,
      format: i % 2 === 0 ? "game" : "comparison",
      title: i % 2 === 0 ? `Pick the GPU before SpecSmith reveals the names: ${a.name} vs ${b.name}` : `${a.name} vs ${b.name}: where does the extra $${Math.round(gap)} actually go?`,
      hook: i % 2 === 0 ? "Two GPUs. Names hidden. Pick one before SpecSmith reveals what your money actually buys." : `These GPUs are $${Math.round(gap)} apart. Is the expensive one actually the smarter choice?`,
      angle: "Turn the Compare feature into the actual decision game.",
      targetAudience: "PC buyers choosing between nearby GPU tiers",
      requiredFacts: [`${a.name} verified SpecSmith price`, `${b.name} verified SpecSmith price`, "benchmark-score difference", "current comparison data"],
      subjectIds: [a.id, b.id],
      productConnection: connection("compare", "Choose between two GPUs without getting lost in specs.", "SpecSmith provides the side-by-side comparison and verified decision inputs.", "Open the exact comparison and change the parts yourself.", "The final reveal lands on the actual SpecSmith comparison rather than an arbitrary creator opinion."),
    }, gap > 250 ? 1 : 0);
  }

  for (const gpu of byValue.slice(0, 4)) {
    push({
      id: `builder-budget-${gpu.id}`,
      format: "simulation",
      title: `I gave SpecSmith a gaming-PC budget and locked in the ${gpu.name}`,
      hook: `Lock this ${gpu.name} into a build. Now every remaining dollar has to survive the Builder.`,
      angle: "Use a real part as a constraint and let the Builder drive the rest of the story.",
      targetAudience: "People planning a gaming PC around a GPU",
      requiredFacts: ["verified GPU price", "actual compatible Builder result before publishing", "final build total", "no invented compatibility result"],
      subjectIds: [gpu.id],
      productConnection: connection("builder", "Build a balanced PC around one must-have component.", "The SpecSmith Builder is the engine resolving budget and compatibility tradeoffs.", "Open the finished build in Builder and swap the parts or budget.", "The payoff is a real build the viewer can continue editing."),
    });
  }

  for (const cpu of cpuValue.slice(0, 3)) {
    push({
      id: `upgrade-${cpu.id}`,
      format: "experiment",
      title: `You get one upgrade. Does SpecSmith spend it on the ${cpu.name} or somewhere else?`,
      hook: "One upgrade. One budget. Make your pick before SpecSmith runs the decision.",
      angle: "Turn an upgrade decision into a prediction challenge instead of a lecture.",
      targetAudience: "Owners deciding what to upgrade first",
      requiredFacts: ["verified CPU price", "actual upgrade-calculator result or supported comparison", "no invented FPS gain"],
      subjectIds: [cpu.id],
      productConnection: connection("upgrade", "Decide where limited upgrade money should go first.", "SpecSmith has an upgrade workflow instead of relying on a generic recommendation.", "Run the viewer's own current parts through the upgrade tool.", "The video answers one case while the site lets the viewer test theirs."),
    });
  }

  if (byValue.length >= 3) {
    const picks = byValue.slice(0, 3);
    push({
      id: `price-guesser-${picks.map((x) => x.id).join("-")}`,
      format: "game",
      title: "Can you beat SpecSmith's GPU Price Guesser?",
      hook: "Three GPUs. Five seconds each. Guess the real price before SpecSmith flips the card.",
      angle: "Make an existing SpecSmith game the content itself.",
      targetAudience: "PC enthusiasts who enjoy price knowledge and interactive challenges",
      requiredFacts: picks.map((x) => `${x.name} price must be verified immediately before publishing`),
      subjectIds: picks.map((x) => x.id),
      productConnection: connection("price-guesser", "Test whether you actually know current PC-part pricing.", "SpecSmith already has a dedicated Price Guesser interaction.", "Play more rounds on the SpecSmith Price Guesser.", "The social video is one round of the same game available on the site."),
    }, 1);
  }

  push({
    id: "crate-random-build-challenge",
    format: "visual-story",
    title: "SpecSmith Build Crate picked the PC. Now we have to make the pull work.",
    hook: "We don't choose the parts. Build Crate does. The question is whether this random pull is actually a PC you'd keep.",
    angle: "Use Build Crate's real compatible randomized build as the unpredictable source of the episode.",
    targetAudience: "PC viewers who like randomizers, rarity systems, and build challenges",
    requiredFacts: ["record an actual Build Crate pull", "use the exact pulled parts and rarity", "use actual final build price", "do not pre-script a fake legendary pull"],
    subjectIds: [],
    productConnection: connection("build-crate", "Make PC building playful without generating fake parts or impossible builds.", "Build Crate pulls from SpecSmith's real parts database and finalizes a compatible build.", "Open a crate, share the pull, or send it into Builder to refine it.", "The video outcome is literally generated by a SpecSmith feature."),
  }, 1);

  push({
    id: "crate-fix-the-pull",
    format: "game",
    title: "Build Crate gave us this PC. You can change ONE part.",
    hook: "Build Crate just dealt this PC. You get one swap. What are you changing before we open it in Builder?",
    angle: "Combine Build Crate's randomness with Builder's refinement workflow.",
    targetAudience: "PC builders who like fixing or optimizing builds",
    requiredFacts: ["actual Build Crate result", "actual Builder-compatible swap", "before/after totals", "no unsupported performance claim"],
    subjectIds: [],
    productConnection: connection("build-crate", "Turn a random valid build into a smarter personal build.", "SpecSmith uniquely connects the randomized crate result to Builder refinement.", "Open the pulled build in Builder and make your own swap.", "The CTA continues the exact decision the viewer just made."),
  }, 1);

  push({
    id: "gallery-spot-the-build-mistake",
    format: "game",
    title: "There is one part in this SpecSmith Gallery build I'd question first. Can you spot it?",
    hook: "You get five seconds to inspect this real build before we open it up and make the case.",
    angle: "Use a real Gallery build as the object viewers inspect and discuss.",
    targetAudience: "Builders who like rating and improving PCs",
    requiredFacts: ["select a real published Gallery build", "verify every shown part", "frame subjective recommendations as recommendations"],
    subjectIds: [],
    productConnection: connection("gallery", "Learn to inspect complete builds rather than isolated parts.", "SpecSmith Gallery provides real build objects viewers can inspect and continue exploring.", "Open the Gallery build, copy it, or compare an alternative.", "The viewer can inspect the same build instead of trusting an edited screenshot."),
  });

  push({
    id: "guide-budget-ladder",
    format: "build",
    title: "What does another $200 actually change in a SpecSmith gaming build?",
    hook: "Same goal. Two budgets. Only $200 changes — so where should it actually go?",
    angle: "Turn build guides into a budget ladder with a visible decision at each step.",
    targetAudience: "Buyers deciding whether stretching a PC budget is worth it",
    requiredFacts: ["generate both real guide/build configurations", "verify totals", "state estimated performance as estimated"],
    subjectIds: [],
    productConnection: connection("build-guides", "Understand what a larger budget meaningfully changes.", "SpecSmith can connect use-case guidance to concrete parts and build totals.", "Open the relevant build guide and adjust the budget/use case.", "The site contains the full parts and reasoning behind the short-form comparison."),
  });

  for (const gpu of byValue.slice(0, 3)) {
    push({
      id: `catalog-${gpu.id}`,
      format: "value",
      title: `Why does SpecSmith keep surfacing the ${gpu.name} around this price tier?`,
      hook: `Forget the logo for a second. At about $${Math.round(gpu.price_usd)}, what is this GPU actually buying you?`,
      angle: "Use the catalog/guide layer to explain one concrete buying decision.",
      targetAudience: "GPU shoppers comparing value tiers",
      requiredFacts: ["fresh price", "benchmark score", "comparison set", "do not call benchmark_score measured FPS"],
      subjectIds: [gpu.id],
      productConnection: connection("parts-catalog", "Find a sensible part within a price tier.", "SpecSmith organizes parts, prices, tiers, and guide pages around buying decisions.", "Open the related parts guide or comparison and inspect alternatives.", "The short gives the decision; the site gives the full option set."),
    });
  }

  const ranked = ideas.sort((a, b) => b.scores.total - a.scores.total || a.id.localeCompare(b.id));
  const topFour: ContentIdea[] = [];
  const usedFeatures = new Set<string>();
  for (const idea of ranked) {
    if (topFour.length >= 4) break;
    if (!usedFeatures.has(idea.productConnection.feature)) {
      topFour.push(idea); usedFeatures.add(idea.productConnection.feature);
    }
  }
  for (const idea of ranked) {
    if (topFour.length >= 4) break;
    if (!topFour.some((x) => x.id === idea.id)) topFour.push(idea);
  }

  return { generatedAt: now.toISOString(), candidateCount: ranked.length, topFour, candidates: ranked };
}
