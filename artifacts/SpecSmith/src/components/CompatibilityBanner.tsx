import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, XCircle, CheckCircle, Wrench } from 'lucide-react';
import type { CompatibilityWarning } from '../lib/compatibility';

interface Props {
  warnings: CompatibilityWarning[];
  passed?: string[];
}

export default function CompatibilityBanner({ warnings, passed = [] }: Props) {
  return (
    <AnimatePresence>
      {warnings.length === 0 ? (
        <motion.div
          key="ok"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="flex items-center gap-2 p-3 rounded-lg bg-[#00E676]/8 border border-[#00E676]/20"
        >
          <CheckCircle size={16} className="text-[var(--ff-green)] shrink-0" />
          <span className="text-sm text-[var(--ff-green)] font-medium">
            {passed.length > 0
              ? `All checks passed: ${passed.join(' · ')}`
              : 'No compatibility issues detected'}
          </span>
        </motion.div>
      ) : (
        <div className="space-y-2">
          {warnings.map(w => {
            const isError = w.type === 'error';
            const color = isError ? 'var(--ff-red)' : 'var(--ff-amber)';
            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-3 rounded-lg"
                style={{ backgroundColor: `${color}14`, border: `1px solid ${color}33` }}
              >
                <div className="flex items-center gap-2">
                  {isError
                    ? <XCircle size={15} className="shrink-0" style={{ color }} />
                    : <AlertTriangle size={15} className="shrink-0" style={{ color }} />
                  }
                  <span className="text-sm font-bold" style={{ color }}>{w.title}</span>
                  {w.confidence === 'likely' && (
                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}>
                      varies by model
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{w.detail}</p>
                {w.fix && (
                  <p className="text-xs mt-1.5 flex items-start gap-1.5 leading-relaxed" style={{ color: 'var(--ff-text)' }}>
                    <Wrench size={11} className="shrink-0 mt-0.5" style={{ color: 'var(--ff-cyan)' }} />
                    <span><span className="font-semibold" style={{ color: 'var(--ff-cyan)' }}>Fix:</span> {w.fix}</span>
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}
