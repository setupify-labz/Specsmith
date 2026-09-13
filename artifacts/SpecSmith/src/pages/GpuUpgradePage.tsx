import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, Zap, Cpu, Sliders, Layers } from 'lucide-react';
import { getUpgradePage, getUpgradeIntro, getRelatedUpgradePages, getUpgradePageMeta } from '../lib/upgradePages';
import {
  getUpgradeGpu,
  getUpgradeComparisons,
  getClosestUpgradeComparisons,
  averageFps,
  UPGRADE_COMPARISON_PREVIEW_LIMIT,
  UPGRADE_REFERENCE_CPU,
} from '../lib/upgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

/**
 * The GPU upgrade guide template — all 57 pages.
 *
 * WHAT THIS PAGE USED TO DO, AND WHY IT STOPPED. It recommended. It named a
 * "best upgrade", ranked cards by net cost and cost per frame, badged one
 * "Best value", estimated what the reader's card was worth used, and told them
 * whether upgrading was worth it. Every one of those rests on two numbers that
 * cannot carry them: the prices in `gpus.json` are editorial and undated
 * against the live market, and `estimateResaleValue` is a flat 65% of one.
 * Multiplying two soft figures produces a hard-looking one, and the page then
 * spent it on a purchase recommendation.
 *
 * The FPS figures have a different problem. They are real model output, but
 * they are model output: a tier and a multiplier against one fixed reference
 * CPU, not a benchmark of anything. Presented beside a verdict they read as
 * measurement.
 *
 * So the page now COMPARES and does not conclude. It previews the closest
 * modelled steps above the selected card, with every figure labelled as an
 * estimate at the point it appears, and links each row into Builder. The
 * complete set is used only to state the range and count; dumping as many as
 * 56 rows into one guide would be hard to scan and would make the programmatic
 * pages repeat almost the entire GPU catalogue.
 */
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

  const avgFpsCurrent = averageFps(gpu);
  const comparisons = getUpgradeComparisons(gpu.id);
  const visibleComparisons = getClosestUpgradeComparisons(gpu.id);
  const intro = getUpgradeIntro(gpu);
  const related = getRelatedUpgradePages(page);

  const ESTIMATE_BASIS =
    `SpecSmith's model produces these figures from each card's internal GPU performance factor against one fixed reference CPU, the ${UPGRADE_REFERENCE_CPU.name}, averaged over 20 games at 1440p High. They are estimates, not benchmark results, and SpecSmith has measured none of these pairings.`;

  const SELECTION_BASIS =
    `This preview shows up to ${UPGRADE_COMPARISON_PREVIEW_LIMIT} of the closest GPUs whose modelled average is higher than the ${gpu.name}'s, ordered from the smallest modelled difference upward. It is not a recommendation, and price does not affect which cards appear.`;

  const NO_PRICES =
    'SpecSmith does not show prices, resale values or cost-per-frame figures on this page. The prices it holds are editorial and are not checked against the live market, so any purchase advice built on them would be more confident than the data allows. Check current prices at a retailer before buying anything.';

  const faqs = [
    {
      title: `Which GPUs are faster than ${gpu.name} in SpecSmith's model?`,
      content: comparisons.length === 0
        ? `None. No GPU SpecSmith tracks produces a higher modelled average than the ${gpu.name}.`
        : `${comparisons.length} tracked GPUs produce a higher modelled average. The modelled range runs from about +${comparisons[comparisons.length - 1].fpsDiffPct}% to about +${comparisons[0].fpsDiffPct}% against the ${gpu.name}. ${SELECTION_BASIS}`,
    },
    { title: 'Where do these FPS figures come from?', content: ESTIMATE_BASIS },
    { title: 'Why are there no prices or upgrade recommendations here?', content: NO_PRICES },
    {
      title: `How do I check one of these cards against my own build?`,
      content: `Each row opens that card in SpecSmith's Builder, where you can add your own CPU, motherboard, case and power supply. The Builder states which compatibility checks it could not run, rather than implying a build is verified when it is not.`,
    },
  ];

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
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
            GPU Upgrade Comparisons for the <span className="gradient-text">{gpu.name}</span>
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {intro}
          </p>
        </motion.div>

        {/* Two figures, both labelled where they are shown. The resale tile that
            used to sit beside them was a flat 65% of an editorial price. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Zap size={13} /> Estimated Average FPS
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }} data-testid="current-avg-fps">{avgFpsCurrent}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              Modelled across 20 games at 1440p High — an estimate, not a benchmark.
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Layers size={13} /> Faster in SpecSmith's Model
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }} data-testid="comparison-count">{comparisons.length}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              Tracked GPUs with a higher modelled average.
            </p>
          </div>
        </div>

        <h2 className="text-xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>Closest Modelled Steps Above</h2>
        <p data-testid="selection-basis" className="text-xs mb-1.5" style={{ color: 'var(--ff-text-3)' }}>{SELECTION_BASIS}</p>
        <p data-testid="estimate-basis" className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>{ESTIMATE_BASIS}</p>

        {comparisons.length === 0 ? (
          <div className="rounded-2xl p-6 text-center mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
              No GPU SpecSmith tracks produces a higher modelled average than the {gpu.name}.
            </p>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {visibleComparisons.map((c, i) => (
              <motion.div
                key={c.gpu.id}
                data-testid="comparison-row"
                data-gpu-id={c.gpu.id}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(i, 8) * 0.02 }}
                className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
              >
                <span className="font-bold min-w-0" style={{ color: 'var(--ff-text)' }}>{c.gpu.name}</span>
                <div className="flex items-center gap-5 ml-auto">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Estimated difference</p>
                    <p className="text-base font-black" style={{ color: 'var(--ff-green)' }}>
                      +{c.fpsDiffPct}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Estimated average</p>
                    <p className="text-base font-black" style={{ color: 'var(--ff-text)' }}>{c.avgFpsNew} FPS</p>
                  </div>
                  {/* Loads the card being COMPARED, never the one being replaced. */}
                  <Link to={`/builder?gpu=${c.gpu.id}`}
                    data-testid={`compare-in-builder-${c.gpu.id}`}
                    aria-label={`Open ${c.gpu.name} in Builder`}
                    className="text-xs font-semibold flex items-center gap-1 whitespace-nowrap transition-opacity hover:opacity-80"
                    style={{ color: 'var(--ff-accent-text)' }}>
                    Open in Builder <ArrowRight size={12} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <p data-testid="no-prices-note" className="text-xs leading-relaxed rounded-xl p-3 mb-10"
          style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-card)' }}>
          {NO_PRICES}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to="/upgrade-calculator"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Sliders size={15} /> Compare a Different GPU <ChevronRight size={14} />
          </Link>
          <Link to="/gpu-tier-list"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Cpu size={15} /> GPU Tier List <ChevronRight size={14} />
          </Link>
        </div>

        <div className="space-y-3 mb-10">
          {faqs.map((f) => (
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
