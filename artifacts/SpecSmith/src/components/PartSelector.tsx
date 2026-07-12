import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import PartCard from './PartCard';

type SortKey = 'price' | 'performance' | 'value';

interface Part {
  id: string;
  name: string;
  price_usd: number;
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
  showSparkline?: boolean;
  recommendedIds?: string[];
}

export default function PartSelector({
  category, label, parts, selectedId, onSelect, getSpecs,
  defaultOpen = false, showSparkline, recommendedIds = [],
}: PartSelectorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('performance');

  const filtered = useMemo(() => {
    let result = parts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (sort === 'price') result.sort((a, b) => a.price_usd - b.price_usd);
    else if (sort === 'performance') result.sort((a, b) => (b.benchmark_score ?? b.tier ?? 0) - (a.benchmark_score ?? a.tier ?? 0));
    else if (sort === 'value') result.sort((a, b) => ((b.benchmark_score ?? b.tier ?? 0) / b.price_usd) - ((a.benchmark_score ?? a.tier ?? 0) / a.price_usd));
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
    const withScores = parts.filter(p => typeof p.benchmark_score === 'number' && p.price_usd > 0);
    if (withScores.length === 0) return { bestValueId: null, bestPerformanceId: null };
    const bestValue = withScores.reduce((best, p) =>
      (p.benchmark_score! / p.price_usd) > (best.benchmark_score! / best.price_usd) ? p : best
    );
    const bestPerformance = withScores.reduce((best, p) =>
      p.benchmark_score! > best.benchmark_score! ? p : best
    );
    return { bestValueId: bestValue.id, bestPerformanceId: bestPerformance.id };
  }, [parts, category]);

  const selectedPart = parts.find(p => p.id === selectedId);

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 transition-colors"
        style={{ backgroundColor: 'var(--ff-surface)' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ff-card-hover)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--ff-surface)')}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full transition-colors"
            style={{ backgroundColor: selectedId ? 'var(--ff-accent)' : 'var(--ff-border)' }}
          />
          <div className="text-left">
            <span className="font-semibold text-sm" style={{ color: 'var(--ff-text)' }}>{label}</span>
            {selectedPart && (
              <p className="text-xs truncate max-w-[200px]" style={{ color: 'var(--ff-text-2)' }}>{selectedPart.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedPart && (
            <span className="text-xs font-semibold" style={{ color: 'var(--ff-accent)' }}>
              ${selectedPart.price_usd.toLocaleString()}
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
            <div className="p-4 space-y-3" style={{ borderTop: '1px solid var(--ff-border)' }}>
              {/* Search + Sort */}
              <div className="flex gap-2">
                <div className="relative flex-1">
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
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as SortKey)}
                  className="px-3 py-2 rounded-lg text-sm focus:outline-none cursor-pointer"
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
              </div>

              {/* Parts grid */}
              <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--ff-text-2)' }}>No parts found</p>
                ) : (
                  filtered.map(part => (
                    <PartCard
                      key={part.id}
                      id={part.id}
                      name={part.name}
                      price_usd={part.price_usd}
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
                      showSparkline={showSparkline}
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
