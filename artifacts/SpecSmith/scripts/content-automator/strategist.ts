import type { ContentIdea, CreativeDNA, HardwareItem, StrategyBatch } from "./types.ts";

const clamp = (value: number) => Math.max(1, Math.min(10, Math.round(value)));
const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const valueRatio = (item: HardwareItem) => item.benchmark_score / item.price_usd;

type IdeaDraft = Omit<ContentIdea, "scores" | "creativeDNA">;

type IdeaSignals = {
  priceGap?: number;
  scoreGap?: number;
  releaseGap?: number;
  price?: number;
  tier?: number;
  subjectCount?: number;
};

const VISUAL_WORLDS = [
  {
    name: "Silicon Gravity Well",
    direction: "PC parts float in a black void while real price tags physically bend the scene; expensive parts create stronger visual gravity.",
  },
  {
    name: "Neon Evidence Lab",
    direction: "Every claim is treated like forensic evidence: macro hardware scans, floating labels, redacted identities, then a hard reveal.",
  },
  {
    name: "Performance Boss Fight",
    direction: "Hardware becomes a cinematic boss encounter where price, benchmark score, VRAM, and age are visualized as attack phases rather than a stat table.",
  },
  {
    name: "PC Part Stock Exchange",
    direction: "A surreal trading floor where performance-per-dollar moves like a live market and bad value gets visually sold off.",
  },
  {
    name: "Budget Heist Board",
    direction: "A heist-planning wall traces where each dollar goes, with the viewer watching one component steal budget from another.",
  },
  {
    name: "Hardware Courtroom",
    direction: "A component is put on trial; price is the accusation, performance data is evidence, and the verdict is withheld until the end.",
  },
  {
    name: "Blind Draft Arena",
    direction: "Names and brands stay hidden while only verified numbers are shown; the viewer must pick before the identities are revealed.",
  },
  {
    name: "Upgrade Time Loop",
    direction: "The same PC decision repeats in a visual time loop, but one variable changes each cycle until the surprising choice becomes obvious.",
  },
  {
    name: "Silicon X-Ray",
    direction: "The part is visually sliced into layers of cost, age, tier, VRAM, and performance so the decision feels like an animated autopsy.",
  },
  {
    name: "Price-Tag Physics",
    direction: "Dollar amounts become physical objects: weights, walls, projectiles, traps, and doors that the hardware has to overcome.",
  },
  {
    name: "Spec Roulette",
    direction: "Verified specs arrive one at a time like roulette outcomes; the identity stays hidden until the viewer has committed to a choice.",
  },
  {
    name: "Impossible Museum",
    direction: "Each part lives inside a bizarre museum exhibit built around one real fact, with rapid transitions between exhibits instead of generic B-roll.",
  },
] as const;

const NARRATIVE_ENGINES = [
  "blind-choice reveal: force the viewer to choose before the product names appear",
  "reverse auction: start with the highest price and remove dollars until the value winner survives",
  "three-act accusation: make a strong claim, present evidence against it, then reverse or confirm it at the payoff",
  "escalating rule change: every few seconds add a new constraint that changes which part looks best",
  "identity mystery: show only data and silhouettes until the final reveal",
  "visual transformation: turn the numerical tradeoff into a physical transformation the viewer can understand without a chart",
  "boss phases: each metric unlocks a new phase and the apparent winner can change before the final phase",
  "time-loop correction: repeat the same decision with one changed variable until the mistake becomes impossible to miss",
] as const;

const RADICAL_FORMATS = new Set<ContentIdea["format"]>(["experiment", "visual-story", "game", "simulation"]);

function stableHash(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], seed: number, offset = 0): T {
  return items[(seed + offset * 7919) % items.length];
}

function buildCreativeDNA(input: IdeaDraft, signals: IdeaSignals): CreativeDNA {
  const seed = stableHash(input.id);
  const world = pick(VISUAL_WORLDS, seed);
  const narrativeEngine = pick(NARRATIVE_ENGINES, seed, 1);
  const subjects = input.subjectIds.length > 1 ? "the competing parts" : "the featured part";
  const priceGap = signals.priceGap ?? 0;
  const scoreGap = signals.scoreGap ?? 0;

  let surpriseMechanic = "withhold the obvious answer, let the viewer form a prediction, then reveal the verified data that changes or confirms it";
  if (priceGap >= 300 && scoreGap <= 50) {
    surpriseMechanic = `make the $${Math.round(priceGap)} price gap feel enormous on screen before revealing how small or large the performance gap actually is`;
  } else if (input.subjectIds.length >= 3) {
    surpriseMechanic = "hide all product identities, eliminate one candidate at a time, and reveal the names only after the viewer has mentally drafted a winner";
  } else if (input.format === "buyer-warning") {
    surpriseMechanic = "open as if the expensive option is absurd, then force the video to earn either a guilty or not-guilty verdict from the real data";
  }

  return {
    conceptName: `${world.name}: ${input.title}`,
    visualWorld: `${world.name} — ${world.direction}`,
    narrativeEngine,
    openingImage: `Open on ${subjects} already inside the ${world.name}; no logo, no presenter intro, no setup sentence. The first frame must look like the story has already started.`,
    patternInterrupt: `${input.hook} Visualize the claim immediately instead of explaining it over generic PC footage.`,
    retentionBeats: [
      `0.0-1.2s — visual shock: establish the ${world.name} and the core conflict before the viewer can categorize it as a normal PC short.`,
      `1.2-4.0s — commitment: ${surpriseMechanic}.`,
      "4.0-9.0s — first evidence drop: reveal one verified number and make it alter the visual world, not just appear as text.",
      "9.0-16.0s — reversal: introduce the strongest counterpoint so the video cannot be predicted from the hook alone.",
      "16.0-24.0s — payoff: reveal the decision, then end on a visual consequence rather than a generic subscribe CTA.",
    ],
    payoff: `Resolve the exact buyer question in "${input.angle}" using only the verified facts listed for this idea. If the evidence is inconclusive, say so instead of manufacturing a winner.`,
    audioDirection: "Sound design should behave like part of the story: hard silence before reveals, tactile impacts tied to price/spec changes, and no generic nonstop hype bed that flattens every beat.",
    originalityConstraint: "Reject the concept if it could be recreated as stock RGB B-roll plus captions. At least one core visual mechanic must be inseparable from the hardware data itself.",
    antiSlopRules: [
      "No 'here are 3 things' listicle opening.",
      "No logo animation or greeting in the first two seconds.",
      "No generic RGB desk pan unless it has a narrative function.",
      "No fake benchmarks, fake prices, fake UI, or invented product facts.",
      "No static spec card held on screen while narration simply reads it.",
      "No repeating the hook as the payoff.",
      "No visual state should persist by default; earn any shot longer than roughly two seconds with tension or a reveal.",
      "If the result feels like a recognizable template, mutate the visual world or narrative engine before production.",
    ],
  };
}

function scoreIdea(input: IdeaDraft, signals: IdeaSignals): ContentIdea {
  const priceGap = Math.min((signals.priceGap ?? 0) / 250, 5);
  const scoreGap = Math.min((signals.scoreGap ?? 0) / 25, 4);
  const releaseGap = Math.min(signals.releaseGap ?? 0, 4);
  const priceShock = Math.min((signals.price ?? 0) / 700, 5);
  const tier = signals.tier ?? 5;
  const experimental = RADICAL_FORMATS.has(input.format);
  const creativeDNA = buildCreativeDNA(input, signals);

  const curiosity = clamp(5 + priceGap + releaseGap * 0.5 + (input.format === "buyer-warning" ? 1.5 : 0) + (experimental ? 1 : 0));
  const usefulness = clamp(6 + scoreGap * 0.5 + (input.format === "comparison" || input.format === "value" ? 1.5 : 0));
  const visualPotential = clamp(7 + (input.subjectIds.length > 1 ? 1 : 0) + (experimental ? 1.5 : 0));
  const purchaseIntent = clamp(4 + priceShock + (input.format === "comparison" || input.format === "value" || input.format === "buyer-warning" ? 1 : 0));
  const novelty = clamp(6 + Math.abs(6 - tier) * 0.3 + releaseGap * 0.5 + (experimental ? 2 : 0));
  const originality = clamp(7 + (experimental ? 2 : 0) + (input.subjectIds.length >= 3 ? 0.5 : 0));
  const retentionPotential = clamp(7 + Math.min(priceGap, 2) * 0.5 + (input.format === "game" ? 2 : 0) + (experimental ? 0.5 : 0));
  const shareability = clamp(6 + (input.format === "game" ? 2 : 0) + (input.format === "buyer-warning" ? 1 : 0) + (input.subjectIds.length > 1 ? 0.5 : 0));
  const total = Number((
    curiosity * 0.16 +
    usefulness * 0.13 +
    visualPotential * 0.14 +
    purchaseIntent * 0.09 +
    novelty * 0.13 +
    originality * 0.16 +
    retentionPotential * 0.12 +
    shareability * 0.07
  ).toFixed(2));

  return {
    ...input,
    creativeDNA,
    scores: {
      curiosity,
      usefulness,
      visualPotential,
      purchaseIntent,
      novelty,
      originality,
      retentionPotential,
      shareability,
      total,
    },
  };
}

export function buildStrategyBatch(gpus: HardwareItem[], cpus: HardwareItem[], now = new Date()): StrategyBatch {
  const currentYear = now.getUTCFullYear();
  const modernGpus = gpus.filter((gpu) => gpu.price_usd > 0 && gpu.benchmark_score > 0 && gpu.release_year >= currentYear - 4);
  const modernCpus = cpus.filter((cpu) => cpu.price_usd > 0 && cpu.benchmark_score > 0 && cpu.release_year >= currentYear - 5);
  const ideas: ContentIdea[] = [];

  const push = (idea: IdeaDraft, signals: IdeaSignals) => {
    ideas.push(scoreIdea(idea, { ...signals, subjectCount: idea.subjectIds.length }));
  };

  const sortedGpus = [...modernGpus].sort((a, b) => b.benchmark_score - a.benchmark_score);
  const valueGpus = [...modernGpus].sort((a, b) => valueRatio(b) - valueRatio(a));

  for (let i = 0; i < Math.min(sortedGpus.length - 1, 8); i++) {
    const a = sortedGpus[i];
    const b = sortedGpus[i + 1];
    const priceGap = Math.abs(a.price_usd - b.price_usd);
    const scoreGap = Math.abs(a.benchmark_score - b.benchmark_score);
    push({
      id: `gpu-compare-${a.id}-${b.id}`,
      format: "comparison",
      title: `${a.name} vs ${b.name}: is the extra money actually worth it?`,
      hook: `You're paying $${priceGap.toFixed(0)} more for this GPU. Here's what that actually buys you.`,
      angle: "Turn a real price/performance gap into a fast buyer decision.",
      targetAudience: "PC builders choosing between nearby GPU tiers",
      requiredFacts: [`${a.name} current SpecSmith price`, `${b.name} current SpecSmith price`, "benchmark score difference", "estimated FPS must be labeled estimated if used"],
      subjectIds: [a.id, b.id],
    }, { priceGap, scoreGap, releaseGap: Math.abs(a.release_year - b.release_year), price: Math.max(a.price_usd, b.price_usd), tier: avg([a.tier ?? 5, b.tier ?? 5]) });
  }

  for (const gpu of valueGpus.slice(0, 6)) {
    push({
      id: `gpu-value-${gpu.id}`,
      format: "value",
      title: `${gpu.name}: one of the strongest performance-per-dollar picks in SpecSmith`,
      hook: `This GPU costs about $${gpu.price_usd}, but its performance score punches way above that price.`,
      angle: "Use SpecSmith's own price and benchmark-score fields to surface unusually strong value within the current catalog.",
      targetAudience: "Budget-conscious gamers",
      requiredFacts: ["SpecSmith price", "benchmark score", "comparison set used for value ranking", "do not call benchmark_score measured game FPS"],
      subjectIds: [gpu.id],
    }, { price: gpu.price_usd, tier: gpu.tier });
  }

  const expensive = [...modernGpus].sort((a, b) => b.price_usd - a.price_usd).slice(0, 4);
  for (const gpu of expensive) {
    push({
      id: `gpu-warning-${gpu.id}`,
      format: "buyer-warning",
      title: `Before you spend $${gpu.price_usd.toFixed(0)} on a ${gpu.name}, put it on trial`,
      hook: `$${gpu.price_usd.toFixed(0)} for one GPU sounds insane — so make the data defend it.`,
      angle: "Frame flagship pricing as a buyer-warning story instead of a generic spec readout.",
      targetAudience: "High-end PC buyers",
      requiredFacts: ["SpecSmith price", "VRAM if available", "benchmark score", "no unsupported value claims"],
      subjectIds: [gpu.id],
    }, { price: gpu.price_usd, tier: gpu.tier, releaseGap: currentYear - gpu.release_year });
  }

  const cpuByValue = [...modernCpus].sort((a, b) => valueRatio(b) - valueRatio(a));
  for (const cpu of cpuByValue.slice(0, 4)) {
    push({
      id: `cpu-value-${cpu.id}`,
      format: "build",
      title: `Build around the ${cpu.name} without letting the CPU eat the whole budget`,
      hook: `Give this ${cpu.name} a budget and watch where the money tries to disappear.`,
      angle: "Turn a CPU into a practical allocation story and point viewers toward the Builder.",
      targetAudience: "First-time and mid-range PC builders",
      requiredFacts: ["SpecSmith CPU price", "benchmark score", "compatible-parts data before naming an exact build"],
      subjectIds: [cpu.id],
    }, { price: cpu.price_usd, tier: cpu.tier });
  }

  // Wildcards deliberately break out of standard tech-review grammar while staying tied to real local data.
  if (sortedGpus.length >= 2) {
    const strongest = sortedGpus[0];
    const valuePick = valueGpus[0];
    const priceGap = Math.abs(strongest.price_usd - valuePick.price_usd);
    const scoreGap = Math.abs(strongest.benchmark_score - valuePick.benchmark_score);
    push({
      id: `wildcard-gravity-${strongest.id}-${valuePick.id}`,
      format: "visual-story",
      title: "What if GPU prices had gravity?",
      hook: `$${Math.round(priceGap)} of price difference is about to bend this entire room.`,
      angle: `Turn the real ${strongest.name} vs ${valuePick.name} price/performance tradeoff into a physical world where cost has gravity.`,
      targetAudience: "PC viewers who normally swipe past specification comparisons",
      requiredFacts: ["both SpecSmith prices", "both benchmark scores", "price gap", "benchmark score is not game FPS"],
      subjectIds: [strongest.id, valuePick.id],
    }, { priceGap, scoreGap, price: Math.max(strongest.price_usd, valuePick.price_usd), tier: strongest.tier });
  }

  if (valueGpus.length >= 3) {
    const draft = valueGpus.slice(0, 3);
    push({
      id: `wildcard-blind-draft-${draft.map((gpu) => gpu.id).join("-")}`,
      format: "game",
      title: "Blind GPU draft: pick one before I tell you what any of them are",
      hook: "Three GPUs. No names. No logos. You only get price and one performance number — choose now.",
      angle: "Make the viewer commit to a choice before brand bias can influence the decision, then reveal the identities.",
      targetAudience: "PC enthusiasts and casual buyers who enjoy interactive reveal formats",
      requiredFacts: draft.flatMap((gpu) => [`${gpu.name} SpecSmith price`, `${gpu.name} benchmark score`]).concat("ranking methodology must be stated or inferable"),
      subjectIds: draft.map((gpu) => gpu.id),
    }, {
      priceGap: Math.max(...draft.map((gpu) => gpu.price_usd)) - Math.min(...draft.map((gpu) => gpu.price_usd)),
      scoreGap: Math.max(...draft.map((gpu) => gpu.benchmark_score)) - Math.min(...draft.map((gpu) => gpu.benchmark_score)),
      price: Math.max(...draft.map((gpu) => gpu.price_usd)),
      tier: avg(draft.map((gpu) => gpu.tier ?? 5)),
    });
  }

  if (sortedGpus.length >= 2) {
    const a = sortedGpus[0];
    const b = sortedGpus[Math.min(2, sortedGpus.length - 1)];
    push({
      id: `wildcard-hp-bars-${a.id}-${b.id}`,
      format: "simulation",
      title: "I turned GPU prices into damage and performance into armor",
      hook: "Every dollar hits the health bar. Every performance point blocks damage. Which GPU survives?",
      angle: "Translate the verified price/performance relationship into a game-like simulation whose rules are visible and mathematically consistent.",
      targetAudience: "Gaming-first PC audiences",
      requiredFacts: ["both SpecSmith prices", "both benchmark scores", "simulation rule shown on screen", "simulation is a visualization, not a benchmark"],
      subjectIds: [a.id, b.id],
    }, {
      priceGap: Math.abs(a.price_usd - b.price_usd),
      scoreGap: Math.abs(a.benchmark_score - b.benchmark_score),
      price: Math.max(a.price_usd, b.price_usd),
      tier: avg([a.tier ?? 5, b.tier ?? 5]),
    });
  }

  if (cpuByValue.length >= 2) {
    const a = cpuByValue[0];
    const b = [...modernCpus].sort((left, right) => right.price_usd - left.price_usd)[0];
    push({
      id: `wildcard-cpu-heist-${a.id}-${b.id}`,
      format: "experiment",
      title: "The CPU budget heist",
      hook: `One of these CPUs is about to steal $${Math.abs(a.price_usd - b.price_usd).toFixed(0)} from the rest of your build.`,
      angle: "Make CPU price difference a literal heist story, then use verified catalog data to explain the tradeoff without inventing an exact build outcome.",
      targetAudience: "Builders deciding how aggressively to spend on CPU",
      requiredFacts: ["both CPU prices", "both benchmark scores", "do not claim an exact GPU upgrade unless compatible catalog data supports it"],
      subjectIds: [a.id, b.id],
    }, {
      priceGap: Math.abs(a.price_usd - b.price_usd),
      scoreGap: Math.abs(a.benchmark_score - b.benchmark_score),
      price: Math.max(a.price_usd, b.price_usd),
      tier: avg([a.tier ?? 5, b.tier ?? 5]),
    });
  }

  const ranked = ideas
    .sort((a, b) => b.scores.total - a.scores.total || b.scores.originality - a.scores.originality || a.id.localeCompare(b.id))
    .filter((idea, index, all) => all.findIndex((other) => other.id === idea.id) === index);

  // Four videos should feel like four inventions, not one template with swapped SKUs. At least two slots are reserved for radical formats.
  const selected: ContentIdea[] = [];
  const usedFormats = new Set<string>();
  const usedWorlds = new Set<string>();
  const worldName = (idea: ContentIdea) => idea.creativeDNA.visualWorld.split(" — ")[0];
  const add = (idea: ContentIdea) => {
    selected.push(idea);
    usedFormats.add(idea.format);
    usedWorlds.add(worldName(idea));
  };

  for (const idea of ranked) {
    if (selected.filter((picked) => RADICAL_FORMATS.has(picked.format)).length >= 2) break;
    if (!RADICAL_FORMATS.has(idea.format)) continue;
    const world = worldName(idea);
    if (!usedFormats.has(idea.format) && !usedWorlds.has(world)) add(idea);
  }

  for (const idea of ranked) {
    if (selected.length >= 4) break;
    const world = worldName(idea);
    if (!selected.some((picked) => picked.id === idea.id) && !usedFormats.has(idea.format) && !usedWorlds.has(world)) add(idea);
  }
  for (const idea of ranked) {
    if (selected.length >= 4) break;
    const world = worldName(idea);
    if (!selected.some((picked) => picked.id === idea.id) && !usedWorlds.has(world)) add(idea);
  }
  for (const idea of ranked) {
    if (selected.length >= 4) break;
    if (!selected.some((picked) => picked.id === idea.id)) add(idea);
  }

  return {
    generatedAt: now.toISOString(),
    candidateCount: ranked.length,
    topFour: selected,
    candidates: ranked,
  };
}
