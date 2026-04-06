import { motion } from 'framer-motion';
import { Check, ExternalLink, Star } from 'lucide-react';
import { getAffiliateUrl } from '../lib/fps';

interface PartCardProps {
  id: string;
  name: string;
  price_usd: number;
  selected: boolean;
  sponsored?: boolean;
  specs: { label: string; value: string }[];
  tier?: number;
  onSelect: (id: string) => void;
}

const tierColors: Record<number, string> = {
  10: '#00D4FF', 9: '#00D4FF', 8: '#6C63FF',
  7: '#6C63FF', 6: '#00E676', 5: '#00E676',
  4: '#FFB300', 3: '#FF8C00', 2: '#FF1744', 1: '#FF1744',
};

const tierLabels: Record<number, string> = {
  10: 'Flagship', 9: 'High-End', 8: 'Enthusiast',
  7: 'Performance', 6: 'Upper Mid', 5: 'Mid-Range',
  4: 'Entry', 3: 'Budget', 2: 'Basic', 1: 'Legacy',
};

export default function PartCard({ id, name, price_usd, selected, sponsored, specs, tier, onSelect }: PartCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-xl border p-4 cursor-pointer card-hover transition-all ${
        selected
          ? 'selected-card bg-[#1C1C26]'
          : 'border-white/8 bg-[#1C1C26] hover:border-[#6C63FF]/40'
      }`}
      onClick={() => onSelect(id)}
    >
      {sponsored && (
        <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30">
          SPONSORED
        </span>
      )}
      {selected && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#6C63FF] flex items-center justify-center">
          <Check size={12} className="text-white" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-white text-sm leading-tight truncate pr-6">{name}</h4>
          {tier !== undefined && (
            <span
              className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: tierColors[tier] ?? '#8888AA', backgroundColor: `${tierColors[tier] ?? '#8888AA'}18` }}
            >
              {tierLabels[tier] ?? `Tier ${tier}`}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1 mb-3">
        {specs.map(s => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <span className="text-[#8888AA]">{s.label}</span>
            <span className="text-white/80 font-medium">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <span className="text-lg font-bold text-white">${price_usd.toLocaleString()}</span>
        <a
          href={getAffiliateUrl(name)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1 text-xs text-[#6C63FF] hover:text-[#00D4FF] transition-colors font-medium"
        >
          Buy <ExternalLink size={11} />
        </a>
      </div>
    </motion.div>
  );
}
