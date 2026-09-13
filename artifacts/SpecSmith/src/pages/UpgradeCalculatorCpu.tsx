import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, BarChart3, Gamepad2, Monitor, Share2 } from 'lucide-react';
import PartSelector from '../components/PartSelector';
import PageGlow from '../components/PageGlow';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { useToast } from '../context/ToastContext';
import {
  getUpgradeCpus,
  getUpgradeCpu,
  getClosestCpuUpgradeComparisons,
  averageCpuFps,
  CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT,
  CPU_UPGRADE_REFERENCE_GPU,
} from '../lib/cpuUpgradeCalculator';

export default function UpgradeCalculatorCpu() {
  useSeo(getRouteMeta('/upgrade-calculator-cpu'));
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const cpus = getUpgradeCpus();
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('cpu');
    return fromUrl && cpus.some(cpu => cpu.id === fromUrl) ? fromUrl : null;
  });

  const current = currentId ? getUpgradeCpu(currentId) : null;
  const avgFpsCurrent = current ? averageCpuFps(current) : 0;
  const comparisons = useMemo(
    () => currentId ? getClosestCpuUpgradeComparisons(currentId) : [],
    [currentId],
  );

  const shareResult = async () => {
    if (!current) return;
    const url = `${SITE_URL}/upgrade-calculator-cpu?cpu=${current.id}`;
    const title = `Compare CPUs above the ${current.name}`;
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
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            CPU Upgrade <span className="gradient-text">Comparison</span>
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Choose your current CPU to compare it with up to {CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT} of the closest faster results in SpecSmith&apos;s performance model.
          </p>
          <p className="text-xs max-w-2xl mx-auto mt-3" style={{ color: 'var(--ff-text-3)' }} data-testid="comparison-limit">
            Estimates only—not measured benchmarks, live prices, resale values or buying advice.
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
            <Link to="/upgrade-cpu" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Browse CPU comparison pages →
            </Link>
            <Link to="/upgrade-calculator" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
              Compare GPUs instead →
            </Link>
          </div>
        </motion.div>

        <div className="mb-6">
          <PartSelector
            category="cpu"
            label="Your Current CPU"
            defaultOpen
            showShopping={false}
            parts={cpus}
            selectedId={currentId}
            onSelect={setCurrentId}
            getSpecs={part => {
              const cpu = part as ReturnType<typeof getUpgradeCpus>[number];
              return [{ label: 'Performance group', value: `${cpu.tier}/10` }];
            }}
          />
        </div>

        <AnimatePresence>
          {current && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <BarChart3 size={13} /> Estimated Average FPS
                  </div>
                  <div className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{avgFpsCurrent}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>A model estimate, not a benchmark of your PC.</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <Monitor size={13} /> Fixed Reference GPU
                  </div>
                  <div className="text-lg font-black leading-tight" style={{ color: 'var(--ff-text)' }}>{CPU_UPGRADE_REFERENCE_GPU.name}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Your GPU may produce different results.</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
                    <Gamepad2 size={13} /> Model Basis
                  </div>
                  <div className="text-lg font-black leading-tight" style={{ color: 'var(--ff-text)' }}>20 games</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>1440p High settings.</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>Closest Modelled Steps Above</h2>
                <button
                  onClick={shareResult}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                >
                  <Share2 size={12} /> Share
                </button>
              </div>

              <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--ff-text-2)' }} data-testid="selection-basis">
                Shows up to {CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT} CPUs with the closest higher modelled averages, ordered from the smallest estimated difference upward. Price does not affect selection. CPU differences are compressed by the fixed high-end GPU and this 20-game model, so nearby results may round to the same percentage. This is a comparison, not a recommendation.
              </p>

              {comparisons.length === 0 ? (
                <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
                    No CPU SpecSmith tracks produces a higher modelled average than {current.name}.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comparisons.map((comparison, index) => (
                    <motion.div
                      key={comparison.cpu.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className="rounded-2xl p-5"
                      style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                      data-testid="comparison-row"
                      data-cpu-id={comparison.cpu.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{comparison.cpu.name}</span>
                        <Link
                          to={`/builder?cpu=${comparison.cpu.id}`}
                          aria-label={`Open ${comparison.cpu.name} in Builder`}
                          className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
                          style={{ color: 'var(--ff-accent-text)' }}
                        >
                          Open in Builder <ArrowRight size={12} />
                        </Link>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Estimated Difference</p>
                          <p className="text-lg font-black" style={{ color: 'var(--ff-green)' }}>+{comparison.fpsDiffPct}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>Estimated Average</p>
                          <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>{comparison.avgFpsNew} FPS</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
