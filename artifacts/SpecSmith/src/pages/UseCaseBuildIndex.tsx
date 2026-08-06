import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Sparkles } from 'lucide-react';
import { USE_CASES } from '../lib/useCaseBuilds';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

export default function UseCaseBuildIndex() {
  useSeo(getRouteMeta('/best-pc-for'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best PC <span className="gradient-text">by Use Case</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Not everyone's building for gaming FPS alone. Pick your use case for GPU/CPU picks weighted for what actually matters there.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {USE_CASES.map((u, i) => (
            <motion.div key={u.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}>
              <Link to={`/best-pc-for/${u.slug}`}
                className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="flex items-center gap-3">
                  <Sparkles size={16} style={{ color: 'var(--ff-accent)' }} />
                  <div>
                    <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{u.shortTitle}</span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{u.tiers.length} budget tiers</p>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link to="/builder"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Start a Build <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
