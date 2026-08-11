import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Eye, ExternalLink, Cpu, Users, Sparkles } from 'lucide-react';
import { fetchRecentBuilds, fetchTopBuilds, recordBuildView } from '../lib/gallery';
import { isGalleryEnabled } from '../lib/supabase';
import { getPartName, getPartSearchQuery, categoryLabels } from '../lib/prebuilts';
import { getAffiliateUrl, getNeweggUrl } from '../lib/fps';
import type { PublicBuildRow } from '../lib/supabase';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const PART_CATEGORIES = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset'];

const galleryFaqs = [
  {
    title: 'Do I need an account to browse the gallery?',
    content: 'No — browsing every published build is open to anyone. You only need an account to save a build to your own Dashboard and publish it here yourself.',
  },
  {
    title: 'What does the ✨ "Staff Pick" label mean?',
    content: 'It marks a build that SpecSmith seeded rather than a real user submission — used to keep the gallery populated early on. Staff picks are always visually labeled this way and never presented as organic user activity.',
  },
  {
    title: 'How is "Most Viewed" calculated?',
    content: 'It\'s a real view count, incremented each time someone expands a build card to see its full part list — not a curated or editorial ranking, just the builds that have actually drawn the most clicks.',
  },
];

function galleryFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: galleryFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

function BuildCard({ build, expanded, onToggle }: { build: PublicBuildRow; expanded: boolean; onToggle: () => void }) {
  const partEntries = PART_CATEGORIES
    .map(cat => [cat, build.build_state[cat] ?? ''] as [string, string])
    .filter(([, id]) => id);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5"
      style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm truncate" style={{ color: 'var(--ff-text)' }}>{build.name}</h3>
            {build.is_staff_pick && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'var(--ff-accent-10)', color: 'var(--ff-accent-text)', border: '1px solid var(--ff-accent-30)' }}
                title="Curated by the SpecSmith team, not a user submission"
              >
                <Sparkles size={10} /> STAFF PICK
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>by {build.creator_name}</p>
        </div>
        <div className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: 'var(--ff-text-3)' }}>
          <Eye size={12} /> {build.view_count}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--ff-card)' }}>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Total Cost</p>
          <p className="text-base font-black" style={{ color: 'var(--ff-text)' }}>${build.total_cost.toLocaleString()}</p>
        </div>
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--ff-card)' }}>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Avg FPS</p>
          <p className="text-base font-black" style={{ color: 'var(--ff-text)' }}>{build.avg_fps}</p>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-1.5 mb-3">
          {partEntries.map(([cat, id]) => (
            <div key={cat} className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid var(--ff-border)' }}>
              <span className="text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--ff-text-3)' }}>{categoryLabels[cat] ?? cat}</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium truncate" style={{ color: 'var(--ff-text)' }}>{getPartName(cat, id)}</span>
                <a href={getAffiliateUrl(getPartSearchQuery(cat, id))} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-[10px] font-semibold hover:opacity-80 flex-shrink-0"
                  style={{ color: 'var(--ff-accent-text)' }}>
                  Buy <ExternalLink size={9} />
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)' }}
        >
          {expanded ? 'Hide parts' : 'View parts'}
        </button>
        <Link
          to={`/builder?${Object.entries(build.build_state).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')}`}
          className="ml-auto text-xs font-semibold flex items-center gap-1 hover:opacity-80"
          style={{ color: 'var(--ff-accent-text)' }}
        >
          <Cpu size={12} /> Load in Builder
        </Link>
      </div>
    </motion.div>
  );
}

export default function Gallery() {
  useSeo(getRouteMeta('/gallery'));
  const [recent, setRecent] = useState<PublicBuildRow[] | null>(null);
  const [top, setTop] = useState<PublicBuildRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isGalleryEnabled) { setRecent([]); return; }
    fetchRecentBuilds().then(setRecent);
    fetchTopBuilds().then(setTop);
  }, []);

  const toggle = (id: string) => {
    const opening = expandedId !== id;
    setExpandedId(opening ? id : null);
    if (opening && !viewedRef.current.has(id)) {
      viewedRef.current.add(id);
      recordBuildView(id);
    }
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(galleryFaqJsonLd()) }} />
      <PageGlow variant="warm" />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Build <span className="gradient-text">Gallery</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Real builds other SpecSmith users put together and published — browse them, steal parts of the parts list, or load one straight into the Builder.
          </p>
        </motion.div>

        {!isGalleryEnabled ? (
          <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--ff-text-3)' }} />
            <p className="font-semibold mb-2" style={{ color: 'var(--ff-text)' }}>Gallery isn't live yet</p>
            <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--ff-text-2)' }}>
              This page is ready to go the moment the gallery database is connected. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {top.length > 0 && (
              <div className="mb-10">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
                  <Trophy size={18} style={{ color: 'var(--ff-amber)' }} /> Most Viewed Builds
                </h2>
                <div className="flex flex-wrap gap-2">
                  {top.map((b, i) => (
                    <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                      <span style={{ color: 'var(--ff-amber)' }}>#{i + 1}</span> {b.name}
                      {b.is_staff_pick && <Sparkles size={10} style={{ color: 'var(--ff-accent-text)' }} aria-label="Staff pick" />}
                      <span className="flex items-center gap-0.5" style={{ color: 'var(--ff-text-3)' }}><Eye size={10} /> {b.view_count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Recent Builds</h2>
            {recent === null ? (
              <p className="text-sm text-center py-10" style={{ color: 'var(--ff-text-2)' }}>Loading…</p>
            ) : recent.length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <p className="font-semibold mb-2" style={{ color: 'var(--ff-text)' }}>No builds published yet</p>
                <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>Be the first — save a build and publish it from your Dashboard.</p>
                <Link to="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                  Go to Dashboard →
                </Link>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {recent.map(build => (
                  <BuildCard key={build.id} build={build} expanded={expandedId === build.id} onToggle={() => toggle(build.id)} />
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-12 space-y-3">
          {galleryFaqs.map((f) => (
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
