import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, DollarSign, TrendingUp, Zap, Cpu } from 'lucide-react';
import PartSelector from '../components/PartSelector';
import PageGlow from '../components/PageGlow';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import {
  getUpgradeGpus, getUpgradeGpu, getUpgradeCandidates, estimateResaleValue, averageFps,
  type UpgradeVerdict,
} from '../lib/upgradeCalculator';

const VERDICT_STYLE: Record<UpgradeVerdict, { label: string; bg: string; color: string; border: string }> = {
  strong:   { label: 'Strong upgrade',   bg: 'rgba(0,230,118,0.12)', color: '#00E676', border: 'rgba(0,230,118,0.3)' },
  moderate: { label: 'Moderate upgrade', bg: 'rgba(0,212,255,0.12)', color: '#00D4FF', border: 'rgba(0,212,255,0.3)' },
  marginal: { label: 'Marginal gain',    bg: 'rgba(255,179,0,0.12)', color: '#FFB300', border: 'rgba(255,179,0,0.3)' },
};

export default function UpgradeCalculator() {
  useSeo(getRouteMeta('/upgrade-calculator'));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const gpus = getUpgradeGpus();

  const current = currentId ? getUpgradeGpu(currentId) : null;
  const resale = current ? estimateResaleValue(current.price_usd) : 0;
  const avgFpsCurrent = current ? averageFps(current) : 0;
  const candidates = useMemo(() => currentId ? getUpgradeCandidates(currentId) : [], [currentId]);

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Should You <span className="gradient-text">Upgrade?</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick your current GPU, see what it's roughly worth used, and what it'd actually cost — and gain — to trade up.
          </p>
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

              <h2 className="text-xl font-black mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
                <TrendingUp size={18} style={{ color: 'var(--ff-accent)' }} /> Upgrade Options
              </h2>

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
                          <div className="flex items-center gap-3">
                            <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{c.gpu.name}</span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}
                            >
                              {style.label}
                            </span>
                          </div>
                          <Link
                            to={`/builder?gpu=${c.gpu.id}`}
                            className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
                            style={{ color: 'var(--ff-accent-text)' }}
                          >
                            Build with this <ArrowRight size={12} />
                          </Link>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Net Cost*</p>
                            <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>${c.netCost.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>FPS Gain</p>
                            <p className="text-lg font-black" style={{ color: c.fpsGainPct >= 0 ? '#00E676' : '#FF1744' }}>
                              {c.fpsGainPct >= 0 ? '+' : ''}{c.fpsGainPct}%
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>New Average</p>
                            <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>{c.avgFpsNew} FPS</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                  <p className="text-[10px] text-center pt-2" style={{ color: 'var(--ff-text-3)' }}>
                    *Net cost = new card's price minus your current card's estimated resale value.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
