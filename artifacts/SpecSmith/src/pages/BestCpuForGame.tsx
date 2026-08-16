import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ChevronRight, Cpu as CpuIcon, ExternalLink } from 'lucide-react';
import {
  getCpuGamePage, getCpuGamePicks, getGameCpuRows, getCpuGameIntro,
  getRelatedCpuGamePages, getCpuGamePageMeta,
} from '../lib/cpuGamePages';
import { getPageGame, getGamePageTitle } from '../lib/gamePages';
import { getMatchupFixedGpu } from '../lib/matchups';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { SITE_URL } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import PageGlow from '../components/PageGlow';

export default function BestCpuForGame() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getCpuGamePage(slug) : undefined;
  const game = page ? getPageGame(page.gameId) : undefined;
  const gpu = getMatchupFixedGpu();

  const fallbackMeta = {
    path: '/best-cpu',
    title: 'Game Not Found | SpecSmith',
    description: 'This game page could not be found. Browse best-CPU picks for all 20 games instead.',
    noindex: true,
  };
  useSeo(page && game ? getCpuGamePageMeta(page) : fallbackMeta);

  if (!page || !game) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Game not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have a page for this game yet.</p>
          <Link to="/best-cpu" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse All Games
          </Link>
        </div>
      </div>
    );
  }

  const picks = getCpuGamePicks(game);
  const rows = getGameCpuRows(game);
  const intro = getCpuGameIntro(game);
  const related = getRelatedCpuGamePages(page);
  const pickIds = new Set(picks.map(p => p.cpu.id));
  const valuePick = picks.find(p => p.label === 'Best Value')!;
  const overallPick = picks.find(p => p.label === 'Best Overall');

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Best CPU for ${game.name}`,
    description: `CPUs ranked by ${game.name} performance, from flagship to budget.`,
    itemListElement: rows.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.cpu.name,
      url: `${SITE_URL}/builder?cpu=${r.cpu.id}`,
    })),
  };

  const faqs = [
    {
      title: `What's the best CPU for ${game.name}?`,
      content: overallPick
        ? `The ${overallPick.cpu.name} tops our ${game.name} FPS ranking at $${overallPick.cpu.price_usd}. If you don't need the absolute fastest, the ${valuePick.cpu.name} delivers the best FPS-per-dollar of the ${rows.length} CPUs we compared.`
        : `The ${valuePick.cpu.name} delivers the best FPS-per-dollar of the ${rows.length} CPUs we compared for ${game.name}.`,
    },
    {
      title: `Why is every CPU paired with the same ${gpu.name}?`,
      content: `Pairing every CPU with a flagship ${gpu.name} isolates CPU performance so the rankings reflect the processor, not the graphics card. With a weaker GPU, the gap between these CPUs would shrink — the GPU becomes the bigger bottleneck instead.`,
    },
    {
      title: 'How accurate are these FPS estimates?',
      content: `They're built from a transparent tier-based algorithm (explained in full on the About page) — a planning guide for comparing CPUs before you buy, not a guarantee of exact real-world performance. Actual FPS varies by RAM speed, game patch, and in-game settings beyond the High preset used here.`,
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
        <Link to="/best-cpu" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← Best CPU by Game
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best CPU for <span className="gradient-text">{game.name}</span>
          </h1>
          <p className="text-base max-w-3xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {intro}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {picks.map(p => (
            <div key={p.label} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ff-text-2)' }}>{p.emoji} {p.label}</p>
              <p className="text-lg font-black mb-1" style={{ color: 'var(--ff-accent-text)' }}>{p.cpu.name}</p>
              <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--ff-text-3)' }}>{p.detail}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.cpu.price_usd}</span>
                <a href={getAffiliateUrl(buildPartQuery(p.cpu.name, p.cpu.brand, 'cpu'))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                  Amazon <ExternalLink size={10} />
                </a>
                <a href={getNeweggUrl(buildPartQuery(p.cpu.name, p.cpu.brand, 'cpu'))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
                  Newegg <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold flex items-center gap-2 mb-5" style={{ color: 'var(--ff-text)' }}>
            <Zap size={16} style={{ color: 'var(--ff-accent)' }} />
            {game.name} FPS by CPU — High Settings, paired with {gpu.name}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>CPU</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>Price</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>1080p</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>1440p</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>4K</th>
                  <th className="text-right py-2 pl-3 font-medium" style={{ color: 'var(--ff-text-2)' }}>FPS/$100</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isPick = pickIds.has(r.cpu.id);
                  const badges = picks.filter(p => p.cpu.id === r.cpu.id).map(p => p.emoji).join(' ');
                  return (
                    <tr key={r.cpu.id} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                      <td className="py-2 pr-4 font-medium" style={{ color: isPick ? 'var(--ff-accent-text)' : 'var(--ff-text)' }}>
                        {r.cpu.name}{badges ? ` ${badges}` : ''}
                      </td>
                      <td className="text-right py-2 px-3" style={{ color: 'var(--ff-text-2)' }}>${r.cpu.price_usd}</td>
                      <td className="text-right py-2 px-3 font-bold" style={{ color: 'var(--ff-text)' }}>{r.fps1080}</td>
                      <td className="text-right py-2 px-3 font-bold" style={{ color: 'var(--ff-text)' }}>{r.fps1440}</td>
                      <td className="text-right py-2 px-3 font-bold" style={{ color: 'var(--ff-text)' }}>{r.fps4k}</td>
                      <td className="text-right py-2 pl-3" style={{ color: 'var(--ff-text-2)' }}>{r.valuePer100}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
            Estimates assume High settings at native resolution with no upscaling (DLSS/FSR/XeSS), paired with an
            {' '}{gpu.name} so the CPU is the bottleneck wherever the game allows it. Real-world results vary by RAM
            speed, game patch, and system configuration. Prices are typical US street pricing, last updated {PRICES_UPDATED}.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to={`/builder?cpu=${valuePick.cpu.id}`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <CpuIcon size={15} /> Build Around the {valuePick.cpu.name}
          </Link>
          <Link to="/compare"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            Compare Any Two Builds <ChevronRight size={14} />
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

        {related.length > 0 && (
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Best CPU for Other Games</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map(r => (
                <Link key={r.slug} to={`/best-cpu/${r.slug}`}
                  className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                  <span>Best CPU for {getGamePageTitle(r)}</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
