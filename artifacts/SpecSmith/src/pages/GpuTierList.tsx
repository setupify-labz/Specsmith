import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Trophy } from 'lucide-react';
import { getGpuTiers } from '../lib/gpuTierList';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function GpuTierList() {
  useSeo(getRouteMeta('/gpu-tier-list'));
  const tiers = getGpuTiers();

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="warm" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            GPU Tier <span className="gradient-text">List</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Every graphics card we track, ranked S to D by raw performance. 💰 marks the best
            value pick in each tier — the card that gives you that tier's performance for the least money.
          </p>
        </motion.div>

        <div className="space-y-6">
          {tiers.map((tier, ti) => (
            <motion.div key={tier.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (ti % 5) * 0.06 }}
              className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <div className="flex items-center gap-4 p-4" style={{ backgroundColor: `${tier.color}18` }}>
                <div className="flex items-center justify-center rounded-xl font-black text-2xl flex-shrink-0"
                  style={{ width: 52, height: 52, backgroundColor: tier.color, color: '#0A0A0F' }}>
                  {tier.id}
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: 'var(--ff-text)' }}>{tier.label}</p>
                  <p className="text-xs" style={{ color: 'var(--ff-text-3)' }}>{tier.blurb}</p>
                </div>
              </div>
              <div className="p-4 flex flex-wrap gap-2">
                {tier.gpus.map(({ gpu, valuePer100, isBestValueInTier }) => (
                  <Link key={gpu.id} to={`/builder?gpu=${gpu.id}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                    style={{ backgroundColor: 'var(--ff-card)', border: isBestValueInTier ? `1px solid ${tier.color}` : '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                    title={`${valuePer100} performance-per-$100`}>
                    {isBestValueInTier && <span title="Best value in this tier">💰</span>}
                    {gpu.name}
                    <span style={{ color: 'var(--ff-text-3)' }}>${gpu.price_usd}</span>
                  </Link>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-xs mt-6 leading-relaxed text-center" style={{ color: 'var(--ff-text-3)' }}>
          Tiers are assigned by raw benchmark performance, independent of price — this answers "how fast is it,"
          not "is it worth it." Prices are typical US street pricing, last updated {PRICES_UPDATED}.
        </p>

        <div className="text-center mt-10">
          <Link to="/compare"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Trophy size={15} /> Compare Two GPUs Head-to-Head <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
