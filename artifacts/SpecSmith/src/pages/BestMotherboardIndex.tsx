import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, CircuitBoard } from 'lucide-react';
import { SOCKET_PAGES, getMotherboardsForSocket } from '../lib/motherboardPages';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const faqs = [
  {
    title: 'How do I know which socket my CPU uses?',
    content: 'Check your CPU\'s product page or box — AMD\'s current desktop chips use AM5 or the older AM4, while Intel\'s current chips use LGA1700 or LGA1851. Picking the wrong socket is the single most common compatibility mistake, which is why every motherboard here is filtered by socket first.',
  },
  {
    title: 'What do "budget, sweet-spot, and high-end" picks mean?',
    content: 'Each socket page highlights the cheapest board that supports the platform, the best balance of price and features, and the highest-end board we track — so you can match the motherboard tier to how much you\'re spending on the rest of the build.',
  },
  {
    title: 'Will any motherboard for my socket work with any CPU for that socket?',
    content: 'Socket match is necessary but not always sufficient — BIOS version, RAM speed support, and power delivery can still vary between boards. Load your specific CPU and motherboard into the Builder to get a full compatibility check, not just a socket match.',
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

export default function BestMotherboardIndex() {
  useSeo(getRouteMeta('/best-motherboard'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best Motherboards <span className="gradient-text">by Platform</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick your CPU's socket to see every motherboard we track for that platform, with budget, sweet-spot, and high-end picks.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCKET_PAGES.map((p, i) => {
            const count = getMotherboardsForSocket(p.socket).length;
            return (
              <motion.div key={p.slug}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}>
                <Link to={`/best-motherboard/${p.slug}`}
                  className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-3">
                    <CircuitBoard size={16} style={{ color: 'var(--ff-accent)' }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{p.label}</span>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{count} boards tracked</p>
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
