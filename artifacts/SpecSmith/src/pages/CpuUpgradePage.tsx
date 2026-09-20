import { useParams, Link } from 'react-router-dom';
import { motion } from '../components/MotionLite';
import { ArrowRight, ChevronRight, Zap, Cpu, Sliders, Layers } from 'lucide-react';
import { getCpuUpgradePage, getCpuUpgradeIntro, getRelatedCpuUpgradePages, getCpuUpgradePageMeta } from '../lib/cpuUpgradePages';
import {
  getUpgradeCpu,
  getCpuUpgradeComparisons,
  getClosestCpuUpgradeComparisons,
  averageCpuFps,
  CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT,
  CPU_UPGRADE_REFERENCE_GPU,
} from '../lib/cpuUpgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

/**
 * The CPU upgrade comparison template — all 51 pages.
 *
 * THE SAME DEFECT THE GPU TEMPLATE CARRIED, fixed the same way (#119). This
 * page recommended: a "best upgrade", chips ranked by net cost and cost per
 * frame, one badged "Best value", an estimate of what the reader's chip was
 * worth used, and strong/moderate/marginal verdicts. All of it rested on two
 * numbers that cannot carry it — the prices in `cpus.json` are editorial and
 * unchecked against the live market, and `estimateCpuResaleValue` is a flat
 * percentage of one.
 *
 * Worse, price reached further than the copy admitted:
 * `getCpuUpgradeCandidates` keeps the CHEAPEST chip in each tier before
 * anything sorts by modelled gain, so an editorial price decided which chips
 * appeared at all.
 *
 * So the page COMPARES and does not conclude. `getCpuUpgradeComparisons` takes
 * no price; the preview shows the closest modelled steps above the selected
 * chip; the complete set is used only for the count and range disclosures.
 * Every figure is labelled an estimate where it appears.
 */
export default function CpuUpgradePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getCpuUpgradePage(slug) : undefined;
  const cpu = page ? getUpgradeCpu(page.cpuId) : undefined;

  const fallbackMeta = {
    path: '/upgrade-calculator-cpu',
    title: 'CPU Not Found | SpecSmith',
    description: 'This upgrade comparison could not be found. Use the interactive CPU Upgrade Calculator instead.',
    noindex: true,
  };
  useSeo(page && cpu ? getCpuUpgradePageMeta(page) : fallbackMeta);

  if (!page || !cpu) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>CPU not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have an upgrade comparison for this chip yet.</p>
          <Link to="/upgrade-calculator-cpu" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Use the CPU Upgrade Calculator
          </Link>
        </div>
      </div>
    );
  }

  const avgFpsCurrent = averageCpuFps(cpu);
  const comparisons = getCpuUpgradeComparisons(cpu.id);
  const visibleComparisons = getClosestCpuUpgradeComparisons(cpu.id);
  const intro = getCpuUpgradeIntro(cpu);
  const related = getRelatedCpuUpgradePages(page);

  /* Describes the model ACCURATELY. The GPU template briefly claimed the
     estimator read each part's catalogue tier; it does not — it reads the
     part's performance factor. Tier is a catalogue grouping and is not an
     estimator input. */
  const ESTIMATE_BASIS =
    `SpecSmith's model produces these figures from each chip's internal CPU performance factor against one fixed reference GPU, the ${CPU_UPGRADE_REFERENCE_GPU.name}, averaged over 20 games at 1440p High. Pairing every chip with the same high-end GPU is what lets the model separate the CPU's effect; at this resolution and preset it also keeps the modelled differences small, so most of the figures below sit within a few percent of each other. They are estimates, not benchmark results, and SpecSmith has measured none of these pairings.`;

  const SELECTION_BASIS =
    `This preview shows up to ${CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT} of the closest CPUs whose modelled average is higher than the ${cpu.name}'s, ordered from the smallest modelled difference upward. It is not a recommendation, and price does not affect which chips appear.`;

  const NO_PRICES =
    'SpecSmith does not show prices, resale values or cost-per-frame figures on this page. The prices it holds are editorial and are not checked against the live market, so any purchase advice built on them would be more confident than the data allows. Check current prices at a retailer before buying anything.';

  const faqs = [
    {
      title: `Which CPUs are faster than the ${cpu.name} in SpecSmith's model?`,
      content: comparisons.length === 0
        ? `None. No CPU SpecSmith tracks produces a higher modelled average than the ${cpu.name}.`
        : `${comparisons.length} tracked CPU${comparisons.length === 1 ? '' : 's'} produce a higher modelled average. The modelled range runs from about +${comparisons[comparisons.length - 1].fpsDiffPct}% to about +${comparisons[0].fpsDiffPct}% against the ${cpu.name}. ${SELECTION_BASIS}`,
    },
    { title: 'Where do these FPS figures come from?', content: ESTIMATE_BASIS },
    { title: 'Why are there no prices or upgrade recommendations here?', content: NO_PRICES },
    {
      title: 'How do I check one of these chips against my own build?',
      content: `Each row opens that chip in SpecSmith's Builder, where you can add your own GPU, motherboard, memory and cooler. The Builder states which compatibility checks it could not run, rather than implying a build is verified when it is not.`,
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
        <Link to="/upgrade-cpu" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All CPU Upgrade Comparisons
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            CPUs Compared With the <span className="gradient-text">{cpu.name}</span>
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {intro}
          </p>
        </motion.div>

        {/* Two figures, both labelled where they are shown. The resale tile that
            used to sit beside them was a flat percentage of an editorial price. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Zap size={13} /> Estimated Average FPS
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }} data-testid="current-avg-fps">{avgFpsCurrent}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              Modelled across 20 games at 1440p High with a fixed reference GPU — an estimate, not a benchmark.
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Layers size={13} /> Faster in SpecSmith's Model
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }} data-testid="comparison-count">{comparisons.length}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>
              Tracked CPUs with a higher modelled average.
            </p>
          </div>
        </div>

        <h2 className="text-xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>Modelled Comparison</h2>
        <p data-testid="selection-basis" className="text-xs mb-1.5" style={{ color: 'var(--ff-text-3)' }}>{SELECTION_BASIS}</p>
        <p data-testid="estimate-basis" className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>{ESTIMATE_BASIS}</p>

        {comparisons.length === 0 ? (
          <div className="rounded-2xl p-6 text-center mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
              No CPU SpecSmith tracks produces a higher modelled average than the {cpu.name}.
            </p>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {visibleComparisons.map((c, i) => (
              <motion.div
                key={c.cpu.id}
                data-testid="comparison-row"
                data-cpu-id={c.cpu.id}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(i, 8) * 0.02 }}
                className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
              >
                <span className="font-bold min-w-0" style={{ color: 'var(--ff-text)' }}>{c.cpu.name}</span>
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
                  {/* Loads the chip being COMPARED, never the one being replaced. */}
                  <Link to={`/builder?cpu=${c.cpu.id}`}
                    data-testid={`compare-in-builder-${c.cpu.id}`}
                    aria-label={`Open ${c.cpu.name} in Builder`}
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
          <Link to="/upgrade-calculator-cpu"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Sliders size={15} /> Compare a Different CPU <ChevronRight size={14} />
          </Link>
          <Link to="/cpu-tier-list"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Cpu size={15} /> CPU Tier List <ChevronRight size={14} />
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
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Upgrade Comparisons for Other Chips</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map(r => {
                const rCpu = getUpgradeCpu(r.cpuId);
                return (
                  <Link key={r.slug} to={`/upgrade-cpu/${r.slug}`}
                    className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                    style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                    <span>{rCpu?.name ?? r.cpuId}</span>
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
