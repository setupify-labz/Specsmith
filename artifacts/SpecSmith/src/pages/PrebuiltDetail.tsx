import { useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap, ArrowLeft } from 'lucide-react';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from '../lib/fps';
import { prebuilts, getPartPrice, getPartName, getPrebuiltTotal, categoryLabels, getPrebuiltMeta } from '../lib/prebuilts';
import { PRICES_UPDATED } from '../lib/prices';
import { ESTIMATED_PREFIX } from '../lib/retail/importedBuild';
import {
  CHOOSE_CURRENT_LISTING_LABEL,
  chooseCurrentListingLabel,
  guidePlanUrl,
  isShoppableCategory,
} from '../lib/retail/guidePlanHandoff';
import { useSeo } from '../hooks/useSeo';
import { SITE_URL } from '../lib/seo';
import PageGlow from '../components/PageGlow';

interface GPU { id: string; name: string; price_usd: number; gpu_multiplier: number; [key: string]: unknown; }
interface CPU { id: string; name: string; price_usd: number; cpu_multiplier: number; [key: string]: unknown; }
interface Game { id: string; name: string; gpu_bound?: number; base_fps: Record<string, Record<string, number>>; [key: string]: unknown; }

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

const BADGE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  gray:   { bg: 'rgba(136,136,170,0.12)', color: 'var(--ff-text-2)', border: 'rgba(136,136,170,0.3)' },
  blue:   { bg: 'rgba(0,212,255,0.12)',   color: 'var(--ff-cyan)', border: 'rgba(0,212,255,0.3)'   },
  purple: { bg: 'rgba(108,99,255,0.12)',  color: 'var(--ff-accent-text)', border: 'rgba(108,99,255,0.3)'  },
  amber:  { bg: 'rgba(255,179,0,0.12)',   color: 'var(--ff-amber)', border: 'rgba(255,179,0,0.3)'   },
  gold:   { bg: 'rgba(255,179,0,0.18)',   color: 'var(--ff-gold)', border: 'rgba(255,215,0,0.4)'   },
};

function getFpsColor(fps: number): string {
  if (fps >= 144) return 'var(--ff-accent-text)';
  if (fps >= 90)  return 'var(--ff-cyan)';
  if (fps >= 60)  return 'var(--ff-green)';
  if (fps >= 30)  return 'var(--ff-amber)';
  return 'var(--ff-red)';
}

export default function PrebuiltDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const prebuilt = prebuilts.find(p => p.id === slug);

  const fallbackMeta = {
    path: '/prebuilts',
    title: 'Build Not Found | SpecSmith',
    description: 'This curated build could not be found. Browse all curated SpecSmith PC builds instead.',
    noindex: true,
  };
  useSeo(prebuilt ? getPrebuiltMeta(prebuilt) : fallbackMeta);

  const fpsRows = useMemo(() => {
    if (!prebuilt) return [];
    const gpu = gpus.find(g => g.id === prebuilt.parts.gpu);
    const cpu = cpus.find(c => c.id === prebuilt.parts.cpu);
    if (!gpu || !cpu) return [];
    return games.map(g => {
      const fps = estimateFpsForBuild(gpu, cpu, g, prebuilt.fps_resolution, prebuilt.fps_preset).estimated;
      return { game: g.name, fps };
    }).sort((a, b) => b.fps - a.fps);
  }, [prebuilt]);

  const totalPrice = useMemo(() => prebuilt ? getPrebuiltTotal(prebuilt) : 0, [prebuilt]);

  if (!prebuilt) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Build not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>This build guide doesn't exist.</p>
          <Link to="/prebuilts" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse Curated Builds
          </Link>
        </div>
      </div>
    );
  }

  const badge = BADGE_STYLES[prebuilt.badge_color] ?? BADGE_STYLES.gray;

  const handleLoad = () => navigate(guidePlanUrl(prebuilt.parts));

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${prebuilt.name} — Components`,
    description: prebuilt.description,
    itemListElement: Object.entries(prebuilt.parts).map(([cat, id], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: getPartName(cat, id),
      url: `${SITE_URL}/builder?${cat}=${id}`,
    })),
  };

  const bestFps = fpsRows[0];
  const worstFps = fpsRows[fpsRows.length - 1];
  const avgFps = fpsRows.length > 0 ? Math.round(fpsRows.reduce((s, r) => s + r.fps, 0) / fpsRows.length) : 0;

  const faqs = [
    {
      title: `What FPS can I expect from the ${prebuilt.name}?`,
      content: fpsRows.length > 0
        ? `Averages ${avgFps} estimated FPS at ${prebuilt.target_resolution} across ${fpsRows.length} games — from ${bestFps.fps} FPS in ${bestFps.game} down to ${worstFps.fps} FPS in ${worstFps.game}, depending on how demanding the game is.`
        : `FPS estimates for this build aren't available.`,
    },
    {
      title: `How much does the ${prebuilt.name} cost?`,
      content: `An estimated $${totalPrice.toLocaleString()} total for every component listed above, based on typical US street pricing last updated ${PRICES_UPDATED}. That's a planning estimate, not a live cart total. Use "Choose current listing" on any part to open it in the Builder, where each retailer listing carries the price observed for that exact SKU and a direct link to it.`,
    },
    {
      title: 'Can I swap parts in this build?',
      content: 'Yes — click "Use this plan in Builder" to load these recommended models so you can choose current retailer listings and customize the build. The Builder shows compatibility checks and FPS estimates as you go.',
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
      <PageGlow variant="warm" />
      <div className="relative max-w-4xl mx-auto px-4">
        <Link
          to="/prebuilts"
          className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}
        >
          <ArrowLeft size={14} /> Back to Curated Builds
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
              >
                {prebuilt.target_resolution}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>{prebuilt.name}</h1>
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--ff-text-2)' }}>{prebuilt.tagline}</p>
            <p className="text-sm max-w-2xl" style={{ color: 'var(--ff-text-2)' }}>{prebuilt.description}</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Components</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(prebuilt.parts).map(([cat, id]) => {
                    const name = getPartName(cat, id);
                    const price = getPartPrice(cat, id);
                    return (
                      <div key={cat} data-testid={`guide-part-${cat}`} className="rounded-lg p-3" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>
                          {categoryLabels[cat]}
                        </div>
                        <div className="text-xs font-medium leading-tight mb-1.5" style={{ color: 'var(--ff-text)' }}>{name}</div>
                        {/* LABELLED WHERE IT IS READ. Our editorial estimate,
                            which used to sit bare beside a "Buy on Amazon"
                            link — the one context in which a reader is
                            entitled to take it for a checkout price. */}
                        <div
                          className="text-[11px] font-semibold mb-2"
                          data-testid={`guide-price-${cat}`}
                          style={{ color: 'var(--ff-text-2)' }}
                        >
                          {ESTIMATED_PREFIX} ${price.toLocaleString()}
                          <span className="font-normal" style={{ color: 'var(--ff-text-3)' }}> · {PRICES_UPDATED}</span>
                        </div>
                        {/* A LINK, NOT A BUTTON. It navigates, so middle-click
                            and ctrl-click must open a tab, "copy link address"
                            must work, and a screen reader must hear a link. */}
                        {isShoppableCategory(cat) && (
                          <Link
                            to={guidePlanUrl(prebuilt.parts, cat)}
                            data-testid={`guide-choose-${cat}`}
                            data-category={cat}
                            aria-label={chooseCurrentListingLabel(cat, name)}
                            className="ff-accent-control inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold"
                            style={{ color: 'var(--ff-accent-text)', border: '1px solid var(--ff-border)' }}
                          >
                            {CHOOSE_CURRENT_LISTING_LABEL}
                            <ChevronRight size={10} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <h2 className="font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
                  <Zap size={16} style={{ color: 'var(--ff-accent)' }} />
                  FPS Estimates — {prebuilt.target_resolution}
                </h2>
                <div className="space-y-2">
                  {fpsRows.map((row, i) => (
                    <motion.div
                      key={row.game}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-center justify-between py-1.5"
                      style={{ borderBottom: '1px solid var(--ff-border)' }}
                    >
                      <span className="text-sm" style={{ color: 'var(--ff-text)' }}>{row.game}</span>
                      <span className="text-sm font-bold" style={{ color: getFpsColor(row.fps) }}>{row.fps} FPS</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="mb-4">
                  {/* The date belongs beside the number, not only in an FAQ —
                      an estimate with no age reads as a live price. */}
                  <p className="text-xs" data-testid="guide-total-label" style={{ color: 'var(--ff-text-2)' }}>
                    Estimated total · {PRICES_UPDATED}
                  </p>
                  <p className="text-3xl font-black" data-testid="guide-total" style={{ color: 'var(--ff-text)' }}>${totalPrice.toLocaleString()}</p>
                </div>
                <button
                  onClick={handleLoad}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                >
                  {/* NOT "this exact build". The button hands the Builder
                      canonical MODEL ids, and the Builder shows them as a plan
                      of recommendations until the shopper picks actual
                      listings. Calling that an exact build promised a
                      purchasable cart and delivered a planning list. */}
                  <Zap size={15} /> Use this plan in Builder <ChevronRight size={14} />
                </button>
              </div>

              <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>More Curated Builds</h2>
                <div className="space-y-2">
                  {prebuilts.filter(p => p.id !== prebuilt.id).map(p => (
                    <Link
                      key={p.id}
                      to={`/prebuilts/${p.id}`}
                      className="flex items-center justify-between text-sm py-1.5 transition-colors"
                      style={{ color: 'var(--ff-text-2)' }}
                    >
                      <span>{p.name}</span>
                      <ChevronRight size={14} />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 mt-6">
            {faqs.map((f) => (
              <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
                <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
