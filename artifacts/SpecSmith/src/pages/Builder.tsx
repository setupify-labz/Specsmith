import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import PartSelector from '../components/PartSelector';
import BuildSummary from '../components/BuildSummary';
import CompatibilityBanner from '../components/CompatibilityBanner';
import FpsEstimator from '../components/FpsEstimator';
import { useBuilder } from '../hooks/useBuilder';
import { checkCompatibility } from '../lib/compatibility';
import { decodeBuild } from '../lib/sharing';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import peripheralData from '../data/peripherals.json';
import { ChevronDown } from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';

type Resolution = '1080p' | '1440p' | '4k';
type Preset = 'low' | 'medium' | 'high' | 'ultra';

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

function getResolutionTier(res: string): number {
  if (res === '4K' || res === '5120x1440p') return 4;
  if (res === '3440x1440p' || res === '1440p') return 2;
  return 1;
}

export default function Builder() {
  useSeo(getRouteMeta('/builder'));
  const [searchParams] = useSearchParams();
  const [peripheralsOpen, setPeripheralsOpen] = useState(false);

  // Parse initial state from URL params (from prebuilts "Load into Builder" or share link)
  const initialBuild = useMemo(() => {
    const b = searchParams.get('b');
    if (b) {
      const decoded = decodeBuild(decodeURIComponent(b));
      if (decoded) return decoded.build as Record<string, string | null>;
    }
    const keys = ['gpu','cpu','motherboard','ram','storage','psu','case','cooler','monitor','keyboard','mouse','headset'];
    const fromParams: Record<string, string | null> = {};
    let hasAny = false;
    keys.forEach(k => {
      const v = searchParams.get(k);
      if (v) { fromParams[k] = v; hasAny = true; }
    });
    return hasAny ? fromParams : undefined;
  }, []);

  const { build, selectPart } = useBuilder(initialBuild as any);
  const [showFps, setShowFps] = useState(false);
  const [fpsResolution, setFpsResolution] = useState<Resolution>('1080p');
  const [fpsPreset, setFpsPreset] = useState<Preset>('high');
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);

  const gpuSectionRef = useRef<HTMLDivElement>(null);
  const cpuSectionRef = useRef<HTMLDivElement>(null);

  const selectedGpu = gpus.find(g => g.id === build.gpu) ?? null;
  const selectedCpu = cpus.find(c => c.id === build.cpu) ?? null;
  const selectedMb = (componentData.motherboards as Motherboard[]).find(m => m.id === build.motherboard) ?? null;
  const selectedRam = (componentData.ram as RAM[]).find(r => r.id === build.ram) ?? null;
  const selectedStorage = (componentData.storage as Storage[]).find(s => s.id === build.storage) ?? null;
  const selectedPsu = (componentData.psus as PSU[]).find(p => p.id === build.psu) ?? null;
  const selectedCase = (componentData.cases as Case[]).find(c => c.id === build.case) ?? null;
  const selectedCooler = (componentData.coolers as Cooler[]).find(c => c.id === build.cooler) ?? null;
  const selectedMonitor = (peripheralData.monitors as Monitor[]).find(m => m.id === (build as any).monitor) ?? null;
  const selectedKeyboard = (peripheralData.keyboards as Keyboard[]).find(k => k.id === (build as any).keyboard) ?? null;
  const selectedMouse = (peripheralData.mice as Mouse[]).find(m => m.id === (build as any).mouse) ?? null;
  const selectedHeadset = (peripheralData.headsets as Headset[]).find(h => h.id === (build as any).headset) ?? null;

  const warnings = useMemo(() => {
    const base = checkCompatibility({ gpu: selectedGpu, cpu: selectedCpu, motherboard: selectedMb, ram: selectedRam, psu: selectedPsu });
    // Monitor compatibility warnings
    if (selectedMonitor && selectedGpu) {
      const res = selectedMonitor.resolution;
      const hz = selectedMonitor.refresh_rate_hz;
      const tier = selectedGpu.tier;
      if ((res === '4K' || res === '5120x1440p') && tier < 7) {
        base.push({ id: 'monitor-4k', type: 'warning', message: 'Your GPU may struggle at 4K on this monitor' });
      } else if (getResolutionTier(res) >= 2 && tier < 5) {
        base.push({ id: 'monitor-1440p', type: 'warning', message: 'Your GPU may struggle at 1440p on this monitor' });
      }
      if (hz >= 360 && tier < 8) {
        base.push({ id: 'monitor-refresh', type: 'warning', message: `Your GPU may not reach ${hz}Hz refresh rate in demanding games` });
      }
    }
    return base;
  }, [selectedGpu, selectedCpu, selectedMb, selectedRam, selectedPsu, selectedMonitor]);

  const corePartsList = [
    selectedGpu     && { label: 'GPU',         name: selectedGpu.name,     price: selectedGpu.price_usd },
    selectedCpu     && { label: 'CPU',         name: selectedCpu.name,     price: selectedCpu.price_usd },
    selectedMb      && { label: 'Motherboard', name: selectedMb.name,      price: selectedMb.price_usd },
    selectedRam     && { label: 'RAM',         name: selectedRam.name,     price: selectedRam.price_usd },
    selectedStorage && { label: 'Storage',     name: selectedStorage.name, price: selectedStorage.price_usd },
    selectedPsu     && { label: 'PSU',         name: selectedPsu.name,     price: selectedPsu.price_usd },
    selectedCase    && { label: 'Case',        name: selectedCase.name,    price: selectedCase.price_usd },
    selectedCooler  && { label: 'Cooler',      name: selectedCooler.name,  price: selectedCooler.price_usd },
  ].filter(Boolean) as { label: string; name: string; price: number }[];

  const peripheralPartsList = [
    selectedMonitor  && { label: 'Monitor',  name: selectedMonitor.name,  price: selectedMonitor.price_usd },
    selectedKeyboard && { label: 'Keyboard', name: selectedKeyboard.name, price: selectedKeyboard.price_usd },
    selectedMouse    && { label: 'Mouse',    name: selectedMouse.name,    price: selectedMouse.price_usd },
    selectedHeadset  && { label: 'Headset',  name: selectedHeadset.name,  price: selectedHeadset.price_usd },
  ].filter(Boolean) as { label: string; name: string; price: number }[];

  const summaryParts = [...corePartsList, ...peripheralPartsList];
  const totalCost = summaryParts.reduce((sum, p) => sum + p.price, 0);
  const canEstimate = !!(selectedGpu && selectedCpu);

  const buildState: Record<string, string | null> = {
    gpu: build.gpu, cpu: build.cpu,
    motherboard: build.motherboard, ram: build.ram,
    storage: build.storage, psu: build.psu,
    case: build.case, cooler: build.cooler,
    monitor: (build as any).monitor ?? null,
    keyboard: (build as any).keyboard ?? null,
    mouse: (build as any).mouse ?? null,
    headset: (build as any).headset ?? null,
  };

  const handleScrollToGpu = () => {
    gpuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight top GPUs
    if (selectedCpu) {
      const top3 = gpus.filter(g => g.benchmark_score >= selectedCpu.benchmark_score * 0.72).slice(0, 3).map(g => g.id);
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            PC <span className="gradient-text">Builder</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Select your components and estimate FPS across 20 games.</p>
        </motion.div>

        <div className="mb-6">
          <CompatibilityBanner warnings={warnings} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Part selectors */}
          <div className="lg:col-span-2 space-y-3">
            {/* GPU */}
            <div ref={gpuSectionRef}>
              <PartSelector
                category="gpu" label="GPU — Graphics Card" defaultOpen
                parts={gpus}
                selectedId={build.gpu}
                recommendedIds={recommendedIds}
                onSelect={id => { selectPart('gpu', id); setShowFps(false); }}
                showSparkline
                getSpecs={p => {
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
                parts={cpus}
                selectedId={build.cpu}
                recommendedIds={recommendedIds}
                onSelect={id => { selectPart('cpu', id); setShowFps(false); }}
                showSparkline
                getSpecs={p => {
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
              parts={componentData.motherboards as Motherboard[]} selectedId={build.motherboard}
              onSelect={id => selectPart('motherboard', id)}
              getSpecs={p => { const m = p as Motherboard; return [{ label: 'Socket', value: m.socket }, { label: 'RAM', value: m.supported_ram.join(' / ') }, { label: 'Form Factor', value: m.form_factor }]; }}
            />
            <PartSelector category="ram" label="RAM — Memory"
              parts={componentData.ram as RAM[]} selectedId={build.ram}
              onSelect={id => selectPart('ram', id)}
              getSpecs={p => { const r = p as RAM; return [{ label: 'Type', value: r.type }, { label: 'Capacity', value: `${r.capacity_gb}GB` }, { label: 'Speed', value: `${r.speed_mhz}MHz` }]; }}
            />
            <PartSelector category="storage" label="Storage"
              parts={componentData.storage as Storage[]} selectedId={build.storage}
              onSelect={id => selectPart('storage', id)}
              getSpecs={p => { const s = p as Storage; return [{ label: 'Type', value: s.type }, { label: 'Capacity', value: `${s.capacity_tb}TB` }, { label: 'Speed', value: `${s.speed_mbs}MB/s` }]; }}
            />
            <PartSelector category="psu" label="PSU — Power Supply"
              parts={componentData.psus as PSU[]} selectedId={build.psu}
              onSelect={id => selectPart('psu', id)}
              getSpecs={p => { const psu = p as PSU; return [{ label: 'Wattage', value: `${psu.wattage}W` }, { label: 'Rating', value: psu.rating }]; }}
            />
            <PartSelector category="case" label="Case"
              parts={componentData.cases as Case[]} selectedId={build.case}
              onSelect={id => selectPart('case', id)}
              getSpecs={p => { const c = p as Case; return [{ label: 'Form Factor', value: c.form_factor }, { label: 'Supports', value: c.motherboard_support.join(', ') }]; }}
            />
            <PartSelector category="cooler" label="CPU Cooler"
              parts={componentData.coolers as Cooler[]} selectedId={build.cooler}
              onSelect={id => selectPart('cooler', id)}
              getSpecs={p => { const c = p as Cooler; return [{ label: 'Type', value: c.type }, { label: 'Max TDP', value: `${c.max_tdp_watts}W` }]; }}
            />

            {/* Peripherals section */}
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <button
                onClick={() => setPeripheralsOpen(!peripheralsOpen)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors"
                style={{ color: 'var(--ff-text)' }}
              >
                <span>Peripherals <span className="text-xs font-normal ml-1" style={{ color: 'var(--ff-text-2)' }}>(optional — Monitor, Keyboard, Mouse, Headset)</span></span>
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
                    <div className="px-1 pb-2 space-y-2" style={{ borderTop: '1px solid var(--ff-border)' }}>
                      <PartSelector category="monitor" label="Monitor"
                        parts={peripheralData.monitors as Monitor[]} selectedId={(build as any).monitor}
                        onSelect={id => (selectPart as any)('monitor', id)}
                        getSpecs={p => { const m = p as Monitor; return [{ label: 'Resolution', value: m.resolution }, { label: 'Refresh Rate', value: `${m.refresh_rate_hz}Hz` }, { label: 'Panel', value: m.panel_type }]; }}
                      />
                      <PartSelector category="keyboard" label="Keyboard"
                        parts={peripheralData.keyboards as Keyboard[]} selectedId={(build as any).keyboard}
                        onSelect={id => (selectPart as any)('keyboard', id)}
                        getSpecs={p => { const k = p as Keyboard; return [{ label: 'Switch', value: k.switch_type }, { label: 'Form', value: k.form_factor }, { label: 'Wireless', value: k.wireless ? 'Yes' : 'No' }]; }}
                      />
                      <PartSelector category="mouse" label="Mouse"
                        parts={peripheralData.mice as Mouse[]} selectedId={(build as any).mouse}
                        onSelect={id => (selectPart as any)('mouse', id)}
                        getSpecs={p => { const m = p as Mouse; return [{ label: 'DPI', value: `${m.dpi_max.toLocaleString()}` }, { label: 'Weight', value: `${m.weight_grams}g` }, { label: 'Wireless', value: m.wireless ? 'Yes' : 'No' }]; }}
                      />
                      <PartSelector category="headset" label="Headset"
                        parts={peripheralData.headsets as Headset[]} selectedId={(build as any).headset}
                        onSelect={id => (selectPart as any)('headset', id)}
                        getSpecs={p => { const h = p as Headset; return [{ label: 'Driver', value: `${h.driver_mm}mm` }, { label: 'Surround', value: h.surround_sound }, { label: 'Wireless', value: h.wireless ? 'Yes' : 'No' }]; }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right panel */}
          <div className="lg:col-span-1">
            <BuildSummary
              parts={summaryParts}
              totalCost={totalCost}
              onEstimateFps={() => setShowFps(true)}
              canEstimate={canEstimate}
              compatibilityOk={warnings.filter(w => w.type === 'error').length === 0}
              gpu={selectedGpu}
              cpu={selectedCpu}
              buildState={buildState}
              shareView={{ resolution: fpsResolution, preset: fpsPreset }}
              onScrollToGpu={handleScrollToGpu}
              onScrollToCpu={handleScrollToCpu}
            />
          </div>
        </div>

        {/* FPS Estimator */}
        <AnimatePresence>
          {showFps && selectedGpu && selectedCpu && (
            <FpsEstimator
              gpu={selectedGpu} cpu={selectedCpu} games={games}
              resolution={fpsResolution} preset={fpsPreset}
              onResolutionChange={setFpsResolution} onPresetChange={setFpsPreset}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
