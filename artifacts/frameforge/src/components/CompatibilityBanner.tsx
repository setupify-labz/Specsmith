import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, XCircle, CheckCircle } from 'lucide-react';
import type { CompatibilityWarning } from '../lib/compatibility';

interface Props {
  warnings: CompatibilityWarning[];
}

export default function CompatibilityBanner({ warnings }: Props) {
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
          <CheckCircle size={16} className="text-[#00E676] shrink-0" />
          <span className="text-sm text-[#00E676] font-medium">No compatibility issues detected</span>
        </motion.div>
      ) : (
        <div className="space-y-2">
          {warnings.map(w => (
            <motion.div
              key={w.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`flex items-start gap-2 p-3 rounded-lg ${
                w.type === 'error'
                  ? 'bg-[#FF1744]/8 border border-[#FF1744]/20'
                  : 'bg-[#FFB300]/8 border border-[#FFB300]/20'
              }`}
            >
              {w.type === 'error'
                ? <XCircle size={16} className="text-[#FF1744] shrink-0 mt-0.5" />
                : <AlertTriangle size={16} className="text-[#FFB300] shrink-0 mt-0.5" />
              }
              <span className={`text-sm ${w.type === 'error' ? 'text-[#FF1744]' : 'text-[#FFB300]'}`}>
                {w.message}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
