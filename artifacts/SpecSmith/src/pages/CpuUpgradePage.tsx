import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, DollarSign, Zap, Cpu, Sliders } from 'lucide-react';
import { getCpuUpgradePage, getCpuUpgradeIntro, getRelatedCpuUpgradePages, getCpuUpgradePageMeta } from '../lib/cpuUpgradePages';
import { getUpgradeCpu, getCpuUpgradeCandidates, estimateCpuResaleValue, averageCpuFps, type UpgradeVerdict } from '../lib/cpuUpgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

const VERDICT_STYLE: Record<UpgradeVerdict, { label: string; bg: string; color: string; border: string }> = {
  strong:   { label: 'Strong upgrade',   bg: 'rgba(0,230,118,0.12)', color: '#00E676', border: 'rgba(0,230,118,0.3)' },
  moderate: { label: 'Moderate upgrade', bg: 'rgba(0,212,255,0.12)', color: '#00D4FF', border: 'rgba(0,212,255,0.3)' },
  marginal: { label: 'Marginal gain',    bg: 'rgba(255,179,0,0.12)', color: '#FFB300', border: 'rgba(255,179,0,0.3)' },
};

export default function CpuUpgradePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getCpuUpgradePage(slug) : undefined;
  const cpu = page ? getUpgradeCpu(page.cpuId) : undefined;

  const fallbackMeta = {
    path: '/upgrade-cpu',
    title: 'CPU Not Found | SpecSmith',
    description: 'This upgrade guide could not be found. Browse CPU upgrade guides instead.',
    noindex: true,
  };
  useSeo(page && cpu ? getCpuUpgradePageMeta(page) : fallbackMeta);

  if (!page || !cpu) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>CPU not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have an upgrade guide for this chip yet.</p>
          <Link to="/upgrade-cpu" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse CPU Upgrade Guides
          </Link>
        </div>
      </div>
    );
  }

  const resale = estimateCpuResaleValue(cpu.price_usd);
  const avgFpsCurrent = averageCpuFps(cpu);
  const candidates = getCpuUpgradeCandidates(cpu.id);
  const intro = getCpuUpgradeIntro(cpu);
  const related = getRelatedCpuUpgradePages(page);

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <Link to="/upgrade-cpu" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All CPU Upgrade Guides
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            What Should You Upgrade Your <span className="gradient-text">{cpu.name}</span> To?
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
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Across 20 games at 1440p High, paired with an RTX 4090.</p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
              <Cpu size={13} /> Tier
            </div>
            <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{cpu.tier}/10</div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>${cpu.price_usd.toLocaleString()} new.</p>
          </div>
        </div>

        <h2 className="text-xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>Upgrade Options</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>
          FPS gains here are naturally smaller than a GPU upgrade's — with a flagship GPU already installed, most games are limited by the graphics card, not the processor, so even a big CPU jump moves the needle less.
        </p>

        {candidates.length === 0 ? (
          <div className="rounded-2xl p-6 text-center mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
              The {cpu.name} is already the top tier we track — there's nothing meaningfully faster in our dataset.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-10">
            {candidates.map((c, i) => {
              const style = VERDICT_STYLE[c.verdict];
              return (
                <motion.div
                  key={c.cpu.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-2xl p-5"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{c.cpu.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                        {style.label}
                      </span>
                    </div>
                    <Link to={`/builder?cpu=${c.cpu.id}`}
                      className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
                      style={{ color: 'var(--ff-accent-text)' }}>
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
              *Net cost = new chip's price minus your {cpu.name}'s estimated resale value.
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to={`/builder?cpu=${cpu.id}`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Build Around the {cpu.name}
          </Link>
          <Link to="/upgrade-calculator-cpu"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            <Sliders size={15} /> Try a Different CPU <ChevronRight size={14} />
          </Link>
        </div>

        {related.length > 0 && (
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Upgrade Guides for Other Chips</h2>
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
