import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Swords, Cpu } from 'lucide-react';
import {
  MATCHUPS, CPU_MATCHUPS,
  getMatchupGpu, getMatchupCpuById, getMatchupTitle, getCpuMatchupTitle,
} from '../lib/matchups';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import PageGlow from '../components/PageGlow';

interface Card {
  slug: string;
  title: string;
  priceA?: number;
  priceB?: number;
}

function MatchupGrid({ cards, icon }: { cards: Card[]; icon: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((c, i) => (
        <motion.div key={c.slug}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: (i % 6) * 0.05 }}>
          <Link to={`/vs/${c.slug}`}
            className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
            style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <div className="flex items-center gap-3">
              {icon}
              <div>
                <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{c.title}</span>
                {c.priceA != null && c.priceB != null && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>
                    ${c.priceA} vs ${c.priceB}
                  </p>
                )}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

export default function GpuMatchupIndex() {
  useSeo(getRouteMeta('/vs'));

  const gpuCards: Card[] = MATCHUPS.map(m => ({
    slug: m.slug,
    title: getMatchupTitle(m),
    priceA: getMatchupGpu(m.gpuA)?.price_usd,
    priceB: getMatchupGpu(m.gpuB)?.price_usd,
  }));
  const cpuCards: Card[] = CPU_MATCHUPS.map(m => ({
    slug: m.slug,
    title: getCpuMatchupTitle(m),
    priceA: getMatchupCpuById(m.cpuA)?.price_usd,
    priceB: getMatchupCpuById(m.cpuB)?.price_usd,
  }));

  const toListItems = (cards: Card[]) => cards.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.title,
    url: `${SITE_URL}/vs/${c.slug}`,
  }));

  const faqs = [
    {
      title: 'How are these matchups picked?',
      content: `The ${gpuCards.length} GPU and ${cpuCards.length} CPU matchups here are curated around parts people actually cross-shop — same price tier, same generation, or a common "should I upgrade" pairing. Don't see the exact two parts you're deciding between? Use Open Build Comparison below to compare any GPU + CPU combo directly.`,
    },
    {
      title: 'What do the FPS numbers on each matchup page mean?',
      content: 'Each matchup estimates FPS across 20 games at 1080p, 1440p, and 4K, with the other component (GPU or CPU) held fixed so the comparison isolates the part being compared. Full methodology is on the About page.',
    },
    {
      title: 'Is "better value" the same as "faster"?',
      content: 'No — each matchup page reports both separately. The FPS winner is whichever part scores higher average FPS; the value winner is whichever delivers more FPS per $100 spent. They\'re often different parts, and both numbers are shown side by side so you can decide which matters more for your budget.',
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

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        name: 'GPU Head-to-Head Comparisons',
        description: 'GPU matchups compared across 20 games at 1080p, 1440p, and 4K.',
        itemListElement: toListItems(gpuCards),
      },
      {
        '@type': 'ItemList',
        name: 'CPU Head-to-Head Comparisons',
        description: 'CPU matchups compared across 20 games at 1080p, 1440p, and 4K.',
        itemListElement: toListItems(cpuCards),
      },
    ],
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            GPU & CPU <span className="gradient-text">Comparisons</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Head-to-head FPS comparisons across 20 games at 1080p, 1440p, and 4K — with specs and price-per-frame value.
          </p>
        </motion.div>

        <h2 className="text-xl font-black mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <Swords size={18} style={{ color: 'var(--ff-accent)' }} /> GPU Matchups
        </h2>
        <MatchupGrid cards={gpuCards} icon={<Swords size={16} style={{ color: 'var(--ff-accent)' }} />} />

        <h2 className="text-xl font-black mb-4 mt-12 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <Cpu size={18} style={{ color: 'var(--ff-cyan)' }} /> CPU Matchups
        </h2>
        <MatchupGrid cards={cpuCards} icon={<Cpu size={16} style={{ color: 'var(--ff-cyan)' }} />} />

        <div className="space-y-3 mt-12">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
            Don't see your matchup? Compare any two GPU + CPU combos in the full tool.
          </p>
          <Link to="/compare"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Open Build Comparison <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
