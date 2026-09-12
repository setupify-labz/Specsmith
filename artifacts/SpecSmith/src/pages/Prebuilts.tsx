import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap } from 'lucide-react';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from '../lib/fps';
import { useAffiliatePartCatalog } from '../hooks/useAffiliatePartCatalog';
import {
  guideBuildSelection,
  guideSubtotal,
  namedCategories,
  resolveGuideSlots,
  unavailableCategories,
  LISTING_UNAVAILABLE_LABEL,
} from '../lib/guides/guideSlots';
import { builderUrlFor, hasExistingBuild, readDraft } from '../lib/guides/guideHandoff';
import {
  STALE_PRICE_LABEL,
  formatAmount,
  formatCheckedAt,
  priceView,
  subtotalLabel,
} from '../lib/retail/partPricing';
import type { AffiliatePart } from '../lib/retail/partCatalog';
import { prebuilts, getPrebuiltTotal, categoryLabels, type Prebuilt } from '../lib/prebuilts';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
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

const ACCENT_COLORS = ['#FFB300', '#6C63FF', '#00D4FF', '#00E676', '#FF6B6B'];

function useFpsPreview(prebuilt: Prebuilt) {
  return useMemo(() => {
    const gpu = gpus.find(g => g.id === prebuilt.parts.gpu);
    const cpu = cpus.find(c => c.id === prebuilt.parts.cpu);
    if (!gpu || !cpu) return [];

    return prebuilt.fps_preview_games.map(gameId => {
      const game = games.find(g => g.id === gameId);
      if (!game) return null;
      const fps = estimateFpsForBuild(gpu, cpu, game, prebuilt.fps_resolution, prebuilt.fps_preset).estimated;
      return { game: game.name, fps };
    }).filter(Boolean) as { game: string; fps: number }[];
  }, [prebuilt]);
}

function useTotalPrice(prebuilt: Prebuilt): number {
  return useMemo(() => getPrebuiltTotal(prebuilt), [prebuilt]);
}

function getFpsColor(fps: number): string {
  if (fps >= 144) return 'var(--ff-accent-text)';
  if (fps >= 90)  return 'var(--ff-cyan)';
  if (fps >= 60)  return 'var(--ff-green)';
  if (fps >= 30)  return 'var(--ff-amber)';
  return 'var(--ff-red)';
}

function PrebuiltCard({ prebuilt, index }: { prebuilt: Prebuilt; index: number }) {
  const navigate = useNavigate();
  const fpsRows = useFpsPreview(prebuilt);
  const badge = BADGE_STYLES[prebuilt.badge_color] ?? BADGE_STYLES.gray;
  const accentColor = ACCENT_COLORS[index % ACCENT_COLORS.length];

  const { view: affiliateCatalog } = useAffiliatePartCatalog();
  const catalogue = useMemo(
    () =>
      affiliateCatalog.status === 'ok'
        ? new Map<string, AffiliatePart>(affiliateCatalog.catalog.parts.map((part) => [part.id, part]))
        : new Map<string, AffiliatePart>(),
    [affiliateCatalog],
  );
  const clock = Date.now();
  const slots = useMemo(
    () => resolveGuideSlots(prebuilt.id, prebuilt.parts, catalogue),
    [prebuilt, catalogue],
  );
  const subtotal = useMemo(() => guideSubtotal(slots, clock), [slots, clock]);
  const missing = useMemo(() => unavailableCategories(slots), [slots]);
  const loadSelection = useMemo(() => guideBuildSelection(slots), [slots]);

  const [confirmingLoad, setConfirmingLoad] = useState(false);
  const handleLoad = () => {
    if (hasExistingBuild(readDraft(typeof window === 'undefined' ? undefined : window.localStorage))) {
      setConfirmingLoad(true);
      return;
    }
    navigate(builderUrlFor(loadSelection));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08 }}
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}
    >
      {/* Accent top bar */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />

      {/* Header */}
      <div className="p-6" style={{ borderBottom: '1px solid var(--ff-border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: accentColor }} />
              <h2 className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>
                <Link to={`/prebuilts/${prebuilt.id}`} className="hover:underline">{prebuilt.name}</Link>
              </h2>
              {/* Resolution + Preset badge */}
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
              >
                {prebuilt.target_resolution}
              </span>
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ff-text-2)' }}>{prebuilt.tagline}</p>
            <p className="text-sm max-w-xl" style={{ color: 'var(--ff-text-2)' }}>{prebuilt.description}</p>
          </div>
          <div className="text-right flex-shrink-0">
            {/* Summed from the exact listings below and nothing else. */}
            <div className="text-3xl font-black gradient-text" data-testid="guide-subtotal">
              {subtotal.currency === null ? '—' : formatAmount(subtotal.knownTotal, subtotal.currency)}
            </div>
            <div className="text-xs mt-0.5" data-testid="guide-subtotal-label" style={{ color: 'var(--ff-text-2)' }}>
              {subtotalLabel(subtotal)} · {subtotal.countedItems} of {slots.length} priced
            </div>
            {missing.length > 0 && (
              <div className="text-[11px] mt-0.5" data-testid="guide-missing-note" style={{ color: 'var(--ff-amber)' }}>
                No listing for {namedCategories(missing)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Parts grid — exact listings only, or an honest gap. */}
      <div
        data-testid={`guide-parts-${prebuilt.id}`}
        className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3"
        style={{ borderBottom: '1px solid var(--ff-border)' }}
      >
        {slots.map((slot) => {
          const label = categoryLabels[slot.category] ?? slot.category;
          if (slot.status !== 'available') {
            return (
              <div
                key={slot.category}
                data-testid={`guide-slot-${slot.category}`}
                data-slot-status={slot.status}
                className="rounded-lg p-3"
                style={{ backgroundColor: 'var(--ff-card)', border: '1px dashed var(--ff-border)' }}
              >
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>{label}</div>
                <div className="text-[11px] font-semibold" style={{ color: 'var(--ff-amber)' }}>
                  {LISTING_UNAVAILABLE_LABEL}
                </div>
              </div>
            );
          }
          const view = priceView(slot.part, clock);
          return (
            <div
              key={slot.category}
              data-testid={`guide-slot-${slot.category}`}
              data-slot-status="available"
              data-part-id={slot.part.id}
              className="rounded-lg p-3"
              style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
            >
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>{label}</div>
              <div className="text-xs font-medium leading-tight mb-1.5" style={{ color: 'var(--ff-text)' }}>
                {slot.part.name}
              </div>
              {view.status === 'fresh' ? (
                <>
                  <div className="text-xs font-bold" style={{ color: 'var(--ff-text)' }}>
                    {formatAmount(view.displayAmount, view.currency)}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
                    {formatCheckedAt(view.checkedAt)}
                  </div>
                </>
              ) : (
                <div className="text-[10px] font-semibold" style={{ color: 'var(--ff-text-2)' }}>{STALE_PRICE_LABEL}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* FPS Preview + CTA */}
      <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider mb-2 font-medium" style={{ color: 'var(--ff-text-2)' }}>
            FPS Preview — {prebuilt.target_resolution}
          </div>
          <div className="flex gap-6">
            {fpsRows.map(fp => (
              <div key={fp.game} className="text-center">
                <div className="text-xl font-black" style={{ color: getFpsColor(fp.fps) }}>{fp.fps}</div>
                <div className="text-xs max-w-[80px] leading-tight truncate" title={fp.game} style={{ color: 'var(--ff-text-2)' }}>{fp.game}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            to={`/prebuilts/${prebuilt.id}`}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
          >
            View Details
            <ChevronRight size={14} />
          </Link>
          <button
            type="button"
            onClick={handleLoad}
            data-testid={`guide-load-${prebuilt.id}`}
            disabled={Object.keys(loadSelection).length === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            <Zap size={16} />
            Load into Builder
          </button>
        </div>
      </div>

      {/* Asked before anything changes; cancelling writes nothing. */}
      {confirmingLoad && (
        <div
          role="alertdialog"
          aria-label="Replace your current build?"
          data-testid={`guide-load-confirm-${prebuilt.id}`}
          className="mx-6 mb-6 rounded-lg p-3"
          style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-amber)' }}
        >
          <p className="text-xs mb-2" style={{ color: 'var(--ff-text)' }}>
            You already have a build in progress. Loading this guide replaces it.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`guide-load-confirm-yes-${prebuilt.id}`}
              onClick={() => { setConfirmingLoad(false); navigate(builderUrlFor(loadSelection)); }}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white"
              style={{ background: 'var(--ff-accent-solid)' }}
            >
              Replace my build
            </button>
            <button
              type="button"
              data-testid={`guide-load-confirm-no-${prebuilt.id}`}
              onClick={() => setConfirmingLoad(false)}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold"
              style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}
            >
              Keep my build
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

const prebuiltFaqs = [
  {
    title: 'Are these 5 builds algorithmically picked, or hand-curated?',
    content: 'Hand-curated — each is a fixed, specific part list chosen to hit a clear price/performance target for its tier (from budget/office use up to no-compromise 4K), not auto-generated by the same picking logic used elsewhere on the site.',
  },
  {
    title: 'Can I customize a prebuilt before buying the parts?',
    content: 'Yes — "Load in Builder" carries the whole part list over so you can swap any individual component (a bigger GPU, more storage, a different case) while keeping the rest, then see the updated compatibility and FPS estimate.',
  },
  {
    title: 'Are the FPS numbers here calculated differently than the rest of the site?',
    content: 'No — they use the same estimation engine and dataset as the Builder and every comparison page, just pre-filled with each tier\'s fixed parts. Estimates shown use native resolution with no upscaling (DLSS/FSR/XeSS); real-world numbers with upscaling enabled will be higher.',
  },
];

function prebuiltFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: prebuiltFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

export default function Prebuilts() {
  useSeo(getRouteMeta('/prebuilts'));

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'SpecSmith Curated Gaming PC Builds',
    description: 'Expert-selected PC configurations for every budget, from entry-level to enthusiast.',
    itemListElement: prebuilts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: `${SITE_URL}/prebuilts/${p.id}`,
    })),
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(prebuiltFaqJsonLd()) }} />
      <PageGlow variant="warm" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Curated <span className="gradient-text">Builds</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Expert-selected configurations for every budget. Load any build into the builder to customize it.
          </p>
        </motion.div>

        {/* Disclaimer */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="mb-8 rounded-xl px-4 py-3 text-xs text-center"
          style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
        >
          FPS estimates use native resolution with no upscaling (DLSS/FSR/XeSS). Real-world figures with upscaling are significantly higher. Prices are estimates based on typical US street pricing — last updated {PRICES_UPDATED}.
        </motion.div>

        {/* Build cards */}
        <div className="space-y-8">
          {prebuilts.map((prebuilt, i) => (
            <PrebuiltCard key={prebuilt.id} prebuilt={prebuilt} index={i} />
          ))}
        </div>

        <div className="mt-12 space-y-3 max-w-3xl mx-auto">
          {prebuiltFaqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
