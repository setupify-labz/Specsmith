import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Swords, Cpu } from 'lucide-react';
import {
  MATCHUPS, CPU_MATCHUPS,
  getMatchupGpu, getMatchupCpuById, getMatchupTitle, getCpuMatchupTitle,
} from '../lib/matchups';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';

interface Card {
  slug: string;
  title: string;
  priceA?: number;
  priceB?: number;
}

function MatchupGrid({ cards, icon }: { cards: Card[]; icon: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((c, i) => (
        <motion.div key={c.slug}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: (i % 6) * 0.05 }}>
          <Link to={`/vs/${c.slug}`}
            className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
            style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-3">
              {icon}
              <div>
                <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{c.title}</span>
                {c.priceA != null && c.priceB != null && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>
                    ${c.priceA} vs ${c.priceB}
                  </p>
                )}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

export default function GpuMatchupIndex() {
  useSeo(getRouteMeta('/vs'));

  const gpuCards: Card[] = MATCHUPS.map(m => ({
    slug: m.slug,
    title: getMatchupTitle(m),
    priceA: getMatchupGpu(m.gpuA)?.price_usd,
    priceB: getMatchupGpu(m.gpuB)?.price_usd,
  }));
  const cpuCards: Card[] = CPU_MATCHUPS.map(m => ({
    slug: m.slug,
    title: getCpuMatchupTitle(m),
    priceA: getMatchupCpuById(m.cpuA)?.price_usd,
    priceB: getMatchupCpuById(m.cpuB)?.price_usd,
  }));

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            GPU & CPU <span className="gradient-text">Comparisons</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Head-to-head FPS comparisons across 20 games at 1080p, 1440p, and 4K — with specs and price-per-frame value.
          </p>
        </motion.div>

        <h2 className="text-xl font-black mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <Swords size={18} style={{ color: 'var(--ff-accent)' }} /> GPU Matchups
        </h2>
        <MatchupGrid cards={gpuCards} icon={<Swords size={16} style={{ color: 'var(--ff-accent)' }} />} />

        <h2 className="text-xl font-black mb-4 mt-12 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <Cpu size={18} style={{ color: 'var(--ff-cyan)' }} /> CPU Matchups
        </h2>
        <MatchupGrid cards={cpuCards} icon={<Cpu size={16} style={{ color: 'var(--ff-cyan)' }} />} />

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
