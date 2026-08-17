import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, DollarSign, Zap, Cpu, Sliders } from 'lucide-react';
import { getUpgradePage, getUpgradeIntro, getRelatedUpgradePages, getUpgradePageMeta } from '../lib/upgradePages';
import { getUpgradeGpu, getUpgradeCandidates, getBestValueCandidate, estimateResaleValue, averageFps, type UpgradeVerdict } from '../lib/upgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

const VERDICT_STYLE: Record<UpgradeVerdict, { label: string; bg: string; color: string; border: string }> = {
  strong:   { label: 'Strong upgrade',   bg: 'rgba(0,230,118,0.12)', color: 'var(--ff-green)', border: 'rgba(0,230,118,0.3)' },
  moderate: { label: 'Moderate upgrade', bg: 'rgba(0,212,255,0.12)', color: 'var(--ff-cyan)', border: 'rgba(0,212,255,0.3)' },
  marginal: { label: 'Marginal gain',    bg: 'rgba(255,179,0,0.12)', color: 'var(--ff-amber)', border: 'rgba(255,179,0,0.3)' },
};
const BEST_VALUE_STYLE = { label: 'Best value', bg: 'rgba(255,215,0,0.12)', color: 'var(--ff-gold)', border: 'rgba(255,215,0,0.35)' };

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
  const intro = getUpgradeIntro(gpu);
  const related = getRelatedUpgradePages(page);
  const bestValue = getBestValueCandidate(candidates);

  const bestGain = candidates.length > 0
    ? candidates.reduce((best, c) => c.fpsGainPct > best.fpsGainPct ? c : best, candidates[0])
    : undefined;

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
            What Should You Upgrade Your <span className="gradient-text">{gpu.name}</span> To?
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {intro}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <DollarSign size={13} /> Estimated Resale Value
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${resale.toLocaleString()}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Rough estimate, not a quote.</p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Zap size={13} /> Average FPS
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{avgFpsCurrent}</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Across 20 games at 1440p High.</p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Cpu size={13} /> Tier
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{gpu.tier}/10</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>${gpu.price_usd.toLocaleString()} new.</p>
          </div>
        </div>

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
                      {bestValue?.gpu.id === c.gpu.id && (
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Net Cost*</p>
                      <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>${c.netCost.toLocaleString()}</p>
                    </div>
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
                    <div>
                      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Cost / FPS**</p>
                      <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
                        {c.costPerFps !== null ? `$${c.costPerFps}` : '—'}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            <p className="text-[10px] text-center pt-2" style={{ color: 'var(--ff-text-3)' }}>
              *Net cost = new card's price minus your {gpu.name}'s estimated resale value. **Cost/FPS = net cost divided by the average FPS gained — lower is a better value, not shown when there's no positive FPS gain to divide by.
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
