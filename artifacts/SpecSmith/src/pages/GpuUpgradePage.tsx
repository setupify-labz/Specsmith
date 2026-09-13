import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, DollarSign, Zap, Cpu, Sliders, Plug, Gauge, CheckCircle2 } from 'lucide-react';
import { getUpgradePage, getUpgradeIntro, getRelatedUpgradePages, getUpgradePageMeta } from '../lib/upgradePages';
import { getUpgradeGpu, getUpgradeCandidates, getBestValueCandidate, estimateResaleValue, averageFps, type UpgradeVerdict } from '../lib/upgradeCalculator';
import { article, getUpgradeGuideDetail, MEANINGFUL_GAIN_PCT, type UpgradeBand } from '../lib/upgradeGuideDetail';
import { useSeo } from '../hooks/useSeo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

const VERDICT_STYLE: Record<UpgradeVerdict, { label: string; bg: string; color: string; border: string }> = {
  strong:   { label: 'Strong upgrade',   bg: 'rgba(0,230,118,0.12)', color: 'var(--ff-green)', border: 'rgba(0,230,118,0.3)' },
  moderate: { label: 'Moderate upgrade', bg: 'rgba(0,212,255,0.12)', color: 'var(--ff-cyan)', border: 'rgba(0,212,255,0.3)' },
  marginal: { label: 'Marginal gain',    bg: 'rgba(255,179,0,0.12)', color: 'var(--ff-amber)', border: 'rgba(255,179,0,0.3)' },
};
const BEST_VALUE_STYLE = { label: 'Best value', bg: 'rgba(255,215,0,0.12)', color: 'var(--ff-gold)', border: 'rgba(255,215,0,0.35)' };

/**
 * Reader-facing names for the three shortlist positions.
 *
 * They name the SELECTION RULE, because that is the only thing that picked
 * them. The earlier labels were Budget / Mid-range / High-end, which implied a
 * price judgement the page no longer makes — and the high-end card carried the
 * rationale "largest estimated gain, whatever it costs" while a hidden
 * cost-per-FPS ceiling was quietly excluding the most expensive card. A label
 * that contradicts its own algorithm is worse than no label.
 */
const PATH_LABEL: Record<UpgradeBand, string> = {
  smallest: 'Smallest qualifying step',
  middle: 'Middle of the shortlist',
  largest: 'Largest modelled step',
};

export default function GpuUpgradePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getUpgradePage(slug) : undefined;
  const gpu = page ? getUpgradeGpu(page.gpuId) : undefined;

  const fallbackMeta = {
    path: '/upgrade-calculator',
    title: 'GPU Not Found | SpecSmith',
    description: 'This upgrade guide could not be found. Use the interactive Upgrade Calculator instead.',
    noindex: true,
  };
  useSeo(page && gpu ? getUpgradePageMeta(page) : fallbackMeta);

  if (!page || !gpu) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>GPU not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have an upgrade guide for this card yet.</p>
          <Link to="/upgrade-calculator" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Use the Upgrade Calculator
          </Link>
        </div>
      </div>
    );
  }

  const resale = estimateResaleValue(gpu.price_usd);
  const avgFpsCurrent = averageFps(gpu);
  const candidates = getUpgradeCandidates(gpu.id);
  // OPT-IN. Only slugs with a reference build get the sections below; every
  // other upgrade page renders exactly what it rendered before.
  const detail = getUpgradeGuideDetail(page.slug, page.gpuId);
  const intro = detail?.intro ?? getUpgradeIntro(gpu);
  const related = getRelatedUpgradePages(page);
  const bestValue = getBestValueCandidate(candidates);

  const bestGain = candidates.length > 0
    ? candidates.reduce((best, c) => c.fpsGainPct > best.fpsGainPct ? c : best, candidates[0])
    : undefined;

  const detailFaqs = detail
    ? [
        {
          title: `Is it worth upgrading from ${article(gpu.name)} ${gpu.name}?`,
          content: `${detail.verdict.headline}. ${detail.verdict.body}`,
        },
        ...(detail.power
          ? [
              {
                title: `How much more power do the shortlisted cards draw than ${article(gpu.name)} ${gpu.name}?`,
                content: `SpecSmith's dataset records the ${gpu.name} at ${detail.power.current.typicalWatts}W of model-typical board power. ${detail.power.upgrades
                  .map((u) => `${u.gpu.name} is recorded at ${u.typicalWatts}W`)
                  .join('; ')}. ${detail.power.caveat}`,
              },
            ]
          : []),
        {
          title: 'Which cards does this guide compare?',
          content: detail.shortlistNote,
        },
        {
          title: 'Where do the FPS figures come from?',
          content: detail.estimatorNote,
        },
      ]
    : [];

  const faqs = [
    {
      title: `What should I upgrade my ${gpu.name} to?`,
      content: candidates.length === 0
        ? `The ${gpu.name} is already the top tier we track — there's nothing meaningfully faster in our dataset to recommend.`
        : `The most direct next step up is the ${candidates[0].gpu.name}, roughly a ${candidates[0].fpsGainPct >= 0 ? '+' : ''}${candidates[0].fpsGainPct}% FPS gain for an estimated net cost of $${candidates[0].netCost.toLocaleString()} after reselling your ${gpu.name}. ${candidates.length} tracked upgrade option${candidates.length === 1 ? '' : 's'} total — see the full list above.`,
    },
    {
      title: `How much is my ${gpu.name} worth used?`,
      content: `Roughly $${resale.toLocaleString()}, a rough resale estimate based on typical used-market depreciation — not a live marketplace quote. Actual resale value depends on condition, local demand, and where you sell.`,
    },
    {
      title: 'What does "Net Cost" mean on this page?',
      content: `Net cost is the new card's price minus your ${gpu.name}'s estimated resale value — the real out-of-pocket cost of the upgrade if you sell your old card. It doesn't include shipping, marketplace fees, or sales tax.`,
    },
    {
      title: 'Is upgrading worth it right now?',
      content: bestGain === undefined
        ? `There's no faster card in our dataset than the ${gpu.name}, so there's nothing to gain by upgrading right now.`
        : bestGain.fpsGainPct >= 30
        ? `The biggest jump available is the ${bestGain.gpu.name} at roughly +${bestGain.fpsGainPct}% FPS — a strong upgrade if the net cost fits your budget. Prices last updated ${PRICES_UPDATED}.`
        : bestGain.fpsGainPct >= 15
        ? `The biggest jump available is the ${bestGain.gpu.name} at roughly +${bestGain.fpsGainPct}% FPS — a moderate, noticeable gain rather than a dramatic one. Prices last updated ${PRICES_UPDATED}.`
        : `Even the biggest jump available, the ${bestGain.gpu.name}, only gains roughly +${bestGain.fpsGainPct}% FPS — a marginal difference. It's probably worth waiting for a bigger generational leap before upgrading. Prices last updated ${PRICES_UPDATED}.`,
    },
  ];

  /* SUPERSEDED, NOT STACKED. The generic "what should I upgrade to" answer
     names the cheapest card one tier up — for the RX 6600 a +3% gain — and the
     generic "is it worth it" answer recommends whatever has the biggest raw
     number regardless of cost. Both contradict the verdict above, and leaving
     them would publish two different recommendations on one page and feed both
     to the FAQ schema. On a page with a reference build they are replaced. */
  const SUPERSEDED_FAQ_TITLES = detail
    ? [
        `What should I upgrade my ${gpu.name} to?`,
        'Is upgrading worth it right now?',
        // Both of these answer questions the reference page no longer poses.
        // Its prices are editorial and its resale figure is a flat 65% of one,
        // so a page that has stopped recommending on money must not keep
        // explaining its money — least of all in the FAQ schema, where the
        // claim would be made to a crawler after being withdrawn from readers.
        `How much is my ${gpu.name} worth used?`,
        'What does "Net Cost" mean on this page?',
      ]
    : [];
  const allFaqs = [...detailFaqs, ...faqs.filter((f) => !SUPERSEDED_FAQ_TITLES.includes(f.title))];

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: allFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <Link to="/upgrade" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All Upgrade Guides
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            What Should You Upgrade Your <span className="gradient-text">{gpu.name}</span> To?
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {intro}
          </p>
        </motion.div>

        <div className={`grid grid-cols-1 gap-3 mb-10 ${detail ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          {/* A FLAT 65% OF AN EDITORIAL PRICE. Two soft numbers multiplied
              into one that looks like a valuation. The reference page drops it
              rather than dress it with another disclaimer. */}
          {!detail && (
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                <DollarSign size={13} /> Estimated Resale Value
              </div>
              <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${resale.toLocaleString()}</div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Rough estimate, not a quote.</p>
            </div>
          )}
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Zap size={13} /> {detail ? 'Estimated Average FPS' : 'Average FPS'}
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{avgFpsCurrent}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              {/* Labelled AT THE POINT OF DISPLAY, not later in the page. The
                  figure is modelled from a tier and a multiplier; nobody
                  measured this card running these games. */}
              {detail ? 'Modelled across 20 games at 1440p High — an estimate, not a benchmark.' : 'Across 20 games at 1440p High.'}
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Cpu size={13} /> Tier
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{gpu.tier}/10</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              {detail
                ? `Estimated $${gpu.price_usd.toLocaleString()} new · ${PRICES_UPDATED}`
                : `$${gpu.price_usd.toLocaleString()} new.`}
            </p>
          </div>
        </div>

        {detail && (
          <>
            {/* THE ANSWER FIRST. This question was the fourth FAQ, below six
                cards ranked by tier — a reader had to scroll past the worst
                recommendation on the page to reach it. */}
            <section aria-labelledby="upgrade-verdict" className="rounded-2xl p-5 mb-8"
              style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--ff-green)' }} aria-hidden="true" />
                <div>
                  <h2 id="upgrade-verdict" className="text-lg font-black mb-1.5" style={{ color: 'var(--ff-text)' }}>
                    {detail.verdict.headline}
                  </h2>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{detail.verdict.body}</p>
                </div>
              </div>
            </section>

            <h2 className="text-xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>Where the Shortlist Lands</h2>
            <p className="text-xs mb-1" style={{ color: 'var(--ff-text-3)' }}>
              Ranked by modelled FPS gain only. SpecSmith does not rank upgrades by price: the prices it holds are
              editorial estimates, so a cost-per-frame or trade-in figure built on them would look more precise than it is.
            </p>
            <p data-testid="upgrade-shortlist-note" className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>
              {detail.shortlistNote}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {detail.paths.map((path) => (
                <div key={path.band} data-testid={`upgrade-path-${path.band}`} className="rounded-2xl p-4 flex flex-col"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: 'var(--ff-accent-text)' }}>
                    {PATH_LABEL[path.band]}
                  </p>
                  <p className="font-bold text-base mb-0.5" style={{ color: 'var(--ff-text)' }}>{path.candidate.gpu.name}</p>
                  <p className="text-[11px] mb-3" style={{ color: 'var(--ff-text-3)' }}>{path.rationale}.</p>
                  <dl className="text-xs space-y-1 mb-4" style={{ color: 'var(--ff-text-2)' }}>
                    <div className="flex justify-between gap-2">
                      <dt>Estimated FPS gain</dt>
                      <dd className="font-bold" style={{ color: 'var(--ff-green)' }}>+{path.candidate.fpsGainPct}%</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Estimated average</dt>
                      <dd className="font-bold" style={{ color: 'var(--ff-text)' }}>{path.candidate.avgFpsNew} FPS</dd>
                    </div>
                  </dl>
                  {/* THE ACTION. The page's existing button builds around the
                      card being replaced; this one loads the upgrade so the
                      reader can check it against their own parts. */}
                  <Link to={`/builder?gpu=${path.candidate.gpu.id}`}
                    data-testid={`upgrade-path-cta-${path.band}`}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-xs text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Test this upgrade in Builder <ArrowRight size={13} />
                  </Link>
                </div>
              ))}
            </div>

            {detail.belowThreshold.length > 0 && (
              <p data-testid="upgrade-below-threshold" className="text-xs leading-relaxed rounded-xl p-3 mb-10"
                style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-card)' }}>
                <strong style={{ color: 'var(--ff-amber)' }}>Below SpecSmith's comparison threshold:</strong>{' '}
                {detail.belowThreshold.map((c) => `${c.gpu.name} (about +${c.fpsGainPct}% estimated)`).join(', ')}
                {' '}— shortlisted, but under the {MEANINGFUL_GAIN_PCT}% modelled gain SpecSmith uses as its line for
                naming a card as a step up. That line is a comparison threshold chosen by SpecSmith, not a finding about
                what a player would perceive. They are listed in full below.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
              {detail.power && (
                <section aria-labelledby="upgrade-power" className="rounded-2xl p-5"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <h2 id="upgrade-power" className="flex items-center gap-1.5 font-black text-sm mb-2" style={{ color: 'var(--ff-text)' }}>
                    <Plug size={15} aria-hidden="true" /> Board power on the shortlist
                  </h2>
                  <dl className="text-xs space-y-1 mb-2.5" style={{ color: 'var(--ff-text-2)' }}>
                    <div className="flex justify-between gap-2">
                      <dt>{detail.power.current.gpu.name} (yours)</dt>
                      <dd className="font-bold" style={{ color: 'var(--ff-text)' }}>{detail.power.current.typicalWatts}W</dd>
                    </div>
                    {detail.power.upgrades.map((note) => (
                      <div key={note.gpu.id} className="flex justify-between gap-2">
                        <dt>{note.gpu.name}</dt>
                        <dd className="font-bold" style={{ color: 'var(--ff-text)' }}>
                          {note.typicalWatts}W <span className="font-normal" style={{ color: 'var(--ff-text-3)' }}>(+{note.deltaWatts}W)</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {/* The heading asks no question, because the section answers
                      none. It reports what the dataset holds and stops. */}
                  <p data-testid="upgrade-power-caveat" className="text-[11px] leading-relaxed" style={{ color: 'var(--ff-amber)' }}>
                    {detail.power.caveat}
                  </p>
                </section>
              )}

              <section aria-labelledby="upgrade-estimator" className="rounded-2xl p-5"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <h2 id="upgrade-estimator" className="flex items-center gap-1.5 font-black text-sm mb-2" style={{ color: 'var(--ff-text)' }}>
                  <Gauge size={15} aria-hidden="true" /> Where these figures come from
                </h2>
                {/* DISCLOSURE, NOT A BOTTLENECK FINDING. An earlier draft put a
                    Ryzen 5 3600 beside the reference chip to show the gain
                    shrinking. Read as advice that is a bottleneck claim, and
                    SpecSmith has measured nothing that would support one. What
                    is defensible is naming what the estimate is conditional on. */}
                <p data-testid="upgrade-estimator-note" className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
                  {detail.estimatorNote}
                </p>
              </section>
            </div>
          </>
        )}

        <h2 className="text-xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>Upgrade Options</h2>

        {candidates.length === 0 ? (
          <div className="rounded-2xl p-6 text-center mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
              The {gpu.name} is already the top tier we track — there's nothing meaningfully faster in our dataset.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-10">
            {candidates.map((c, i) => {
              const style = VERDICT_STYLE[c.verdict];
              return (
                <motion.div
                  key={c.gpu.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-2xl p-5"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{c.gpu.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                        {style.label}
                      </span>
                      {/* "Best value" IS a cost-per-FPS recommendation —
                          getBestValueCandidate picks the lowest one. Withheld
                          on the reference page for the same reason the column
                          below it is. */}
                      {!detail && bestValue?.gpu.id === c.gpu.id && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: BEST_VALUE_STYLE.bg, color: BEST_VALUE_STYLE.color, border: `1px solid ${BEST_VALUE_STYLE.border}` }}>
                          {BEST_VALUE_STYLE.label}
                        </span>
                      )}
                    </div>
                    <Link to={`/builder?gpu=${c.gpu.id}`}
                      className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
                      style={{ color: 'var(--ff-accent-text)' }}>
                      Build with this <ArrowRight size={12} />
                    </Link>
                  </div>
                  <div className={`grid grid-cols-2 gap-3 text-center ${detail ? '' : 'sm:grid-cols-4'}`}>
                    {!detail && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Net Cost*</p>
                        <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>${c.netCost.toLocaleString()}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>FPS Gain</p>
                      <p className="text-lg font-black" style={{ color: c.fpsGainPct >= 0 ? 'var(--ff-green)' : 'var(--ff-red)' }}>
                        {c.fpsGainPct >= 0 ? '+' : ''}{c.fpsGainPct}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>New Average</p>
                      <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>{c.avgFpsNew} FPS</p>
                    </div>
                    {!detail && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Cost / FPS**</p>
                        <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
                          {c.costPerFps !== null ? `$${c.costPerFps}` : '—'}
                        </p>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
            <p className="text-[10px] text-center pt-2" style={{ color: 'var(--ff-text-3)' }}>
              {detail
                ? `FPS figures are estimates from SpecSmith's model across 20 games at 1440p High, not benchmark results.`
                : `*Net cost = new card's price minus your ${gpu.name}'s estimated resale value. **Cost/FPS = net cost divided by the average FPS gained — lower is a better value, not shown when there's no positive FPS gain to divide by.`}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to={`/builder?gpu=${gpu.id}`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Build Around the {gpu.name}
          </Link>
          <Link to="/upgrade-calculator"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Sliders size={15} /> Try a Different GPU <ChevronRight size={14} />
          </Link>
        </div>

        <div className="space-y-3 mb-10">
          {allFaqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        {related.length > 0 && (
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Upgrade Guides for Other Cards</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map(r => {
                const rGpu = getUpgradeGpu(r.gpuId);
                return (
                  <Link key={r.slug} to={`/upgrade/${r.slug}`}
                    className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                    style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                    <span>{rGpu?.name ?? r.gpuId}</span>
                    <ChevronRight size={14} />
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
