import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, ExternalLink } from 'lucide-react';
import { getComponentGuide, getComponentGuideMeta, type GuideCategory } from '../lib/componentGuides';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { SITE_URL } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function ComponentGuidePage({ category }: { category: GuideCategory }) {
  const guide = getComponentGuide(category);
  useSeo(guide ? getComponentGuideMeta(guide) : { path: '/', title: 'SpecSmith', description: 'Free PC Builder and FPS Estimator.', noindex: true });

  if (!guide) return null;

  const pickIds = new Set(guide.picks.map(p => p.item.id));
  const sortedItems = [...guide.items].sort((a, b) => a.price_usd - b.price_usd);

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: guide.title,
    description: guide.blurb,
    itemListElement: sortedItems.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: `${SITE_URL}/builder?${guide.category}=${item.id}`,
    })),
  };

  const faqs = [
    {
      title: `How do I pick the right ${guide.categoryLabel}?`,
      content: guide.blurb,
    },
    {
      title: `How many ${guide.categoryLabel} options do you track, and how are the picks chosen?`,
      content: `We track ${guide.items.length} ${guide.categoryLabel} options. The picks above (${guide.picks.map(p => p.label).join(', ')}) are computed directly from that tracked list — by price, spec extremes, or capacity-per-dollar depending on the pick — not sponsored placements.`,
    },
    {
      title: 'Are these prices up to date?',
      content: `Prices are typical US street pricing, last updated ${PRICES_UPDATED}.`,
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            {guide.title.split(' for ')[0]} <span className="gradient-text">for {guide.title.split(' for ')[1] ?? 'Gaming'}</span>
          </h1>
          <p className="text-base max-w-3xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {guide.blurb}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {guide.picks.map(p => (
            <div key={p.label} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ff-text-2)' }}>{p.emoji} {p.label}</p>
              <p className="text-lg font-black mb-1" style={{ color: 'var(--ff-accent-text)' }}>{p.item.name}</p>
              <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--ff-text-3)' }}>{p.detail}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.item.price_usd}</span>
                <a href={getAffiliateUrl(buildPartQuery(p.item.name, p.item.brand, guide.category))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                  Amazon <ExternalLink size={10} />
                </a>
                <a href={getNeweggUrl(buildPartQuery(p.item.name, p.item.brand, guide.category))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
                  Newegg <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-5" style={{ color: 'var(--ff-text)' }}>
            All {guide.categoryLabel} We Track
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>{guide.categoryLabel}</th>
                  {guide.columns.map(c => (
                    <th key={c.key} className="text-left py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>{c.label}</th>
                  ))}
                  <th className="text-right py-2 pl-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: pickIds.has(item.id) ? 'var(--ff-accent-text)' : 'var(--ff-text)' }}>
                      {item.name}
                    </td>
                    {guide.columns.map(c => (
                      <td key={c.key} className="py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>
                        {c.format ? c.format(item[c.key]) : String(item[c.key] ?? '—')}
                      </td>
                    ))}
                    <td className="text-right py-2 pl-3 font-bold" style={{ color: 'var(--ff-text)' }}>${item.price_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
            Prices are typical US street pricing, last updated {PRICES_UPDATED}.
          </p>
        </div>

        <div className="space-y-3 mb-10">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Start a Build
          </Link>
        </div>
      </div>
    </div>
  );
}
