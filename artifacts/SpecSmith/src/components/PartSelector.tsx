import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from './MotionLite';
import {
  ChevronDown, ChevronUp, Search, Check,
  Cpu, Gpu, CircuitBoard, MemoryStick, HardDrive, Power, Box, Fan,
  Monitor, Keyboard, Mouse, Headphones,
} from 'lucide-react';
import PartCard from './PartCard';
import { buildPartQuery } from '../lib/fps';
import { comparablePriceAmount, describePartPrice, type PartPrice } from '../lib/partPrice';

type SortKey = 'price' | 'performance' | 'value';

const CATEGORY_ICONS: Record<string, typeof Cpu> = {
  gpu: Gpu,
  cpu: Cpu,
  motherboard: CircuitBoard,
  ram: MemoryStick,
  storage: HardDrive,
  psu: Power,
  case: Box,
  cooler: Fan,
  monitor: Monitor,
  keyboard: Keyboard,
  mouse: Mouse,
  headset: Headphones,
};

interface Part {
  id: string;
  name: string;
  image?: string;
  price_usd?: number;
  affiliateUrl?: string;
  specsVerified?: boolean;
  tier?: number;
  benchmark_score?: number;
  sponsored?: boolean;
  [key: string]: unknown;
}

interface PartSelectorProps {
  category: string;
  label: string;
  parts: Part[];
  selectedId: string | null | undefined;
  onSelect: (id: string | null) => void;
  getSpecs: (part: Part) => { label: string; value: string }[];
  defaultOpen?: boolean;
  recommendedIds?: string[];
  /**
   * Bumped to open this selector from outside — the header's "choose a
   * processor" action, which has to reach the processor rather than the top
   * of the page.
   *
   * A token rather than a boolean, so the same selector can be asked for
   * twice running: a `shouldOpen` flag is unchanged on the second click and
   * would quietly do nothing after the shopper collapses the panel again.
   */
  openSignal?: number;
  /** Hide prices, value sorting, badges and retailer links when this selector
   * is choosing a comparison subject rather than a product to shop for. */
  showShopping?: boolean;
  /**
   * Says where each part's price came from (#156). The caller knows its data
   * source; this component does not, so it never turns `price_usd` into a
   * displayed price on its own. Without it, no figure is shown and nothing is
   * sorted or ranked by price.
   */
  getPrice?: (part: Part) => PartPrice;
}

/**
 * How many frames a scroll request may keep re-asserting itself.
 *
 * Generous enough to outlast a panel expanding and the layout settling around
 * it, small enough that an element which can never come into view stops trying
 * well inside a second.
 */
const SCROLL_ATTEMPT_FRAMES = 30;

export default function PartSelector({
  category, label, parts, selectedId, onSelect, getSpecs,
  defaultOpen = false, recommendedIds = [], openSignal, showShopping = true, getPrice,
}: PartSelectorProps) {
  const priceOf = (part: Part): PartPrice | undefined => (showShopping && getPrice ? getPrice(part) : undefined);
  const amountOf = (part: Part): number | null => comparablePriceAmount(priceOf(part));
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Opens this selector on request, and brings it into view — EVERY time.
   *
   * KEYED ON THE TOKEN, NOT ON `open`. This was two effects: one calling
   * `setOpen(true)`, and one keyed on `open` that did the scrolling. That works
   * exactly once, from closed. `setOpen(true)` on an already-open selector
   * changes no state, so React does not re-render, so an effect watching `open`
   * never runs again — and the request silently did nothing. Two cases hit this
   * in ordinary use: the GPU selector, which is `defaultOpen`, and any category
   * asked for twice running. Both are a shopper clicking a button and watching
   * nothing happen.
   *
   * WHY IT RE-ASSERTS RATHER THAN SCROLLING ONCE. `scrollIntoView` computes its
   * target from the layout at the moment it is called, and this panel is
   * expanding as it is called — so a single scroll can be aimed at an offset
   * that stops existing a frame later, and Chromium abandons it. Measured at
   * 375px: the page moved two pixels and the processor stayed off screen, on
   * the first request after a page load but not the second, which is the
   * signature of a race rather than a mistake in the ordering.
   *
   * So it does not guess when the layout is final. It watches for the only
   * thing that matters — is the selector actually on screen? — and re-issues
   * the scroll until it is, giving up after a bounded number of frames so a
   * genuinely unreachable element cannot spin forever. Converging on an
   * observable condition, rather than a delay tuned to one machine.
   */
  useEffect(() => {
    if (openSignal === undefined) return;
    setOpen(true);

    let frame: number | null = null;
    let framesLeft = SCROLL_ATTEMPT_FRAMES;

    const settle = () => {
      frame = null;
      const element = rootRef.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const onScreen = box.top < window.innerHeight && box.bottom > 0;
      if (onScreen || framesLeft <= 0) return;
      framesLeft -= 1;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // DOM-only test environments have no layout engine and report a zero
      // rectangle forever. One call proves the request without scheduling 29
      // pointless animation frames; real browser elements have dimensions.
      if (box.width === 0 && box.height === 0) return;
      frame = requestAnimationFrame(settle);
    };

    frame = requestAnimationFrame(settle);
    // The pending frame is always cancelled — a selector unmounted, or a newer
    // request arriving, must not leave a scroll scheduled against a stale
    // target or a node that is gone.
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [openSignal]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('performance');

  const filtered = useMemo(() => {
    let result = parts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (showShopping && sort === 'price') result.sort((a, b) => (amountOf(a) ?? Number.POSITIVE_INFINITY) - (amountOf(b) ?? Number.POSITIVE_INFINITY));
    else if (sort === 'performance') result.sort((a, b) => (b.benchmark_score ?? b.tier ?? 0) - (a.benchmark_score ?? a.tier ?? 0));
    else if (showShopping && sort === 'value') result.sort((a, b) => {
      const aAmount = amountOf(a);
      const bAmount = amountOf(b);
      const aValue = aAmount && aAmount > 0 ? (a.benchmark_score ?? a.tier ?? 0) / aAmount : -1;
      const bValue = bAmount && bAmount > 0 ? (b.benchmark_score ?? b.tier ?? 0) / bAmount : -1;
      return bValue - aValue;
    });
    // Recommended first when present
    if (recommendedIds.length > 0) {
      result = [
        ...result.filter(p => recommendedIds.includes(p.id)),
        ...result.filter(p => !recommendedIds.includes(p.id)),
      ];
    }
    return result;
  }, [parts, search, sort, recommendedIds, showShopping, getPrice]);

  // "Best Value" (highest benchmark-score/price ratio) and "Best Performance"
  // (highest raw benchmark score) — one of each per category, GPU/CPU only.
  const { bestValueId, bestPerformanceId } = useMemo(() => {
    if (!showShopping || (category !== 'gpu' && category !== 'cpu')) return { bestValueId: null, bestPerformanceId: null };
    const withScores = parts
      .map((p) => ({ part: p, amount: amountOf(p) }))
      .filter((entry): entry is { part: Part & { benchmark_score: number }; amount: number } =>
        typeof entry.part.benchmark_score === 'number' && entry.amount !== null && entry.amount > 0,
      );
    if (withScores.length === 0) return { bestValueId: null, bestPerformanceId: null };
    const bestValue = withScores.reduce((best, entry) =>
      (entry.part.benchmark_score / entry.amount) > (best.part.benchmark_score / best.amount) ? entry : best
    ).part;
    const scored = withScores.map((entry) => entry.part);
    const bestPerformance = scored.reduce((best, p) =>
      p.benchmark_score > best.benchmark_score ? p : best
    );
    return { bestValueId: bestValue.id, bestPerformanceId: bestPerformance.id };
  }, [parts, category, showShopping, getPrice]);

  const selectedPart = parts.find(p => p.id === selectedId);
  const selectedPrice = selectedPart && showShopping ? describePartPrice(priceOf(selectedPart)) : null;
  const Icon = CATEGORY_ICONS[category] ?? Box;

  return (
    <div
      ref={rootRef}
      data-part-section={category}
      className="rounded-2xl overflow-hidden transition-shadow"
      style={{
        border: `1px solid ${selectedId ? 'var(--ff-accent-30)' : 'var(--ff-border)'}`,
        backgroundColor: 'var(--ff-surface)',
        boxShadow: open ? '0 8px 24px -8px rgba(108,99,255,0.18)' : 'none',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 transition-colors"
        style={{ backgroundColor: open ? 'var(--ff-card-hover)' : 'var(--ff-surface)' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ff-card-hover)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = open ? 'var(--ff-card-hover)' : 'var(--ff-surface)')}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            style={{
              background: selectedId ? 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' : 'var(--ff-card)',
              border: selectedId ? 'none' : '1px solid var(--ff-border)',
            }}
          >
            {selectedId
              ? <Check size={16} className="text-white" strokeWidth={3} />
              : <Icon size={16} style={{ color: 'var(--ff-text-2)' }} />}
          </div>
          <div className="text-left min-w-0">
            <span className="font-semibold text-sm" style={{ color: 'var(--ff-text)' }}>{label}</span>
            {selectedPart ? (
              <p className="text-xs truncate max-w-[220px]" style={{ color: 'var(--ff-text-2)' }}>{selectedPart.name}</p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--ff-text-3)' }}>Not selected</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {selectedPrice && (
            <span
              className="text-sm font-bold"
              style={{ color: 'var(--ff-accent-text)' }}
              data-testid="selected-part-price"
              data-price-provenance={selectedPrice.provenance}
            >
              {selectedPrice.primary}
              {/* The source line does not fit the header; screen readers get it. */}
              {selectedPrice.detail && <span className="sr-only">, {selectedPrice.detail}</span>}
            </span>
          )}
          {open
            ? <ChevronUp size={16} style={{ color: 'var(--ff-text-2)' }} />
            : <ChevronDown size={16} style={{ color: 'var(--ff-text-2)' }} />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3" style={{ borderTop: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-bg)' }}>
              {/* Search + Sort */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }} />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm focus:outline-none"
                    style={{
                      backgroundColor: 'var(--ff-input-bg)',
                      border: '1px solid var(--ff-border)',
                      color: 'var(--ff-text)',
                    }}
                  />
                </div>
                {showShopping && <div className="relative w-full sm:w-[132px] sm:flex-shrink-0">
                  <select
                    aria-label="Sort parts by"
                    value={sort}
                    onChange={e => setSort(e.target.value as SortKey)}
                    className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg text-sm focus:outline-none cursor-pointer"
                    style={{
                      backgroundColor: 'var(--ff-input-bg)',
                      border: '1px solid var(--ff-border)',
                      color: 'var(--ff-text)',
                    }}
                  >
                    <option value="performance">Performance</option>
                    <option value="price">Price</option>
                    <option value="value">Value</option>
                  </select>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--ff-text-3)' }}
                  />
                </div>}
              </div>

              {/* Parts grid */}
              {showShopping && filtered.some(part => Boolean(part.affiliateUrl)) && (
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
                  Affiliate disclosure: SpecSmith may earn a commission from purchases made through marked retailer links. Your price is not increased.
                </p>
              )}
              <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pt-1 pr-1">
                {filtered.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--ff-text-2)' }}>No parts found</p>
                ) : (
                  filtered.map(part => (
                    <PartCard
                      key={part.id}
                      id={part.id}
                      name={part.name}
                      image={part.image}
                      searchQuery={buildPartQuery(part.name, part.brand as string | undefined, category)}
                      price={priceOf(part)}
                      affiliateUrl={part.affiliateUrl}
                      selected={part.id === selectedId}
                      sponsored={part.sponsored}
                      recommended={recommendedIds.includes(part.id)}
                      badge={
                        part.id === bestPerformanceId ? 'best-performance' :
                        part.id === bestValueId ? 'best-value' :
                        undefined
                      }
                      specs={getSpecs(part)}
                      tier={part.tier}
                      showShopping={showShopping}
                      onSelect={(id) => onSelect(id === selectedId ? null : id)}
                    />
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
