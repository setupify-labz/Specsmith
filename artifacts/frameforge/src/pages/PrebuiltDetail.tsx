import { useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap, ExternalLink, ArrowLeft } from 'lucide-react';
import prebuiltsData from '../data/prebuilts.json';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import { estimateFps, getAffiliateUrl, getNeweggUrl } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import { getPrebuiltMeta } from '../lib/seo';

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

function getFpsColor(fps: number): string {
  if (fps >= 144) return '#6C63FF';
  if (fps >= 90)  return '#00D4FF';
  if (fps >= 60)  return '#00E676';
  if (fps >= 30)  return '#FFB300';
  return '#FF1744';
}

export default function PrebuiltDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const prebuilt = prebuilts.find(p => p.id === slug);

  const fallbackMeta = {
    path: '/prebuilts',
    title: 'Build Not Found | SpecSmith',
    description: 'This curated build could not be found. Browse all curated SpecSmith PC builds instead.',
    noindex: true,
  };
  useSeo(prebuilt ? getPrebuiltMeta(prebuilt) : fallbackMeta);

  const fpsRows = useMemo(() => {
    if (!prebuilt) return [];
    const gpu = gpus.find(g => g.id === prebuilt.parts.gpu);
    const cpu = cpus.find(c => c.id === prebuilt.parts.cpu);
    if (!gpu || !cpu) return [];
    return games.map(g => {
      const baseFps = g.base_fps[prebuilt.fps_resolution]?.[prebuilt.fps_preset] ?? 0;
      const fps = estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, baseFps).estimated;
      return { game: g.name, fps };
    }).sort((a, b) => b.fps - a.fps);
  }, [prebuilt]);

  const totalPrice = useMemo(() => {
    if (!prebuilt) return 0;
    return Object.entries(prebuilt.parts).reduce((sum, [cat, id]) => sum + getPartPrice(cat, id), 0);
  }, [prebuilt]);

  if (!prebuilt) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Build not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>This prebuilt configuration doesn't exist.</p>
          <Link to="/prebuilts" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse Curated Builds
          </Link>
        </div>
      </div>
    );
  }

  const badge = BADGE_STYLES[prebuilt.badge_color] ?? BADGE_STYLES.gray;

  const handleLoad = () => {
    const params = new URLSearchParams();
    Object.entries(prebuilt.parts).forEach(([k, v]) => params.set(k, v));
    navigate(`/builder?${params.toString()}`);
  };

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-4xl mx-auto px-4">
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(prebuilt.parts).map(([cat, id]) => {
                    const name = getPartName(cat, id);
                    const price = getPartPrice(cat, id);
                    return (
                      <div key={cat} className="rounded-lg p-3" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
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
                            >
                              <ExternalLink size={9} />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                <div className="mb-4">
                  <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>Estimated Total</p>
                  <p className="text-3xl font-black" style={{ color: 'var(--ff-text)' }}>${totalPrice.toLocaleString()}</p>
                </div>
                <button
                  onClick={handleLoad}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                >
                  <Zap size={15} /> Customize in Builder <ChevronRight size={14} />
                </button>
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
        </motion.div>
      </div>
    </div>
  );
}
