import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import { fetchRecentTopPulls } from '../lib/cratePulls';
import { isGalleryEnabled } from '../lib/supabase';
import { RARITY_STYLE } from '../lib/buildCrate';
import type { CratePullRow } from '../lib/supabase';

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A live feed of recent Epic/Legendary pulls from every SpecSmith visitor —
 * silently omits itself if the Gallery database isn't connected yet, same
 * as every other Supabase-backed feature on the site. */
export default function CratePullsFeed() {
  const [pulls, setPulls] = useState<CratePullRow[] | null>(null);

  useEffect(() => {
    if (!isGalleryEnabled) return;
    fetchRecentTopPulls().then(setPulls);
  }, []);

  if (!isGalleryEnabled || pulls === null) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-10">
      <h2 className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: 'var(--ff-text)' }}>
        <Trophy size={15} style={{ color: 'var(--ff-gold)' }} /> Recent Epic+ Pulls
      </h2>
      {pulls.length === 0 ? (
        <p className="text-xs text-center py-6 rounded-2xl" style={{ color: 'var(--ff-text-3)', backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          No Epic or Legendary pulls yet — be the first.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {pulls.map(p => {
            const style = RARITY_STYLE[p.rarity];
            return (
              <div key={p.id} className="rounded-xl p-3 flex items-center justify-between gap-3"
                style={{ backgroundColor: 'var(--ff-surface)', border: `1px solid ${style.color}40` }}>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: style.color }}>{style.label}</p>
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--ff-text)' }}>{p.gpu_name} + {p.cpu_name}</p>
                  <p className="text-[10px]" style={{ color: 'var(--ff-text-3)' }}>{p.puller_name} · {timeAgo(p.created_at)}</p>
                </div>
                <p className="text-sm font-black flex-shrink-0" style={{ color: 'var(--ff-text)' }}>${p.total_cost.toLocaleString()}</p>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
