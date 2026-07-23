import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, RotateCcw, Cpu, Share2, Sparkles, Lock } from 'lucide-react';
import {
  CRATE_CATEGORY_ORDER, rollMotherboard, rollCpu, rollRam, rollGpu, rollStorage, rollCase, rollCooler, rollPsu,
  finalizeCrateBuild, type CrateBuild, type CrateRarity, type RolledPart,
  type CrateMotherboard, type CrateCpu, type CrateRam, type CrateGpu, type CrateStorage, type CrateCase, type CrateCooler, type CratePsu,
} from '../lib/buildCrate';
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

interface RevealedState {
  motherboard?: RolledPart<CrateMotherboard>;
  cpu?: RolledPart<CrateCpu>;
  ram?: RolledPart<CrateRam>;
  gpu?: RolledPart<CrateGpu>;
  storage?: RolledPart<CrateStorage>;
  case?: RolledPart<CrateCase>;
  cooler?: RolledPart<CrateCooler>;
  psu?: RolledPart<CratePsu>;
}

export default function BuildCrate() {
  useSeo(getRouteMeta('/crate'));
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [socket, setSocket] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedState>({});
  const [opening, setOpening] = useState(false);
  const [finalBuild, setFinalBuild] = useState<CrateBuild | null>(null);

  const revealedCount = CRATE_CATEGORY_ORDER.filter(c => revealed[c.key]).length;
  const nextCategory = CRATE_CATEGORY_ORDER[revealedCount];

  const openNext = () => {
    if (!nextCategory || opening) return;
    setOpening(true);
    setTimeout(() => {
      const key = nextCategory.key;
      const updated: RevealedState = { ...revealed };

      if (key === 'motherboard') {
        const r = rollMotherboard();
        setSocket(r.socket);
        updated.motherboard = r;
      } else if (key === 'cpu') {
        updated.cpu = rollCpu(socket!);
      } else if (key === 'ram') {
        updated.ram = rollRam(revealed.motherboard!.part.supported_ram[0]);
      } else if (key === 'gpu') {
        updated.gpu = rollGpu();
      } else if (key === 'storage') {
        updated.storage = rollStorage();
      } else if (key === 'case') {
        updated.case = rollCase();
      } else if (key === 'cooler') {
        updated.cooler = rollCooler();
      } else {
        updated.psu = rollPsu();
      }

      setRevealed(updated);
      setOpening(false);

      if (updated.motherboard && updated.cpu && updated.ram && updated.gpu && updated.storage && updated.case && updated.cooler && updated.psu) {
        setFinalBuild(finalizeCrateBuild({
          gpu: updated.gpu.part, cpu: updated.cpu.part, motherboard: updated.motherboard.part,
          ram: updated.ram.part, storage: updated.storage.part, case: updated.case.part,
          cooler: updated.cooler.part, psu: updated.psu.part,
        }));
      }
    }, 750);
  };

  const resetCrate = () => {
    setSocket(null);
    setRevealed({});
    setFinalBuild(null);
  };

  const buildWithThis = () => {
    if (!finalBuild) return;
    const qs = Object.entries(finalBuild.buildState).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    navigate(`/builder?${qs}`);
  };

  const copyShareLink = () => {
    if (!finalBuild) return;
    const url = getShareUrl(finalBuild.buildState, `${RARITY_STYLE[finalBuild.rarity].label} Build Crate`);
    navigator.clipboard.writeText(url);
    showToast('Share link copied', 'success');
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="warm" />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Build <span className="gradient-text">Crate</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Open one crate per part. First crate sets your platform — everything after it is guaranteed to fit that platform.
          </p>
        </motion.div>

        {/* Slot row */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-8">
          {CRATE_CATEGORY_ORDER.map((cat, i) => {
            const r = revealed[cat.key];
            const isNext = i === revealedCount && !finalBuild;
            return (
              <div key={cat.key}
                className="rounded-xl p-2 text-center flex flex-col items-center justify-center"
                style={{
                  minHeight: 64,
                  backgroundColor: 'var(--ff-surface)',
                  border: r ? `1.5px solid ${RARITY_STYLE[r.rarity].color}` : isNext ? '1.5px dashed var(--ff-accent)' : '1px solid var(--ff-border)',
                  boxShadow: r ? `0 0 14px ${RARITY_STYLE[r.rarity].glow}` : undefined,
                  opacity: r || isNext ? 1 : 0.45,
                }}
              >
                {r ? (
                  <>
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: RARITY_STYLE[r.rarity].color }}>{RARITY_STYLE[r.rarity].label}</p>
                    <p className="text-[10px] font-bold leading-tight" style={{ color: 'var(--ff-text)' }}>{r.part.name}</p>
                  </>
                ) : (
                  <>
                    {!isNext && <Lock size={12} style={{ color: 'var(--ff-text-3)' }} className="mb-1" />}
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--ff-text-3)' }}>{cat.label}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Open button */}
        {!finalBuild && (
          <div className="flex justify-center mb-10">
            <motion.button
              onClick={openNext}
              disabled={opening}
              whileHover={{ scale: opening ? 1 : 1.04 }}
              whileTap={{ scale: opening ? 1 : 0.97 }}
              animate={opening ? { rotate: [0, -8, 8, -8, 8, 0] } : {}}
              transition={opening ? { duration: 0.75 } : { duration: 0.15 }}
              className="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl font-black text-white disabled:opacity-80"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
            >
              <Package size={40} />
              <span className="text-lg">{opening ? 'Opening…' : `Open ${nextCategory.label} Crate`}</span>
            </motion.button>
          </div>
        )}

        <AnimatePresence>
          {finalBuild && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <div
                className="rounded-3xl p-6 mb-6 text-center"
                style={{
                  backgroundColor: 'var(--ff-surface)',
                  border: `2px solid ${RARITY_STYLE[finalBuild.rarity].color}`,
                  boxShadow: `0 0 40px ${RARITY_STYLE[finalBuild.rarity].glow}`,
                }}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles size={16} style={{ color: RARITY_STYLE[finalBuild.rarity].color }} />
                  <span className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: RARITY_STYLE[finalBuild.rarity].color }}>
                    {RARITY_STYLE[finalBuild.rarity].label} Build
                  </span>
                  <Sparkles size={16} style={{ color: RARITY_STYLE[finalBuild.rarity].color }} />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Total Cost</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${finalBuild.totalCost.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Average FPS</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{finalBuild.avgFps}</p>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <CompatibilityBanner warnings={finalBuild.compat.warnings} passed={finalBuild.compat.passed} />
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
                <button onClick={resetCrate}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <RotateCcw size={15} /> Open New Crates
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {revealedCount === 0 && !opening && (
          <p className="text-xs text-center mt-4" style={{ color: 'var(--ff-text-3)' }}>
            Socket and RAM type are always guaranteed to be compatible. Everything else — fit, wattage, cooling — is part of the roll.{' '}
            <Link to="/builder" className="underline hover:opacity-80" style={{ color: 'var(--ff-text-2)' }}>Prefer to pick your own parts?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
