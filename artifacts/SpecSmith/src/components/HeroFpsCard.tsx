import { motion } from 'framer-motion';
import { Trophy, Zap } from 'lucide-react';

// Real numbers computed from the site's own dataset (RTX 5090 / RTX 5070,
// avg FPS across the 20-game set at 1440p High, Ryzen 7 9800X3D) — same
// method the /vs matchup pages use, not made up for decoration.
const CARD_A = { name: 'RTX 5090', price: 3979, fps: 211 };
const CARD_B = { name: 'RTX 5070', price: 599, fps: 146 };

function Bar({ name, price, fps, color, delay, maxFps }: { name: string; price: number; fps: number; color: string; delay: number; maxFps: number }) {
  const shown = fps;
  const widthPct = Math.max(4, (shown / maxFps) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-bold" style={{ color }}>{name}</span>
        <span className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
          Est. {shown} <span className="text-xs font-semibold" style={{ color: 'var(--ff-text-3)' }}>FPS</span>
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
      <div className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>Est. ${price.toLocaleString()}</div>
    </div>
  );
}

/** Floating preview card for the hero — a live-feeling snapshot of what the
 * FPS estimator produces, built from real computed data, not a screenshot. */
export default function HeroFpsCard() {
  const maxFps = CARD_A.fps;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative w-full max-w-lg mx-auto"
    >
      <motion.div
        className="rounded-2xl p-6 sm:p-8 relative"
        style={{
          backgroundColor: 'var(--ff-surface)',
          border: '1px solid var(--ff-border)',
          boxShadow: '0 20px 60px -12px rgba(108,99,255,0.35), 0 0 0 1px rgba(255,255,255,0.02)',
        }}
      >
        <p className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: 'var(--ff-accent-text)' }}>Before you buy</p>
        <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Compare the performance.</p>
        <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--ff-text-2)' }}>An example of estimated results—not a measured benchmark or a retailer quote.</p>
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ff-text-2)' }}>
            <Zap size={13} style={{ color: 'var(--ff-cyan)' }} /> FPS Estimator
          </span>
          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ color: 'var(--ff-accent-text)', backgroundColor: 'var(--ff-accent-10)' }}>
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
          <Bar name={CARD_B.name} price={CARD_B.price} fps={CARD_B.fps} color="var(--ff-green)" delay={700} maxFps={maxFps} />
        </div>

        <div className="flex items-center gap-1.5 mt-4 pt-4 text-xs font-semibold" style={{ borderTop: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}>
          <Trophy size={13} style={{ color: 'var(--ff-amber)' }} />
          Example estimates · 20-game average · Ryzen 7 9800X3D
        </div>
      </motion.div>

      <p className="mt-4 text-center text-sm" style={{ color: 'var(--ff-text-2)' }}>Choose parts → review estimates → check the retailer</p>
    </motion.div>
  );
}
