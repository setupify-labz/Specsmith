import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import FpsGauge from './FpsGauge';
import { estimateFpsForBuild, getFpsColorClass } from '../lib/fps';
import type { Resolution, Preset } from '../lib/fps';

interface GPU { gpu_multiplier: number; name: string; [key: string]: unknown; }
interface CPU { cpu_multiplier: number; name: string; [key: string]: unknown; }
interface Game {
  id: string;
  name: string;
  genre: string;
  gpu_bound?: number;
  base_fps: Record<Resolution, Record<Preset, number>>;
  [key: string]: unknown;
}

interface Props {
  gpu: GPU;
  cpu: CPU;
  games: Game[];
  resolution: Resolution;
  preset: Preset;
  onResolutionChange: (r: Resolution) => void;
  onPresetChange: (p: Preset) => void;
}

type FpsTarget = 60 | 144 | 240 | null;

const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const presets: Preset[] = ['low', 'medium', 'high', 'ultra'];
const presetLabels: Record<Preset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
const resLabels: Record<Resolution, string> = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };
const FPS_TARGETS: FpsTarget[] = [60, 144, 240];

function getTargetRowStyle(fps: number, target: FpsTarget): React.CSSProperties {
  if (target === null) return {};
  if (fps >= target) {
    return { backgroundColor: 'rgba(0, 230, 118, 0.08)', borderLeft: '2px solid #00E676' };
  }
  if (fps >= target * 0.85) {
    return { backgroundColor: 'rgba(255, 179, 0, 0.08)', borderLeft: '2px solid #FFB300' };
  }
  return { backgroundColor: 'rgba(255, 23, 68, 0.08)', borderLeft: '2px solid #FF1744' };
}

function getTargetBadge(fps: number, target: FpsTarget): { icon: string; color: string } | null {
  if (target === null) return null;
  if (fps >= target) return { icon: '✓', color: 'var(--ff-green)' };
  if (fps >= target * 0.85) return { icon: '~', color: 'var(--ff-amber)' };
  return { icon: '✗', color: 'var(--ff-red)' };
}

export default function FpsEstimator({ gpu, cpu, games, resolution, preset, onResolutionChange, onPresetChange }: Props) {
  const [selectedGame, setSelectedGame] = useState<string>(games[0]?.id ?? '');
  const [fpsTarget, setFpsTarget] = useState<FpsTarget>(null);

  const currentGame = games.find(g => g.id === selectedGame);
  const result = useMemo(() => {
    if (!currentGame) return null;
    return estimateFpsForBuild(gpu, cpu, currentGame, resolution, preset);
  }, [currentGame, resolution, preset, gpu, cpu]);

  const allGamesResults = useMemo(() => {
    return games.map(g => ({
      ...g,
      result: estimateFpsForBuild(gpu, cpu, g, resolution, preset),
    })).sort((a, b) => b.result.estimated - a.result.estimated);
  }, [games, resolution, preset, gpu, cpu]);

  const toggleStyle = (active: boolean) => active
    ? { backgroundColor: 'var(--ff-accent-solid)', color: '#fff' }
    : { color: 'var(--ff-text-2)', backgroundColor: 'transparent' };

  const targetBtnStyle = (t: FpsTarget) => {
    const isActive = fpsTarget === t;
    return {
      padding: '6px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'pointer',
      border: isActive ? '1px solid var(--ff-accent-solid)' : '1px solid var(--ff-border)',
      backgroundColor: isActive ? 'var(--ff-accent-solid)' : 'transparent',
      color: isActive ? '#fff' : 'var(--ff-text-2)',
      transition: 'all 0.15s',
    } as React.CSSProperties;
  };

  const meetsTarget = fpsTarget !== null
    ? { green: allGamesResults.filter(g => g.result.estimated >= fpsTarget).length,
        yellow: allGamesResults.filter(g => g.result.estimated >= fpsTarget * 0.85 && g.result.estimated < fpsTarget).length,
        red: allGamesResults.filter(g => g.result.estimated < fpsTarget * 0.85).length }
    : null;

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {/* Game */}
        <div>
          <label htmlFor="fps-game-select" className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Game</label>
          <select
            id="fps-game-select"
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
              <button key={r} onClick={() => onResolutionChange(r)}
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
              <button key={p} onClick={() => onPresetChange(p)}
                className="flex-1 py-2 text-xs font-semibold transition-colors"
                style={toggleStyle(preset === p)}>
                {presetLabels[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FPS Target Mode */}
      <div className="flex items-center gap-3 mb-6 p-3 rounded-xl" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
        <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: 'var(--ff-text-2)' }}>
          FPS Target
        </span>
        <div className="flex gap-1.5 flex-wrap">
          {FPS_TARGETS.map(t => (
            <button
              key={t}
              onClick={() => setFpsTarget(fpsTarget === t ? null : t)}
              style={targetBtnStyle(t)}
            >
              {t} FPS
            </button>
          ))}
          {fpsTarget !== null && (
            <button
              onClick={() => setFpsTarget(null)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                border: '1px solid var(--ff-border)',
                backgroundColor: 'transparent',
                color: 'var(--ff-text-3)',
              }}
            >
              Clear
            </button>
          )}
        </div>
        {meetsTarget && (
          <div className="flex items-center gap-3 ml-auto text-xs shrink-0">
            <span style={{ color: 'var(--ff-green)' }}>✓ {meetsTarget.green}</span>
            <span style={{ color: 'var(--ff-amber)' }}>~ {meetsTarget.yellow}</span>
            <span style={{ color: 'var(--ff-red)' }}>✗ {meetsTarget.red}</span>
          </div>
        )}
      </div>

      {/* Gauge */}
      {result && (
        <div className="flex justify-center mb-6">
          <FpsGauge fps={result.estimated} min={result.min} max={result.max} color={result.color} label={result.label} />
        </div>
      )}

      {/* All Games Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm" style={{ color: 'var(--ff-text)' }}>All Games Overview</h4>
          {fpsTarget !== null && (
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ff-text-2)' }}>
              <span className="flex items-center gap-1"><span style={{ color: 'var(--ff-green)' }}>●</span> ≥{fpsTarget}</span>
              <span className="flex items-center gap-1"><span style={{ color: 'var(--ff-amber)' }}>●</span> within 15%</span>
              <span className="flex items-center gap-1"><span style={{ color: 'var(--ff-red)' }}>●</span> below</span>
            </div>
          )}
        </div>
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
                  {fpsTarget !== null && (
                    <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Target</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {allGamesResults.map((g, i) => {
                  const badge = getTargetBadge(g.result.estimated, fpsTarget);
                  const rowStyle = getTargetRowStyle(g.result.estimated, fpsTarget);
                  const isSelected = g.id === selectedGame;
                  return (
                    <motion.tr
                      key={g.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderTop: '1px solid var(--ff-border)',
                        ...(isSelected ? { backgroundColor: 'var(--ff-accent-10)' } : rowStyle),
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--ff-card)';
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) {
                          const el = e.currentTarget as HTMLElement;
                          if (fpsTarget !== null) {
                            const fps = g.result.estimated;
                            if (fps >= fpsTarget) el.style.backgroundColor = 'rgba(0, 230, 118, 0.08)';
                            else if (fps >= fpsTarget * 0.85) el.style.backgroundColor = 'rgba(255, 179, 0, 0.08)';
                            else el.style.backgroundColor = 'rgba(255, 23, 68, 0.08)';
                          } else {
                            el.style.backgroundColor = 'transparent';
                          }
                        }
                      }}
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
                      {fpsTarget !== null && (
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-sm font-bold" style={{ color: badge?.color }}>
                            {badge?.icon}
                          </span>
                        </td>
                      )}
                    </motion.tr>
                  );
                })}
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
