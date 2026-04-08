import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import PartSelector from '../components/PartSelector';
import { estimateFps } from '../lib/fps';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
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
interface Game {
  id: string; name: string; genre: string; year: number;
  base_fps: Record<Resolution, Record<Preset, number>>;
}

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

const COLORS = { a: '#6C63FF', b: '#00D4FF' };

function BuildColumn({
  title, color, gpuId, cpuId, onGpuSelect, onCpuSelect
}: {
  title: string; color: string;
  gpuId: string | null; cpuId: string | null;
  onGpuSelect: (id: string | null) => void;
  onCpuSelect: (id: string | null) => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="text-white font-bold">{title}</h3>
      </div>
      <div className="space-y-3">
        <PartSelector
          category="gpu" label="GPU" defaultOpen
          parts={gpus} selectedId={gpuId} onSelect={onGpuSelect}
          getSpecs={p => {
            const g = p as GPU;
            return [
              { label: 'VRAM', value: `${g.vram_gb}GB` },
              { label: 'TDP', value: `${g.tdp_watts}W` },
              { label: 'Arch', value: g.architecture },
            ];
          }}
        />
        <PartSelector
          category="cpu" label="CPU"
          parts={cpus} selectedId={cpuId} onSelect={onCpuSelect}
          getSpecs={p => {
            const c = p as CPU;
            return [
              { label: 'Cores', value: `${c.cores}C/${c.threads}T` },
              { label: 'Boost', value: `${c.boost_ghz}GHz` },
              { label: 'Socket', value: c.socket },
            ];
          }}
        />
      </div>
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1C1C26] border border-white/10 rounded-xl p-3 shadow-2xl">
      <p className="text-white text-xs font-bold mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-[#8888AA]">{p.name}:</span>
          <span className="text-white font-bold">{p.value} FPS</span>
        </div>
      ))}
    </div>
  );
}

const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const presets: Preset[] = ['low', 'medium', 'high', 'ultra'];

export default function Compare() {
  const [gpuA, setGpuA] = useState<string | null>(null);
  const [cpuA, setCpuA] = useState<string | null>(null);
  const [gpuB, setGpuB] = useState<string | null>(null);
  const [cpuB, setCpuB] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [preset, setPreset] = useState<Preset>('high');

  const selectedGpuA = gpus.find(g => g.id === gpuA);
  const selectedCpuA = cpus.find(c => c.id === cpuA);
  const selectedGpuB = gpus.find(g => g.id === gpuB);
  const selectedCpuB = cpus.find(c => c.id === cpuB);

  const canCompare = !!(gpuA && cpuA && gpuB && cpuB);

  const chartData = useMemo(() => {
    if (!canCompare || !selectedGpuA || !selectedCpuA || !selectedGpuB || !selectedCpuB) return [];
    return games.map(g => {
      const base = g.base_fps[resolution][preset];
      const fpsA = estimateFps((selectedGpuA as any).gpu_multiplier ?? selectedGpuA.tier / 10, (selectedCpuA as any).cpu_multiplier ?? selectedCpuA.tier / 10, base).estimated;
      const fpsB = estimateFps((selectedGpuB as any).gpu_multiplier ?? selectedGpuB.tier / 10, (selectedCpuB as any).cpu_multiplier ?? selectedCpuB.tier / 10, base).estimated;
      return {
        game: g.name.length > 18 ? g.name.substring(0, 18) + '…' : g.name,
        fullGame: g.name,
        'Build A': fpsA,
        'Build B': fpsB,
        winner: fpsA >= fpsB ? 'A' : 'B',
      };
    });
  }, [canCompare, selectedGpuA, selectedCpuA, selectedGpuB, selectedCpuB, resolution, preset]);

  const costA = (selectedGpuA?.price_usd ?? 0) + (selectedCpuA?.price_usd ?? 0);
  const costB = (selectedGpuB?.price_usd ?? 0) + (selectedCpuB?.price_usd ?? 0);

  const winsA = chartData.filter(d => d.winner === 'A').length;
  const winsB = chartData.filter(d => d.winner === 'B').length;

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4">
            Build <span className="gradient-text">Comparison</span>
          </h1>
          <p className="text-[#8888AA] text-lg max-w-xl mx-auto">
            Compare two GPU + CPU combinations side by side across 20 games.
          </p>
        </motion.div>

        {/* Two columns */}
        <div className="flex flex-col lg:flex-row gap-6 mb-8">
          <BuildColumn
            title="Build A" color={COLORS.a}
            gpuId={gpuA} cpuId={cpuA}
            onGpuSelect={setGpuA} onCpuSelect={setCpuA}
          />
          <div className="hidden lg:flex items-center justify-center">
            <div className="w-px h-full bg-white/10" />
            <span className="absolute text-[#8888AA] text-sm font-bold bg-[#0A0A0F] px-2">VS</span>
          </div>
          <BuildColumn
            title="Build B" color={COLORS.b}
            gpuId={gpuB} cpuId={cpuB}
            onGpuSelect={setGpuB} onCpuSelect={setCpuB}
          />
        </div>

        {/* Chart */}
        {canCompare ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/8 bg-[#13131A] p-6"
          >
            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-xs text-[#8888AA] mb-1.5 font-medium uppercase tracking-wider">Resolution</label>
                <div className="flex rounded-lg overflow-hidden border border-white/8 w-fit">
                  {resolutions.map(r => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      className={`px-4 py-2 text-xs font-semibold transition-colors ${
                        resolution === r ? 'text-white bg-[#6C63FF]' : 'text-[#8888AA] hover:text-white'
                      }`}
                    >
                      {r === '4k' ? '4K' : r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-[#8888AA] mb-1.5 font-medium uppercase tracking-wider">Quality</label>
                <div className="flex rounded-lg overflow-hidden border border-white/8 w-fit">
                  {presets.map(p => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      className={`px-4 py-2 text-xs font-semibold transition-colors capitalize ${
                        preset === p ? 'text-white bg-[#6C63FF]' : 'text-[#8888AA] hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Score summary */}
            <div className="flex gap-4 mb-6">
              <div className="flex-1 rounded-xl p-4 text-center" style={{ backgroundColor: `${COLORS.a}15`, border: `1px solid ${COLORS.a}30` }}>
                <div className="text-3xl font-black" style={{ color: COLORS.a }}>{winsA}</div>
                <div className="text-[#8888AA] text-xs mt-1">Build A Wins</div>
                <div className="text-white text-xs font-semibold mt-2">
                  {selectedGpuA?.name} + {selectedCpuA?.name}
                </div>
                {costA > 0 && <div className="text-[#8888AA] text-xs mt-1">GPU+CPU: ${costA.toLocaleString()}</div>}
              </div>
              <div className="flex items-center justify-center text-[#8888AA] font-bold text-lg">VS</div>
              <div className="flex-1 rounded-xl p-4 text-center" style={{ backgroundColor: `${COLORS.b}15`, border: `1px solid ${COLORS.b}30` }}>
                <div className="text-3xl font-black" style={{ color: COLORS.b }}>{winsB}</div>
                <div className="text-[#8888AA] text-xs mt-1">Build B Wins</div>
                <div className="text-white text-xs font-semibold mt-2">
                  {selectedGpuB?.name} + {selectedCpuB?.name}
                </div>
                {costB > 0 && <div className="text-[#8888AA] text-xs mt-1">GPU+CPU: ${costB.toLocaleString()}</div>}
              </div>
            </div>

            {/* Bar chart */}
            <div style={{ height: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 20, left: 120, bottom: 0 }}
                  barSize={10}
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" stroke="#8888AA" tick={{ fontSize: 11, fill: '#8888AA' }} />
                  <YAxis
                    type="category" dataKey="game" width={120}
                    tick={{ fontSize: 10, fill: '#8888AA' }}
                    stroke="transparent"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ paddingTop: '16px', fontSize: '12px', color: '#8888AA' }}
                  />
                  <Bar dataKey="Build A" fill={COLORS.a} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Build B" fill={COLORS.b} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detailed table */}
            <div className="mt-6 rounded-xl border border-white/8 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/3">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs text-[#8888AA] font-medium">Game</th>
                      <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: COLORS.a }}>Build A FPS</th>
                      <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: COLORS.b }}>Build B FPS</th>
                      <th className="text-right px-4 py-2 text-xs text-[#8888AA] font-medium">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row, i) => (
                      <motion.tr
                        key={row.fullGame}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="border-t border-white/5 hover:bg-white/2"
                      >
                        <td className="px-4 py-2.5">
                          <span className="text-white text-xs">{row.fullGame}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-sm" style={{ color: row.winner === 'A' ? COLORS.a : '#8888AA' }}>
                            {row['Build A']}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-sm" style={{ color: row.winner === 'B' ? COLORS.b : '#8888AA' }}>
                            {row['Build B']}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-full"
                            style={{
                              color: row.winner === 'A' ? COLORS.a : COLORS.b,
                              backgroundColor: `${row.winner === 'A' ? COLORS.a : COLORS.b}18`
                            }}
                          >
                            Build {row.winner}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-[#13131A] p-12 text-center">
            <p className="text-[#8888AA] text-lg">Select GPU + CPU for both builds to see the comparison</p>
          </div>
        )}
      </div>
    </div>
  );
}
