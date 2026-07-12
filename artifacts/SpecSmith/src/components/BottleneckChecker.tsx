import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Zap } from 'lucide-react';

interface Props {
  gpuScore: number;
  cpuScore: number;
  onFixGpu?: () => void;
  onFixCpu?: () => void;
}

export default function BottleneckChecker({ gpuScore, cpuScore, onFixGpu, onFixCpu }: Props) {
  const ratio = gpuScore / cpuScore;

  let bottleneck: 'CPU' | 'GPU' | 'none' = 'none';
  let severity: 'severe' | 'moderate' | 'none' = 'none';
  let pct = 0;
  let message = '';

  if (ratio > 1.4) {
    bottleneck = 'CPU';
    severity = ratio > 1.7 ? 'severe' : 'moderate';
    pct = Math.round((ratio - 1) * 100);
    message = `Your CPU is bottlenecking your GPU by ~${pct}%. Your GPU is being held back. Consider upgrading to a faster CPU.`;
  } else if (ratio < 0.72) {
    bottleneck = 'GPU';
    severity = ratio < 0.55 ? 'severe' : 'moderate';
    pct = Math.round((1 - ratio) * 100);
    message = `Your GPU is bottlenecking your CPU by ~${pct}%. Your CPU is faster than your GPU can keep up with. Consider a stronger GPU.`;
  } else {
    message = 'Great balance! Your CPU and GPU are well-matched for maximum performance.';
  }

  const badgeColor = severity === 'severe' ? '#FF1744' : severity === 'moderate' ? '#FFB300' : '#00E676';
  const badgeLabel = severity === 'none' ? 'Balanced' : severity === 'moderate' ? 'Moderate Bottleneck' : 'Severe Bottleneck';

  const total = gpuScore + cpuScore;
  const cpuPct = (cpuScore / total) * 100;
  const gpuPct = (gpuScore / total) * 100;

  return (
    <div
      className="rounded-xl p-4 mt-4"
      style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-card)' }}
    >
      <h4 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
        <Zap size={14} style={{ color: 'var(--ff-accent)' }} />
        Bottleneck Analysis
      </h4>

      {/* Balance bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>
          <span>CPU {cpuScore}</span>
          <span className="text-[10px]">Ideal Zone</span>
          <span>GPU {gpuScore}</span>
        </div>
        <div className="relative h-4 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ff-bg)' }}>
          {/* CPU side (left, purple) */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${cpuPct / 2}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute left-0 top-0 h-full"
            style={{
              background: 'linear-gradient(90deg, #6C63FF88, #6C63FF)',
              left: `${50 - cpuPct / 2}%`,
            }}
          />
          {/* GPU side (right, cyan) */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${gpuPct / 2}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute top-0 h-full"
            style={{
              background: 'linear-gradient(90deg, var(--ff-cyan), #00D4FF88)',
              left: '50%',
            }}
          />
          {/* Center tick */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/60" style={{ left: '50%' }} />
        </div>
      </div>

      {/* Badge */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: `${badgeColor}18`, color: badgeColor, border: `1px solid ${badgeColor}40` }}
        >
          {severity === 'none' ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
          {badgeLabel}
        </span>

        {bottleneck !== 'none' && (
          <button
            onClick={bottleneck === 'CPU' ? onFixCpu : onFixGpu}
            className="text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ color: 'var(--ff-accent)' }}
          >
            Upgrade {bottleneck} →
          </button>
        )}
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{message}</p>
    </div>
  );
}
