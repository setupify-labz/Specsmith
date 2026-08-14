import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, TrendingUp, Sliders } from 'lucide-react';
import { CPU_UPGRADE_PAGES } from '../lib/cpuUpgradePages';
import { getUpgradeCpu } from '../lib/cpuUpgradeCalculator';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

export default function CpuUpgradeIndex() {
  useSeo(getRouteMeta('/upgrade-cpu'));

  const cards = CPU_UPGRADE_PAGES
    .map(p => ({ page: p, cpu: getUpgradeCpu(p.cpuId) }))
    .filter((x): x is { page: typeof x.page; cpu: NonNullable<typeof x.cpu> } => !!x.cpu)
    .sort((a, b) => b.cpu.tier - a.cpu.tier || a.cpu.price_usd - b.cpu.price_usd);

  const faqs = [
    {
      title: 'How is my resale value estimated?',
      content: 'Each guide applies a typical used-market depreciation estimate to the chip\'s current new price — a rough guide for planning, not a live marketplace quote. Actual resale value depends on condition, local demand, and where you sell.',
    },
    {
      title: `How many chips have a dedicated upgrade guide?`,
      content: `${cards.length} CPUs, covering nearly every chip in our dataset. Don't see yours? Use the interactive Upgrade Calculator instead — it works for any CPU.`,
    },
    {
      title: 'Should I upgrade my CPU or my GPU first?',
      content: 'It depends on what\'s actually limiting your FPS in the games you play. These guides pair every chip with a flagship RTX 4090 to isolate CPU performance — with a weaker GPU already installed, the GPU is more often the bottleneck. Check the GPU Upgrade Guides if you\'re not sure which one to prioritize.',
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
            CPU Upgrade <span className="gradient-text">Guides</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick your current processor to see its estimated resale value and what it actually costs — and gains — to trade up.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map(({ page, cpu }, i) => (
            <motion.div key={page.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (i % 8) * 0.04 }}>
              <Link to={`/upgrade-cpu/${page.slug}`}
                className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="flex items-center gap-3">
                  <TrendingUp size={16} style={{ color: 'var(--ff-accent)' }} />
                  <div>
                    <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{cpu.name}</span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>${cpu.price_usd.toLocaleString()} new · Tier {cpu.tier}/10</p>
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
            Want the interactive version instead? Pick any chip and compare live. Or looking for a GPU upgrade?
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/upgrade-calculator-cpu"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
              <Sliders size={15} /> Open Upgrade Calculator <ChevronRight size={14} />
            </Link>
            <Link to="/upgrade"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
              style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
              GPU Upgrade Guides <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
