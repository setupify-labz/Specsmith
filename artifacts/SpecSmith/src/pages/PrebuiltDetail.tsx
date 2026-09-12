import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap, ArrowLeft } from 'lucide-react';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from '../lib/fps';
import { prebuilts, getPrebuiltMeta } from '../lib/prebuilts';
import { useAffiliatePartCatalog } from '../hooks/useAffiliatePartCatalog';
import GuidePartRow from '../components/guides/GuidePartRow';
import {
  CATALOGUE_FAILED,
  CATALOGUE_LOADING,
  LISTINGS_UNCHECKABLE_LABEL,
  RETRY_LISTINGS_LABEL,
  catalogueReady,
  guideBuildSelection,
  guideSubtotal,
  isGuidePending,
  namedCategories,
  resolveGuideSlots,
  unavailableCategories,
  type GuideCatalogue,
} from '../lib/guides/guideSlots';
import { builderUrlFor, hasExistingBuild, readDraft } from '../lib/guides/guideHandoff';
import { formatAmount, subtotalLabel } from '../lib/retail/partPricing';
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
  const { view: affiliateCatalog, retry: retryCatalog } = useAffiliatePartCatalog();
  /**
   * A FAILED OR PENDING FETCH IS NOT A CATALOGUE. Collapsing both into an
   * empty map made every bound slot resolve as delisted, so a guide opened
   * during a failed download announced that all of its products were
   * unavailable — a statement about the world inferred from our own network.
   */
  const catalogue = useMemo<GuideCatalogue>(
    () =>
      affiliateCatalog.status === 'ok'
        ? catalogueReady(new Map(affiliateCatalog.catalog.parts.map((part) => [part.id, part])))
        : affiliateCatalog.status === 'loading'
          ? CATALOGUE_LOADING
          : CATALOGUE_FAILED,
    [affiliateCatalog],
  );
  const clock = Date.now();

  const fallbackMeta = {
    path: '/prebuilts',
    title: 'Build Not Found | SpecSmith',
    description: 'This curated build could not be found. Browse all curated SpecSmith PC builds instead.',
    noindex: true,
  };
  useSeo(prebuilt ? getPrebuiltMeta(prebuilt) : fallbackMeta);

  /**
   * The guide's slots, read against the catalogue the shopper would buy from.
   *
   * Resolved here rather than in the row, so the parts grid, the subtotal and
   * the Builder handoff all describe one reading of one catalogue.
   *
   * ABOVE THE not-found RETURN, with every other hook. These sat below it and
   * the page rendered a different number of hooks depending on whether the
   * slug matched — fine while every slug matched, and a blank page with React
   * error #300 the moment one did not. Found by loading a guide in the
   * production build, not by a test.
   */
  const slots = useMemo(
    () => (prebuilt ? resolveGuideSlots(prebuilt.id, prebuilt.parts, catalogue) : []),
    [prebuilt, catalogue],
  );
  const subtotal = useMemo(() => guideSubtotal(slots, clock), [slots, clock]);
  const missing = useMemo(() => unavailableCategories(slots), [slots]);
  const loadSelection = useMemo(() => guideBuildSelection(slots), [slots]);

  /**
   * Loading asks first when there is something to lose.
   *
   * Overwriting a build a shopper has spent time on is not recoverable from
   * the page, so the question is asked before anything changes, and cancelling
   * leaves the draft exactly as it was — this component never writes to it.
   */
  /**
   * Where a confirmed load should go, or null when nothing is pending.
   *
   * Holding the destination rather than a boolean is what lets the SAME
   * confirmation serve both "Load into Builder" and a slot's "Choose
   * replacement in Builder" — both replace the shopper's current build, so
   * both have to ask.
   */
  const [pendingLoadHref, setPendingLoadHref] = useState<string | null>(null);

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

  const loadHref = builderUrlFor(loadSelection);

  /**
   * Loading asks first when there is something to lose.
   *
   * Overwriting a build a shopper has spent time on is not recoverable from
   * the page, so the question is asked before anything changes, and cancelling
   * leaves the draft exactly as it was — this component never writes to it.
   */
  const buildInProgress = () =>
    hasExistingBuild(readDraft(typeof window === 'undefined' ? undefined : window.localStorage));

  const handleLoad = () => {
    if (buildInProgress()) {
      setPendingLoadHref(loadHref);
      return;
    }
    navigate(loadHref);
  };

  /** Returns true when the replacement link must not navigate on its own. */
  const interceptReplacement = (href: string) => () => {
    if (!buildInProgress()) return false;
    setPendingLoadHref(href);
    return true;
  };

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${prebuilt.name} — Components`,
    description: prebuilt.description,
    // Only the slots with a real listing. Publishing a model name as a
    // ListItem would put a product in structured data that nobody can buy.
    itemListElement: slots
      .filter((slot) => slot.status === 'available')
      .map((slot, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: slot.status === 'available' ? slot.part.name : '',
        url: `${SITE_URL}${builderUrlFor(loadSelection, slot.category)}`,
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
      content: subtotal.currency === null
        ? 'No current retailer listings are bound to this guide yet, so there is no subtotal to show. Each part says whether a listing is available.'
        : `${formatAmount(subtotal.knownTotal, subtotal.currency)} across the ${subtotal.countedItems} part${subtotal.countedItems === 1 ? '' : 's'} that currently have a Newegg listing, summed from those listings and shown with the time each price was checked.${missing.length > 0 ? ` No current listing for ${namedCategories(missing)}, so ${missing.length === 1 ? 'it is' : 'they are'} not in the figure.` : ''}`,
    },
    {
      title: 'Can I swap parts in this build?',
      content: 'Yes — "Load into Builder" puts this guide\'s current retailer listings into the Builder as ordinary selected parts, with a subtotal calculated from those listings. You can remove or replace any of them, and any part with no current listing arrives empty for you to fill. The Builder shows compatibility checks and FPS estimates as you go.',
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
                {/* A FAILURE SAYS SO, AND OFFERS THE ONE ACTION THAT HELPS.
                    Without this the slots read "Checking current listing…"
                    forever: the shopper waits for an answer that is not
                    coming and is never given a way to ask again. */}
                {catalogue.status === 'failed' && (
                  <div
                    data-testid="guide-listings-unavailable"
                    role="status"
                    className="mb-3 flex flex-wrap items-center gap-3 rounded-lg p-3"
                    style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-amber)' }}
                  >
                    <span className="text-xs font-semibold" style={{ color: 'var(--ff-amber)' }}>
                      {LISTINGS_UNCHECKABLE_LABEL}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--ff-text-2)' }}>
                      Current prices and availability could not be loaded. Nothing below is a
                      claim that a product is gone.
                    </span>
                    <button
                      type="button"
                      data-testid="guide-listings-retry"
                      onClick={retryCatalog}
                      className="ff-accent-control rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                      style={{ color: 'var(--ff-accent-text)', border: '1px solid var(--ff-border)' }}
                    >
                      {RETRY_LISTINGS_LABEL}
                    </button>
                  </div>
                )}
                {missing.length > 0 && (
                  <p
                    className="mb-3 text-xs font-medium"
                    data-testid="guide-missing-note"
                    role="status"
                    style={{ color: 'var(--ff-amber)' }}
                  >
                    No current listing for {namedCategories(missing)}. Those parts are not in the
                    subtotal and are left empty when you load this guide.
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="guide-components">
                  {slots.map((slot) => (
                    <GuidePartRow
                      key={slot.category}
                      state={slot}
                      now={clock}
                      replacementHref={builderUrlFor(loadSelection, slot.category)}
                      onReplacementIntercept={interceptReplacement(
                        builderUrlFor(loadSelection, slot.category),
                      )}
                    />
                  ))}
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
                {/* SUMMED FROM THE EXACT LISTINGS ABOVE, and from nothing
                    else. A slot with no listing is a hole in this figure, and
                    the label says "Known-price subtotal" rather than pretending
                    an editorial estimate closed the gap. */}
                <div className="mb-4">
                  <p className="text-xs" data-testid="guide-subtotal-label" style={{ color: 'var(--ff-text-2)' }}>
                    {subtotalLabel(subtotal)}
                  </p>
                  <p className="text-3xl font-black" data-testid="guide-subtotal" style={{ color: 'var(--ff-text)' }}>
                    {subtotal.currency === null
                      ? '—'
                      : formatAmount(subtotal.knownTotal, subtotal.currency)}
                  </p>
                  <p className="text-[11px] mt-0.5" data-testid="guide-subtotal-detail" style={{ color: 'var(--ff-text-3)' }}>
                    {subtotal.countedItems} of {slots.length} parts priced
                    {missing.length > 0 ? ` · no listing for ${namedCategories(missing)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLoad}
                  data-testid="guide-load"
                  disabled={Object.keys(loadSelection).length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                >
                  <Zap size={15} /> Load into Builder <ChevronRight size={14} />
                </button>
                {Object.keys(loadSelection).length === 0 && (
                  <p className="mt-2 text-[11px]" data-testid="guide-load-empty" style={{ color: 'var(--ff-text-3)' }}>
                    Nothing to load: this guide has no current listings yet.
                  </p>
                )}

                {/* ASKED BEFORE ANYTHING CHANGES. Cancelling navigates
                    nowhere and writes nothing, so the existing draft survives
                    untouched — this component never writes to storage. */}
                {pendingLoadHref !== null && (
                  <div
                    role="alertdialog"
                    aria-label="Replace your current build?"
                    data-testid="guide-load-confirm"
                    className="mt-3 rounded-lg p-3"
                    style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-amber)' }}
                  >
                    <p className="text-xs mb-2" style={{ color: 'var(--ff-text)' }}>
                      You already have a build in progress. Loading this guide replaces it.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="guide-load-confirm-yes"
                        onClick={() => { const to = pendingLoadHref; setPendingLoadHref(null); navigate(to); }}
                        className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-white"
                        style={{ background: 'var(--ff-accent-solid)' }}
                      >
                        Replace my build
                      </button>
                      <button
                        type="button"
                        data-testid="guide-load-confirm-no"
                        onClick={() => setPendingLoadHref(null)}
                        className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold"
                        style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}
                      >
                        Keep my build
                      </button>
                    </div>
                  </div>
                )}
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
