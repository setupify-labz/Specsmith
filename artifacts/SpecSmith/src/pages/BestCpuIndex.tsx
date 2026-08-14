import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu as CpuIcon } from 'lucide-react';
import { CPU_GAME_PAGES } from '../lib/cpuGamePages';
import { getPageGame, getGamePageTitle } from '../lib/gamePages';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const faqs = [
  {
    title: `How many games does this cover?`,
    content: `${CPU_GAME_PAGES.length} popular titles, from CPU-heavy esports games like Valorant and CS2 to open-world titles like Cyberpunk 2077 and Starfield. Each game's page ranks CPUs by estimated FPS specifically for that title's performance profile.`,
  },
  {
    title: 'Why is every game tested with the same RTX 4090?',
    content: 'CPU differences only show up clearly when the GPU isn\'t the bottleneck. Pairing every CPU with a flagship RTX 4090 isolates CPU performance so the rankings reflect the processor, not the graphics card — with your actual GPU, gains from a faster CPU may be smaller.',
  },
  {
    title: "What if my game isn't listed here?",
    content: 'Use the Builder to estimate FPS for any CPU paired with any of the other games in our dataset, or the CPU Tier List for a game-agnostic ranking of every chip we track.',
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

export default function BestCpuIndex() {
  useSeo(getRouteMeta('/best-cpu'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best CPU <span className="gradient-text">by Game</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Pick the game you actually play. We rank 15 CPUs from budget to flagship, paired with an
            RTX 4090 to isolate CPU performance — with honest value picks for GPU-bound titles.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CPU_GAME_PAGES.map((p, i) => {
            const game = getPageGame(p.gameId);
            return (
              <motion.div key={p.slug}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 6) * 0.05 }}>
                <Link to={`/best-cpu/${p.slug}`}
                  className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-3">
                    <CpuIcon size={16} style={{ color: 'var(--ff-cyan)' }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>
                        Best CPU for {getGamePageTitle(p)}
                      </span>
                      {game && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{game.genre}</p>
                      )}
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
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
            Playing something else? Estimate FPS for any GPU + CPU combo in the Builder.
          </p>
          <Link to="/builder"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Open the Builder <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
