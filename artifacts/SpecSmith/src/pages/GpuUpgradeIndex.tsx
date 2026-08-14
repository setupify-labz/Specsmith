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

  const faqs = [
    {
      title: 'How is my resale value estimated?',
      content: 'Each guide applies a typical used-market depreciation estimate to the card\'s current new price — a rough guide for planning, not a live marketplace quote. Actual resale value depends on condition, local demand, and where you sell.',
    },
    {
      title: `How many cards have a dedicated upgrade guide?`,
      content: `${cards.length} GPUs, covering nearly every card in our dataset. Don't see yours? Use the interactive Upgrade Calculator instead — it works for any card.`,
    },
    {
      title: 'Should I upgrade my GPU or my CPU first?',
      content: 'It depends on what\'s actually limiting your FPS in the games you play. If you\'re GPU-bound (common at 1440p/4K), a GPU upgrade helps more; if you\'re CPU-bound (common at 1080p in CPU-heavy titles), check the CPU Upgrade Guides instead. The Builder\'s FPS estimator can help you see which is the bigger bottleneck for your specific setup.',
    },
  ];

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
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

        <div className="space-y-3 mt-12 mb-2">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
            Want the interactive version instead? Pick any card and compare live. Or looking for a CPU upgrade?
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/upgrade-calculator"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Sliders size={15} /> Open Upgrade Calculator <ChevronRight size={14} />
          </Link>
          <Link to="/upgrade-cpu"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            CPU Upgrade Guides <ChevronRight size={14} />
          </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
