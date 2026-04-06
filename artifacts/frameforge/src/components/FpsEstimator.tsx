import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import FpsGauge from './FpsGauge';
import { estimateFps, getFpsColorClass } from '../lib/fps';
import type { Resolution, Preset } from '../lib/fps';

interface GPU { tier: number; name: string }
interface CPU { tier: number; name: string }
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

export default function FpsEstimator({ gpu, cpu, games }: Props) {
  const [selectedGame, setSelectedGame] = useState<string>(games[0]?.id ?? '');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [preset, setPreset] = useState<Preset>('high');

  const currentGame = games.find(g => g.id === selectedGame);
  const result = useMemo(() => {
    if (!currentGame) return null;
    const base = currentGame.base_fps[resolution][preset];
    return estimateFps(gpu.tier, cpu.tier, base);
  }, [currentGame, resolution, preset, gpu.tier, cpu.tier]);

  const allGamesResults = useMemo(() => {
    return games.map(g => {
      const base = g.base_fps[resolution][preset];
      return { ...g, result: estimateFps(gpu.tier, cpu.tier, base) };
    }).sort((a, b) => b.result.estimated - a.result.estimated);
  }, [games, resolution, preset, gpu.tier, cpu.tier]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[#6C63FF]/30 bg-[#13131A] p-6 mt-6"
    >
      <h3 className="text-white font-bold text-lg mb-5 flex items-center gap-2">
        <span className="gradient-text">FPS Estimator</span>
        <span className="text-xs font-normal text-[#8888AA] ml-1">— {gpu.name} + {cpu.name}</span>
      </h3>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* Game selector */}
        <div>
          <label className="block text-xs text-[#8888AA] mb-1.5 font-medium uppercase tracking-wider">Game</label>
          <select
            value={selectedGame}
            onChange={e => setSelectedGame(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white text-sm focus:outline-none focus:border-[#6C63FF]/50"
          >
            {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {/* Resolution */}
        <div>
          <label className="block text-xs text-[#8888AA] mb-1.5 font-medium uppercase tracking-wider">Resolution</label>
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {resolutions.map(r => (
              <button
                key={r}
                onClick={() => setResolution(r)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  resolution === r ? 'text-white bg-[#6C63FF]' : 'text-[#8888AA] hover:text-white hover:bg-white/5'
                }`}
              >
                {r === '4k' ? '4K' : r}
              </button>
            ))}
          </div>
        </div>

        {/* Preset */}
        <div>
          <label className="block text-xs text-[#8888AA] mb-1.5 font-medium uppercase tracking-wider">Quality</label>
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  preset === p ? 'text-white bg-[#6C63FF]' : 'text-[#8888AA] hover:text-white hover:bg-white/5'
                }`}
              >
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
        <h4 className="text-white font-semibold text-sm mb-3">All Games Overview</h4>
        <div className="rounded-xl border border-white/8 overflow-hidden">
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full">
              <thead className="bg-white/3 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-xs text-[#8888AA] font-medium">Game</th>
                  <th className="text-right px-3 py-2 text-xs text-[#8888AA] font-medium">Genre</th>
                  <th className="text-right px-3 py-2 text-xs text-[#8888AA] font-medium">Min</th>
                  <th className="text-right px-3 py-2 text-xs text-[#8888AA] font-medium">Est. FPS</th>
                  <th className="text-right px-3 py-2 text-xs text-[#8888AA] font-medium">Max</th>
                </tr>
              </thead>
              <tbody>
                {allGamesResults.map((g, i) => (
                  <motion.tr
                    key={g.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`border-t border-white/5 hover:bg-white/3 cursor-pointer transition-colors ${g.id === selectedGame ? 'bg-[#6C63FF]/8' : ''}`}
                    onClick={() => setSelectedGame(g.id)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="text-white text-xs font-medium">{g.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[#8888AA] text-xs">{g.genre}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[#8888AA] text-xs">{g.result.min}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-sm font-bold ${getFpsColorClass(g.result.estimated)}`}>
                        {g.result.estimated}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[#8888AA] text-xs">{g.result.max}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-[#8888AA] text-xs mt-4 italic">
        Estimates based on aggregated benchmark data. Actual performance varies by driver version, game patch, and system configuration.
      </p>
    </motion.div>
  );
}
