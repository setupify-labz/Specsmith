import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Zap, DollarSign, Save } from 'lucide-react';
import { getAffiliateUrl } from '../lib/fps';
import BottleneckChecker from './BottleneckChecker';
import ShareButton from './ShareButton';
import SaveBuildModal from './SaveBuildModal';

interface SummaryPart {
  label: string;
  name: string;
  price: number;
}

interface Props {
  parts: SummaryPart[];
  totalCost: number;
  onEstimateFps: () => void;
  canEstimate: boolean;
  compatibilityOk: boolean;
  gpu?: { benchmark_score: number } | null;
  cpu?: { benchmark_score: number } | null;
  buildState: Record<string, string | null>;
  onScrollToGpu?: () => void;
  onScrollToCpu?: () => void;
}

export default function BuildSummary({
  parts, totalCost, onEstimateFps, canEstimate, compatibilityOk,
  gpu, cpu, buildState, onScrollToGpu, onScrollToCpu,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <>
      <div
        className="rounded-2xl p-5 sticky top-20"
        style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}
      >
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <DollarSign size={18} style={{ color: 'var(--ff-accent)' }} />
          Build Summary
        </h3>

        {/* Parts list */}
        <div className="space-y-2 mb-4 min-h-[100px]">
          <AnimatePresence>
            {parts.length === 0 && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-sm text-center py-6" style={{ color: 'var(--ff-text-2)' }}>
                Select components to build your PC
              </motion.p>
            )}
            {parts.map(p => (
              <motion.div
                key={p.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center justify-between gap-2 py-2 last:border-0"
                style={{ borderBottom: '1px solid var(--ff-border)' }}
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>{p.label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium truncate" style={{ color: 'var(--ff-text)' }}>{p.name}</span>
                    <a href={getAffiliateUrl(p.name)} target="_blank" rel="noopener noreferrer"
                      className="flex-shrink-0 transition-colors" style={{ color: 'var(--ff-accent)' }}>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--ff-text)' }}>
                  ${p.price.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>Total Cost</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} size="sm" />
            </motion.div>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
