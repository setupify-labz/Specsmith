import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Zap } from 'lucide-react';

// Real numbers computed from the site's own dataset (RTX 5090 / RTX 5070,
// avg FPS across the 20-game set at 1440p High, Ryzen 7 9800X3D) — same
// method the /vs matchup pages use, not made up for decoration.
const CARD_A = { name: 'RTX 5090', price: 3979, fps: 211 };
const CARD_B = { name: 'RTX 5070', price: 599, fps: 146 };

function useCountUp(target: number, delayMs: number, durationMs = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs]);
  return value;
}

function Bar({ name, price, fps, color, delay, maxFps }: { name: string; price: number; fps: number; color: string; delay: number; maxFps: number }) {
  const shown = useCountUp(fps, delay);
  const widthPct = Math.max(4, (shown / maxFps) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-bold" style={{ color }}>{name}</span>
        <span className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
          {shown} <span className="text-xs font-semibold" style={{ color: 'var(--ff-text-3)' }}>FPS</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ff-border)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, var(--ff-cyan))` }}
          initial={{ width: '0%' }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 1.1, delay: delay / 1000, ease: 'easeOut' }}
        />
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>${price.toLocaleString()}</div>
    </div>
  );
}

/** Floating preview card for the hero — a live-feeling snapshot of what the
 * FPS estimator produces, built from real computed data, not a screenshot. */
export default function HeroFpsCard() {
  const maxFps = CARD_A.fps;
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: -2 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative w-full max-w-sm mx-auto lg:mx-0"
    >
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="rounded-2xl p-5 relative"
        style={{
          backgroundColor: 'var(--ff-surface)',
          border: '1px solid var(--ff-border)',
          boxShadow: '0 20px 60px -12px rgba(108,99,255,0.35), 0 0 0 1px rgba(255,255,255,0.02)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ff-text-2)' }}>
            <Zap size={13} style={{ color: 'var(--ff-cyan)' }} /> FPS Estimator
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--ff-accent-text)', backgroundColor: 'var(--ff-accent-10)' }}>
            1440p · High
          </span>
        </div>

        {/* A card label, not a document heading — using <h3> here skipped
            past <h2> in the page outline and failed Lighthouse's
            heading-order check. */}
        <p className="text-sm font-bold mb-4" style={{ color: 'var(--ff-text)' }}>
          {CARD_A.name} <span style={{ color: 'var(--ff-text-3)' }}>vs</span> {CARD_B.name}
        </p>

        <div className="space-y-4">
          <Bar name={CARD_A.name} price={CARD_A.price} fps={CARD_A.fps} color="var(--ff-accent-text)" delay={500} maxFps={maxFps} />
          <Bar name={CARD_B.name} price={CARD_B.price} fps={CARD_B.fps} color="#00E676" delay={700} maxFps={maxFps} />
        </div>

        <div className="flex items-center gap-1.5 mt-4 pt-4 text-xs font-semibold" style={{ borderTop: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}>
          <Trophy size={13} style={{ color: '#FFB300' }} />
          20 games benchmarked · real pricing
        </div>
      </motion.div>

      {/* Floating badge chip */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, x: -10 }}
        animate={{ opacity: 1, scale: 1, x: 0, y: [0, 8, 0] }}
        transition={{ opacity: { duration: 0.5, delay: 1.3 }, scale: { duration: 0.5, delay: 1.3 }, y: { duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1.3 } }}
        className="absolute -left-6 -bottom-5 hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
        style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.4)' }}
      >
        <span role="img" aria-hidden="true">✓</span> No account needed
      </motion.div>
    </motion.div>
  );
}
