import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package, RotateCcw, Cpu, Share2, Sparkles, Lock, Upload, Volume2, VolumeX, Download, ImageDown, Flame, Clipboard,
  CircuitBoard, MemoryStick, MonitorSmartphone, HardDrive, Box, Fan, Zap, type LucideIcon,
} from 'lucide-react';
import {
  CRATE_CATEGORY_ORDER, RARITY_STYLE, rollMotherboard, rollCpu, rollRam, rollGpu, rollStorage, rollCase, rollCooler, rollPsu,
  getMotherboardPool, getCpuPool, getRamPool, getGpuPool, getStoragePool, getCasePool, getCoolerPool, getPsuPool,
  finalizeCrateBuild, type CrateBuild, type CrateRarity, type RolledPart,
  type CrateMotherboard, type CrateCpu, type CrateRam, type CrateGpu, type CrateStorage, type CrateCase, type CrateCooler, type CratePsu,
} from '../lib/buildCrate';
import { getBestPull, recordPullIfBest, type BestPull } from '../lib/crateBestPull';
import { isPityActive, pullsUntilPity, recordPullResult, PITY_THRESHOLD } from '../lib/cratePity';
import { playRaritySound, playSpinWhoosh, isCrateSoundMuted, setCrateSoundMuted } from '../lib/crateSound';
import { getShareUrl } from '../lib/sharing';
import { publishBuild } from '../lib/gallery';
import { recordGlobalPull } from '../lib/cratePulls';
import { downloadCrateCard, copyCrateCardToClipboard } from '../lib/crateCard';
import { isGalleryEnabled } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import CompatibilityBanner from '../components/CompatibilityBanner';
import CratePullsFeed from '../components/CratePullsFeed';
import PageGlow from '../components/PageGlow';

// How dramatic the landing effect gets, escalating per rarity tier.
const RARITY_INTENSITY: Record<CrateRarity, { particles: number; distance: number; shake: number; rays: boolean }> = {
  common:    { particles: 6,  distance: 40,  shake: 0,  rays: false },
  uncommon:  { particles: 10, distance: 55,  shake: 0,  rays: false },
  rare:      { particles: 14, distance: 70,  shake: 4,  rays: true },
  epic:      { particles: 20, distance: 95,  shake: 7,  rays: true },
  legendary: { particles: 28, distance: 130, shake: 11, rays: true },
};

// Category icons stand in for real product photos — we don't have licensed
// product photography to show yet (needs the Amazon Associates account or
// manufacturer press assets), so this is honest flavor rather than a fake
// per-product image.
const CATEGORY_ICON: Record<CategoryKey, LucideIcon> = {
  motherboard: CircuitBoard,
  cpu: Cpu,
  ram: MemoryStick,
  gpu: MonitorSmartphone,
  storage: HardDrive,
  case: Box,
  cooler: Fan,
  psu: Zap,
};

function LightRays({ color, count }: { color: string; count: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * 360;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 origin-left"
            style={{ width: 140, height: 3, background: `linear-gradient(90deg, ${color}, transparent)`, transform: `rotate(${angle}deg)` }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: [0, 0.85, 0], scaleX: [0, 1, 1.2] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

/** Rarity-colored flash + outward particle burst, triggered right as a reel
 * lands on its result. Escalates in particle count / spread / light rays
 * with rarity — a Common pull barely twinkles, Legendary gets the works. */
function LandingBurst({ color, rarity }: { color: string; rarity: CrateRarity }) {
  const cfg = RARITY_INTENSITY[rarity];
  const particles = useMemo(() => Array.from({ length: cfg.particles }, (_, i) => {
    const angle = (i / cfg.particles) * Math.PI * 2 + Math.random() * 0.4;
    const distance = cfg.distance * 0.6 + Math.random() * cfg.distance * 0.6;
    return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance, delay: Math.random() * 0.08 };
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const size = rarity === 'legendary' ? 6 : rarity === 'epic' ? 5 : 4;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 20 }}>
      {cfg.rays && <LightRays color={color} count={rarity === 'legendary' ? 10 : 7} />}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0.55 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        style={{ background: `radial-gradient(circle at 50% 50%, ${color}55, transparent 70%)` }}
      />
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ left: '50%', top: '50%', width: size, height: size, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.6, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Full-viewport gold flash + falling confetti — only for the rarest pulls. */
function LegendaryBlast() {
  const confetti = useMemo(() => Array.from({ length: 40 }, () => ({
    x: Math.random() * 100,
    delay: Math.random() * 0.4,
    duration: 1.4 + Math.random() * 0.8,
    rotate: Math.random() * 360,
    color: ['#FFD700', '#FFB300', '#FF6B00', '#FFFFFF'][Math.floor(Math.random() * 4)],
  })), []);

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 200 }}>
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.7 }}
        style={{ background: 'radial-gradient(circle at 50% 35%, rgba(255,215,0,0.35), transparent 60%)' }}
      />
      {confetti.map((c, i) => (
        <motion.div
          key={i}
          className="absolute rounded-sm"
          style={{ left: `${c.x}%`, top: -20, width: 8, height: 8, backgroundColor: c.color }}
          initial={{ y: 0, opacity: 1, rotate: 0 }}
          animate={{ y: '110vh', opacity: [1, 1, 0], rotate: c.rotate }}
          transition={{ duration: c.duration, delay: c.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

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

type CategoryKey = keyof RevealedState;

interface PendingReveal {
  key: CategoryKey;
  part: { name: string };
  rarity: CrateRarity;
  apply: (updated: RevealedState) => void;
}

const REEL_ITEM_WIDTH = 128;
const REEL_VISIBLE_WIDTH = 384;
const REEL_LANDING_INDEX = 26;

function CrateReel({ category, pool, finalName, rarity, onLand, onComplete }: {
  category: CategoryKey; pool: { name: string }[]; finalName: string; rarity: CrateRarity;
  onLand: (rarity: CrateRarity) => void; onComplete: () => void;
}) {
  const [landed, setLanded] = useState(false);
  const Icon = CATEGORY_ICON[category];

  const strip = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < REEL_LANDING_INDEX; i++) arr.push(pool[Math.floor(Math.random() * pool.length)].name);
    arr.push(finalName);
    for (let i = 0; i < 4; i++) arr.push(pool[Math.floor(Math.random() * pool.length)].name);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetX = -(REEL_LANDING_INDEX * REEL_ITEM_WIDTH + REEL_ITEM_WIDTH / 2 - REEL_VISIBLE_WIDTH / 2);

  const handleSpinComplete = () => {
    setLanded(true);
    onLand(rarity);
    setTimeout(onComplete, 480);
  };

  return (
    <div className="relative mx-auto mb-8 overflow-hidden rounded-2xl"
      style={{
        width: REEL_VISIBLE_WIDTH, maxWidth: '100%', height: 92,
        backgroundColor: 'var(--ff-surface)',
        border: landed ? `1.5px solid ${RARITY_STYLE[rarity].color}` : '1px solid var(--ff-border)',
        boxShadow: landed ? `0 0 24px ${RARITY_STYLE[rarity].glow}` : undefined,
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}>
      <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: '50%', width: 2, backgroundColor: 'var(--ff-accent)', boxShadow: '0 0 8px var(--ff-accent)' }} />
      <div className="absolute inset-x-0 top-0 h-6 z-10 pointer-events-none" style={{ background: 'linear-gradient(180deg, var(--ff-surface), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 h-6 z-10 pointer-events-none" style={{ background: 'linear-gradient(0deg, var(--ff-surface), transparent)' }} />
      <motion.div
        className="flex items-center h-full"
        initial={{ x: 0 }}
        animate={{ x: targetX }}
        transition={{ duration: 2.3, ease: [0.1, 0.7, 0.2, 1] }}
        onAnimationComplete={handleSpinComplete}
      >
        {strip.map((name, i) => (
          <div key={i} className="flex-shrink-0 flex flex-col items-center justify-center text-center gap-1 px-3" style={{ width: REEL_ITEM_WIDTH }}>
            <Icon size={18} style={{ color: i === REEL_LANDING_INDEX ? 'var(--ff-accent)' : 'var(--ff-text-3)' }} />
            <span className="text-xs font-bold leading-tight" style={{ color: i === REEL_LANDING_INDEX ? 'var(--ff-text)' : 'var(--ff-text-2)' }}>{name}</span>
          </div>
        ))}
      </motion.div>
      {landed && <LandingBurst color={RARITY_STYLE[rarity].color} rarity={rarity} />}
    </div>
  );
}

// Cold traffic from short-form video lands here with zero context about
// SpecSmith, so this stays short and always visible (not gated behind an
// accordion). Generated into FAQPage JSON-LD below so it can't drift from
// what's actually on the page.
const crateFaqSections = [
  {
    title: 'Is this a real PC build, or just a random image?',
    content: 'Every pull comes from SpecSmith\'s real parts database — the build you get is a genuine, buildable PC with real prices and real compatibility, not a random generator making things up.',
  },
  {
    title: 'Do I have to buy anything?',
    content: 'No. Build Crate is 100% free to open, no account or purchase required. If you like your pull, you can send it straight to the Builder to fine-tune it, or just enjoy the pull.',
  },
  {
    title: 'How is rarity decided?',
    content: 'Each part you land on is weighted toward the lower end of its category, and rarity (Common through Legendary) reflects roughly where that part ranks against everything else in its category — landing a top-tier GPU is rarer than landing an entry-level one.',
  },
  {
    title: 'Can I keep opening crates?',
    content: 'Yes — hit "Open New Crates" to start over anytime. There\'s also a pity system: go too long without a Rare-or-better pull and your next crate is guaranteed one.',
  },
];

const crateFaqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: crateFaqSections.map((s) => ({
    '@type': 'Question',
    name: s.title,
    acceptedAnswer: { '@type': 'Answer', text: s.content },
  })),
};

export default function BuildCrate() {
  useSeo(getRouteMeta('/crate'));
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [socket, setSocket] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedState>({});
  const [pending, setPending] = useState<PendingReveal | null>(null);
  const [finalBuild, setFinalBuild] = useState<CrateBuild | null>(null);
  const [bestPull, setBestPull] = useState<BestPull | null>(null);
  const [shake, setShake] = useState(0);
  const [legendaryBlast, setLegendaryBlast] = useState(false);
  const [muted, setMuted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pityActive, setPityActive] = useState(false);
  const [pullsLeft, setPullsLeft] = useState(PITY_THRESHOLD);
  const [cardState, setCardState] = useState<'idle' | 'downloading' | 'copying' | 'copied'>('idle');

  useEffect(() => {
    setBestPull(getBestPull());
    setMuted(isCrateSoundMuted());
    setPityActive(isPityActive());
    setPullsLeft(pullsUntilPity());
  }, []);

  const revealedCount = CRATE_CATEGORY_ORDER.filter(c => revealed[c.key]).length;
  const nextCategory = CRATE_CATEGORY_ORDER[revealedCount];

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setCrateSoundMuted(next);
  };

  const handleLand = (rarity: CrateRarity) => {
    playRaritySound(rarity);
    const cfg = RARITY_INTENSITY[rarity];
    if (cfg.shake > 0) setShake(cfg.shake);
    if (rarity === 'legendary') {
      setLegendaryBlast(true);
      setTimeout(() => setLegendaryBlast(false), 1800);
    }
  };

  const openNext = () => {
    if (!nextCategory || pending) return;
    playSpinWhoosh();
    const key = nextCategory.key;

    if (key === 'motherboard') {
      const r = rollMotherboard();
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.motherboard = r; } });
      setSocket(r.socket);
    } else if (key === 'cpu') {
      const r = rollCpu(socket!, pityActive);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.cpu = r; } });
    } else if (key === 'ram') {
      const r = rollRam(revealed.motherboard!.part.supported_ram[0]);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.ram = r; } });
    } else if (key === 'gpu') {
      const r = rollGpu(pityActive);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.gpu = r; } });
    } else if (key === 'storage') {
      const r = rollStorage();
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.storage = r; } });
    } else if (key === 'case') {
      const r = rollCase(revealed.motherboard!.part.form_factor, revealed.gpu!.part.length_mm);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.case = r; } });
    } else if (key === 'cooler') {
      const r = rollCooler(revealed.case!.part.cooler_clearance_mm, revealed.cpu!.part.tdp_watts);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.cooler = r; } });
    } else {
      const r = rollPsu(revealed.gpu!.part.tdp_watts, revealed.cpu!.part.tdp_watts);
      setPending({ key, part: r.part, rarity: r.rarity, apply: u => { u.psu = r; } });
    }
  };

  const handleReelComplete = () => {
    if (!pending) return;
    const updated: RevealedState = { ...revealed };
    pending.apply(updated);
    setRevealed(updated);
    setPending(null);

    if (updated.motherboard && updated.cpu && updated.ram && updated.gpu && updated.storage && updated.case && updated.cooler && updated.psu) {
      const fb = finalizeCrateBuild({
        gpu: updated.gpu.part, cpu: updated.cpu.part, motherboard: updated.motherboard.part,
        ram: updated.ram.part, storage: updated.storage.part, case: updated.case.part,
        cooler: updated.cooler.part, psu: updated.psu.part,
      });
      setFinalBuild(fb);
      setBestPull(recordPullIfBest({ rarity: fb.rarity, gpuName: fb.gpu.name, cpuName: fb.cpu.name, totalCost: fb.totalCost, avgFps: fb.avgFps }));
      recordPullResult(fb.rarity);
      recordGlobalPull(fb, user?.username ?? 'Anonymous');
    }
  };

  const resetCrate = () => {
    setSocket(null);
    setRevealed({});
    setPending(null);
    setFinalBuild(null);
    setPityActive(isPityActive());
    setPullsLeft(pullsUntilPity());
  };

  const buildWithThis = () => {
    if (!finalBuild) return;
    const qs = Object.entries(finalBuild.buildState).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    navigate(`/builder?${qs}`);
  };

  const copyShareLink = async () => {
    if (!finalBuild) return;
    const url = getShareUrl(finalBuild.buildState, `${RARITY_STYLE[finalBuild.rarity].label} Build Crate`);
    // Prefer the OS share sheet on mobile — the exact device this page is
    // usually opened on — falling back to a plain clipboard copy.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${RARITY_STYLE[finalBuild.rarity].label} Build Crate pull`, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    navigator.clipboard.writeText(url);
    showToast('Share link copied', 'success');
  };

  // A ready-to-paste caption for whoever's filming their pull — references
  // the actual rarity and parts landed on, so it doesn't read as generic
  // copy-pasted filler.
  const copyCaption = () => {
    if (!finalBuild) return;
    const rarity = RARITY_STYLE[finalBuild.rarity].label;
    const caption = `I built a website that randomly generates gaming PCs... it gave me a ${rarity} pull (${finalBuild.gpu.name} + ${finalBuild.cpu.name}). Rate it 1-10 👇\n\n#pcbuild #webdev #gamingpc #fyp #techtok #buildinpublic`;
    navigator.clipboard.writeText(caption);
    showToast('Caption copied', 'success');
  };

  const publishToGallery = async () => {
    if (!finalBuild || !user) return;
    setPublishing(true);
    const result = await publishBuild(`${RARITY_STYLE[finalBuild.rarity].label} Crate Pull`, finalBuild.buildState, user.username);
    setPublishing(false);
    showToast(result.ok ? 'Published to the Gallery' : result.error, result.ok ? 'success' : 'error');
  };

  const crateCardOptions = () => {
    if (!finalBuild) return null;
    return {
      rarity: finalBuild.rarity,
      totalCost: finalBuild.totalCost,
      avgFps: finalBuild.avgFps,
      parts: CRATE_CATEGORY_ORDER.map(c => {
        const r = revealed[c.key]!;
        return { label: c.label, name: r.part.name, rarity: r.rarity };
      }),
    };
  };

  const handleDownloadCard = async () => {
    const options = crateCardOptions();
    if (!options || cardState !== 'idle') return;
    setCardState('downloading');
    try { await downloadCrateCard(options); } finally { setCardState('idle'); }
  };

  const handleCopyCard = async () => {
    const options = crateCardOptions();
    if (!options || cardState !== 'idle') return;
    setCardState('copying');
    try {
      await copyCrateCardToClipboard(options);
      setCardState('copied');
      setTimeout(() => setCardState('idle'), 2000);
    } catch {
      setCardState('idle');
      showToast('Failed to copy image', 'error');
    }
  };

  const pendingPool = pending && (
    pending.key === 'motherboard' ? getMotherboardPool() :
    pending.key === 'cpu' ? getCpuPool(socket!) :
    pending.key === 'ram' ? getRamPool(revealed.motherboard!.part.supported_ram[0]) :
    pending.key === 'gpu' ? getGpuPool() :
    pending.key === 'storage' ? getStoragePool() :
    pending.key === 'case' ? getCasePool() :
    pending.key === 'cooler' ? getCoolerPool() :
    getPsuPool()
  );

  return (
    <motion.div
      className="relative min-h-screen pt-24 pb-20"
      style={{ backgroundColor: 'var(--ff-bg)' }}
      animate={shake ? { x: [0, -shake, shake, -shake * 0.6, shake * 0.6, -shake * 0.3, shake * 0.3, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
      onAnimationComplete={() => setShake(0)}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crateFaqJsonLd) }} />
      <PageGlow variant="warm" />
      <AnimatePresence>{legendaryBlast && <LegendaryBlast />}</AnimatePresence>
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex justify-end mb-1">
          <button onClick={toggleMute} title={muted ? 'Unmute crate sounds' : 'Mute crate sounds'}
            className="p-2 rounded-lg transition-opacity hover:opacity-70" style={{ color: 'var(--ff-text-3)' }}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-4">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Build <span className="gradient-text">Crate</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Open one crate per part. First crate sets your platform — everything after it is guaranteed to fit that platform.
          </p>
        </motion.div>

        {bestPull && (
          <p className="text-xs text-center mb-2" style={{ color: 'var(--ff-text-3)' }}>
            Your best pull: <span style={{ color: RARITY_STYLE[bestPull.rarity].color, fontWeight: 700 }}>{RARITY_STYLE[bestPull.rarity].label}</span>{' '}
            — {bestPull.gpuName} + {bestPull.cpuName}
          </p>
        )}

        {!finalBuild && !pending && revealedCount === 0 && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-center mb-6" style={{ color: pityActive ? '#FF9800' : 'var(--ff-text-3)' }}>
            <Flame size={12} />
            {pityActive
              ? 'Pity active — this crate is guaranteed Rare or better'
              : `${pullsLeft} more sub-Rare pull${pullsLeft === 1 ? '' : 's'} until guaranteed Rare+`}
          </p>
        )}

        {/* Slot row */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-8">
          {CRATE_CATEGORY_ORDER.map((cat, i) => {
            const r = revealed[cat.key];
            const isNext = i === revealedCount && !finalBuild;
            const Icon = CATEGORY_ICON[cat.key];
            return (
              <motion.div key={cat.key}
                initial={r ? { scale: 0.7, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
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
                    <Icon size={14} style={{ color: RARITY_STYLE[r.rarity].color }} className="mb-0.5" />
                    <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: RARITY_STYLE[r.rarity].color }}>{RARITY_STYLE[r.rarity].label}</p>
                    <p className="text-[10px] font-bold leading-tight" style={{ color: 'var(--ff-text)' }}>{r.part.name}</p>
                  </>
                ) : (
                  <>
                    {!isNext && <Lock size={12} style={{ color: 'var(--ff-text-3)' }} className="mb-1" />}
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--ff-text-3)' }}>{cat.label}</p>
                  </>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Spinning reel while a crate is opening */}
        {pending && pendingPool && (
          <CrateReel category={pending.key} pool={pendingPool} finalName={pending.part.name} rarity={pending.rarity} onLand={handleLand} onComplete={handleReelComplete} />
        )}

        {/* Open button */}
        {!finalBuild && !pending && (
          <div className="flex justify-center mb-10">
            <motion.button
              onClick={openNext}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="flex flex-col items-center gap-3 px-10 py-8 rounded-3xl font-black text-white"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
            >
              <Package size={40} />
              <span className="text-lg">Open {nextCategory.label} Crate</span>
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
                className="relative rounded-3xl p-6 mb-6 text-center"
                style={{
                  backgroundColor: 'var(--ff-surface)',
                  border: `2px solid ${RARITY_STYLE[finalBuild.rarity].color}`,
                  boxShadow: `0 0 40px ${RARITY_STYLE[finalBuild.rarity].glow}`,
                }}
              >
                {(finalBuild.rarity === 'epic' || finalBuild.rarity === 'legendary') && (
                  <LandingBurst color={RARITY_STYLE[finalBuild.rarity].color} rarity={finalBuild.rarity} />
                )}
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

              <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center">
                <button onClick={buildWithThis}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                  <Cpu size={15} /> Build With This
                </button>
                <button onClick={copyShareLink}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <Share2 size={15} /> Share Link
                </button>
                <button onClick={copyCaption}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <Clipboard size={15} /> Copy Caption
                </button>
                <button onClick={handleDownloadCard}
                  disabled={cardState !== 'idle'}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ border: `1px solid ${RARITY_STYLE[finalBuild.rarity].color}`, color: RARITY_STYLE[finalBuild.rarity].color }}>
                  <Download size={15} /> {cardState === 'downloading' ? 'Saving…' : 'Download Card'}
                </button>
                <button onClick={handleCopyCard}
                  disabled={cardState !== 'idle'}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ border: `1px solid ${RARITY_STYLE[finalBuild.rarity].color}`, color: RARITY_STYLE[finalBuild.rarity].color }}>
                  <ImageDown size={15} /> {cardState === 'copying' ? 'Copying…' : cardState === 'copied' ? 'Copied!' : 'Copy Image'}
                </button>
                {user ? (
                  <button onClick={publishToGallery}
                    disabled={!isGalleryEnabled || publishing}
                    title={!isGalleryEnabled ? "Gallery isn't live yet" : undefined}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40"
                    style={{ backgroundColor: '#00E67612', color: 'var(--ff-green)' }}>
                    <Upload size={15} /> {publishing ? 'Publishing…' : 'Publish to Gallery'}
                  </button>
                ) : (
                  <Link to="/login"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                    <Upload size={15} /> Log In to Publish
                  </Link>
                )}
                <button onClick={resetCrate}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                  <RotateCcw size={15} /> Open New Crates
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {revealedCount === 0 && !pending && (
          <p className="text-xs text-center mt-4" style={{ color: 'var(--ff-text-3)' }}>
            Every part is guaranteed to fit and work together — socket, RAM, case clearance, cooler height, and power headroom. What's random is only how good the parts you land on are.{' '}
            <Link to="/builder" className="underline hover:opacity-80" style={{ color: 'var(--ff-text-2)' }}>Prefer to pick your own parts?</Link>
          </p>
        )}

        <CratePullsFeed />

        <div className="mt-12 space-y-3">
          {crateFaqSections.map((s) => (
            <div key={s.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{s.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{s.content}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
