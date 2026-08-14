import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Sparkles, Box } from 'lucide-react';
import { USE_CASES } from '../lib/useCaseBuilds';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const faqs = [
  {
    title: 'How are picks different from a gaming build?',
    content: 'Each use case weighs parts for what that workload actually needs — video editing prioritizes VRAM and core count for exports, home office spends nothing extra on the GPU and puts the budget into CPU cores for multitasking, streaming favors NVENC-capable cards. A pure gaming build optimizes for FPS per dollar instead.',
  },
  {
    title: 'How many use cases and budget tiers are covered?',
    content: `${USE_CASES.length} use cases plus a dedicated Small Form Factor guide, each with multiple budget tiers so you can match the recommendation to what you're actually spending.`,
  },
  {
    title: "What if my use case isn't listed here?",
    content: 'Use the Builder directly — pick any parts and it still runs the same compatibility and PSU wattage checks, just without a pre-weighted recommendation for your specific workload.',
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

export default function UseCaseBuildIndex() {
  useSeo(getRouteMeta('/best-pc-for'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
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

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: USE_CASES.length * 0.05 }}>
            <Link to="/best-pc-for/small-form-factor"
              className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
              style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <div className="flex items-center gap-3">
                <Box size={16} style={{ color: 'var(--ff-accent)' }} />
                <div>
                  <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>Small Form Factor (Mini-ITX)</span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>2 clearance-verified builds</p>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
            </Link>
          </motion.div>
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
