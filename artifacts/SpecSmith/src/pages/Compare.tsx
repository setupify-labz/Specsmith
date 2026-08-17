import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, LabelList } from 'recharts';
import PartSelector from '../components/PartSelector';
import { estimateFpsForBuild } from '../lib/fps';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { useToast } from '../context/ToastContext';
import PageGlow from '../components/PageGlow';
import { getAverageFps, getCostPerFps, getBetterValueBuild } from '../lib/compareValue';

type Resolution = '1080p' | '1440p' | '4k';
type Preset = 'low' | 'medium' | 'high' | 'ultra';

interface GPU {
  id: string; name: string; brand: string; series: string; price_usd: number;
  tier: number; vram_gb: number; tdp_watts: number; architecture: string;
  release_year: number; benchmark_score: number; gpu_multiplier: number; sponsored?: boolean;
  [key: string]: unknown;
}
interface CPU {
  id: string; name: string; brand: string; series: string; price_usd: number;
  tier: number; cores: number; threads: number; base_ghz: number; boost_ghz: number;
  tdp_watts: number; socket: string; supported_ram: string[]; release_year: number;
  benchmark_score: number; cpu_multiplier: number; sponsored?: boolean;
  [key: string]: unknown;
}
interface Game {
  id: string; name: string; genre: string; year: number;
  gpu_bound?: number;
  base_fps: Record<Resolution, Record<Preset, number>>;
  [key: string]: unknown;
}

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

// Reuses the theme-aware --ff-accent-text/--ff-cyan tokens directly (not
// raw hex) so "Build A"/"Build B" text stays WCAG-AA-contrast in both
// themes — this used to be hardcoded to the dark-mode hex values and read
// as low as ~2:1 in light mode, found via an axe-core light-theme sweep.
const COLORS = { a: 'var(--ff-accent-text)', b: 'var(--ff-cyan)' };

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
        <h2 className="text-ff-primary font-bold">{title}</h2>
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
  payload?: Array<{ color: string; name: string; value: number; payload: { fullGame: string } }>;
  label?: string;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const fullGame = payload[0]?.payload?.fullGame ?? '';
  return (
    <div className="rounded-xl p-3 shadow-2xl max-w-[220px]" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
      <p className="text-ff-primary text-xs font-bold mb-2">{fullGame}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-secondary-custom">{p.name}:</span>
          <span className="text-ff-primary font-bold">{p.value} FPS</span>
        </div>
      ))}
    </div>
  );
}

function GameAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--ff-text-2)" fontSize={11}>
      {payload?.value}
    </text>
  );
}

const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const presets: Preset[] = ['low', 'medium', 'high', 'ultra'];

const compareFaqs = [
  {
    title: 'Does changing resolution or quality preset change which build wins a given game?',
    content: 'No — for any single game, both builds are scaled by that game\'s same base FPS number at the chosen resolution/preset, so the winner for that game is fixed by the builds themselves. Resolution and preset change the raw FPS numbers shown, not which build comes out ahead in that particular title.',
  },
  {
    title: 'Why does Build A win some games and Build B win others?',
    content: 'Each tracked game has its own real weighting of how much GPU strength versus CPU strength matters (a GPU-bound shooter behaves differently than a CPU-heavy strategy game) — so a build with a stronger GPU but weaker CPU can win GPU-heavy titles while losing CPU-sensitive ones to a more balanced build, even if one build costs more overall.',
  },
  {
    title: 'What do the two default builds represent?',
    content: 'A starting example, not a recommendation — two real, similarly-priced GPU+CPU pairings (currently about $100 apart) so the comparison has something to show before you\'ve picked your own parts. Swap either side using the selectors above; the URL updates so you can share your specific comparison.',
  },
];

function compareFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: compareFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

const DEFAULT_GPU_A = 'rtx4070ti';
const DEFAULT_CPU_A = 'i5-13600k';
const DEFAULT_GPU_B = 'rx7800xt';
const DEFAULT_CPU_B = 'r7-7800x3d';

export default function Compare() {
  useSeo(getRouteMeta('/compare'));
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const initGpu = (param: string, fallback: string, altIndex: number) => {
    const fromUrl = searchParams.get(param);
    if (fromUrl && gpus.some(g => g.id === fromUrl)) return fromUrl;
    return gpus.some(g => g.id === fallback) ? fallback : gpus[altIndex]?.id ?? null;
  };
  const initCpu = (param: string, fallback: string, altIndex: number) => {
    const fromUrl = searchParams.get(param);
    if (fromUrl && cpus.some(c => c.id === fromUrl)) return fromUrl;
    return cpus.some(c => c.id === fallback) ? fallback : cpus[altIndex]?.id ?? null;
  };
  const [gpuA, setGpuA] = useState<string | null>(() => initGpu('gpuA', DEFAULT_GPU_A, 0));
  const [cpuA, setCpuA] = useState<string | null>(() => initCpu('cpuA', DEFAULT_CPU_A, 0));
  const [gpuB, setGpuB] = useState<string | null>(() => initGpu('gpuB', DEFAULT_GPU_B, 1));
  const [cpuB, setCpuB] = useState<string | null>(() => initCpu('cpuB', DEFAULT_CPU_B, 1));
  const [resolution, setResolution] = useState<Resolution>(() => {
    const fromUrl = searchParams.get('res');
    return (resolutions as string[]).includes(fromUrl ?? '') ? (fromUrl as Resolution) : '1080p';
  });
  const [preset, setPreset] = useState<Preset>(() => {
    const fromUrl = searchParams.get('preset');
    return (presets as string[]).includes(fromUrl ?? '') ? (fromUrl as Preset) : 'high';
  });

  const selectedGpuA = gpus.find(g => g.id === gpuA);
  const selectedCpuA = cpus.find(c => c.id === cpuA);
  const selectedGpuB = gpus.find(g => g.id === gpuB);
  const selectedCpuB = cpus.find(c => c.id === cpuB);

  const canCompare = !!(gpuA && cpuA && gpuB && cpuB);

  const chartData = useMemo(() => {
    if (!canCompare || !selectedGpuA || !selectedCpuA || !selectedGpuB || !selectedCpuB) return [];
    return games.map(g => {
      const fpsA = estimateFpsForBuild(selectedGpuA, selectedCpuA, g, resolution, preset).estimated;
      const fpsB = estimateFpsForBuild(selectedGpuB, selectedCpuB, g, resolution, preset).estimated;
      return {
        game: g.name.length > 26 ? g.name.slice(0, 25) + '…' : g.name,
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

  const avgFpsA = getAverageFps(chartData.map(d => d['Build A']));
  const avgFpsB = getAverageFps(chartData.map(d => d['Build B']));
  const costPerFpsA = getCostPerFps(costA, avgFpsA);
  const costPerFpsB = getCostPerFps(costB, avgFpsB);
  const betterValue = getBetterValueBuild(costPerFpsA, costPerFpsB);

  const shareComparison = async () => {
    if (!canCompare) return;
    const params = new URLSearchParams({ gpuA: gpuA!, cpuA: cpuA!, gpuB: gpuB!, cpuB: cpuB!, res: resolution, preset });
    const url = `${SITE_URL}/compare?${params.toString()}`;
    const title = `${selectedGpuA?.name} + ${selectedCpuA?.name} vs ${selectedGpuB?.name} + ${selectedCpuB?.name}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Comparison link copied', 'success');
    } catch {
      showToast('Failed to copy link', 'error');
    }
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(compareFaqJsonLd()) }} />
      <PageGlow variant="cool" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-black text-ff-primary mb-4">
            Build <span className="gradient-text">Comparison</span>
          </h1>
          <p className="text-secondary-custom text-lg max-w-xl mx-auto">
            Compare two GPU + CPU combinations side by side across 20 games. We've pre-loaded a sample matchup below — swap in any parts to compare your own builds.
          </p>
          <p className="text-secondary-custom text-sm mt-3">
            Not sure where to start? See the{' '}
            <Link to="/gpu-tier-list" className="font-semibold hover:opacity-80" style={{ color: COLORS.a }}>GPU</Link>
            {' '}or{' '}
            <Link to="/cpu-tier-list" className="font-semibold hover:opacity-80" style={{ color: COLORS.b }}>CPU</Link>
            {' '}Tier List. Or test your price instincts with{' '}
            <Link to="/price-guesser" className="font-semibold hover:opacity-80" style={{ color: 'var(--ff-red)' }}>Higher or Lower</Link>.
          </p>
        </motion.div>

        {/* Two columns */}
        <div className="flex flex-col lg:flex-row gap-6 mb-8">
          <BuildColumn
            title="Build A" color={COLORS.a}
            gpuId={gpuA} cpuId={cpuA}
            onGpuSelect={setGpuA} onCpuSelect={setCpuA}
          />
          <div className="relative hidden lg:flex items-center justify-center">
            <div className="w-px h-full bg-white/10" />
            <span className="absolute text-secondary-custom text-sm font-bold px-2" style={{ backgroundColor: 'var(--ff-bg)' }}>VS</span>
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
            className="rounded-2xl border border-subtle bg-surface p-6"
          >
            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-xs text-secondary-custom mb-1.5 font-medium uppercase tracking-wider">Resolution</label>
                <div className="flex rounded-lg overflow-hidden border border-white/8 w-fit">
                  {resolutions.map(r => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      className={`px-4 py-2 text-xs font-semibold transition-colors ${
                        resolution === r ? 'text-white bg-[var(--ff-accent-solid)]' : 'text-secondary-custom hover:opacity-70'
                      }`}
                    >
                      {r === '4k' ? '4K' : r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-secondary-custom mb-1.5 font-medium uppercase tracking-wider">Quality</label>
                <div className="flex rounded-lg overflow-hidden border border-white/8 w-fit">
                  {presets.map(p => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      className={`px-4 py-2 text-xs font-semibold transition-colors capitalize ${
                        preset === p ? 'text-white bg-[var(--ff-accent-solid)]' : 'text-secondary-custom hover:opacity-70'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={shareComparison}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80 sm:self-end"
                style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              >
                <Share2 size={13} /> Share Comparison
              </button>
            </div>

            {/* Score summary */}
            <div className="flex gap-4 mb-6">
              <div className="flex-1 rounded-xl p-4 text-center" style={{ backgroundColor: `${COLORS.a}15`, border: `1px solid ${COLORS.a}30` }}>
                <div className="text-3xl font-black" style={{ color: COLORS.a }}>{winsA}</div>
                <div className="text-secondary-custom text-xs mt-1">Build A Wins</div>
                <div className="text-ff-primary text-xs font-semibold mt-2">
                  {selectedGpuA?.name} + {selectedCpuA?.name}
                </div>
                {costA > 0 && <div className="text-secondary-custom text-xs mt-1">GPU+CPU: ${costA.toLocaleString()}</div>}
                {avgFpsA > 0 && <div className="text-secondary-custom text-xs mt-1">Avg FPS: {avgFpsA}</div>}
                {costPerFpsA !== null && (
                  <div className="text-secondary-custom text-xs mt-1">${costPerFpsA}/avg FPS</div>
                )}
                {betterValue === 'A' && (
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-2"
                    style={{ backgroundColor: 'rgba(255,215,0,0.12)', color: 'var(--ff-gold)', border: '1px solid rgba(255,215,0,0.35)' }}>
                    Better Value
                  </span>
                )}
              </div>
              <div className="flex items-center justify-center text-secondary-custom font-bold text-lg">VS</div>
              <div className="flex-1 rounded-xl p-4 text-center" style={{ backgroundColor: `${COLORS.b}15`, border: `1px solid ${COLORS.b}30` }}>
                <div className="text-3xl font-black" style={{ color: COLORS.b }}>{winsB}</div>
                <div className="text-secondary-custom text-xs mt-1">Build B Wins</div>
                <div className="text-ff-primary text-xs font-semibold mt-2">
                  {selectedGpuB?.name} + {selectedCpuB?.name}
                </div>
                {costB > 0 && <div className="text-secondary-custom text-xs mt-1">GPU+CPU: ${costB.toLocaleString()}</div>}
                {avgFpsB > 0 && <div className="text-secondary-custom text-xs mt-1">Avg FPS: {avgFpsB}</div>}
                {costPerFpsB !== null && (
                  <div className="text-secondary-custom text-xs mt-1">${costPerFpsB}/avg FPS</div>
                )}
                {betterValue === 'B' && (
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-2"
                    style={{ backgroundColor: 'rgba(255,215,0,0.12)', color: 'var(--ff-gold)', border: '1px solid rgba(255,215,0,0.35)' }}>
                    Better Value
                  </span>
                )}
              </div>
            </div>
            {(costPerFpsA !== null || costPerFpsB !== null) && (
              <p className="text-[10px] text-secondary-custom text-center -mt-2 mb-6">
                $/avg FPS = total GPU+CPU cost divided by average FPS across all 20 games at the selected resolution/quality — lower is a better value, separate from which build wins more individual games.
              </p>
            )}

            {/* Bar chart */}
            <div className="overflow-x-auto">
              <div style={{ height: Math.max(560, chartData.length * 42), minWidth: 640 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 0, right: 44, left: 4, bottom: 0 }}
                    barSize={14}
                    barGap={4}
                    barCategoryGap="30%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border)" horizontal={false} />
                    <XAxis type="number" stroke="var(--ff-text-2)" tick={{ fontSize: 11, fill: 'var(--ff-text-2)' }} />
                    <YAxis
                      type="category" dataKey="game" width={160}
                      tick={<GameAxisTick />}
                      tickLine={false}
                      stroke="transparent"
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(136,136,170,0.08)' }} />
                    <Legend
                      wrapperStyle={{ paddingTop: '16px', fontSize: '12px', color: 'var(--ff-text-2)' }}
                    />
                    <Bar dataKey="Build A" fill={COLORS.a} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="Build A" position="right" fontSize={10} fill="var(--ff-text-2)" />
                    </Bar>
                    <Bar dataKey="Build B" fill={COLORS.b} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="Build B" position="right" fontSize={10} fill="var(--ff-text-2)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="sm:hidden text-[10px] text-secondary-custom text-center mt-2">← Scroll the chart to see full bars and values →</p>

            {/* Detailed table */}
            <div className="mt-6 rounded-xl border border-subtle overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ backgroundColor: 'var(--ff-card)' }}>
                    <tr>
                      <th className="text-left px-4 py-2 text-xs text-secondary-custom font-medium">Game</th>
                      <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: COLORS.a }}>Build A FPS</th>
                      <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: COLORS.b }}>Build B FPS</th>
                      <th className="text-right px-4 py-2 text-xs text-secondary-custom font-medium">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row, i) => (
                      <motion.tr
                        key={row.fullGame}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="border-t border-subtle"
                      >
                        <td className="px-4 py-2.5">
                          <span className="text-ff-primary text-xs">{row.fullGame}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-sm" style={{ color: row.winner === 'A' ? COLORS.a : 'var(--ff-text-2)' }}>
                            {row['Build A']}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-sm" style={{ color: row.winner === 'B' ? COLORS.b : 'var(--ff-text-2)' }}>
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
          <div className="rounded-2xl border border-subtle bg-surface p-12 text-center">
            <p className="text-secondary-custom text-lg">Select GPU + CPU for both builds to see the comparison</p>
          </div>
        )}

        <div className="mt-12 space-y-3">
          {compareFaqs.map((f) => (
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
