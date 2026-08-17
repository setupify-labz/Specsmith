import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, DollarSign, TrendingUp, Zap, Cpu, Share2 } from 'lucide-react';
import PartSelector from '../components/PartSelector';
import PageGlow from '../components/PageGlow';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { useToast } from '../context/ToastContext';
import {
  getUpgradeGpus, getUpgradeGpu, getUpgradeCandidates, getBestValueCandidate, estimateResaleValue, averageFps,
  upgradeCalculatorFaqs, upgradeCalculatorFaqJsonLd,
  type UpgradeVerdict,
} from '../lib/upgradeCalculator';

const VERDICT_STYLE: Record<UpgradeVerdict, { label: string; bg: string; color: string; border: string }> = {
  strong:   { label: 'Strong upgrade',   bg: 'rgba(0,230,118,0.12)', color: 'var(--ff-green)', border: 'rgba(0,230,118,0.3)' },
  moderate: { label: 'Moderate upgrade', bg: 'rgba(0,212,255,0.12)', color: 'var(--ff-cyan)', border: 'rgba(0,212,255,0.3)' },
  marginal: { label: 'Marginal gain',    bg: 'rgba(255,179,0,0.12)', color: 'var(--ff-amber)', border: 'rgba(255,179,0,0.3)' },
};
const BEST_VALUE_STYLE = { label: 'Best value', bg: 'rgba(255,215,0,0.12)', color: 'var(--ff-gold)', border: 'rgba(255,215,0,0.35)' };

export default function UpgradeCalculator() {
  useSeo(getRouteMeta('/upgrade-calculator'));
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const gpus = getUpgradeGpus();
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('gpu');
    return fromUrl && gpus.some(g => g.id === fromUrl) ? fromUrl : null;
  });

  const current = currentId ? getUpgradeGpu(currentId) : null;
  const resale = current ? estimateResaleValue(current.price_usd) : 0;
  const avgFpsCurrent = current ? averageFps(current) : 0;
  const candidates = useMemo(() => currentId ? getUpgradeCandidates(currentId) : [], [currentId]);
  const bestValue = useMemo(() => getBestValueCandidate(candidates), [candidates]);

  const shareResult = async () => {
    if (!current) return;
    const url = `${SITE_URL}/upgrade-calculator?gpu=${current.id}`;
    const title = `Should you upgrade your ${current.name}?`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied', 'success');
    } catch {
      showToast('Failed to copy link', 'error');
    }
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(upgradeCalculatorFaqJsonLd()) }} />
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Should You <span className="gradient-text">Upgrade?</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick your current GPU, see what it's roughly worth used, and what it'd actually cost — and gain — to trade up.
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
            <Link to="/upgrade" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Or browse upgrade guides for every GPU →
            </Link>
            <Link to="/upgrade-calculator-cpu" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
              Looking to upgrade your CPU instead? →
            </Link>
          </div>
        </motion.div>

        <div className="mb-6">
          <PartSelector
            category="gpu" label="Your Current GPU" defaultOpen
            parts={gpus}
            selectedId={currentId}
            onSelect={setCurrentId}
            getSpecs={p => {
              const g = p as ReturnType<typeof getUpgradeGpus>[number];
              return [{ label: 'Tier', value: `${g.tier}/10` }];
            }}
          />
        </div>

        <AnimatePresence>
          {current && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <DollarSign size={13} /> Estimated Resale Value
                  </div>
                  <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${resale.toLocaleString()}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Rough estimate, not a quote — actual used prices vary.</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <Zap size={13} /> Your Average FPS
                  </div>
                  <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{avgFpsCurrent}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Across 20 games at 1440p High.</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <Cpu size={13} /> Current Card
                  </div>
                  <div className="text-lg font-black leading-tight" style={{ color: 'var(--ff-text)' }}>{current.name}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>${current.price_usd.toLocaleString()} new · Tier {current.tier}/10</p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
                  <TrendingUp size={18} style={{ color: 'var(--ff-accent)' }} /> Upgrade Options
                </h2>
                <button
                  onClick={shareResult}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                >
                  <Share2 size={12} /> Share
                </button>
              </div>

              {candidates.length === 0 ? (
                <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
                    You're already at the top tier we track — there's nothing meaningfully faster in our dataset.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {candidates.map((c, i) => {
                    const style = VERDICT_STYLE[c.verdict];
                    return (
                      <motion.div
                        key={c.gpu.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{c.gpu.name}</span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}
                            >
                              {style.label}
                            </span>
                            {bestValue?.gpu.id === c.gpu.id && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: BEST_VALUE_STYLE.bg, color: BEST_VALUE_STYLE.color, border: `1px solid ${BEST_VALUE_STYLE.border}` }}>
                                {BEST_VALUE_STYLE.label}
                              </span>
                            )}
                          </div>
                          <Link
                            to={`/builder?gpu=${c.gpu.id}`}
                            className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
                            style={{ color: 'var(--ff-accent-text)' }}
                          >
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
                    *Net cost = new card's price minus your current card's estimated resale value. **Cost/FPS = net cost divided by the average FPS gained — lower is a better value, not shown when there's no positive FPS gain to divide by.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-12 space-y-3">
          {upgradeCalculatorFaqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
