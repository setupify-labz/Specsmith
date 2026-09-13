/**
 * The reference build of the GPU upgrade guide, currently /upgrade/rx-6600.
 *
 * WHY ONE SLUG. All 57 upgrade pages render from one component, so anything
 * added there lands on every card at once. This module is opt-in: a slug with
 * no entry gets exactly the page it had before, byte for byte. That keeps the
 * blast radius at one URL while the shape is proven, and makes the rollout to
 * the other 56 a data change rather than a rewrite.
 *
 * WHAT THE PAGE HAS TO ANSWER. Someone asking whether to upgrade an RX 6600
 * wants to know whether it is worth it and what to move to. The page as it
 * stood answered the second badly and the first late: `getUpgradeIntro` calls
 * the cheapest card one tier up "the best upgrade in our data" — for the RX
 * 6600 that is an RX 6600 XT at about +3%, which the page's own badge calls a
 * marginal gain — and the "is it worth it" FAQ sat fourth, below six cards.
 *
 * WHAT THIS MODULE MAY NOT SAY. Review cut the first version of this file back
 * hard, and the boundaries are worth stating because they are easy to drift
 * across again:
 *
 *   - NO MONEY IN A RECOMMENDATION. `gpus.json` prices are editorial, and
 *     `estimateResaleValue` is a flat 65% of one. Net cost, resale value and
 *     cost-per-FPS all compound those two into a figure that looks precise and
 *     is not, so nothing here ranks, selects or recommends on price.
 *   - NO CLAIM ABOUT WHAT A PLAYER WOULD NOTICE. The threshold below is a
 *     SpecSmith comparison line, not a perceptual finding.
 *   - NO FIT OR POWER VERDICT. Board power is a model-typical figure from the
 *     dataset; it is shown, and nothing is concluded from it.
 *   - NO CLAIM OF COMPLETENESS. `getUpgradeCandidates` keeps one cheapest card
 *     per tier above the current one, drops any that do not beat it on the
 *     modelled average, and returns at most six. That is a shortlist.
 *
 * Every figure is derived from the same estimator and `gpus.json` the rest of
 * the site uses, so a data refresh moves the page instead of leaving a stale
 * claim frozen in prose. No benchmark result is quoted, because SpecSmith has
 * measured none for these pairings.
 */

import {
  UPGRADE_REFERENCE_CPU,
  getUpgradeCandidates,
  getUpgradeGpu,
  type UpgradeCandidate,
  type UpgradeGpu,
} from './upgradeCalculator';

/**
 * The modelled gain at or above which this page will name a card at all.
 *
 * A SPECSMITH COMPARISON THRESHOLD, and nothing more. It is set to the same
 * boundary the existing badges use for 'moderate' so the shortlist and the
 * label beside it cannot disagree — not because anything has established what
 * a player can or cannot perceive. SpecSmith has run no perceptual study, and
 * the page must not imply one.
 */
export const MEANINGFUL_GAIN_PCT = 15;

/** How each shortlisted card was chosen. The band id IS the rule. */
export type UpgradeBand = 'smallest' | 'middle' | 'largest';

export interface UpgradePath {
  band: UpgradeBand;
  /** The selection rule, stated for the reader in the same words the code uses. */
  rationale: string;
  candidate: UpgradeCandidate;
}

export interface PowerNote {
  gpu: UpgradeGpu;
  /** Model-typical board power from gpus.json. NOT a measurement of any card. */
  typicalWatts: number;
  /** Difference from the card being replaced, on the same basis. */
  deltaWatts: number;
}

export interface UpgradeGuideDetail {
  slug: string;
  intro: string;
  verdict: { headline: string; body: string };
  paths: UpgradePath[];
  /** Shortlisted cards below the threshold, named rather than silently dropped. */
  belowThreshold: UpgradeCandidate[];
  /** How the shortlist was built, so the page never implies it is exhaustive. */
  shortlistNote: string;
  power: { current: PowerNote; upgrades: PowerNote[]; caveat: string } | null;
  /** The fixed CPU every figure on the page is modelled against. */
  estimatorNote: string;
}

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value}%`;

/** Letters whose SPOKEN name opens with a vowel sound: "an R-X", "an F-X". */
const VOWEL_SOUNDING_INITIALS = /^[AEFHILMNORSX]/;

export const article = (name: string): string => {
  const trimmed = name.trim();
  // An initialism is read letter by letter, so the letter's name decides.
  if (/^[A-Z]{2,}/.test(trimmed)) return VOWEL_SOUNDING_INITIALS.test(trimmed) ? 'an' : 'a';
  return /^[aeiou]/i.test(trimmed) ? 'an' : 'a';
};

const RATIONALE: Record<UpgradeBand, string> = {
  smallest: 'Smallest modelled gain on the shortlist that reaches SpecSmith’s comparison threshold',
  middle: 'Middle of the shortlist by modelled gain',
  largest: 'Largest modelled gain on the shortlist',
};

/**
 * Three cards off the shortlist, chosen ONLY by modelled FPS gain.
 *
 * Price is deliberately absent from this function. The earlier version ranked
 * by net cost and cost-per-FPS, which meant a recommendation rested on an
 * editorial list price minus a flat 65% resale assumption — two soft numbers
 * multiplied into one confident-looking one. Modelled gain is the single axis
 * this page can actually defend, so it is the only axis used, and the band
 * names say so rather than implying a budget judgement that is not being made.
 *
 * Fewer than three qualifying cards yields fewer than three paths; the bands
 * are positions in a list, so a list too short to have a middle has none.
 */
export function pickUpgradePaths(candidates: readonly UpgradeCandidate[]): UpgradePath[] {
  const qualifying = candidates
    .filter((c) => c.fpsGainPct >= MEANINGFUL_GAIN_PCT)
    .slice()
    .sort((a, b) => a.fpsGainPct - b.fpsGainPct);
  if (qualifying.length === 0) return [];

  const chosen: Array<[UpgradeBand, UpgradeCandidate]> = [
    ['smallest', qualifying[0]],
    ['largest', qualifying[qualifying.length - 1]],
  ];
  if (qualifying.length >= 3) {
    chosen.splice(1, 0, ['middle', qualifying[Math.floor((qualifying.length - 1) / 2)]]);
  }

  const seen = new Set<string>();
  const order: UpgradeBand[] = ['smallest', 'middle', 'largest'];
  return chosen
    .filter(([, candidate]) => {
      if (seen.has(candidate.gpu.id)) return false;
      seen.add(candidate.gpu.id);
      return true;
    })
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([band, candidate]) => ({ band, rationale: RATIONALE[band], candidate }));
}

/** The answer to "is it worth it", stated before any card is named. */
export function buildVerdict(
  gpu: UpgradeGpu,
  paths: readonly UpgradePath[],
  candidates: readonly UpgradeCandidate[],
): { headline: string; body: string } {
  if (candidates.length === 0) {
    return {
      headline: 'No — there is nothing faster on the shortlist',
      body: `The ${gpu.name} is the quickest card SpecSmith models, so there is no upgrade to estimate.`,
    };
  }
  if (paths.length === 0) {
    const best = candidates.reduce((b, c) => (c.fpsGainPct > b.fpsGainPct ? c : b), candidates[0]);
    return {
      headline: `Not on this shortlist — nothing reaches SpecSmith’s ${MEANINGFUL_GAIN_PCT}% comparison threshold`,
      body: `The largest modelled step from ${article(gpu.name)} ${gpu.name} is the ${best.gpu.name}, at roughly ${pct(best.fpsGainPct)} estimated average FPS.`,
    };
  }
  const smallest = paths[0];
  return {
    headline: 'Yes — but not with the cheapest card one tier up',
    body: `Stepping up a single tier barely moves the estimate. The smallest shortlisted step that reaches SpecSmith’s ${MEANINGFUL_GAIN_PCT}% comparison threshold is the ${smallest.candidate.gpu.name}, at roughly ${pct(smallest.candidate.fpsGainPct)} estimated average FPS. Every figure here is modelled, not measured.`,
  };
}

/** Board power for the current card and each shortlisted one, from the dataset. */
export function buildPowerNotes(gpu: UpgradeGpu, paths: readonly UpgradePath[]): UpgradeGuideDetail['power'] {
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
    // NOT A COMPATIBILITY VERDICT, and no claim about behaviour under load.
    // An earlier draft asserted that power spikes exceed the rated figure —
    // true of some cards, measured by SpecSmith for none of them, and stated
    // categorically. What is defensible is the provenance of the number and
    // the fact that it does not describe a specific board. SpecSmith refuses
    // to turn a generic figure into an exact-fit claim elsewhere
    // (src/lib/retail/partIdentity.ts); this page holds the same line.
    caveat:
      'These are the model-typical board-power figures recorded in SpecSmith’s dataset, not measurements of any specific card, and partner cards differ. SpecSmith does not assess whether a given power supply is sufficient for a given card — check the exact model you plan to buy against your power supply’s rating and connectors.',
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
  const shortlisted = new Set(paths.map((p) => p.candidate.gpu.id));

  return {
    slug,
    intro: `Upgrading ${article(gpu.name)} ${gpu.name} is worth it — as long as you skip the card directly above it. This guide works from a shortlist: one card per tier above the ${gpu.name}, ranked by the average FPS SpecSmith's model estimates across 20 games at 1440p High. Those figures are estimates, not benchmark results.`,
    verdict: buildVerdict(gpu, paths, candidates),
    paths,
    belowThreshold: candidates.filter(
      (c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT && !shortlisted.has(c.gpu.id),
    ),
    // SAYS WHAT THE LIST IS. An earlier draft called it "every option we can
    // model", which it is not: getUpgradeCandidates takes the CHEAPEST card in
    // each tier above the current one, drops any that do not beat it on the
    // modelled average, and returns at most six.
    shortlistNote: `This shortlist is not every card that would be faster. SpecSmith takes the lowest-priced card it tracks in each tier above the ${gpu.name}, drops any whose modelled average does not beat it, and keeps at most six. Cards omitted by that rule may still be worth considering.`,
    power: buildPowerNotes(gpu, paths),
    // DISCLOSURE, NOT A BOTTLENECK CLAIM. Naming the fixed CPU the estimator
    // uses tells a reader what the figure is conditional on. The earlier draft
    // went further and compared against a Ryzen 5 3600 to show the gain
    // shrinking, which reads as a bottleneck finding; nothing has been
    // measured that would support one, so it is gone.
    estimatorNote:
      'Every FPS figure on this page is produced by SpecSmith’s estimator against one fixed reference CPU, the Ryzen 7 9800X3D, across 20 games at 1440p High. They are model output, not benchmark results, and a different CPU would produce different figures.',
  };
}
