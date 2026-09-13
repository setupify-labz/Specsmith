/**
 * The reference build of the GPU upgrade guide, currently /upgrade/rx-6600.
 *
 * WHY ONE SLUG. All 57 upgrade pages render from one component, so anything
 * added there lands on every card at once. This module is opt-in: a slug with
 * no entry gets exactly the page it had before, byte for byte. That keeps the
 * blast radius at one URL while the shape is proven, and makes the rollout to
 * the other 56 a data change rather than a rewrite.
 *
 * WHAT THE PAGE HAS TO ANSWER. Someone typing "is it worth upgrading from an
 * RX 6600" wants six things, and the page as it stood answered one and a half:
 *
 *   1. Is upgrading worth it at all?     — buried in the fourth FAQ.
 *   2. What should I buy at my budget?   — a flat list of six cards by tier.
 *   3. How much faster will it be?       — shown, but unlabelled as modelled.
 *   4. Will my power supply take it?     — absent.
 *   5. Will my CPU hold it back?         — absent, and silently assumed away.
 *   6. How do I check before buying?     — a button that builds around the
 *                                          card being replaced.
 *
 * The worst of it was the lead. `getUpgradeIntro` calls the cheapest card one
 * tier up "the best upgrade in our data" — for the RX 6600 that is an RX 6600
 * XT at about +3%, which the page's own badge calls a marginal gain. The first
 * thing a reader saw recommended the one option not worth their money.
 *
 * EVERY NUMBER HERE IS DERIVED. Nothing in this file hard-codes an FPS figure,
 * a price, or a gain. They come from the same estimator and the same
 * `gpus.json` the rest of the site uses, so a data refresh moves the page and
 * cannot leave a stale claim frozen in prose. No benchmark result is quoted,
 * because SpecSmith has not measured one for these pairings; no live price is
 * quoted, because the catalogue's figures are editorial and dated.
 */

import {
  UPGRADE_REFERENCE_CPU,
  averageFps,
  averageFpsWithCpu,
  getBestValueCandidate,
  getUpgradeCandidates,
  getUpgradeGpu,
  type UpgradeCandidate,
  type UpgradeGpu,
} from './upgradeCalculator';
import cpuData from '../data/cpus.json';

/**
 * The gain below which an upgrade is not worth paying for.
 *
 * Deliberately the SAME boundary the card badges already use for 'moderate',
 * so the recommendation and the label beside it cannot disagree. A page that
 * calls a card a "marginal gain" in one place and a budget pick in another is
 * worse than one that says neither.
 */
export const MEANINGFUL_GAIN_PCT = 15;

/**
 * How much worse than the best value a "high-end" pick may be.
 *
 * Without a ceiling, "largest gain" recommends whatever sits at the top of the
 * dataset. From an RX 6600 that is an RTX 4090: about ten times the net cost
 * of the mid-range pick for a third again the gain, at $47 per estimated FPS
 * against $13. That is not a high-end recommendation, it is the maximum
 * element of a list, and presenting it as advice would be the same failure as
 * leading with the marginal card at the other end.
 *
 * Twice the best cost-per-FPS is the line. It is a judgement, stated here
 * rather than buried, and the cards it excludes are still listed in full
 * further down the page — they are simply not recommended.
 */
const HIGH_END_VALUE_CEILING = 2;

/** A stand-in for the CPU an owner of a budget card plausibly has. */
const MODEST_CPU_ID = 'r5-3600';

export interface UpgradePath {
  /** 'budget' | 'midrange' | 'high-end' — the reader's question, not a tier. */
  band: 'budget' | 'midrange' | 'high-end';
  /** What this pick actually optimises, so the band label is never the only claim. */
  rationale: string;
  candidate: UpgradeCandidate;
}

export interface PowerNote {
  gpu: UpgradeGpu;
  /** Model-typical board power from gpus.json. NOT a measurement of any card. */
  typicalWatts: number;
  /** How much more than the card being replaced, same basis. */
  deltaWatts: number;
}

export interface CpuSensitivity {
  referenceCpuName: string;
  modestCpuName: string;
  gpu: UpgradeGpu;
  /** Estimated 20-game average with the reference chip the page models. */
  fpsWithReferenceCpu: number;
  /** The same estimate with a modest chip — the honest lower bound. */
  fpsWithModestCpu: number;
}

export interface UpgradeGuideDetail {
  slug: string;
  /** Replaces the generic intro, which leads with the cheapest card regardless of gain. */
  intro: string;
  /** The straight answer, first thing on the page. */
  verdict: { headline: string; body: string };
  paths: UpgradePath[];
  /** Cards that clear a tier but not the gain threshold, named so they are not silently dropped. */
  notWorthIt: UpgradeCandidate[];
  power: { current: PowerNote; upgrades: PowerNote[]; caveat: string };
  cpu: CpuSensitivity;
}

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value}%`;

/**
 * "an RX 6600", not "a RX 6600".
 *
 * Read aloud, which is how a reader hears it: R, X, S and the rest are spelled
 * out and start with a vowel sound, so the article follows the SOUND, not the
 * letter. Applied only to the strings this module writes — the rest of the
 * page's copy is shared with 56 other guides and is not this change's to edit.
 */
/** Letters whose SPOKEN name opens with a vowel sound: "an R-X", "an F-X". */
const VOWEL_SOUNDING_INITIALS = /^[AEFHILMNORSX]/;

export const article = (name: string): string => {
  const trimmed = name.trim();
  // An initialism is read letter by letter, so the letter's name decides.
  if (/^[A-Z]{2,}/.test(trimmed)) return VOWEL_SOUNDING_INITIALS.test(trimmed) ? 'an' : 'a';
  return /^[aeiou]/i.test(trimmed) ? 'an' : 'a';
};
const usd = (value: number) => `$${value.toLocaleString()}`;

/**
 * The three paths, chosen by what each one is actually best AT.
 *
 * Not three price brackets with a card dropped in each: a bracket with no
 * worthwhile card in it would get filled anyway, which is how the marginal
 * pick became the headline in the first place. Every path here has to clear
 * MEANINGFUL_GAIN_PCT before it can be recommended at all, and a band with no
 * qualifying card is simply absent.
 */
export function pickUpgradePaths(candidates: readonly UpgradeCandidate[]): UpgradePath[] {
  const worthwhile = candidates.filter((c) => c.fpsGainPct >= MEANINGFUL_GAIN_PCT);
  if (worthwhile.length === 0) return [];

  const cheapest = worthwhile.reduce((best, c) => (c.netCost < best.netCost ? c : best), worthwhile[0]);
  const bestValue = getBestValueCandidate([...worthwhile]) ?? cheapest;
  // Biggest gain, among cards whose value has not fallen off a cliff. Falls
  // back to the unfiltered maximum if nothing has a comparable cost per FPS,
  // so a band is never empty merely because no candidate could be priced.
  const ceiling = bestValue.costPerFps === null ? null : bestValue.costPerFps * HIGH_END_VALUE_CEILING;
  const sensible = ceiling === null
    ? worthwhile
    : worthwhile.filter((c) => c.costPerFps !== null && c.costPerFps <= ceiling);
  const pool = sensible.length > 0 ? sensible : worthwhile;
  const biggest = pool.reduce((best, c) => (c.fpsGainPct > best.fpsGainPct ? c : best), pool[0]);

  const paths: UpgradePath[] = [
    { band: 'budget', rationale: 'Lowest net cost that still clears a noticeable gain', candidate: cheapest },
    { band: 'midrange', rationale: 'Lowest cost per estimated FPS gained', candidate: bestValue },
    { band: 'high-end', rationale: 'Largest estimated gain, whatever it costs', candidate: biggest },
  ];

  // One card can legitimately win two bands. Showing it twice would read as
  // two recommendations; the earlier band keeps it, since that is the cheaper
  // framing and the one more readers are shopping in.
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path.candidate.gpu.id)) return false;
    seen.add(path.candidate.gpu.id);
    return true;
  });
}

/** The answer to "is it worth it", stated before any card is recommended. */
export function buildVerdict(gpu: UpgradeGpu, paths: readonly UpgradePath[], candidates: readonly UpgradeCandidate[]): { headline: string; body: string } {
  if (candidates.length === 0) {
    return {
      headline: `No, there is nothing faster to move to`,
      body: `The ${gpu.name} is the quickest card in our dataset, so there is no upgrade to estimate.`,
    };
  }
  if (paths.length === 0) {
    const best = candidates.reduce((b, c) => (c.fpsGainPct > b.fpsGainPct ? c : b), candidates[0]);
    return {
      headline: 'Not yet — nothing available is a big enough step',
      body: `The largest jump we can model from a ${gpu.name} is the ${best.gpu.name} at roughly ${pct(best.fpsGainPct)} estimated average FPS, below the ${MEANINGFUL_GAIN_PCT}% we treat as a noticeable difference. Waiting costs nothing.`,
    };
  }
  const budget = paths[0];
  return {
    headline: 'Yes — but not with the cheapest card above it',
    body: `Stepping up one tier gains almost nothing. The first upgrade that changes how games feel is the ${budget.candidate.gpu.name}, an estimated ${pct(budget.candidate.fpsGainPct)} average FPS for about ${usd(budget.candidate.netCost)} out of pocket after selling your ${gpu.name}. Every figure here is modelled, not measured.`,
  };
}

/** Board power for the current card and each recommendation, from the dataset. */
export function buildPowerNotes(gpu: UpgradeGpu, paths: readonly UpgradePath[]): UpgradeGuideDetail['power'] | null {
  const watts = (candidate: UpgradeGpu): number | null =>
    typeof candidate.tdp_watts === 'number' ? candidate.tdp_watts : null;

  const currentWatts = watts(gpu);
  if (currentWatts === null) return null;

  const upgrades: PowerNote[] = [];
  for (const path of paths) {
    const w = watts(path.candidate.gpu);
    if (w === null) continue;
    upgrades.push({ gpu: path.candidate.gpu, typicalWatts: w, deltaWatts: w - currentWatts });
  }
  if (upgrades.length === 0) return null;

  return {
    current: { gpu, typicalWatts: currentWatts, deltaWatts: 0 },
    upgrades,
    // NOT A COMPATIBILITY VERDICT. These are model-typical figures for a
    // reference design; the card in the box is built by a board partner and
    // may draw more, and we have not measured one. SpecSmith refuses to turn
    // a generic figure into an exact-fit claim — see src/lib/retail/partIdentity.ts
    // — and this page holds the same line: it gives the reader the numbers to
    // check against their own supply, and makes no ruling.
    caveat: 'These are typical board-power figures for each model, not measurements of a specific card. Partner cards vary, and power spikes exceed the rated figure. Check the exact model you plan to buy against your power supply\'s rating and its available connectors before ordering.',
  };
}

/** What the modelled gain assumes about the chip beside the card. */
export function buildCpuSensitivity(gpu: UpgradeGpu, paths: readonly UpgradePath[]): CpuSensitivity | null {
  const target = paths[0]?.candidate.gpu ?? gpu;
  const modest = (cpuData as Array<{ id: string; name: string; cpu_multiplier: number }>).find((c) => c.id === MODEST_CPU_ID);
  if (!modest) return null;
  return {
    referenceCpuName: UPGRADE_REFERENCE_CPU.name,
    modestCpuName: modest.name,
    gpu: target,
    fpsWithReferenceCpu: averageFps(target),
    fpsWithModestCpu: averageFpsWithCpu(target, modest),
  };
}

/** Slugs with a reference build. Everything else renders exactly as before. */
const DETAILED_SLUGS = new Set<string>(['rx-6600']);

export function hasUpgradeGuideDetail(slug: string): boolean {
  return DETAILED_SLUGS.has(slug);
}

export function getUpgradeGuideDetail(slug: string, gpuId: string): UpgradeGuideDetail | undefined {
  if (!hasUpgradeGuideDetail(slug)) return undefined;
  const gpu = getUpgradeGpu(gpuId);
  if (!gpu) return undefined;

  const candidates = getUpgradeCandidates(gpuId);
  const paths = pickUpgradePaths(candidates);
  const power = buildPowerNotes(gpu, paths);
  const cpu = buildCpuSensitivity(gpu, paths);
  if (!power || !cpu) return undefined;

  const recommended = new Set(paths.map((p) => p.candidate.gpu.id));
  return {
    slug,
    intro: `Upgrading a ${gpu.name} is worth it — as long as you skip the card directly above it. This guide ranks every option we can model by what it actually gains, what it costs after selling your old card, and what your power supply and CPU need to keep up. Performance figures are estimates from SpecSmith's model, not benchmark results.`,
    verdict: buildVerdict(gpu, paths, candidates),
    paths,
    notWorthIt: candidates.filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT && !recommended.has(c.gpu.id)),
    power,
    cpu,
  };
}
