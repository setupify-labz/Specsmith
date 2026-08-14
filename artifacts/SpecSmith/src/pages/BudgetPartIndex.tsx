import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, DollarSign } from 'lucide-react';
import { GPU_BUDGET_TIERS, CPU_BUDGET_TIERS, getPartsUnderBudget } from '../lib/budgetPages';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function BudgetPartIndex({ category }: { category: 'gpu' | 'cpu' }) {
  const path = category === 'gpu' ? '/best-gpu-budget' : '/best-cpu-budget';
  useSeo(getRouteMeta(path));
  const kind = category === 'gpu' ? 'GPU' : 'CPU';
  const tiers = category === 'gpu' ? GPU_BUDGET_TIERS : CPU_BUDGET_TIERS;
  const otherPath = category === 'gpu' ? '/best-cpu-budget' : '/best-gpu-budget';
  const otherKind = category === 'gpu' ? 'CPU' : 'GPU';

  const faqs = [
    {
      title: `How is "best under budget" ranked?`,
      content: `Every ${kind} that fits under the price ceiling is sorted by benchmark score, so the top of each list is simply the fastest ${kind} we track at or below that price — not a curated or sponsored pick.`,
    },
    {
      title: `Are these prices live or updated regularly?`,
      content: `Prices are typical US street pricing, refreshed monthly (last updated ${PRICES_UPDATED}). A ${kind} that's borderline on a budget tier now may shift up or down slightly next update.`,
    },
    {
      title: `What if I want to set an exact custom budget instead of these tiers?`,
      content: `Use the Builder to set any price and see live compatibility checks and FPS estimates for your full build, not just a single ${kind} pick.`,
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
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best {kind} <span className="gradient-text">by Budget</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick a price ceiling to see the strongest {kind}s we track that fit under it, ranked by benchmark performance.
          </p>
          <Link to={otherPath} className="inline-block mt-3 text-sm font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
            Looking for {otherKind} budgets instead? →
          </Link>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tiers.map((t, i) => {
            const count = getPartsUnderBudget(category, t.maxPrice).length;
            return (
              <motion.div key={t.slug}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}>
                <Link to={`${path}/${t.slug}`}
                  className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-3">
                    <DollarSign size={16} style={{ color: 'var(--ff-accent)' }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{kind} {t.label}</span>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{count} {kind}s tracked</p>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
                </Link>
              </motion.div>
            );
          })}
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
