import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, ExternalLink } from 'lucide-react';
import { getSocketPage, getMotherboardsForSocket, getMotherboardPicks, getSocketPageMeta, SOCKET_PAGES } from '../lib/motherboardPages';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { SITE_URL } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function BestMotherboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getSocketPage(slug) : undefined;

  const fallbackMeta = {
    path: '/best-motherboard',
    title: 'Platform Not Found | SpecSmith',
    description: 'This motherboard guide could not be found. Browse all platforms instead.',
    noindex: true,
  };
  useSeo(page ? getSocketPageMeta(page) : fallbackMeta);

  if (!page) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Platform not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have a guide for this platform yet.</p>
          <Link to="/best-motherboard" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse All Platforms
          </Link>
        </div>
      </div>
    );
  }

  const boards = getMotherboardsForSocket(page.socket);
  const picks = getMotherboardPicks(page.socket);
  const pickIds = new Set(picks.map(p => p.motherboard.id));
  const related = SOCKET_PAGES.filter(p => p.slug !== page.slug);

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Best ${page.label} Motherboards`,
    description: page.blurb,
    itemListElement: boards.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.name,
      url: `${SITE_URL}/builder?motherboard=${b.id}`,
    })),
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <Link to="/best-motherboard" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All Platforms
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best <span className="gradient-text">{page.label}</span> Motherboards
          </h1>
          <p className="text-base max-w-3xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {page.blurb}
          </p>
        </motion.div>

        {picks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {picks.map(p => (
              <div key={p.label} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ff-text-2)' }}>{p.emoji} {p.label}</p>
                <p className="text-lg font-black mb-1" style={{ color: 'var(--ff-accent-text)' }}>{p.motherboard.name}</p>
                <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--ff-text-3)' }}>{p.detail}</p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.motherboard.price_usd}</span>
                  <a href={getAffiliateUrl(buildPartQuery(p.motherboard.name, p.motherboard.brand, 'motherboard'))} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                    Amazon <ExternalLink size={10} />
                  </a>
                  <a href={getNeweggUrl(buildPartQuery(p.motherboard.name, p.motherboard.brand, 'motherboard'))} target="_blank" rel="noopener noreferrer"
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
            All {page.label} Motherboards We Track
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>Motherboard</th>
                  <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Form Factor</th>
                  <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>RAM</th>
                  <th className="text-right py-2 pl-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {boards.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: pickIds.has(b.id) ? 'var(--ff-accent-text)' : 'var(--ff-text)' }}>
                      {b.name}
                    </td>
                    <td className="py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>{b.form_factor}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>{b.supported_ram.join('/')}</td>
                    <td className="text-right py-2 pl-3 font-bold" style={{ color: 'var(--ff-text)' }}>${b.price_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
            Prices are typical US street pricing, last updated {PRICES_UPDATED}.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Start a Build
          </Link>
        </div>

        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Other Platforms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {related.map(r => (
              <Link key={r.slug} to={`/best-motherboard/${r.slug}`}
                className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                <span>Best {r.label} Motherboards</span>
                <ChevronRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
