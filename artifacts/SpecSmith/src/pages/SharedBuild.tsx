import { useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, ExternalLink, Zap, ArrowRight } from 'lucide-react';
import { decodeBuild } from '../lib/sharing';
import { estimateFpsForBuild, getAffiliateUrl, getNeweggUrl } from '../lib/fps';
import { getPartName, getPartPrice, categoryLabels, getPartSearchQuery } from '../lib/prebuilts';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { useAuth } from '../context/AuthContext';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

interface GPU { id: string; name: string; price_usd: number; tier: number; benchmark_score: number; gpu_multiplier: number; [key: string]: unknown; }
interface CPU { id: string; name: string; price_usd: number; tier: number; benchmark_score: number; cpu_multiplier: number; [key: string]: unknown; }
interface Game { id: string; name: string; base_fps: Record<string, Record<string, number>>; [key: string]: unknown; }

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

export default function SharedBuild() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const encoded = params.get('b');

  const decoded = useMemo(() => {
    if (!encoded) return null;
    return decodeBuild(decodeURIComponent(encoded));
  }, [encoded]);

  // Shared build links are ephemeral, user-generated snapshots (unbounded
  // /build?b=... parameter space). Keep them out of search indexes and
  // point crawlers back at the canonical /builder page instead. The base
  // /build shell still gets prerendered generic metadata (see entry-server
  // + scripts/prerender.mjs) so bots that don't run JS still see a
  // meaningful noindex'd title/description instead of the app shell.
  const buildMeta = getRouteMeta('/build');
  useSeo({
    ...buildMeta,
    title: decoded ? `${decoded.name} — SpecSmith Shared Build` : buildMeta.title,
  });

  const gpu = decoded ? gpus.find(g => g.id === decoded.build.gpu) : undefined;
  const cpu = decoded ? cpus.find(c => c.id === decoded.build.cpu) : undefined;
  // Falls back to 1080p/high for share links created before the viewing
  // resolution/preset was encoded.
  const view = decoded?.view ?? { resolution: '1080p', preset: 'high' };

  const fpsRows = useMemo(() => {
    if (!gpu || !cpu) return [];
    return games.map(g => ({
      name: g.name,
      fps: estimateFpsForBuild(gpu, cpu, g, view.resolution, view.preset).estimated,
    })).sort((a, b) => b.fps - a.fps);
  }, [gpu, cpu, view.resolution, view.preset]);

  if (!decoded) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Invalid build link</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>This build link is broken or has expired.</p>
          <Link to="/builder" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Create your own build
          </Link>
        </div>
      </div>
    );
  }

  const { build, name } = decoded;

  const partEntries = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset']
    .map(cat => [cat, build[cat] ?? ''] as [string, string])
    .filter(([, id]) => id);

  const customParts = decoded.customParts;
  const totalCost = partEntries.reduce((sum, [cat, id]) => sum + getPartPrice(cat, id), 0)
    + customParts.reduce((sum, c) => sum + c.price, 0);

  const loadInBuilder = () => {
    const qs = Object.entries(build).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join('&');
    navigate(`/builder?${qs}`);
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          {/* Header */}
          <div className="mb-6">
            <div className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3"
              style={{ backgroundColor: 'var(--ff-accent)18', color: 'var(--ff-accent-text)', border: '1px solid var(--ff-accent)40' }}>
              SHARED BUILD
            </div>
            <h1 className="text-3xl font-black" style={{ color: 'var(--ff-text)' }}>{name}</h1>
            {gpu && cpu && (
              <p className="text-sm mt-1" style={{ color: 'var(--ff-text-2)' }}>
                {gpu.name} + {cpu.name}
              </p>
            )}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: build details */}
            <div className="lg:col-span-2 space-y-4">
              {/* Parts */}
              <div className="rounded-2xl p-5"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Components</h2>
                <div className="space-y-2">
                  {partEntries.map(([cat, id]) => (
                    <div key={cat} className="flex items-center justify-between py-2"
                      style={{ borderBottom: '1px solid var(--ff-border)' }}>
                      <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>{categoryLabels[cat] ?? cat}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--ff-text)' }}>
                          {getPartName(cat, id)}
                        </span>
                        <a href={getAffiliateUrl(getPartSearchQuery(cat, id))} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] font-semibold hover:opacity-80"
                          style={{ color: 'var(--ff-accent-text)' }}>
                          Amazon <ExternalLink size={9} />
                        </a>
                        <a href={getNeweggUrl(getPartSearchQuery(cat, id))} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] font-semibold hover:opacity-80"
                          style={{ color: '#FF9E1B' }}>
                          Newegg <ExternalLink size={9} />
                        </a>
                      </div>
                    </div>
                  ))}
                  {customParts.map((c, i) => (
                    <div key={`custom-${i}`} className="flex items-center justify-between py-2"
                      style={{ borderBottom: '1px solid var(--ff-border)' }}>
                      <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Custom</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--ff-text)' }}>{c.name}</span>
                        <span className="text-xs font-semibold" style={{ color: 'var(--ff-accent-text)' }}>${c.price.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* FPS table */}
              {fpsRows.length > 0 && (
                <div className="rounded-2xl p-5"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <h2 className="font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
                    <Zap size={16} style={{ color: 'var(--ff-accent)' }} />
                    FPS Estimates ({view.resolution === '4k' ? '4K' : view.resolution} {view.preset.charAt(0).toUpperCase() + view.preset.slice(1)})
                  </h2>
                  <div className="space-y-2">
                    {fpsRows.map((row, i) => {
                      const color = row.fps >= 144 ? '#9B94FF' : row.fps >= 90 ? '#00D4FF' : row.fps >= 60 ? '#00E676' : row.fps >= 30 ? '#FFB300' : '#FF1744';
                      return (
                        <motion.div key={row.name}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex items-center justify-between py-1.5"
                          style={{ borderBottom: '1px solid var(--ff-border)' }}>
                          <span className="text-sm" style={{ color: 'var(--ff-text)' }}>{row.name}</span>
                          <span className="text-sm font-bold" style={{ color }}>{Math.round(row.fps)} FPS</span>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right: actions */}
            <div className="space-y-4">
              <div className="rounded-2xl p-5"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="mb-4">
                  <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>Estimated Total</p>
                  <p className="text-3xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</p>
                </div>
                <div className="space-y-3">
                  <button onClick={loadInBuilder}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    <Cpu size={15} /> Load This Build
                  </button>
                  {!user ? (
                    <Link to="/signup"
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm"
                      style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}>
                      <ArrowRight size={15} /> Save to My Account
                    </Link>
                  ) : (
                    <button onClick={loadInBuilder}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm"
                      style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}>
                      <ArrowRight size={15} /> Open in Builder
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
