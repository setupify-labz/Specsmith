import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap, ExternalLink } from 'lucide-react';
import prebuiltsData from '../data/prebuilts.json';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import { estimateFps, getAffiliateUrl, getNeweggUrl } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';

interface Prebuilt {
  id: string;
  name: string;
  tagline: string;
  description: string;
  target_resolution: string;
  badge_color: string;
  fps_resolution: string;
  fps_preset: string;
  fps_preview_games: string[];
  estimated_price: number;
  parts: Record<string, string>;
}

interface GPU { id: string; name: string; price_usd: number; gpu_multiplier: number; [key: string]: unknown; }
interface CPU { id: string; name: string; price_usd: number; cpu_multiplier: number; [key: string]: unknown; }
interface Game { id: string; name: string; base_fps: Record<string, Record<string, number>>; }

const prebuilts = prebuiltsData as Prebuilt[];
const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

function getPartPrice(category: string, id: string): number {
  if (category === 'gpu') return gpus.find(g => g.id === id)?.price_usd ?? 0;
  if (category === 'cpu') return cpus.find(c => c.id === id)?.price_usd ?? 0;
  if (category === 'motherboard') return (componentData.motherboards as any[]).find(m => m.id === id)?.price_usd ?? 0;
  if (category === 'ram') return (componentData.ram as any[]).find(r => r.id === id)?.price_usd ?? 0;
  if (category === 'storage') return (componentData.storage as any[]).find(s => s.id === id)?.price_usd ?? 0;
  if (category === 'psu') return (componentData.psus as any[]).find(p => p.id === id)?.price_usd ?? 0;
  if (category === 'case') return (componentData.cases as any[]).find(c => c.id === id)?.price_usd ?? 0;
  if (category === 'cooler') return (componentData.coolers as any[]).find(c => c.id === id)?.price_usd ?? 0;
  return 0;
}

function getPartName(category: string, id: string): string {
  if (category === 'gpu') return gpus.find(g => g.id === id)?.name ?? id;
  if (category === 'cpu') return cpus.find(c => c.id === id)?.name ?? id;
  if (category === 'motherboard') return (componentData.motherboards as any[]).find(m => m.id === id)?.name ?? id;
  if (category === 'ram') return (componentData.ram as any[]).find(r => r.id === id)?.name ?? id;
  if (category === 'storage') return (componentData.storage as any[]).find(s => s.id === id)?.name ?? id;
  if (category === 'psu') return (componentData.psus as any[]).find(p => p.id === id)?.name ?? id;
  if (category === 'case') return (componentData.cases as any[]).find(c => c.id === id)?.name ?? id;
  if (category === 'cooler') return (componentData.coolers as any[]).find(c => c.id === id)?.name ?? id;
  return id;
}

const categoryLabels: Record<string, string> = {
  gpu: 'GPU', cpu: 'CPU', motherboard: 'Motherboard', ram: 'RAM',
  storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'CPU Cooler',
};

const BADGE_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  gray:   { bg: 'rgba(136,136,170,0.12)', color: '#8888AA', border: 'rgba(136,136,170,0.3)' },
  blue:   { bg: 'rgba(0,212,255,0.12)',   color: '#00D4FF', border: 'rgba(0,212,255,0.3)'   },
  purple: { bg: 'rgba(108,99,255,0.12)',  color: '#6C63FF', border: 'rgba(108,99,255,0.3)'  },
  amber:  { bg: 'rgba(255,179,0,0.12)',   color: '#FFB300', border: 'rgba(255,179,0,0.3)'   },
  gold:   { bg: 'rgba(255,179,0,0.18)',   color: '#FFD700', border: 'rgba(255,215,0,0.4)'   },
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
      const baseFps = game.base_fps[prebuilt.fps_resolution]?.[prebuilt.fps_preset] ?? 0;
      const fps = estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, baseFps).estimated;
      return { game: game.name, fps };
    }).filter(Boolean) as { game: string; fps: number }[];
  }, [prebuilt]);
}

function useTotalPrice(prebuilt: Prebuilt): number {
  return useMemo(() => {
    return Object.entries(prebuilt.parts).reduce((sum, [cat, id]) => sum + getPartPrice(cat, id), 0);
  }, [prebuilt]);
}

function getFpsColor(fps: number): string {
  if (fps >= 144) return '#6C63FF';
  if (fps >= 90)  return '#00D4FF';
  if (fps >= 60)  return '#00E676';
  if (fps >= 30)  return '#FFB300';
  return '#FF1744';
}

function PrebuiltCard({ prebuilt, index }: { prebuilt: Prebuilt; index: number }) {
  const navigate = useNavigate();
  const fpsRows = useFpsPreview(prebuilt);
  const totalPrice = useTotalPrice(prebuilt);
  const badge = BADGE_STYLES[prebuilt.badge_color] ?? BADGE_STYLES.gray;
  const accentColor = ACCENT_COLORS[index % ACCENT_COLORS.length];

  const handleLoad = () => {
    const params = new URLSearchParams();
    Object.entries(prebuilt.parts).forEach(([k, v]) => params.set(k, v));
    navigate(`/builder?${params.toString()}`);
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
            <div className="text-3xl font-black gradient-text">${totalPrice.toLocaleString()}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ff-text-2)' }}>Estimated total</div>
          </div>
        </div>
      </div>

      {/* Parts grid */}
      <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ borderBottom: '1px solid var(--ff-border)' }}>
        {Object.entries(prebuilt.parts).map(([cat, id]) => {
          const name = getPartName(cat, id);
          const price = getPartPrice(cat, id);
          return (
            <div
              key={cat}
              className="rounded-lg p-3"
              style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
            >
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>
                {categoryLabels[cat]}
              </div>
              <div className="text-xs font-medium leading-tight mb-1.5" style={{ color: 'var(--ff-text)' }}>{name}</div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-semibold" style={{ color: 'var(--ff-accent)' }}>${price}</span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={getAffiliateUrl(name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Buy on Amazon"
                    className="flex items-center gap-0.5 text-[10px] transition-colors"
                    style={{ color: 'var(--ff-text-3)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--ff-accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--ff-text-3)')}
                  >
                    <ExternalLink size={9} />
                  </a>
                  <a
                    href={getNeweggUrl(name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Compare on Newegg"
                    className="flex items-center gap-0.5 text-[10px] transition-colors"
                    style={{ color: 'var(--ff-text-3)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--ff-accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--ff-text-3)')}
                  >
                    <ExternalLink size={9} />
                  </a>
                </div>
              </div>
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
                <div className="text-xs max-w-[80px] leading-tight" style={{ color: 'var(--ff-text-2)' }}>{fp.game}</div>
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
            onClick={handleLoad}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 hover:scale-105"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            <Zap size={16} />
            Load into Builder
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function Prebuilts() {
  useSeo(getRouteMeta('/prebuilts'));
  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
          FPS estimates use native resolution with no upscaling (DLSS/FSR/XeSS). Real-world figures with upscaling are significantly higher. Prices are estimated based on current market data.
        </motion.div>

        {/* Build cards */}
        <div className="space-y-8">
          {prebuilts.map((prebuilt, i) => (
            <PrebuiltCard key={prebuilt.id} prebuilt={prebuilt} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
