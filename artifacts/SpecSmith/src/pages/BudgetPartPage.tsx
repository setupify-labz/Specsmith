import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, ExternalLink } from 'lucide-react';
import {
  getBudgetTier, getPartsUnderBudget, getBudgetPicks, getBudgetPageMeta, budgetItemListJsonLd,
  GPU_BUDGET_TIERS, CPU_BUDGET_TIERS,
} from '../lib/budgetPages';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function BudgetPartPage({ category }: { category: 'gpu' | 'cpu' }) {
  const { slug } = useParams<{ slug: string }>();
  const tier = slug ? getBudgetTier(category, slug) : undefined;
  const kind = category === 'gpu' ? 'GPU' : 'CPU';
  const indexPath = category === 'gpu' ? '/best-gpu-budget' : '/best-cpu-budget';
  const allTiers = category === 'gpu' ? GPU_BUDGET_TIERS : CPU_BUDGET_TIERS;

  const fallbackMeta = {
    path: indexPath,
    title: `Budget Tier Not Found | SpecSmith`,
    description: `This budget guide could not be found. Browse all budget tiers instead.`,
    noindex: true,
  };
  useSeo(tier ? getBudgetPageMeta(category, tier) : fallbackMeta);

  if (!tier) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Budget tier not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have a guide for this price range yet.</p>
          <Link to={indexPath} className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse All Budget Tiers
          </Link>
        </div>
      </div>
    );
  }

  const parts = getPartsUnderBudget(category, tier.maxPrice);
  const picks = getBudgetPicks(category, tier);
  const pickIds = new Set(picks.map(p => p.part.id));
  const related = allTiers.filter(t => t.slug !== tier.slug);
  const partCategory = category === 'gpu' ? 'gpu' : 'cpu';

  const topPick = parts.length > 0
    ? parts.reduce((best, p) => (p.benchmark_score > best.benchmark_score ? p : best), parts[0])
    : undefined;

  const faqs = [
    {
      title: `What's the best ${kind} ${tier.label.toLowerCase()}?`,
      content: topPick
        ? `The ${topPick.name} at $${topPick.price_usd} — it has the highest benchmark score (${topPick.benchmark_score}) of the ${parts.length} ${kind}s we track ${tier.label.toLowerCase()}. Every part on this page is ranked the same way: by raw benchmark performance within the price cap, not a subjective pick.`
        : `We don't currently track a ${kind} under this price point.`,
    },
    {
      title: `Are these prices accurate right now?`,
      content: `Prices are typical US street pricing, refreshed monthly (last updated ${PRICES_UPDATED}). A ${kind} sitting right at the edge of ${tier.label.toLowerCase()} could shift into a different tier slightly next update.`,
    },
    {
      title: `What does "Benchmark" mean in the table?`,
      content: `It's our relative performance index for comparing parts against each other — not a specific real-world game or test result. Use it to rank options within this price range; for actual estimated FPS in specific games, use the Builder or FPS Estimator instead.`,
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(budgetItemListJsonLd(category, tier, parts)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <Link to={indexPath} className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All {kind} Budget Tiers
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best {kind} <span className="gradient-text">{tier.label}</span>
          </h1>
          <p className="text-base max-w-3xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            Every {kind} we track priced {tier.label.toLowerCase()}, ranked by raw benchmark performance.
          </p>
        </motion.div>

        {picks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {picks.map(p => (
              <div key={p.label} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ff-text-2)' }}>{p.emoji} {p.label}</p>
                <p className="text-lg font-black mb-1" style={{ color: 'var(--ff-accent-text)' }}>{p.part.name}</p>
                <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--ff-text-3)' }}>{p.detail}</p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.part.price_usd}</span>
                  <a href={getAffiliateUrl(buildPartQuery(p.part.name, p.part.brand, partCategory))} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                    Amazon <ExternalLink size={10} />
                  </a>
                  <a href={getNeweggUrl(buildPartQuery(p.part.name, p.part.brand, partCategory))} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
                    Newegg <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-5" style={{ color: 'var(--ff-text)' }}>
            All {kind}s {tier.label}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>{kind}</th>
                  <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Brand</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Benchmark</th>
                  <th className="text-right py-2 pl-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {parts.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: pickIds.has(p.id) ? 'var(--ff-accent-text)' : 'var(--ff-text)' }}>
                      {p.name}
                    </td>
                    <td className="py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>{p.brand}</td>
                    <td className="text-right py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>{p.benchmark_score}</td>
                    <td className="text-right py-2 pl-3 font-bold" style={{ color: 'var(--ff-text)' }}>${p.price_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
            Prices are typical US street pricing, last updated {PRICES_UPDATED}. Benchmark scores are our relative performance index, not a specific real-world test result.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Start a Build
          </Link>
        </div>

        <div className="space-y-3 mb-10">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Other {kind} Budgets</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {related.map(r => (
              <Link key={r.slug} to={`${indexPath}/${r.slug}`}
                className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                <span>Best {kind} {r.label}</span>
                <ChevronRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
