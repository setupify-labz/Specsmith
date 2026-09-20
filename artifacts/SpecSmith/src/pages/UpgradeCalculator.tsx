import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from '../components/MotionLite';
import { ArrowRight, BarChart3, Cpu, Gamepad2, Share2 } from 'lucide-react';
import PartSelector from '../components/PartSelector';
import PageGlow from '../components/PageGlow';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { useToast } from '../context/ToastContext';
import {
  getUpgradeGpus,
  getUpgradeGpu,
  getClosestUpgradeComparisons,
  averageFps,
  UPGRADE_COMPARISON_PREVIEW_LIMIT,
  UPGRADE_REFERENCE_CPU,
  upgradeCalculatorFaqs,
  upgradeCalculatorFaqJsonLd,
} from '../lib/upgradeCalculator';
import { trackProductEvent } from '../lib/productAnalytics';

export default function UpgradeCalculator() {
  useSeo(getRouteMeta('/upgrade-calculator'));
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const gpus = getUpgradeGpus();
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('gpu');
    return fromUrl && gpus.some(gpu => gpu.id === fromUrl) ? fromUrl : null;
  });

  const current = currentId ? getUpgradeGpu(currentId) : null;
  const avgFpsCurrent = current ? averageFps(current) : 0;
  const comparisons = useMemo(
    () => currentId ? getClosestUpgradeComparisons(currentId) : [],
    [currentId],
  );

  useEffect(() => {
    if (!current) return;
    trackProductEvent({
      name: 'upgrade_comparison_viewed',
      metadata: { component: 'gpu', resultCount: comparisons.length },
    });
  }, [current, comparisons.length]);

  const shareResult = async () => {
    if (!current) return;
    const url = `${SITE_URL}/upgrade-calculator?gpu=${current.id}`;
    const title = `Compare GPUs above the ${current.name}`;
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
            GPU Upgrade <span className="gradient-text">Comparison</span>
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Choose your current GPU to compare it with up to {UPGRADE_COMPARISON_PREVIEW_LIMIT} of the closest faster results in SpecSmith&apos;s performance model.
          </p>
          <p className="text-xs max-w-2xl mx-auto mt-3" style={{ color: 'var(--ff-text-3)' }} data-testid="comparison-limit">
            Estimates only—not measured benchmarks, live prices or buying advice.
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
            <Link to="/upgrade" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Browse GPU comparison pages →
            </Link>
            <Link to="/upgrade-calculator-cpu" className="inline-block text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
              Compare CPUs instead →
            </Link>
          </div>
        </motion.div>

        <div className="mb-6">
          <PartSelector
            category="gpu"
            label="Your Current GPU"
            defaultOpen
            showShopping={false}
            parts={gpus}
            selectedId={currentId}
            onSelect={setCurrentId}
            getSpecs={part => {
              const gpu = part as ReturnType<typeof getUpgradeGpus>[number];
              return [{ label: 'Performance group', value: `${gpu.tier}/10` }];
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
                    <Cpu size={13} /> Fixed Reference CPU
                  </div>
                  <div className="text-lg font-black leading-tight" style={{ color: 'var(--ff-text)' }}>{UPGRADE_REFERENCE_CPU.name}</div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--ff-text-3)' }}>Your CPU may produce different results.</p>
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
                Shows up to {UPGRADE_COMPARISON_PREVIEW_LIMIT} GPUs with the closest higher modelled averages, ordered from the smallest estimated difference upward. Price does not affect selection. This is a comparison, not a recommendation.
              </p>

              {comparisons.length === 0 ? (
                <div className="rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
                    No GPU SpecSmith tracks produces a higher modelled average than {current.name}.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comparisons.map((comparison, index) => (
                    <motion.div
                      key={comparison.gpu.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className="rounded-2xl p-5"
                      style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                      data-testid="comparison-row"
                      data-gpu-id={comparison.gpu.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <span className="font-bold" style={{ color: 'var(--ff-text)' }}>{comparison.gpu.name}</span>
                        <Link
                          to={`/builder?gpu=${comparison.gpu.id}`}
                          aria-label={`Open ${comparison.gpu.name} in Builder`}
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

        <div className="mt-12 space-y-3">
          {upgradeCalculatorFaqs.map(faq => (
            <div key={faq.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{faq.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{faq.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
