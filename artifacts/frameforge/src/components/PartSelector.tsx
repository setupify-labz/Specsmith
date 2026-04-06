import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Search, SortAsc } from 'lucide-react';
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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  getSpecs: (part: Part) => { label: string; value: string }[];
  defaultOpen?: boolean;
}

export default function PartSelector({
  category, label, parts, selectedId, onSelect, getSpecs, defaultOpen = false
}: PartSelectorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('performance');

  const filtered = useMemo(() => {
    let result = parts.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase())
    );
    if (sort === 'price') result.sort((a, b) => a.price_usd - b.price_usd);
    else if (sort === 'performance') result.sort((a, b) => (b.benchmark_score ?? b.tier ?? 0) - (a.benchmark_score ?? a.tier ?? 0));
    else if (sort === 'value') result.sort((a, b) => ((b.benchmark_score ?? b.tier ?? 0) / b.price_usd) - ((a.benchmark_score ?? a.tier ?? 0) / a.price_usd));
    return result;
  }, [parts, search, sort]);

  const selectedPart = parts.find(p => p.id === selectedId);

  return (
    <div className="rounded-xl border border-white/8 overflow-hidden bg-[#1C1C26]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${selectedId ? 'bg-[#6C63FF]' : 'bg-white/20'}`} />
          <div className="text-left">
            <span className="font-semibold text-white text-sm">{label}</span>
            {selectedPart && (
              <p className="text-[#8888AA] text-xs truncate max-w-48">{selectedPart.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedPart && (
            <span className="text-[#6C63FF] text-xs font-semibold">${selectedPart.price_usd.toLocaleString()}</span>
          )}
          {open ? <ChevronUp size={16} className="text-[#8888AA]" /> : <ChevronDown size={16} className="text-[#8888AA]" />}
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
            <div className="border-t border-white/5 p-4 space-y-3">
              {/* Search + Sort */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8888AA]" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white text-sm placeholder-[#8888AA] focus:outline-none focus:border-[#6C63FF]/50"
                  />
                </div>
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as SortKey)}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white text-sm focus:outline-none focus:border-[#6C63FF]/50 cursor-pointer"
                >
                  <option value="performance">Performance</option>
                  <option value="price">Price</option>
                  <option value="value">Value</option>
                </select>
              </div>

              {/* Parts grid */}
              <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="text-[#8888AA] text-sm text-center py-4">No parts found</p>
                ) : (
                  filtered.map(part => (
                    <PartCard
                      key={part.id}
                      id={part.id}
                      name={part.name}
                      price_usd={part.price_usd}
                      selected={part.id === selectedId}
                      sponsored={part.sponsored}
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
