import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PartSelector from '../components/PartSelector';
import BuildSummary from '../components/BuildSummary';
import CompatibilityBanner from '../components/CompatibilityBanner';
import FpsEstimator from '../components/FpsEstimator';
import { useBuilder } from '../hooks/useBuilder';
import { checkCompatibility } from '../lib/compatibility';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';

type Resolution = '1080p' | '1440p' | '4k';
type Preset = 'low' | 'medium' | 'high' | 'ultra';

interface GPU {
  id: string; name: string; brand: string; series: string; price_usd: number;
  tier: number; vram_gb: number; tdp_watts: number; architecture: string;
  release_year: number; benchmark_score: number; sponsored?: boolean;
}
interface CPU {
  id: string; name: string; brand: string; series: string; price_usd: number;
  tier: number; cores: number; threads: number; base_ghz: number; boost_ghz: number;
  tdp_watts: number; socket: string; supported_ram: string[]; release_year: number;
  benchmark_score: number; sponsored?: boolean;
}
interface Motherboard {
  id: string; name: string; brand: string; price_usd: number; socket: string;
  supported_ram: string[]; form_factor: string; sponsored?: boolean;
}
interface RAM {
  id: string; name: string; brand: string; price_usd: number; type: string;
  capacity_gb: number; speed_mhz: number; sponsored?: boolean;
}
interface Storage {
  id: string; name: string; brand: string; price_usd: number; type: string;
  capacity_tb: number; speed_mbs: number; sponsored?: boolean;
}
interface PSU {
  id: string; name: string; brand: string; price_usd: number; wattage: number;
  rating: string; sponsored?: boolean;
}
interface Case {
  id: string; name: string; brand: string; price_usd: number; form_factor: string;
  motherboard_support: string[]; sponsored?: boolean;
}
interface Cooler {
  id: string; name: string; brand: string; price_usd: number; type: string;
  max_tdp_watts: number; sponsored?: boolean;
}
interface Game {
  id: string; name: string; genre: string; year: number;
  base_fps: Record<Resolution, Record<Preset, number>>;
}

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

export default function Builder() {
  const { build, selectPart } = useBuilder();
  const [showFps, setShowFps] = useState(false);

  const selectedGpu = gpus.find(g => g.id === build.gpu) ?? null;
  const selectedCpu = cpus.find(c => c.id === build.cpu) ?? null;
  const selectedMb = (componentData.motherboards as Motherboard[]).find(m => m.id === build.motherboard) ?? null;
  const selectedRam = (componentData.ram as RAM[]).find(r => r.id === build.ram) ?? null;
  const selectedStorage = (componentData.storage as Storage[]).find(s => s.id === build.storage) ?? null;
  const selectedPsu = (componentData.psus as PSU[]).find(p => p.id === build.psu) ?? null;
  const selectedCase = (componentData.cases as Case[]).find(c => c.id === build.case) ?? null;
  const selectedCooler = (componentData.coolers as Cooler[]).find(c => c.id === build.cooler) ?? null;

  const warnings = useMemo(() => checkCompatibility({
    gpu: selectedGpu,
    cpu: selectedCpu,
    motherboard: selectedMb,
    ram: selectedRam,
    psu: selectedPsu,
  }), [selectedGpu, selectedCpu, selectedMb, selectedRam, selectedPsu]);

  const summaryParts = [
    selectedGpu && { label: 'GPU', name: selectedGpu.name, price: selectedGpu.price_usd },
    selectedCpu && { label: 'CPU', name: selectedCpu.name, price: selectedCpu.price_usd },
    selectedMb && { label: 'Motherboard', name: selectedMb.name, price: selectedMb.price_usd },
    selectedRam && { label: 'RAM', name: selectedRam.name, price: selectedRam.price_usd },
    selectedStorage && { label: 'Storage', name: selectedStorage.name, price: selectedStorage.price_usd },
    selectedPsu && { label: 'PSU', name: selectedPsu.name, price: selectedPsu.price_usd },
    selectedCase && { label: 'Case', name: selectedCase.name, price: selectedCase.price_usd },
    selectedCooler && { label: 'Cooler', name: selectedCooler.name, price: selectedCooler.price_usd },
  ].filter(Boolean) as { label: string; name: string; price: number }[];

  const totalCost = summaryParts.reduce((sum, p) => sum + p.price, 0);
  const canEstimate = !!(selectedGpu && selectedCpu);

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">
            PC <span className="gradient-text">Builder</span>
          </h1>
          <p className="text-[#8888AA]">Select your components and estimate FPS across 20 games.</p>
        </motion.div>

        {/* Compatibility */}
        <div className="mb-6">
          <CompatibilityBanner warnings={warnings} />
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Part selectors */}
          <div className="lg:col-span-2 space-y-3">
            <PartSelector
              category="gpu" label="GPU — Graphics Card" defaultOpen
              parts={gpus}
              selectedId={build.gpu}
              onSelect={id => { selectPart('gpu', id); setShowFps(false); }}
              getSpecs={p => {
                const g = p as GPU;
                return [
                  { label: 'VRAM', value: `${g.vram_gb}GB ${g.architecture}` },
                  { label: 'TDP', value: `${g.tdp_watts}W` },
                  { label: 'Release', value: String(g.release_year) },
                ];
              }}
            />
            <PartSelector
              category="cpu" label="CPU — Processor"
              parts={cpus}
              selectedId={build.cpu}
              onSelect={id => { selectPart('cpu', id); setShowFps(false); }}
              getSpecs={p => {
                const c = p as CPU;
                return [
                  { label: 'Cores/Threads', value: `${c.cores}C / ${c.threads}T` },
                  { label: 'Boost', value: `${c.boost_ghz}GHz` },
                  { label: 'Socket', value: `${c.socket} · ${c.supported_ram.join('/')}` },
                ];
              }}
            />
            <PartSelector
              category="motherboard" label="Motherboard"
              parts={componentData.motherboards as Motherboard[]}
              selectedId={build.motherboard}
              onSelect={id => selectPart('motherboard', id)}
              getSpecs={p => {
                const m = p as Motherboard;
                return [
                  { label: 'Socket', value: m.socket },
                  { label: 'RAM', value: m.supported_ram.join(' / ') },
                  { label: 'Form Factor', value: m.form_factor },
                ];
              }}
            />
            <PartSelector
              category="ram" label="RAM — Memory"
              parts={componentData.ram as RAM[]}
              selectedId={build.ram}
              onSelect={id => selectPart('ram', id)}
              getSpecs={p => {
                const r = p as RAM;
                return [
                  { label: 'Type', value: r.type },
                  { label: 'Capacity', value: `${r.capacity_gb}GB` },
                  { label: 'Speed', value: `${r.speed_mhz}MHz` },
                ];
              }}
            />
            <PartSelector
              category="storage" label="Storage"
              parts={componentData.storage as Storage[]}
              selectedId={build.storage}
              onSelect={id => selectPart('storage', id)}
              getSpecs={p => {
                const s = p as Storage;
                return [
                  { label: 'Type', value: s.type },
                  { label: 'Capacity', value: `${s.capacity_tb}TB` },
                  { label: 'Speed', value: `${s.speed_mbs}MB/s` },
                ];
              }}
            />
            <PartSelector
              category="psu" label="PSU — Power Supply"
              parts={componentData.psus as PSU[]}
              selectedId={build.psu}
              onSelect={id => selectPart('psu', id)}
              getSpecs={p => {
                const psu = p as PSU;
                return [
                  { label: 'Wattage', value: `${psu.wattage}W` },
                  { label: 'Rating', value: psu.rating },
                ];
              }}
            />
            <PartSelector
              category="case" label="Case"
              parts={componentData.cases as Case[]}
              selectedId={build.case}
              onSelect={id => selectPart('case', id)}
              getSpecs={p => {
                const c = p as Case;
                return [
                  { label: 'Form Factor', value: c.form_factor },
                  { label: 'Supports', value: c.motherboard_support.join(', ') },
                ];
              }}
            />
            <PartSelector
              category="cooler" label="CPU Cooler"
              parts={componentData.coolers as Cooler[]}
              selectedId={build.cooler}
              onSelect={id => selectPart('cooler', id)}
              getSpecs={p => {
                const c = p as Cooler;
                return [
                  { label: 'Type', value: c.type },
                  { label: 'Max TDP', value: `${c.max_tdp_watts}W` },
                ];
              }}
            />
          </div>

          {/* Right panel */}
          <div className="lg:col-span-1">
            <BuildSummary
              parts={summaryParts}
              totalCost={totalCost}
              onEstimateFps={() => setShowFps(true)}
              canEstimate={canEstimate}
              compatibilityOk={warnings.filter(w => w.type === 'error').length === 0}
            />
          </div>
        </div>

        {/* FPS Estimator */}
        <AnimatePresence>
          {showFps && selectedGpu && selectedCpu && (
            <FpsEstimator gpu={selectedGpu} cpu={selectedCpu} games={games} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
