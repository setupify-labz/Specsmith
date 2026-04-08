import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import FpsGauge from './FpsGauge';
import { estimateFps, getFpsColorClass } from '../lib/fps';
import type { Resolution, Preset } from '../lib/fps';

interface GPU { gpu_multiplier: number; name: string; [key: string]: unknown; }
interface CPU { cpu_multiplier: number; name: string; [key: string]: unknown; }
interface Game {
  id: string;
  name: string;
  genre: string;
  base_fps: Record<Resolution, Record<Preset, number>>;
}

interface Props {
  gpu: GPU;
  cpu: CPU;
  games: Game[];
}

const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const presets: Preset[] = ['low', 'medium', 'high', 'ultra'];
const presetLabels: Record<Preset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
const resLabels: Record<Resolution, string> = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };

export default function FpsEstimator({ gpu, cpu, games }: Props) {
  const [selectedGame, setSelectedGame] = useState<string>(games[0]?.id ?? '');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [preset, setPreset] = useState<Preset>('high');

  const currentGame = games.find(g => g.id === selectedGame);
  const result = useMemo(() => {
    if (!currentGame) return null;
    const base = currentGame.base_fps[resolution]?.[preset] ?? 0;
    return estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, base);
  }, [currentGame, resolution, preset, gpu.gpu_multiplier, cpu.cpu_multiplier]);

  const allGamesResults = useMemo(() => {
    return games.map(g => {
      const base = g.base_fps[resolution]?.[preset] ?? 0;
      return { ...g, result: estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, base) };
    }).sort((a, b) => b.result.estimated - a.result.estimated);
  }, [games, resolution, preset, gpu.gpu_multiplier, cpu.cpu_multiplier]);

  const toggleStyle = (active: boolean) => active
    ? { backgroundColor: 'var(--ff-accent)', color: '#fff' }
    : { color: 'var(--ff-text-2)', backgroundColor: 'transparent' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-6 mt-6"
      style={{ border: '1px solid var(--ff-accent-30)', backgroundColor: 'var(--ff-surface)' }}
    >
      <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--ff-text)' }}>
        <span className="gradient-text">FPS Estimator</span>
        <span className="text-xs font-normal ml-2" style={{ color: 'var(--ff-text-2)' }}>
          — {gpu.name} + {cpu.name}
        </span>
      </h3>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* Game */}
        <div>
          <label className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Game</label>
          <select
            value={selectedGame}
            onChange={e => setSelectedGame(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
          >
            {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {/* Resolution */}
        <div>
          <label className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Resolution</label>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--ff-border)' }}>
            {resolutions.map(r => (
              <button key={r} onClick={() => setResolution(r)}
                className="flex-1 py-2 text-xs font-semibold transition-colors"
                style={toggleStyle(resolution === r)}>
                {resLabels[r]}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div>
          <label className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Quality</label>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--ff-border)' }}>
            {presets.map(p => (
              <button key={p} onClick={() => setPreset(p)}
                className="flex-1 py-2 text-xs font-semibold transition-colors"
                style={toggleStyle(preset === p)}>
                {presetLabels[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gauge */}
      {result && (
        <div className="flex justify-center mb-6">
          <FpsGauge fps={result.estimated} min={result.min} max={result.max} color={result.color} label={result.label} />
        </div>
      )}

      {/* All Games Table */}
      <div>
        <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>All Games Overview</h4>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--ff-border)' }}>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0" style={{ backgroundColor: 'var(--ff-card)' }}>
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Game</th>
                  <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Genre</th>
                  <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Min</th>
                  <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Est. FPS</th>
                  <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Max</th>
                </tr>
              </thead>
              <tbody>
                {allGamesResults.map((g, i) => (
                  <motion.tr
                    key={g.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderTop: '1px solid var(--ff-border)',
                      backgroundColor: g.id === selectedGame ? 'var(--ff-accent-10)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (g.id !== selectedGame) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--ff-card)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = g.id === selectedGame ? 'var(--ff-accent-10)' : 'transparent'; }}
                    onClick={() => setSelectedGame(g.id)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--ff-text)' }}>{g.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs" style={{ color: 'var(--ff-text-2)' }}>{g.genre}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs" style={{ color: 'var(--ff-text-2)' }}>{g.result.min}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-sm font-bold ${getFpsColorClass(g.result.estimated)}`}>
                        {g.result.estimated}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs" style={{ color: 'var(--ff-text-2)' }}>{g.result.max}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs mt-4 italic" style={{ color: 'var(--ff-text-3)' }}>
        FPS estimates are for native resolution with no upscaling (no DLSS, FSR, or XeSS). Real-world performance with upscaling enabled can be significantly higher. Figures are based on aggregated benchmark data and will vary by driver version, game patch, background processes, and system temperature.
      </p>
    </motion.div>
  );
}
