import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Zap, DollarSign } from 'lucide-react';
import { getAffiliateUrl } from '../lib/fps';

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
}

export default function BuildSummary({ parts, totalCost, onEstimateFps, canEstimate, compatibilityOk }: Props) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#13131A] p-5 sticky top-20">
      <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <DollarSign size={18} className="text-[#6C63FF]" />
        Build Summary
      </h3>

      <div className="space-y-2 mb-4 min-h-[120px]">
        <AnimatePresence>
          {parts.length === 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[#8888AA] text-sm text-center py-8"
            >
              Select components to build your PC
            </motion.p>
          )}
          {parts.map(p => (
            <motion.div
              key={p.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center justify-between gap-2 py-2 border-b border-white/5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] text-[#8888AA] uppercase tracking-wider">{p.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-white text-xs font-medium truncate">{p.name}</span>
                  <a
                    href={getAffiliateUrl(p.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#6C63FF] hover:text-[#00D4FF] flex-shrink-0"
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
              <span className="text-white text-sm font-semibold whitespace-nowrap">${p.price.toLocaleString()}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="border-t border-white/10 pt-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-[#8888AA] text-sm font-medium">Total Cost</span>
          <span className="text-2xl font-black text-white">${totalCost.toLocaleString()}</span>
        </div>
      </div>

      <button
        onClick={onEstimateFps}
        disabled={!canEstimate}
        className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
          canEstimate
            ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
            : 'text-[#8888AA] cursor-not-allowed opacity-50 bg-white/5'
        }`}
        style={canEstimate ? { background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' } : {}}
      >
        <Zap size={16} />
        {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
      </button>
    </div>
  );
}
