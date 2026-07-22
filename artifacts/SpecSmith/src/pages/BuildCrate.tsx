import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, RotateCcw, Cpu, Share2, Sparkles } from 'lucide-react';
import { rollBuildCrate, type CrateBuild, type CrateRarity } from '../lib/buildCrate';
import { getShareUrl } from '../lib/sharing';
import { useToast } from '../context/ToastContext';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import CompatibilityBanner from '../components/CompatibilityBanner';
import PageGlow from '../components/PageGlow';

const RARITY_STYLE: Record<CrateRarity, { label: string; color: string; glow: string }> = {
  common:    { label: 'Common',    color: '#9CA3AF', glow: 'rgba(156,163,175,0.35)' },
  uncommon:  { label: 'Uncommon',  color: '#00E676', glow: 'rgba(0,230,118,0.4)' },
  rare:      { label: 'Rare',      color: '#00D4FF', glow: 'rgba(0,212,255,0.4)' },
  epic:      { label: 'Epic',      color: '#9B6BFF', glow: 'rgba(155,107,255,0.45)' },
  legendary: { label: 'Legendary', color: '#FFD700', glow: 'rgba(255,215,0,0.5)' },
};

const PART_ROWS: { key: keyof Pick<CrateBuild, 'motherboard' | 'cpu' | 'ram' | 'gpu' | 'storage' | 'case' | 'cooler' | 'psu'>; label: string }[] = [
  { key: 'motherboard', label: 'Motherboard' },
  { key: 'cpu', label: 'CPU' },
  { key: 'ram', label: 'RAM' },
  { key: 'gpu', label: 'GPU' },
  { key: 'storage', label: 'Storage' },
  { key: 'case', label: 'Case' },
  { key: 'cooler', label: 'CPU Cooler' },
  { key: 'psu', label: 'PSU' },
];

export default function BuildCrate() {
  useSeo(getRouteMeta('/crate'));
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [opening, setOpening] = useState(false);
  const [build, setBuild] = useState<CrateBuild | null>(null);

  const openCrate = () => {
    setOpening(true);
    setBuild(null);
    setTimeout(() => {
      setBuild(rollBuildCrate());
      setOpening(false);
    }, 900);
  };

  const buildWithThis = () => {
    if (!build) return;
    const qs = Object.entries(build.buildState).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    navigate(`/builder?${qs}`);
  };

  const copyShareLink = () => {
    if (!build) return;
    const url = getShareUrl(build.buildState, `${RARITY_STYLE[build.rarity].label} Build Crate`);
    navigator.clipboard.writeText(url);
    showToast('Share link copied', 'success');
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="warm" />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Build <span className="gradient-text">Crate</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Open a crate for a fully random PC build. Every part is guaranteed to physically fit together — what tier you pull is the gamble.
          </p>
        </motion.div>

        <div className="flex justify-center mb-10">
          <motion.button
            onClick={openCrate}
            disabled={opening}
            whileHover={{ scale: opening ? 1 : 1.04 }}
            whileTap={{ scale: opening ? 1 : 0.97 }}
            animate={opening ? { rotate: [0, -8, 8, -8, 8, 0] } : {}}
            transition={opening ? { duration: 0.9 } : { duration: 0.15 }}
            className="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl font-black text-white disabled:opacity-80"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            <Package size={40} />
            <span className="text-lg">{opening ? 'Opening…' : build ? 'Open Another Crate' : 'Open a Build Crate'}</span>
          </motion.button>
        </div>

        <AnimatePresence mode="wait">
          {build && (
            <motion.div
              key={build.gpu.id + build.cpu.id}
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <div
                className="rounded-3xl p-6 mb-6 text-center"
                style={{
                  backgroundColor: 'var(--ff-surface)',
                  border: `2px solid ${RARITY_STYLE[build.rarity].color}`,
                  boxShadow: `0 0 40px ${RARITY_STYLE[build.rarity].glow}`,
                }}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles size={16} style={{ color: RARITY_STYLE[build.rarity].color }} />
                  <span className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: RARITY_STYLE[build.rarity].color }}>
                    {RARITY_STYLE[build.rarity].label} Pull
                  </span>
                  <Sparkles size={16} style={{ color: RARITY_STYLE[build.rarity].color }} />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Total Cost</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${build.totalCost.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Average FPS</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{build.avgFps}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="space-y-2">
                  {PART_ROWS.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--ff-border)' }}>
                      <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>{label}</span>
                      <span className="text-sm font-medium text-right" style={{ color: 'var(--ff-text)' }}>{build[key].name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <CompatibilityBanner warnings={build.compat.warnings} passed={build.compat.passed} />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={buildWithThis}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                  <Cpu size={15} /> Build With This
                </button>
                <button onClick={copyShareLink}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <Share2 size={15} /> Copy Share Link
                </button>
                <button onClick={openCrate}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <RotateCcw size={15} /> Reroll
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!build && !opening && (
          <p className="text-xs text-center mt-4" style={{ color: 'var(--ff-text-3)' }}>
            Socket and RAM type are always guaranteed to be compatible. Everything else — fit, wattage, cooling — is part of the roll.{' '}
            <Link to="/builder" className="underline hover:opacity-80" style={{ color: 'var(--ff-text-2)' }}>Prefer to pick your own parts?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
