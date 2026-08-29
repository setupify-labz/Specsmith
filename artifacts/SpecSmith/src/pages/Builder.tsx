import { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import PartSelector from '../components/PartSelector';
import BuildSummary from '../components/BuildSummary';
import CompatibilityBanner from '../components/CompatibilityBanner';
import FpsEstimator from '../components/FpsEstimator';
import VerifiedBenchmarkPanel from '../components/VerifiedBenchmarkPanel';
import { useBuilder, type BuildState } from '../hooks/useBuilder';
import { checkCompatibility } from '../lib/compatibility';
import { decodeBuild } from '../lib/sharing';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import peripheralData from '../data/peripherals.json';
import { ChevronDown, Monitor as MonitorIcon, Sparkles } from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { useAffiliatePartCatalog } from '../hooks/useAffiliatePartCatalog';
import type { AffiliatePart, RetailPartCategory } from '../lib/retail/partCatalog';

type Resolution = '1080p' | '1440p' | '4k';
type Preset = 'low' | 'medium' | 'high' | 'ultra';

const VALID_RESOLUTIONS: Resolution[] = ['1080p', '1440p', '4k'];
const VALID_PRESETS: Preset[] = ['low', 'medium', 'high', 'ultra'];

interface GPU { id: string; name: string; brand: string; series: string; price_usd: number; tier: number; vram_gb: number; tdp_watts: number; architecture: string; release_year: number; benchmark_score: number; gpu_multiplier: number; sponsored?: boolean; [key: string]: unknown; }
interface CPU { id: string; name: string; brand: string; series: string; price_usd: number; tier: number; cores: number; threads: number; base_ghz: number; boost_ghz: number; tdp_watts: number; socket: string; supported_ram: string[]; release_year: number; benchmark_score: number; cpu_multiplier: number; sponsored?: boolean; [key: string]: unknown; }
interface Motherboard { id: string; name: string; brand: string; price_usd: number; socket: string; supported_ram: string[]; form_factor: string; sponsored?: boolean; [key: string]: unknown; }
interface RAM { id: string; name: string; brand: string; price_usd: number; type: string; capacity_gb: number; speed_mhz: number; sponsored?: boolean; [key: string]: unknown; }
interface Storage { id: string; name: string; brand: string; price_usd: number; type: string; capacity_tb: number; speed_mbs: number; sponsored?: boolean; [key: string]: unknown; }
interface PSU { id: string; name: string; brand: string; price_usd: number; wattage: number; rating: string; sponsored?: boolean; [key: string]: unknown; }
interface Case { id: string; name: string; brand: string; price_usd: number; form_factor: string; motherboard_support: string[]; sponsored?: boolean; [key: string]: unknown; }
interface Cooler { id: string; name: string; brand: string; price_usd: number; type: string; max_tdp_watts: number; sponsored?: boolean; [key: string]: unknown; }
interface Monitor { id: string; name: string; brand: string; price_usd: number; size_inches: number; resolution: string; panel_type: string; refresh_rate_hz: number; response_time_ms: number; hdr: boolean | string; g_sync: boolean | string; freesync: boolean; release_year: number; [key: string]: unknown; }
interface Keyboard { id: string; name: string; brand: string; price_usd: number; switch_type: string; form_factor: string; rgb: boolean; wireless: boolean; release_year: number; [key: string]: unknown; }
interface Mouse { id: string; name: string; brand: string; price_usd: number; dpi_max: number; weight_grams: number; wireless: boolean; rgb: boolean; buttons: number; release_year: number; [key: string]: unknown; }
interface Headset { id: string; name: string; brand: string; price_usd: number; driver_mm: number; surround_sound: string; wireless: boolean; noise_cancelling: boolean; microphone: boolean; release_year: number; [key: string]: unknown; }
interface Game { id: string; name: string; genre: string; year: number; gpu_bound?: number; base_fps: Record<Resolution, Record<Preset, number>>; [key: string]: unknown; }

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

const builderFaqs = [
  {
    title: 'How accurate are the FPS estimates for my exact build?',
    content: 'They use the same transparent tier-based algorithm explained on the About page, applied to whatever specific GPU/CPU/game/resolution/preset combination you\'ve picked here — not a generic average. Estimates are a planning guide, not a guarantee; real-world results vary by driver version, game patch, and background load. For a real, cited benchmark instead of an estimate, check Verified Benchmarks below the estimator — coverage is still small, so it won\'t have every combination yet.',
  },
  {
    title: 'Can I add a part that isn\'t in the list?',
    content: 'Yes — use "Add Custom Part" in the build summary to enter any component by name and price so it\'s included in your total cost. Custom parts don\'t have benchmark data in our dataset, so they won\'t affect the FPS estimate or compatibility checks — those still run on the tracked GPU and CPU you\'ve selected.',
  },
  {
    title: 'Does the total price include sales tax?',
    content: 'No, prices exclude sales tax by default. The build summary has an optional field where you can enter your local tax rate to see an estimated with-tax total — nothing is added automatically since rates vary by location.',
  },
  {
    title: 'What do the compatibility warnings actually mean?',
    content: 'Each one explains the specific reason for the conflict, a suggested fix, and how confident we are — "certain" for hard incompatibilities (like a socket mismatch) versus "likely" for things that depend on factors we can\'t fully verify (like exact case clearance). They\'re not just a red flag — click into one to see the reasoning.',
  },
];

function builderFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: builderFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

function getResolutionTier(res: string): number {
  if (res === '4K' || res === '5120x1440p') return 4;
  if (res === '3440x1440p' || res === '1440p') return 2;
  return 1;
}

export default function Builder() {
  useSeo(getRouteMeta('/builder'));
  const [searchParams] = useSearchParams();
  const [peripheralsOpen, setPeripheralsOpen] = useState(false);
  const affiliateCatalog = useAffiliatePartCatalog();

  const retailByCategory = useMemo(() => {
    const grouped = new Map<RetailPartCategory, AffiliatePart[]>();
    if (affiliateCatalog.status !== 'ok') return grouped;
    for (const part of affiliateCatalog.catalog.parts) {
      const list = grouped.get(part.category) ?? [];
      list.push(part);
      grouped.set(part.category, list);
    }
    return grouped;
  }, [affiliateCatalog]);

  const retailBase = (part: AffiliatePart) => ({
    id: part.id,
    name: part.name,
    image: part.imageUrl,
    affiliateUrl: part.trackedAffiliateUrl,
    specsVerified: part.specsVerified,
    canonicalPartId: part.canonicalPartId,
    retailPart: true,
  });

  const builderGpus = useMemo<GPU[]>(() => {
    const retail = retailByCategory.get('gpu') ?? [];
    const firstLink = new Map<string, AffiliatePart>();
    for (const part of retail) if (part.canonicalPartId && !firstLink.has(part.canonicalPartId)) firstLink.set(part.canonicalPartId, part);
    const canonical = gpus.map((gpu) => {
      const offer = firstLink.get(gpu.id);
      return {
        ...gpu,
        image: `/images/gpus/${gpu.id}.png`,
        specsVerified: true,
        ...(offer ? { affiliateUrl: offer.trackedAffiliateUrl } : {}),
      };
    });
    const skuParts = retail.flatMap((part) => {
      const base = gpus.find((gpu) => gpu.id === part.canonicalPartId);
      return base ? [{ ...base, ...retailBase(part), price_usd: undefined } as unknown as GPU] : [];
    });
    return [...canonical, ...skuParts];
  }, [retailByCategory]);

  const builderCpus = useMemo<CPU[]>(() => [
    ...cpus.map((part) => ({ ...part, specsVerified: true })),
    ...(retailByCategory.get('cpu') ?? []).map((part) => ({ ...retailBase(part), price_usd: undefined } as unknown as CPU)),
  ], [retailByCategory]);

  const withRetail = <T extends { id: string }>(category: RetailPartCategory, canonical: T[]): T[] => [
    ...canonical.map((part) => ({ ...part, specsVerified: true })),
    ...(retailByCategory.get(category) ?? []).map((part) => ({ ...retailBase(part), price_usd: undefined } as unknown as T)),
  ];

  const builderMotherboards = useMemo(() => withRetail('motherboard', componentData.motherboards as Motherboard[]), [retailByCategory]);
  const builderRam = useMemo(() => withRetail('ram', componentData.ram as RAM[]), [retailByCategory]);
  const builderStorage = useMemo(() => withRetail('storage', componentData.storage as Storage[]), [retailByCategory]);
  const builderPsus = useMemo(() => withRetail('psu', componentData.psus as PSU[]), [retailByCategory]);
  const builderCases = useMemo(() => withRetail('case', componentData.cases as Case[]), [retailByCategory]);
  const builderCoolers = useMemo(() => withRetail('cooler', componentData.coolers as Cooler[]), [retailByCategory]);
  const builderMonitors = useMemo(() => withRetail('monitor', peripheralData.monitors as Monitor[]), [retailByCategory]);
  const builderKeyboards = useMemo(() => withRetail('keyboard', peripheralData.keyboards as Keyboard[]), [retailByCategory]);
  const builderMice = useMemo(() => withRetail('mouse', peripheralData.mice as Mouse[]), [retailByCategory]);
  const builderHeadsets = useMemo(() => withRetail('headset', peripheralData.headsets as Headset[]), [retailByCategory]);

  // Parse initial state from URL params (from prebuilts "Load into Builder" or share link)
  const initialBuild = useMemo(() => {
    const b = searchParams.get('b');
    if (b) {
      const decoded = decodeBuild(decodeURIComponent(b));
      if (decoded) return decoded.build as Partial<BuildState>;
    }
    const keys: (keyof BuildState)[] = ['gpu','cpu','motherboard','ram','storage','psu','case','cooler','monitor','keyboard','mouse','headset'];
    const fromParams: Partial<BuildState> = {};
    let hasAny = false;
    keys.forEach(k => {
      const v = searchParams.get(k);
      if (v) { fromParams[k] = v; hasAny = true; }
    });
    return hasAny ? fromParams : undefined;
  }, []);

  const { build, selectPart, loadBuild, clearBuild } = useBuilder(initialBuild);
  const [showFps, setShowFps] = useState(false);
  const [fpsResolution, setFpsResolution] = useState<Resolution>('1080p');
  const [fpsPreset, setFpsPreset] = useState<Preset>('high');
  const [customParts, setCustomParts] = useState<{ id: string; name: string; price: number }[]>([]);
  const addCustomPart = (name: string, price: number) =>
    setCustomParts(list => [...list, { id: `custom-${Date.now()}`, name, price }]);
  const removeCustomPart = (id: string) =>
    setCustomParts(list => list.filter(p => p.id !== id));
  const startOver = () => {
    clearBuild();
    setCustomParts([]);
    setShowFps(false);
  };
  const importBuild = (imported: { build: Record<string, string | null>; view: { resolution: string; preset: string } | null; customParts: { name: string; price: number }[] }) => {
    loadBuild(imported.build);
    if (imported.view
      && (VALID_RESOLUTIONS as string[]).includes(imported.view.resolution)
      && (VALID_PRESETS as string[]).includes(imported.view.preset)) {
      setFpsResolution(imported.view.resolution as Resolution);
      setFpsPreset(imported.view.preset as Preset);
    }
    setCustomParts(imported.customParts.map((cp, i) => ({ id: `custom-${Date.now()}-${i}`, name: cp.name, price: cp.price })));
    setShowFps(false);
  };
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);

  const gpuSectionRef = useRef<HTMLDivElement>(null);
  const cpuSectionRef = useRef<HTMLDivElement>(null);
  const fpsSectionRef = useRef<HTMLDivElement>(null);

  const selectedGpu = builderGpus.find(g => g.id === build.gpu) ?? null;
  const selectedCpu = builderCpus.find(c => c.id === build.cpu) ?? null;
  const selectedMb = builderMotherboards.find(m => m.id === build.motherboard) ?? null;
  const selectedRam = builderRam.find(r => r.id === build.ram) ?? null;
  const selectedStorage = builderStorage.find(s => s.id === build.storage) ?? null;
  const selectedPsu = builderPsus.find(p => p.id === build.psu) ?? null;
  const selectedCase = builderCases.find(c => c.id === build.case) ?? null;
  const selectedCooler = builderCoolers.find(c => c.id === build.cooler) ?? null;
  const selectedMonitor = builderMonitors.find(m => m.id === build.monitor) ?? null;
  const selectedKeyboard = builderKeyboards.find(k => k.id === build.keyboard) ?? null;
  const selectedMouse = builderMice.find(m => m.id === build.mouse) ?? null;
  const selectedHeadset = builderHeadsets.find(h => h.id === build.headset) ?? null;

  const compat = useMemo(() => {
    const result = checkCompatibility({
      gpu: selectedGpu, cpu: selectedCpu, motherboard: selectedMb, ram: selectedRam,
      psu: selectedPsu, case: selectedCase, cooler: selectedCooler,
    });
    // Monitor pairing warnings
    if (selectedMonitor && selectedGpu && typeof selectedMonitor.resolution === 'string' && typeof selectedMonitor.refresh_rate_hz === 'number' && typeof selectedGpu.tier === 'number') {
      const res = selectedMonitor.resolution;
      const hz = selectedMonitor.refresh_rate_hz;
      const tier = selectedGpu.tier;
      if ((res === '4K' || res === '5120x1440p') && tier < 7) {
        result.warnings.push({
          id: 'monitor-4k', type: 'warning', confidence: 'likely',
          title: 'GPU may struggle at this monitor\'s resolution',
          detail: `${selectedMonitor.name} is ${res}, which is demanding — ${selectedGpu.name} will need lowered settings or upscaling to keep smooth frame rates there.`,
          fix: 'Consider a stronger GPU, a 1440p monitor, or plan on using DLSS/FSR.',
        });
      } else if (getResolutionTier(res) >= 2 && tier < 5) {
        result.warnings.push({
          id: 'monitor-1440p', type: 'warning', confidence: 'likely',
          title: 'GPU may struggle at 1440p on this monitor',
          detail: `${selectedGpu.name} is an entry-level card for ${res} — expect medium settings in demanding games.`,
          fix: 'A mid-tier or better GPU pairs more comfortably with this monitor.',
        });
      }
      if (hz >= 360 && tier < 8) {
        result.warnings.push({
          id: 'monitor-refresh', type: 'warning', confidence: 'likely',
          title: `GPU won't feed this ${hz}Hz monitor in most games`,
          detail: `${hz}Hz only pays off when the GPU can produce ${hz}+ FPS — realistic for esports titles on this card, but not in demanding games.`,
          fix: 'Fine if you mainly play esports titles; otherwise a high-end GPU makes better use of this panel.',
        });
      }
    }
    return result;
  }, [selectedGpu, selectedCpu, selectedMb, selectedRam, selectedPsu, selectedCase, selectedCooler, selectedMonitor]);
  const warnings = compat.warnings;
  const monitorWarningCount = warnings.filter(w => w.id.startsWith('monitor-')).length;

  const corePartsList = [
    selectedGpu     && { label: 'GPU',         name: selectedGpu.name,     price: selectedGpu.price_usd, affiliateUrl: selectedGpu.affiliateUrl as string | undefined },
    selectedCpu     && { label: 'CPU',         name: selectedCpu.name,     price: selectedCpu.price_usd, affiliateUrl: selectedCpu.affiliateUrl as string | undefined },
    selectedMb      && { label: 'Motherboard', name: selectedMb.name,      price: selectedMb.price_usd, affiliateUrl: selectedMb.affiliateUrl as string | undefined },
    selectedRam     && { label: 'RAM',         name: selectedRam.name,     price: selectedRam.price_usd, affiliateUrl: selectedRam.affiliateUrl as string | undefined },
    selectedStorage && { label: 'Storage',     name: selectedStorage.name, price: selectedStorage.price_usd, affiliateUrl: selectedStorage.affiliateUrl as string | undefined },
    selectedPsu     && { label: 'PSU',         name: selectedPsu.name,     price: selectedPsu.price_usd, affiliateUrl: selectedPsu.affiliateUrl as string | undefined },
    selectedCase    && { label: 'Case',        name: selectedCase.name,    price: selectedCase.price_usd, affiliateUrl: selectedCase.affiliateUrl as string | undefined },
    selectedCooler  && { label: 'Cooler',      name: selectedCooler.name,  price: selectedCooler.price_usd, affiliateUrl: selectedCooler.affiliateUrl as string | undefined },
  ].filter(Boolean) as { label: string; name: string; price?: number; affiliateUrl?: string }[];

  const peripheralPartsList = [
    selectedMonitor  && { label: 'Monitor',  name: selectedMonitor.name,  price: selectedMonitor.price_usd, affiliateUrl: selectedMonitor.affiliateUrl as string | undefined },
    selectedKeyboard && { label: 'Keyboard', name: selectedKeyboard.name, price: selectedKeyboard.price_usd, affiliateUrl: selectedKeyboard.affiliateUrl as string | undefined },
    selectedMouse    && { label: 'Mouse',    name: selectedMouse.name,    price: selectedMouse.price_usd, affiliateUrl: selectedMouse.affiliateUrl as string | undefined },
    selectedHeadset  && { label: 'Headset',  name: selectedHeadset.name,  price: selectedHeadset.price_usd, affiliateUrl: selectedHeadset.affiliateUrl as string | undefined },
  ].filter(Boolean) as { label: string; name: string; price?: number; affiliateUrl?: string }[];

  const summaryParts = [
    ...corePartsList,
    ...peripheralPartsList,
    ...customParts.map(cp => ({ label: 'Custom', name: cp.name, price: cp.price, customId: cp.id })),
  ];
  const totalCost = summaryParts.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const canEstimate = Boolean(
    selectedGpu && selectedCpu &&
    typeof selectedGpu.gpu_multiplier === 'number' && Number.isFinite(selectedGpu.gpu_multiplier) &&
    typeof selectedCpu.cpu_multiplier === 'number' && Number.isFinite(selectedCpu.cpu_multiplier),
  );

  const buildState: Record<string, string | null> = {
    gpu: build.gpu, cpu: build.cpu,
    motherboard: build.motherboard, ram: build.ram,
    storage: build.storage, psu: build.psu,
    case: build.case, cooler: build.cooler,
    monitor: build.monitor ?? null,
    keyboard: build.keyboard ?? null,
    mouse: build.mouse ?? null,
    headset: build.headset ?? null,
  };

  const handleEstimateFps = () => {
    setShowFps(true);
    // Wait a tick so the FPS section has mounted before scrolling to it —
    // scrolls every time the button is clicked, not just the first.
    requestAnimationFrame(() => {
      fpsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleScrollToGpu = () => {
    gpuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight top GPUs
    if (selectedCpu) {
      const top3 = typeof selectedCpu.benchmark_score === 'number'
        ? gpus.filter(g => g.benchmark_score >= selectedCpu.benchmark_score * 0.72).slice(0, 3).map(g => g.id)
        : [];
      setRecommendedIds(top3);
      setTimeout(() => setRecommendedIds([]), 3500);
    }
  };
  const handleScrollToCpu = () => {
    cpuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (selectedGpu) {
      const top3 = cpus.filter(c => c.benchmark_score >= selectedGpu.benchmark_score / 1.4).slice(0, 3).map(c => c.id);
      setRecommendedIds(top3);
      setTimeout(() => setRecommendedIds([]), 3500);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(builderFaqJsonLd()) }} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            PC <span className="gradient-text">Builder</span>
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>Select your components and estimate FPS across 20 games.</p>

          {corePartsList.length === 0 && (
            <Link to="/quiz" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 hover:opacity-80"
              style={{ color: 'var(--ff-accent-text)' }}>
              <Sparkles size={12} /> Not sure where to start? Take the 2-question PC Build Quiz →
            </Link>
          )}

          <div className="flex items-center gap-3 max-w-xs">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ff-border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, var(--ff-accent), var(--ff-cyan))' }}
                initial={{ width: 0 }}
                animate={{ width: `${(corePartsList.length / 8) * 100}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
            <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--ff-text-2)' }}>
              {corePartsList.length} of 8 selected
            </span>
          </div>
        </motion.div>

        <div className="mb-6">
          <CompatibilityBanner warnings={warnings} passed={compat.passed} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Part selectors */}
          <div className="lg:col-span-2 space-y-3">
            {/* GPU */}
            <div ref={gpuSectionRef}>
              <PartSelector
                category="gpu" label="GPU — Graphics Card" defaultOpen
                parts={builderGpus}
                selectedId={build.gpu}
                recommendedIds={recommendedIds}
                onSelect={id => { selectPart('gpu', id); setShowFps(false); }}
                getSpecs={p => {
                  if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }];
                  const g = p as GPU;
                  return [
                    { label: 'VRAM', value: `${g.vram_gb}GB ${g.architecture}` },
                    { label: 'TDP', value: `${g.tdp_watts}W` },
                    { label: 'Release', value: String(g.release_year) },
                  ];
                }}
              />
            </div>
            {/* CPU */}
            <div ref={cpuSectionRef}>
              <PartSelector
                category="cpu" label="CPU — Processor"
                parts={builderCpus}
                selectedId={build.cpu}
                recommendedIds={recommendedIds}
                onSelect={id => { selectPart('cpu', id); setShowFps(false); }}
                getSpecs={p => {
                  if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }];
                  const c = p as CPU;
                  return [
                    { label: 'Cores/Threads', value: `${c.cores}C / ${c.threads}T` },
                    { label: 'Boost', value: `${c.boost_ghz}GHz` },
                    { label: 'Socket', value: `${c.socket} · ${c.supported_ram.join('/')}` },
                  ];
                }}
              />
            </div>
            <PartSelector category="motherboard" label="Motherboard"
              parts={builderMotherboards} selectedId={build.motherboard}
              onSelect={id => selectPart('motherboard', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Motherboard; return [{ label: 'Socket', value: m.socket }, { label: 'RAM', value: m.supported_ram.join(' / ') }, { label: 'Form Factor', value: m.form_factor }]; }}
            />
            <PartSelector category="ram" label="RAM — Memory"
              parts={builderRam} selectedId={build.ram}
              onSelect={id => selectPart('ram', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const r = p as RAM; return [{ label: 'Type', value: r.type }, { label: 'Capacity', value: `${r.capacity_gb}GB` }, { label: 'Speed', value: `${r.speed_mhz}MHz` }]; }}
            />
            <PartSelector category="storage" label="Storage"
              parts={builderStorage} selectedId={build.storage}
              onSelect={id => selectPart('storage', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const s = p as Storage; return [{ label: 'Type', value: s.type }, { label: 'Capacity', value: `${s.capacity_tb}TB` }, { label: 'Speed', value: `${s.speed_mbs}MB/s` }]; }}
            />
            <PartSelector category="psu" label="PSU — Power Supply"
              parts={builderPsus} selectedId={build.psu}
              onSelect={id => selectPart('psu', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const psu = p as PSU; return [{ label: 'Wattage', value: `${psu.wattage}W` }, { label: 'Rating', value: psu.rating }]; }}
            />
            <PartSelector category="case" label="Case"
              parts={builderCases} selectedId={build.case}
              onSelect={id => selectPart('case', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const c = p as Case; return [{ label: 'Form Factor', value: c.form_factor }, { label: 'Supports', value: c.motherboard_support.join(', ') }]; }}
            />
            <PartSelector category="cooler" label="CPU Cooler"
              parts={builderCoolers} selectedId={build.cooler}
              onSelect={id => selectPart('cooler', id)}
              getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const c = p as Cooler; return [{ label: 'Type', value: c.type }, { label: 'Max TDP', value: `${c.max_tdp_watts}W` }]; }}
            />

            {/* Peripherals section */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                border: monitorWarningCount > 0 && !peripheralsOpen ? '1px solid var(--ff-amber)' : '1px solid var(--ff-border)',
                backgroundColor: 'var(--ff-surface)',
                boxShadow: peripheralsOpen ? '0 8px 24px -8px rgba(108,99,255,0.18)' : 'none',
              }}
            >
              <button
                onClick={() => setPeripheralsOpen(!peripheralsOpen)}
                className="w-full flex items-center justify-between p-4 text-sm font-semibold transition-colors"
                style={{ color: 'var(--ff-text)', backgroundColor: peripheralsOpen ? 'var(--ff-card-hover)' : 'var(--ff-surface)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative"
                    style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
                  >
                    <MonitorIcon size={16} style={{ color: 'var(--ff-text-2)' }} />
                    {monitorWarningCount > 0 && !peripheralsOpen && (
                      <span
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-black"
                        style={{ backgroundColor: 'var(--ff-amber)' }}
                        aria-hidden="true"
                      >
                        {monitorWarningCount}
                      </span>
                    )}
                  </div>
                  <div className="text-left">
                    <span>Peripherals <span className="text-xs font-normal ml-1" style={{ color: 'var(--ff-text-2)' }}>(optional)</span></span>
                    <p className="text-xs font-normal mt-0.5" style={{ color: monitorWarningCount > 0 && !peripheralsOpen ? 'var(--ff-amber)' : 'var(--ff-text-3)' }}>
                      {monitorWarningCount > 0 && !peripheralsOpen
                        ? `${monitorWarningCount} monitor pairing note${monitorWarningCount > 1 ? 's' : ''} — open to review`
                        : 'Pairing a monitor checks it against your GPU — also Keyboard, Mouse, Headset'}
                    </p>
                  </div>
                </div>
                <ChevronDown size={18} className={`transition-transform duration-300 ${peripheralsOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--ff-text-2)' }} />
              </button>
              <AnimatePresence>
                {peripheralsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-bg)' }}>
                      <PartSelector category="monitor" label="Monitor"
                        parts={builderMonitors} selectedId={build.monitor}
                        onSelect={id => selectPart('monitor', id)}
                        getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Monitor; return [{ label: 'Resolution', value: m.resolution }, { label: 'Refresh Rate', value: `${m.refresh_rate_hz}Hz` }, { label: 'Panel', value: m.panel_type }]; }}
                      />
                      <PartSelector category="keyboard" label="Keyboard"
                        parts={builderKeyboards} selectedId={build.keyboard}
                        onSelect={id => selectPart('keyboard', id)}
                        getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const k = p as Keyboard; return [{ label: 'Switch', value: k.switch_type }, { label: 'Form', value: k.form_factor }, { label: 'Wireless', value: k.wireless ? 'Yes' : 'No' }]; }}
                      />
                      <PartSelector category="mouse" label="Mouse"
                        parts={builderMice} selectedId={build.mouse}
                        onSelect={id => selectPart('mouse', id)}
                        getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Mouse; return [{ label: 'DPI', value: `${m.dpi_max.toLocaleString()}` }, { label: 'Weight', value: `${m.weight_grams}g` }, { label: 'Wireless', value: m.wireless ? 'Yes' : 'No' }]; }}
                      />
                      <PartSelector category="headset" label="Headset"
                        parts={builderHeadsets} selectedId={build.headset}
                        onSelect={id => selectPart('headset', id)}
                        getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const h = p as Headset; return [{ label: 'Driver', value: `${h.driver_mm}mm` }, { label: 'Surround', value: h.surround_sound }, { label: 'Wireless', value: h.wireless ? 'Yes' : 'No' }]; }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right panel */}
          <div className="lg:col-span-1 space-y-6">
            <BuildSummary
              parts={summaryParts}
              totalCost={totalCost}
              onEstimateFps={handleEstimateFps}
              canEstimate={canEstimate}
              compatibilityOk={warnings.filter(w => w.type === 'error').length === 0}
              gpu={selectedGpu}
              cpu={selectedCpu}
              buildState={buildState}
              shareView={{ resolution: fpsResolution, preset: fpsPreset }}
              customParts={customParts}
              onAddCustomPart={addCustomPart}
              onRemoveCustomPart={removeCustomPart}
              onScrollToGpu={handleScrollToGpu}
              onScrollToCpu={handleScrollToCpu}
              onStartOver={startOver}
              onImportBuild={importBuild}
            />
          </div>
        </div>

        {/* FPS Estimator */}
        <div ref={fpsSectionRef}>
          <AnimatePresence>
            {showFps && selectedGpu && selectedCpu && (
              <FpsEstimator
                gpu={selectedGpu} cpu={selectedCpu} games={games}
                resolution={fpsResolution} preset={fpsPreset}
                onResolutionChange={setFpsResolution} onPresetChange={setFpsPreset}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showFps && selectedGpu && selectedCpu && (
              <VerifiedBenchmarkPanel
                gpuId={selectedGpu.id} gpuName={selectedGpu.name}
                cpuId={selectedCpu.id} cpuName={selectedCpu.name}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="mt-12 space-y-3">
          {builderFaqs.map((f) => (
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
