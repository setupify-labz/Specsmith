import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, TrendingUp, Sliders } from 'lucide-react';
import { UPGRADE_PAGES } from '../lib/upgradePages';
import { getUpgradeGpu } from '../lib/upgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

export default function GpuUpgradeIndex() {
  useSeo(getRouteMeta('/upgrade'));

  const cards = UPGRADE_PAGES
    .map(p => ({ page: p, gpu: getUpgradeGpu(p.gpuId) }))
    .filter((x): x is { page: typeof x.page; gpu: NonNullable<typeof x.gpu> } => !!x.gpu)
    .sort((a, b) => b.gpu.tier - a.gpu.tier || a.gpu.price_usd - b.gpu.price_usd);

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="cool" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            GPU Upgrade <span className="gradient-text">Guides</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick your current graphics card to see its estimated resale value and what it actually costs — and gains — to trade up.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map(({ page, gpu }, i) => (
            <motion.div key={page.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (i % 8) * 0.04 }}>
              <Link to={`/upgrade/${page.slug}`}
                className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="flex items-center gap-3">
                  <TrendingUp size={16} style={{ color: 'var(--ff-accent)' }} />
                  <div>
                    <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{gpu.name}</span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>${gpu.price_usd.toLocaleString()} new · Tier {gpu.tier}/10</p>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-10">
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
            Want the interactive version instead? Pick any card and compare live.
          </p>
          <Link to="/upgrade-calculator"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Sliders size={15} /> Open Upgrade Calculator <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
