import type { ContentIdea, HardwareItem, StrategyBatch } from "./types.ts";

const clamp = (value: number) => Math.max(1, Math.min(10, Math.round(value)));
const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function scoreIdea(input: Omit<ContentIdea, "scores">, signals: {
  priceGap?: number;
  scoreGap?: number;
  releaseGap?: number;
  price?: number;
  tier?: number;
}): ContentIdea {
  const priceGap = Math.min((signals.priceGap ?? 0) / 250, 5);
  const scoreGap = Math.min((signals.scoreGap ?? 0) / 25, 4);
  const releaseGap = Math.min(signals.releaseGap ?? 0, 4);
  const priceShock = Math.min((signals.price ?? 0) / 700, 5);
  const tier = signals.tier ?? 5;

  const curiosity = clamp(5 + priceGap + releaseGap * 0.5 + (input.format === "buyer-warning" ? 1.5 : 0));
  const usefulness = clamp(6 + scoreGap * 0.5 + (input.format === "comparison" || input.format === "value" ? 1.5 : 0));
  const visualPotential = clamp(6 + (input.subjectIds.length > 1 ? 1.5 : 0) + (input.format === "build" ? 1.5 : 0));
  const purchaseIntent = clamp(4 + priceShock + (input.format === "comparison" || input.format === "value" ? 1 : 0));
  const novelty = clamp(5 + Math.abs(6 - tier) * 0.4 + releaseGap * 0.6 + (input.format === "experiment" ? 1.5 : 0));
  const total = Number(avg([curiosity, usefulness, visualPotential, purchaseIntent, novelty]).toFixed(2));

  return { ...input, scores: { curiosity, usefulness, visualPotential, purchaseIntent, novelty, total } };
}

export function buildStrategyBatch(gpus: HardwareItem[], cpus: HardwareItem[], now = new Date()): StrategyBatch {
  const currentYear = now.getUTCFullYear();
  const modernGpus = gpus.filter((gpu) => gpu.price_usd > 0 && gpu.benchmark_score > 0 && gpu.release_year >= currentYear - 4);
  const modernCpus = cpus.filter((cpu) => cpu.price_usd > 0 && cpu.benchmark_score > 0 && cpu.release_year >= currentYear - 5);
  const ideas: ContentIdea[] = [];

  const push = (idea: Omit<ContentIdea, "scores">, signals: Parameters<typeof scoreIdea>[1]) => {
    ideas.push(scoreIdea(idea, signals));
  };

  const sortedGpus = [...modernGpus].sort((a, b) => b.benchmark_score - a.benchmark_score);
  const valueGpus = [...modernGpus].sort((a, b) => (b.benchmark_score / b.price_usd) - (a.benchmark_score / a.price_usd));

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
      title: `${gpu.name}: one of the strongest FPS-per-dollar picks in SpecSmith`,
      hook: `This GPU costs about $${gpu.price_usd}, but its performance score punches way above that price.`,
      angle: "Use SpecSmith's own price and performance fields to surface unusually strong value.",
      targetAudience: "Budget-conscious gamers",
      requiredFacts: ["SpecSmith price", "benchmark score", "comparison set used for value ranking"],
      subjectIds: [gpu.id],
    }, { price: gpu.price_usd, tier: gpu.tier });
  }

  const expensive = [...modernGpus].sort((a, b) => b.price_usd - a.price_usd).slice(0, 4);
  for (const gpu of expensive) {
    push({
      id: `gpu-warning-${gpu.id}`,
      format: "buyer-warning",
      title: `Before you spend $${gpu.price_usd.toFixed(0)} on a ${gpu.name}, check this`,
      hook: `$${gpu.price_usd.toFixed(0)} for one GPU sounds insane — so when does it actually make sense?`,
      angle: "Frame flagship pricing as a buyer-warning story instead of generic specs.",
      targetAudience: "High-end PC buyers",
      requiredFacts: ["SpecSmith price", "VRAM if available", "benchmark score", "no unsupported value claims"],
      subjectIds: [gpu.id],
    }, { price: gpu.price_usd, tier: gpu.tier, releaseGap: currentYear - gpu.release_year });
  }

  const cpuByValue = [...modernCpus].sort((a, b) => (b.benchmark_score / b.price_usd) - (a.benchmark_score / a.price_usd));
  for (const cpu of cpuByValue.slice(0, 4)) {
    push({
      id: `cpu-value-${cpu.id}`,
      format: "build",
      title: `Build around the ${cpu.name} without wasting your GPU budget`,
      hook: `If I was building around a ${cpu.name} today, I would protect the GPU budget first.`,
      angle: "Turn a CPU into a practical allocation lesson and point viewers toward the Builder.",
      targetAudience: "First-time and mid-range PC builders",
      requiredFacts: ["SpecSmith CPU price", "benchmark score", "compatible-parts data before naming an exact build"],
      subjectIds: [cpu.id],
    }, { price: cpu.price_usd, tier: cpu.tier });
  }

  const top = ideas
    .sort((a, b) => b.scores.total - a.scores.total || a.id.localeCompare(b.id))
    .filter((idea, index, all) => all.findIndex((other) => other.id === idea.id) === index);

  // Force format diversity so the daily four are four experiments, not four copies.
  const selected: ContentIdea[] = [];
  for (const idea of top) {
    if (selected.length >= 4) break;
    if (!selected.some((picked) => picked.format === idea.format)) selected.push(idea);
  }
  for (const idea of top) {
    if (selected.length >= 4) break;
    if (!selected.some((picked) => picked.id === idea.id)) selected.push(idea);
  }

  return {
    generatedAt: now.toISOString(),
    candidateCount: top.length,
    topFour: selected,
    candidates: top,
  };
}
