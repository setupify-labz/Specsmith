import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronUp, Search, Check,
  Cpu, Gpu, CircuitBoard, MemoryStick, HardDrive, Power, Box, Fan,
  Monitor, Keyboard, Mouse, Headphones,
} from 'lucide-react';
import PartCard from './PartCard';
import { buildPartQuery } from '../lib/fps';

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
}

export default function PartSelector({
  category, label, parts, selectedId, onSelect, getSpecs,
  defaultOpen = false, recommendedIds = [], openSignal,
}: PartSelectorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Set when an outside request opens this selector, cleared once it has been
  // scrolled to. See the effect below for why the two are separate steps.
  const scrollWhenOpen = useRef(false);

  useEffect(() => {
    if (openSignal === undefined) return;
    scrollWhenOpen.current = true;
    setOpen(true);
  }, [openSignal]);

  /**
   * Brings this selector into view once it has ACTUALLY OPENED.
   *
   * Not in the click handler, and not in the effect above. Opening this panel
   * changes the height of the page, and `scrollIntoView` computes its target
   * from the layout at the moment it is called — so a scroll issued while the
   * panel is still collapsed aims at an offset that stops existing a
   * millisecond later, and the browser abandons it. Measured on a 375px
   * viewport: the page moved 14 pixels and the processor stayed off screen,
   * which is the defect this is fixing, merely later in the sequence.
   *
   * Depending on `open` means this runs in the commit AFTER the panel has
   * expanded, when the geometry is final. Not a timer: no guessed delay, and
   * nothing to be flaky about on a slow machine.
   */
  useEffect(() => {
    if (!open || !scrollWhenOpen.current) return;
    scrollWhenOpen.current = false;
    // TWO FRAMES, NOT A TIMER. The first rAF lands before the browser has
    // laid out the panel that just expanded; the second runs after that paint,
    // when the offset scrollIntoView computes is the one that will still exist
    // when the scroll starts. A scroll issued any earlier is aimed at an
    // offset the expansion invalidates, and Chromium abandons it — measured at
    // 375px, the page moved 14 pixels and the processor stayed off screen.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('performance');

  const filtered = useMemo(() => {
    let result = parts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (sort === 'price') result.sort((a, b) => (a.price_usd ?? Number.POSITIVE_INFINITY) - (b.price_usd ?? Number.POSITIVE_INFINITY));
    else if (sort === 'performance') result.sort((a, b) => (b.benchmark_score ?? b.tier ?? 0) - (a.benchmark_score ?? a.tier ?? 0));
    else if (sort === 'value') result.sort((a, b) => {
      const aValue = a.price_usd && a.price_usd > 0 ? (a.benchmark_score ?? a.tier ?? 0) / a.price_usd : -1;
      const bValue = b.price_usd && b.price_usd > 0 ? (b.benchmark_score ?? b.tier ?? 0) / b.price_usd : -1;
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
  }, [parts, search, sort, recommendedIds]);

  // "Best Value" (highest benchmark-score/price ratio) and "Best Performance"
  // (highest raw benchmark score) — one of each per category, GPU/CPU only.
  const { bestValueId, bestPerformanceId } = useMemo(() => {
    if (category !== 'gpu' && category !== 'cpu') return { bestValueId: null, bestPerformanceId: null };
    const withScores = parts.filter((p): p is Part & { benchmark_score: number; price_usd: number } =>
      typeof p.benchmark_score === 'number' && typeof p.price_usd === 'number' && p.price_usd > 0,
    );
    if (withScores.length === 0) return { bestValueId: null, bestPerformanceId: null };
    const bestValue = withScores.reduce((best, p) =>
      (p.benchmark_score / p.price_usd) > (best.benchmark_score / best.price_usd) ? p : best
    );
    const bestPerformance = withScores.reduce((best, p) =>
      p.benchmark_score > best.benchmark_score ? p : best
    );
    return { bestValueId: bestValue.id, bestPerformanceId: bestPerformance.id };
  }, [parts, category]);

  const selectedPart = parts.find(p => p.id === selectedId);
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
          {selectedPart && (
            <span className="text-sm font-bold" style={{ color: 'var(--ff-accent-text)' }}>
              {selectedPart.price_usd === undefined ? 'Retailer price' : `$${selectedPart.price_usd.toLocaleString()}`}
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
                <div className="relative w-full sm:w-[132px] sm:flex-shrink-0">
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
                </div>
              </div>

              {/* Parts grid */}
              {filtered.some(part => Boolean(part.affiliateUrl)) && (
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
                      price_usd={part.price_usd}
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
