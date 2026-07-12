import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Swords } from 'lucide-react';
import { MATCHUPS, getMatchupGpu, getMatchupTitle } from '../lib/matchups';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';

export default function GpuMatchupIndex() {
  useSeo(getRouteMeta('/vs'));

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            GPU <span className="gradient-text">Comparisons</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Head-to-head FPS comparisons across 20 games at 1080p, 1440p, and 4K — with specs and price-per-frame value.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MATCHUPS.map((m, i) => {
            const a = getMatchupGpu(m.gpuA);
            const b = getMatchupGpu(m.gpuB);
            return (
              <motion.div key={m.slug}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 6) * 0.05 }}>
                <Link to={`/vs/${m.slug}`}
                  className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-3">
                    <Swords size={16} style={{ color: 'var(--ff-accent)' }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{getMatchupTitle(m)}</span>
                      {a && b && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>
                          ${a.price_usd} vs ${b.price_usd}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
                </Link>
              </motion.div>
            );
          })}
        </div>

        <div className="text-center mt-10">
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
            Don't see your matchup? Compare any two GPU + CPU combos in the full tool.
          </p>
          <Link to="/compare"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Open Build Comparison <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
